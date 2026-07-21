use anyhow::Result;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let app = faultline_api::router().layer(tower_http::cors::CorsLayer::permissive());
    let addr = std::env::var("FAULTLINE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("faultlined listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
