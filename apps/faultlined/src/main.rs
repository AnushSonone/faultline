use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use faultline_api::{router, AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let fixtures = std::env::var("FAULTLINE_FIXTURES")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("datasets/fixtures"));
    // Applies FAULTLINE_MAX_SESSIONS, FAULTLINE_SESSION_TTL_S, and
    // FAULTLINE_ALLOWED_INCIDENTS on top of the defaults.
    let state = Arc::new(AppState::from_env(fixtures));
    tracing::info!(
        max_sessions = state.max_sessions,
        session_ttl_s = state.session_ttl.as_secs(),
        allowlist = ?state.allowed_incidents,
        "session limits configured"
    );

    // Sweeper: evict sessions idle past the TTL once a minute. Playback tick
    // loops look their session up by id each tick and exit when it is gone.
    let sweep_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let evicted = sweep_state.evict_idle();
            if evicted > 0 {
                tracing::info!("evicted {evicted} idle session(s)");
            }
        }
    });

    let app = router(state);

    // Permissive CORS is load-bearing: the only UI is the embed on
    // anush.wiki/blog/faultline, which calls this API cross-origin. The
    // WebSocket stream cannot be proxied by the wiki's host (Vercel), so
    // same-origin serving is not an option.
    let app = app.layer(tower_http::cors::CorsLayer::permissive());
    let addr = std::env::var("FAULTLINE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("faultlined listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
