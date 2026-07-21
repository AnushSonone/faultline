use std::path::PathBuf;
use std::sync::Arc;

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
    let state = Arc::new(AppState::new(fixtures));
    let app = router(state).layer(tower_http::cors::CorsLayer::permissive());
    let addr = std::env::var("FAULTLINE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("faultlined listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
