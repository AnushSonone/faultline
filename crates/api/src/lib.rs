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
    seek_session, speed_session,
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
}
