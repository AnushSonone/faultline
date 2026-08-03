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
    checkpoint_session, crash_test_session, create_session, explain_query_route, get_trace,
    list_incidents, list_queries, load_session, pause_session, play_session, reset_session,
    resync_session, run_query_route, runtime_inspector, seek_session, session_case,
    session_snapshot, set_projection_mode, speed_session, validate_query_route,
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
        .route(
            "/api/v1/sessions/{id}/projection-mode",
            post(set_projection_mode),
        )
        .route("/api/v1/sessions/{id}/runtime", get(runtime_inspector))
        .route("/api/v1/sessions/{id}/checkpoint", post(checkpoint_session))
        .route("/api/v1/sessions/{id}/crash-test", post(crash_test_session))
        .route("/api/v1/sessions/{id}/snapshot", get(session_snapshot))
        .route("/api/v1/sessions/{id}/case", get(session_case))
        .route("/api/v1/queries", get(list_queries).post(run_query_route))
        .route("/api/v1/queries/validate", post(validate_query_route))
        .route("/api/v1/queries/explain", post(explain_query_route))
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
                    .body(Body::from(
                        r#"{"incident_id":"rec-mem-001","evaluation_mode":true}"#,
                    ))
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

    #[tokio::test]
    async fn case_endpoint_gates_answer_behind_reveal() {
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
        let app = router(state);

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

        // Default: brief present, answer absent.
        let case = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/sessions/{sid}/case"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(case.status(), StatusCode::OK);
        let case_body = to_bytes(case.into_body(), usize::MAX).await.unwrap();
        let case_json: Value = serde_json::from_slice(&case_body).unwrap();
        assert!(case_json["fault_type"].is_string());
        assert!(case_json["event_counts"].is_object());
        assert!(case_json["system"].is_string());
        assert!(
            case_json.get("answer").is_none() || case_json["answer"].is_null(),
            "answer fields must be gated behind ?reveal=true"
        );

        // Reveal: answer present with ground-truth services.
        let revealed = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/sessions/{sid}/case?reveal=true"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revealed.status(), StatusCode::OK);
        let revealed_body = to_bytes(revealed.into_body(), usize::MAX).await.unwrap();
        let revealed_json: Value = serde_json::from_slice(&revealed_body).unwrap();
        assert!(revealed_json["answer"]["root_cause_services"].is_array());
        assert_eq!(
            revealed_json["answer"]["source"].as_str().unwrap(),
            "fixture_ground_truth"
        );
    }

    #[tokio::test]
    async fn root_causes_ranked_and_ground_truth_gated() {
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
        let create_body = to_bytes(create.into_body(), usize::MAX).await.unwrap();
        let create_json: Value = serde_json::from_slice(&create_body).unwrap();
        let sid = create_json["session_id"].as_str().unwrap().to_owned();

        // Default load: no evaluation mode, so no ground truth in the response.
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
        assert!(
            load_json["ground_truth"].is_null(),
            "ground truth must be hidden outside evaluation mode"
        );
        let end = load_json["end_time_ns"].as_i64().unwrap();
        let start = load_json["start_time_ns"].as_i64().unwrap();

        let seek = |t: i64| {
            let app = app.clone();
            let sid = sid.clone();
            async move {
                app.oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/api/v1/sessions/{sid}/seek"))
                        .header("content-type", "application/json")
                        .body(Body::from(format!(r#"{{"event_time_ns":{t}}}"#)))
                        .unwrap(),
                )
                .await
                .unwrap()
            }
        };

        assert_eq!(seek(end).await.status(), StatusCode::OK);
        let full = {
            let sessions = state.sessions.lock();
            let s = sessions.get(&sid).unwrap();
            faultline_projection::build_root_causes(
                "rec-mem-001",
                &s.envelopes,
                s.clock.current_event_time_ns(),
                1,
            )
        };
        assert!(full.incident_onset_ns.is_some());
        let top = &full.candidates[0];
        assert_eq!(top.rank, 1);
        assert_eq!(top.service, "recommendationservice");
        assert_eq!(top.components.len(), 9, "every score component inspectable");
        assert!(!full.evidence.is_empty());

        // Determinism: same cursor, same serialized output.
        let again = {
            let sessions = state.sessions.lock();
            let s = sessions.get(&sid).unwrap();
            faultline_projection::build_root_causes(
                "rec-mem-001",
                &s.envelopes,
                s.clock.current_event_time_ns(),
                1,
            )
        };
        assert_eq!(
            serde_json::to_string(&full).unwrap(),
            serde_json::to_string(&again).unwrap()
        );

        // Seek back before the fault: cursor-bounded rebuild finds no incident.
        assert_eq!(seek(start).await.status(), StatusCode::OK);
        let early = {
            let sessions = state.sessions.lock();
            let s = sessions.get(&sid).unwrap();
            faultline_projection::build_root_causes(
                "rec-mem-001",
                &s.envelopes,
                s.clock.current_event_time_ns(),
                2,
            )
        };
        assert!(early.incident_onset_ns.is_none());
    }

    /// M6 exit gate: checkpoint -> forced crash -> recovery restores active
    /// state with no duplicate evidence (spec 25.4 integration chain).
    #[tokio::test]
    async fn checkpoint_crash_recover_without_duplicates() {
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
        let checkpoints = tempfile::tempdir().unwrap();
        let state = std::sync::Arc::new(AppState::with_roots(fixtures, checkpoints.path()));
        let app = router(state.clone());

        let post = |uri: String, body: &'static str| {
            let app = app.clone();
            async move {
                app.oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(uri)
                        .header("content-type", "application/json")
                        .body(if body.is_empty() {
                            Body::empty()
                        } else {
                            Body::from(body)
                        })
                        .unwrap(),
                )
                .await
                .unwrap()
            }
        };

        let create = post("/api/v1/sessions".into(), "").await;
        let body = to_bytes(create.into_body(), usize::MAX).await.unwrap();
        let sid = serde_json::from_slice::<Value>(&body).unwrap()["session_id"]
            .as_str()
            .unwrap()
            .to_owned();

        let load = post(
            format!("/api/v1/sessions/{sid}/load"),
            r#"{"incident_id":"rec-mem-001"}"#,
        )
        .await;
        assert_eq!(load.status(), StatusCode::OK);
        let load_body = to_bytes(load.into_body(), usize::MAX).await.unwrap();
        let load_json: Value = serde_json::from_slice(&load_body).unwrap();
        let end = load_json["end_time_ns"].as_i64().unwrap();

        // Seek to end of incident so evidence exists, then checkpoint.
        let seek = post(
            format!("/api/v1/sessions/{sid}/seek"),
            Box::leak(format!(r#"{{"event_time_ns":{end}}}"#).into_boxed_str()),
        )
        .await;
        assert_eq!(seek.status(), StatusCode::OK);

        let cp = post(format!("/api/v1/sessions/{sid}/checkpoint"), "").await;
        assert_eq!(cp.status(), StatusCode::OK);
        let cp_body = to_bytes(cp.into_body(), usize::MAX).await.unwrap();
        let cp_json: Value = serde_json::from_slice(&cp_body).unwrap();
        assert!(cp_json["checkpoint_bytes"].as_u64().unwrap() > 0);

        let crash = post(format!("/api/v1/sessions/{sid}/crash-test"), "").await;
        assert_eq!(crash.status(), StatusCode::OK);
        let crash_body = to_bytes(crash.into_body(), usize::MAX).await.unwrap();
        let report: Value = serde_json::from_slice(&crash_body).unwrap();
        assert_eq!(
            report["duplicates_after_recovery"], false,
            "recovery minted duplicate evidence: {report}"
        );
        assert_eq!(report["cursor_ns"].as_i64().unwrap(), end);
        assert!(report["evidence_id_count"].as_u64().unwrap() > 0);
        assert_eq!(report["fell_back"], false);

        // Session is alive and consistent after recovery.
        {
            let sessions = state.sessions.lock();
            let s = sessions.get(&sid).unwrap();
            assert_eq!(s.envelopes.len(), 387);
            assert_eq!(s.clock.current_event_time_ns(), end);
            let rc = faultline_projection::build_root_causes(
                "rec-mem-001",
                &s.envelopes,
                s.clock.current_event_time_ns(),
                1,
            );
            assert_eq!(rc.candidates[0].service, "recommendationservice");
        }

        // Snapshot endpoint reports the checkpoint.
        let snap = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/sessions/{sid}/snapshot"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let snap_body = to_bytes(snap.into_body(), usize::MAX).await.unwrap();
        let snap_json: Value = serde_json::from_slice(&snap_body).unwrap();
        assert!(snap_json["latest_checkpoint"].is_string());
    }

    fn create_session_request() -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/api/v1/sessions")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn session_cap_returns_demo_busy() {
        use axum::body::to_bytes;
        use serde_json::Value;
        use std::time::Duration;

        let tmp = tempfile::tempdir().unwrap();
        let state = std::sync::Arc::new(
            AppState::with_roots(tmp.path(), tmp.path()).with_limits(1, Duration::from_secs(900)),
        );
        let app = router(state);

        let first = app.clone().oneshot(create_session_request()).await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        let second = app.clone().oneshot(create_session_request()).await.unwrap();
        assert_eq!(second.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(second.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"], "demo_busy");
    }

    #[tokio::test]
    async fn idle_sessions_evicted_on_create() {
        use std::time::Duration;

        let tmp = tempfile::tempdir().unwrap();
        let state = std::sync::Arc::new(
            AppState::with_roots(tmp.path(), tmp.path()).with_limits(1, Duration::ZERO),
        );
        let app = router(state.clone());

        let first = app.clone().oneshot(create_session_request()).await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        // TTL zero: the first session is idle-expired by the time the second
        // create runs, so eviction frees the single slot.
        let second = app.clone().oneshot(create_session_request()).await.unwrap();
        assert_eq!(second.status(), StatusCode::OK);
        assert_eq!(state.sessions.lock().len(), 1);
    }

    #[tokio::test]
    async fn orphaned_sessions_evicted_before_ttl() {
        use std::time::{Duration, Instant};

        let tmp = tempfile::tempdir().unwrap();
        // Long TTL: only the orphan grace can free the slot.
        let state = std::sync::Arc::new(
            AppState::with_roots(tmp.path(), tmp.path()).with_limits(1, Duration::from_secs(3600)),
        );
        let app = router(state.clone());

        let first = app.clone().oneshot(create_session_request()).await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        // No WS subscriber ever attached; backdate past the orphan grace.
        {
            let mut sessions = state.sessions.lock();
            let s = sessions.values_mut().next().unwrap();
            s.last_activity = Instant::now() - Duration::from_secs(120);
        }

        let second = app.clone().oneshot(create_session_request()).await.unwrap();
        assert_eq!(
            second.status(),
            StatusCode::OK,
            "orphaned session must free its slot before the TTL"
        );
        assert_eq!(state.sessions.lock().len(), 1);
    }

    #[tokio::test]
    async fn allowlist_filters_incidents_and_blocks_load() {
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
        let state =
            std::sync::Arc::new(AppState::new(fixtures).with_allowed_incidents(["rec-mem-001"]));
        let app = router(state);

        // Listing only shows allowlisted incidents.
        let list = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/incidents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list.status(), StatusCode::OK);
        let list_body = to_bytes(list.into_body(), usize::MAX).await.unwrap();
        let incidents: Vec<Value> = serde_json::from_slice(&list_body).unwrap();
        assert_eq!(incidents.len(), 1, "allowlist must filter listing");
        assert_eq!(incidents[0]["incident_id"], "rec-mem-001");

        let create = app.clone().oneshot(create_session_request()).await.unwrap();
        let create_body = to_bytes(create.into_body(), usize::MAX).await.unwrap();
        let create_json: Value = serde_json::from_slice(&create_body).unwrap();
        let sid = create_json["session_id"].as_str().unwrap().to_owned();

        // Loading an incident outside the allowlist is forbidden.
        let load = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/sessions/{sid}/load"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"incident_id":"eval-cpu-cart-007"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(load.status(), StatusCode::FORBIDDEN);
        let load_body = to_bytes(load.into_body(), usize::MAX).await.unwrap();
        let load_json: Value = serde_json::from_slice(&load_body).unwrap();
        assert_eq!(load_json["error"], "incident_not_allowed");

        // Loads by explicit path are also rejected while an allowlist is on.
        let path_load = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/sessions/{sid}/load"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"incident_path":"/tmp/anything"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(path_load.status(), StatusCode::FORBIDDEN);

        // The allowlisted incident still loads.
        let ok_load = app
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
        assert_eq!(ok_load.status(), StatusCode::OK);
    }
}
