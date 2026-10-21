use api_server::{app, state::AppState};
use std::net::SocketAddr;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr: SocketAddr = match format!("{host}:{port}").parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("invalid HOST/PORT: {e}");
            std::process::exit(2);
        }
    };
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cannot bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!(
        "pipe-robot API listening on http://{}",
        listener.local_addr().unwrap_or(addr)
    );
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutting down");
    };
    if let Err(e) = axum::serve(listener, app(AppState::new()))
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("server error: {e}");
        std::process::exit(1);
    }
}
