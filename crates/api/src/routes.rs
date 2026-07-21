//! REST routes for health, incidents, sessions, and traces.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};

use crate::sessions::{
    clock_state_label, parse_speed, CreateSessionResponse, LoadRequest, SeekRequest, SharedState,
    SpeedRequest,
};

pub fn api_prefix() -> &'static str {
    "/api/v1"
}

#[derive(Debug, Clone, Serialize)]
pub struct IncidentSummary {
    pub incident_id: String,
    pub dataset_id: String,
    pub dataset_version: String,
    pub path: String,
}

pub async fn list_incidents(State(state): State<SharedState>) -> Json<Vec<IncidentSummary>> {
    let mut out = Vec::new();
    let root = &state.fixtures_root;
    // synthetic-ob/v1/*
    let synthetic = root.join("synthetic-ob").join("v1");
    if let Ok(entries) = std::fs::read_dir(&synthetic) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.join("manifest.json").exists() {
                let id = entry.file_name().to_string_lossy().into_owned();
                out.push(IncidentSummary {
                    incident_id: id,
                    dataset_id: "synthetic-ob".into(),
                    dataset_version: "v1".into(),
                    path: path.display().to_string(),
                });
            }
        }
    }
    // Also list direct children with manifest
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.join("manifest.json").exists() {
                let id = entry.file_name().to_string_lossy().into_owned();
                if !out.iter().any(|i| i.incident_id == id) {
                    out.push(IncidentSummary {
                        incident_id: id,
                        dataset_id: "local".into(),
                        dataset_version: "v1".into(),
                        path: path.display().to_string(),
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.incident_id.cmp(&b.incident_id));
    Json(out)
}

pub async fn create_session(State(state): State<SharedState>) -> Json<CreateSessionResponse> {
    let session_id = state.create_session();
    Json(CreateSessionResponse { session_id })
}

pub async fn load_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
    Json(body): Json<LoadRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = state
        .resolve_incident_path(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    let mut sessions = state.sessions.lock();
    let session = sessions.get_mut(&session_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "session not found"})),
        )
    })?;
    session
        .load_from_path(&path)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    session.emit(
        "session.ready",
        json!({
            "session_id": session_id,
            "incident_id": session.incident_id,
            "event_count": session.envelopes.len(),
        }),
    );
    Ok(Json(json!({
        "session_id": session_id,
        "incident_id": session.incident_id,
        "event_count": session.envelopes.len(),
        "start_time_ns": session.clock.start_ns(),
        "end_time_ns": session.clock.end_ns(),
    })))
}

pub async fn play_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let label = with_session(&state, &session_id, |s| {
        s.clock.play();
        s.publish_projections();
        json!({ "state": clock_state_label(s.clock.state()) })
    })?;

    let state_tick = state.clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        use faultline_replay::ClockState;
        use std::time::Duration;
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let mut sessions = state_tick.sessions.lock();
            let Some(session) = sessions.get_mut(&sid) else {
                break;
            };
            if session.clock.state() != ClockState::Playing {
                break;
            }
            session.clock.tick_wall(Duration::from_millis(150));
            session.publish_projections();
            if session.clock.state() != ClockState::Playing {
                break;
            }
        }
    });

    Ok(label)
}

pub async fn pause_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        s.clock.pause();
        s.emit(
            "replay.status",
            json!({ "state": clock_state_label(s.clock.state()) }),
        );
        json!({ "state": clock_state_label(s.clock.state()) })
    })
}

pub async fn seek_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
    Json(body): Json<SeekRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        s.clock.seek(body.event_time_ns);
        s.publish_projections();
        json!({ "event_time_ns": s.clock.current_event_time_ns() })
    })
}

pub async fn speed_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
    Json(body): Json<SpeedRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let speed = parse_speed(&body.speed)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    with_session(&state, &session_id, |s| {
        s.clock.set_speed(speed);
        json!({ "speed": body.speed })
    })
}

pub async fn get_trace(
    State(state): State<SharedState>,
    Path(trace_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let sessions = state.sessions.lock();
    for session in sessions.values() {
        if let Some(dag) = session.get_trace(&trace_id) {
            return Ok(Json(serde_json::to_value(dag).unwrap_or(json!({}))));
        }
    }
    Err((
        StatusCode::NOT_FOUND,
        Json(json!({"error": "trace not found"})),
    ))
}

fn with_session<F>(
    state: &SharedState,
    session_id: &str,
    f: F,
) -> Result<Json<Value>, (StatusCode, Json<Value>)>
where
    F: FnOnce(&mut crate::sessions::Session) -> Value,
{
    let mut sessions = state.sessions.lock();
    let session = sessions.get_mut(session_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "session not found"})),
        )
    })?;
    Ok(Json(f(session)))
}
