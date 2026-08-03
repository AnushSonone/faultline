//! REST routes for health, incidents, sessions, and traces.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};

use crate::sessions::{
    clock_state_label, parse_speed, CaseQuery, CreateSessionResponse, LoadRequest,
    ProjectionModeRequest, SeekRequest, SharedState, SpeedRequest,
};
use faultline_engine::ProjectionMode;

#[derive(Debug, Clone, Serialize)]
pub struct IncidentSummary {
    pub incident_id: String,
    pub dataset_id: String,
    pub dataset_version: String,
    pub path: String,
}

pub async fn list_incidents(State(state): State<SharedState>) -> Json<Vec<IncidentSummary>> {
    let out = faultline_catalog::discover_incidents(&state.fixtures_root)
        .into_iter()
        .filter(|i| state.incident_allowed(&i.incident_id))
        .map(|i| IncidentSummary {
            incident_id: i.incident_id,
            dataset_id: i.dataset_id,
            dataset_version: i.dataset_version,
            path: i.path.display().to_string(),
        })
        .collect();
    Json(out)
}

pub async fn create_session(
    State(state): State<SharedState>,
) -> Result<Json<CreateSessionResponse>, (StatusCode, Json<Value>)> {
    match state.create_session() {
        Some(session_id) => Ok(Json(CreateSessionResponse { session_id })),
        None => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "demo_busy"})),
        )),
    }
}

pub async fn load_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
    Json(body): Json<LoadRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if state.allowed_incidents.is_some() {
        let permitted = match (&body.incident_path, &body.incident_id) {
            // Path loads bypass the id check entirely, so they are rejected
            // outright whenever an allowlist is active.
            (Some(_), _) => false,
            (None, Some(id)) => state.incident_allowed(id),
            // Neither given: fall through to the 400 from resolve below.
            (None, None) => true,
        };
        if !permitted {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": "incident_not_allowed"})),
            ));
        }
    }
    let path = state
        .resolve_incident_path(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    with_session_try(&state, &session_id, |session| {
        session
            .load_from_path(&path, body.adversarial)
            .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
        // Ground truth is hidden outside evaluation mode (spec M4 exit criterion).
        let ground_truth = session
            .labels
            .as_ref()
            .filter(|_| body.evaluation_mode)
            .map(|labels| {
                json!({
                    "source": "fixture_ground_truth",
                    "not_inferred": true,
                    "fault_type": labels.fault_type,
                    "root_cause_services": labels.root_cause_services,
                    "root_cause_indicators": labels.root_cause_indicators,
                    "fault_start_time_ns": labels.fault_start_time_ns,
                    "fault_end_time_ns": labels.fault_end_time_ns,
                    "notes": labels.notes,
                })
            });
        session.emit(
            "session.ready",
            json!({
                "session_id": session_id,
                "incident_id": session.incident_id,
                "event_count": session.envelopes.len(),
                "ground_truth": ground_truth.clone(),
            }),
        );
        session.publish_projections();
        Ok(Json(json!({
            "session_id": session_id,
            "incident_id": session.incident_id,
            "event_count": session.envelopes.len(),
            "start_time_ns": session.clock.start_ns(),
            "end_time_ns": session.clock.end_ns(),
            "ground_truth": ground_truth,
        })))
    })
}

pub async fn play_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let epoch = {
        let mut sessions = state.sessions.lock();
        let session = sessions.get_mut(&session_id).ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "session not found"})),
            )
        })?;
        session.touch();
        session.playback_epoch = session.playback_epoch.saturating_add(1);
        let epoch = session.playback_epoch;
        session.clock.play();
        session.publish_projections();
        epoch
    };

    let state_tick = state.clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        use faultline_replay::ClockState;
        use std::time::Duration;
        // Ticks with no WS subscriber before playback auto-pauses. Rebuilding
        // and broadcasting projections to nobody holds the sessions lock for
        // nothing; abandoned playing sessions must not accumulate that cost.
        // ~3s of grace covers the client's 750ms reconnect retry.
        const MAX_UNOBSERVED_TICKS: u32 = 20;
        let mut unobserved_ticks: u32 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let mut sessions = state_tick.sessions.lock();
            let Some(session) = sessions.get_mut(&sid) else {
                break;
            };
            if session.playback_epoch != epoch || session.clock.state() != ClockState::Playing {
                break;
            }
            if session.broadcast.receiver_count() == 0 {
                unobserved_ticks += 1;
                if unobserved_ticks >= MAX_UNOBSERVED_TICKS {
                    session.clock.pause();
                    break;
                }
            } else {
                unobserved_ticks = 0;
            }
            session.clock.tick_wall(Duration::from_millis(150));
            session.publish_projections();
            if session.playback_epoch != epoch || session.clock.state() != ClockState::Playing {
                break;
            }
        }
    });

    Ok(Json(json!({ "state": "playing", "playback_epoch": epoch })))
}

pub async fn pause_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        s.playback_epoch = s.playback_epoch.saturating_add(1);
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

pub async fn reset_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        s.reset_replay();
        json!({
            "state": clock_state_label(s.clock.state()),
            "event_time_ns": s.clock.current_event_time_ns(),
        })
    })
}

/// Republish full projection snapshots (WS gap / reconnect recovery for M2).
pub async fn resync_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        s.publish_projections();
        json!({
            "session_id": session_id,
            "event_time_ns": s.clock.current_event_time_ns(),
            "projection_version": s.projection_version,
            "ws_sequence": s.ws_sequence,
        })
    })
}

pub async fn set_projection_mode(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
    Json(body): Json<ProjectionModeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mode = match body.mode.to_ascii_lowercase().as_str() {
        "streaming" => ProjectionMode::Streaming,
        "precomputed" => ProjectionMode::Precomputed,
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("invalid mode: {other}")})),
            ));
        }
    };
    // Streaming mode replays the full arrival order on every publish (M3
    // known issue: rebuild is not incremental), which is unusable past the
    // size threshold; refuse rather than wedge the server.
    if mode == ProjectionMode::Streaming {
        let sessions = state.sessions.lock();
        if let Some(s) = sessions.get(&session_id) {
            if s.envelopes.len() > crate::sessions::Session::STREAMING_HEATMAP_MAX_EVENTS {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(json!({
                        "error": "incident too large for streaming heatmap replay; precomputed only"
                    })),
                ));
            }
        }
    }
    with_session(&state, &session_id, |s| {
        s.set_projection_mode(mode);
        s.publish_projections();
        json!({ "mode": body.mode })
    })
}

pub async fn runtime_inspector(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        serde_json::to_value(s.inspector()).unwrap_or(json!({}))
    })
}

/// Write an atomic checkpoint (TA-040).
pub async fn checkpoint_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let store = state.checkpoint_store(&session_id);
    with_session_try(&state, &session_id, |session| {
        match session.checkpoint(&store) {
            Ok(metrics) => Ok(Json(serde_json::to_value(metrics).unwrap_or(json!({})))),
            Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e})))),
        }
    })
}

/// Forced crash + recovery from the latest checkpoint (TA-042).
pub async fn crash_test_session(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let store = state.checkpoint_store(&session_id);
    with_session_try(&state, &session_id, |session| {
        match session.crash_and_recover(&store) {
            Ok(report) => Ok(Json(report)),
            Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e})))),
        }
    })
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct QueryRequest {
    pub sql: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// Registered queries (TA-047 API surface).
pub async fn list_queries(State(state): State<SharedState>) -> Json<Value> {
    Json(json!({ "queries": *state.queries.lock() }))
}

/// Validate without executing.
pub async fn validate_query_route(
    Json(body): Json<QueryRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match faultline_planner::validate_query(&body.sql) {
        Ok(explain) => Ok(Json(json!({ "valid": true, "explain": explain }))),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "valid": false, "error": e })),
        )),
    }
}

/// EXPLAIN (with ANALYZE when a session is supplied).
pub async fn explain_query_route(
    State(state): State<SharedState>,
    Json(body): Json<QueryRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let Some(session_id) = &body.session_id else {
        return validate_query_route(Json(body)).await;
    };
    with_session_try(&state, session_id, |session| {
        let cursor = session.clock.current_event_time_ns();
        match faultline_planner::run_query(&body.sql, &session.envelopes, cursor) {
            Ok((_, explain)) => Ok(Json(json!({ "explain": explain }))),
            Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "error": e })))),
        }
    })
}

/// Register + execute a query against a session at its cursor. Emits
/// query.plan and query.metrics on the session stream.
pub async fn run_query_route(
    State(state): State<SharedState>,
    Json(body): Json<QueryRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let Some(session_id) = &body.session_id else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "session_id required to execute"})),
        ));
    };
    with_session_try(&state, session_id, |session| {
        let cursor = session.clock.current_event_time_ns();
        match faultline_planner::run_query(&body.sql, &session.envelopes, cursor) {
            Ok((result, explain)) => {
                session.emit(
                    "query.plan",
                    serde_json::to_value(&explain).unwrap_or(json!({})),
                );
                session.emit(
                    "query.metrics",
                    serde_json::to_value(&result.metrics).unwrap_or(json!({})),
                );
                let mut queries = state.queries.lock();
                if !queries.iter().any(|q| q["sql"] == body.sql) {
                    let id = queries.len() + 1;
                    queries.push(json!({ "id": id, "sql": body.sql }));
                }
                Ok(Json(json!({ "result": result, "explain": explain })))
            }
            Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "error": e })))),
        }
    })
}

/// Latest checkpoint summary for a session.
pub async fn session_snapshot(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let store = state.checkpoint_store(&session_id);
    with_session(&state, &session_id, |s| {
        json!({
            "session_id": s.id,
            "latest_checkpoint": store.latest_pointer(),
            "checkpoints": store.list_ids(),
            "last_checkpoint": s.last_checkpoint,
        })
    })
}

/// Case metadata for the loaded incident. Always returns the manifest brief
/// (system, fault type, injection time, counts, sampling notes); the answer
/// fields (`root_cause_services`, `root_cause_indicators`,
/// `expected_downstream_services`) require an explicit `?reveal=true`,
/// mirroring the `evaluation_mode` gate on load (spec M4 exit criterion).
/// The inference path never reads labels regardless.
pub async fn session_case(
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
    Query(query): Query<CaseQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    with_session(&state, &session_id, |s| {
        let manifest = s.manifest.as_ref();
        let labels = s.labels.as_ref();
        let mut body = json!({
            "session_id": s.id,
            "incident_id": s.incident_id,
            "system": manifest.map(|m| m.system.clone()),
            "dataset_id": manifest.map(|m| m.dataset_id.clone()),
            "dataset_version": manifest.map(|m| m.dataset_version.clone()),
            "signals": manifest.map(|m| m.signals.clone()),
            "event_counts": manifest.map(|m| m.event_counts.clone()),
            "start_time_ns": s.clock.start_ns(),
            "end_time_ns": s.clock.end_ns(),
            "adversarial": s.adversarial,
            "fault_type": labels.map(|l| l.fault_type.clone()),
            "fault_start_time_ns": labels.map(|l| l.fault_start_time_ns),
            "fault_end_time_ns": labels.map(|l| l.fault_end_time_ns),
            "notes": labels.map(|l| l.notes.clone()),
            "labels_gated": true,
        });
        if query.reveal {
            if let (Some(obj), Some(l)) = (body.as_object_mut(), labels) {
                obj.insert(
                    "answer".into(),
                    json!({
                        "source": "fixture_ground_truth",
                        "not_inferred": true,
                        "root_cause_services": l.root_cause_services,
                        "root_cause_indicators": l.root_cause_indicators,
                        "expected_downstream_services": l.expected_downstream_services,
                    }),
                );
            }
        }
        body
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
    with_session_try(state, session_id, |s| Ok(Json(f(s))))
}

/// Like `with_session`, but the closure picks its own success type and can
/// fail with its own status code.
fn with_session_try<T, F>(
    state: &SharedState,
    session_id: &str,
    f: F,
) -> Result<T, (StatusCode, Json<Value>)>
where
    F: FnOnce(&mut crate::sessions::Session) -> Result<T, (StatusCode, Json<Value>)>,
{
    let mut sessions = state.sessions.lock();
    let session = sessions.get_mut(session_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "session not found"})),
        )
    })?;
    session.touch();
    f(session)
}
