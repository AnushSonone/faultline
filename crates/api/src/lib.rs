//! HTTP and WebSocket API surface for faultlined.

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;

pub mod routes;
pub mod sessions;
pub mod websocket;

pub use sessions::{AppState, SharedState};
pub use websocket::PROTOCOL_VERSION;

use routes::{
    create_session, get_trace, list_incidents, load_session, pause_session, play_session,
    reset_session, resync_session, seek_session, speed_session,
};
use websocket::stream_handler;

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "faultlined",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Build the full API router with shared session state.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/incidents", get(list_incidents))
        .route("/api/v1/sessions", post(create_session))
        .route("/api/v1/sessions/{id}/load", post(load_session))
        .route("/api/v1/sessions/{id}/play", post(play_session))
        .route("/api/v1/sessions/{id}/pause", post(pause_session))
        .route("/api/v1/sessions/{id}/seek", post(seek_session))
        .route("/api/v1/sessions/{id}/speed", post(speed_session))
        .route("/api/v1/sessions/{id}/reset", post(reset_session))
        .route("/api/v1/sessions/{id}/resync", post(resync_session))
        .route("/api/v1/sessions/{id}/stream", get(stream_handler))
        .route("/api/v1/traces/{trace_id}", get(get_trace))
        .with_state(state)
}

/// Convenience router with default fixtures root (`datasets/fixtures`).
pub fn router_with_fixtures(fixtures_root: impl Into<std::path::PathBuf>) -> Router {
    router(std::sync::Arc::new(AppState::new(fixtures_root)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_ok() {
        let app = router_with_fixtures(std::env::temp_dir());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn seek_back_rebuilds_smaller_topology() {
        use axum::body::to_bytes;
        use serde_json::Value;
        use std::path::PathBuf;

        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../datasets/fixtures");
        if !fixtures
            .join("synthetic-ob/v1/rec-mem-001/manifest.json")
            .exists()
        {
            return;
        }
        let state = std::sync::Arc::new(AppState::new(fixtures));
        let app = router(state.clone());

        let create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create.status(), StatusCode::OK);
        let create_body = to_bytes(create.into_body(), usize::MAX).await.unwrap();
        let create_json: Value = serde_json::from_slice(&create_body).unwrap();
        let sid = create_json["session_id"].as_str().unwrap().to_owned();

        let load = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/sessions/{sid}/load"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"incident_id":"rec-mem-001"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(load.status(), StatusCode::OK);
        let load_body = to_bytes(load.into_body(), usize::MAX).await.unwrap();
        let load_json: Value = serde_json::from_slice(&load_body).unwrap();
        assert_eq!(load_json["event_count"].as_u64().unwrap(), 387);
        assert_eq!(
            load_json["ground_truth"]["source"].as_str().unwrap(),
            "fixture_ground_truth"
        );

        let end = load_json["end_time_ns"].as_i64().unwrap();
        let start = load_json["start_time_ns"].as_i64().unwrap();

        let seek_end = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/sessions/{sid}/seek"))
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"event_time_ns":{end}}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(seek_end.status(), StatusCode::OK);

        let late_nodes = {
            let sessions = state.sessions.lock();
            let s = sessions.get(&sid).unwrap();
            let topo = faultline_projection::build_topology(
                &s.envelopes,
                s.clock.current_event_time_ns(),
                1,
            );
            topo.graph.nodes.len()
        };

        let seek_start = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/sessions/{sid}/seek"))
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"event_time_ns":{start}}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(seek_start.status(), StatusCode::OK);

        let early_nodes = {
            let sessions = state.sessions.lock();
            let s = sessions.get(&sid).unwrap();
            let topo = faultline_projection::build_topology(
                &s.envelopes,
                s.clock.current_event_time_ns(),
                2,
            );
            topo.graph.nodes.len()
        };

        assert!(
            early_nodes <= late_nodes,
            "seek-back must not retain later topology ({early_nodes} > {late_nodes})"
        );
    }
}
