//! HTTP + WebSocket API around the simulation engine.
//!
//! The Rust process owns all simulation state; clients only send commands
//! and render the data they receive.

pub mod error;
pub mod handlers;
pub mod state;
pub mod ws;

use axum::Router;
use axum::routing::{get, post, put};
use state::AppState;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

pub fn app(state: AppState) -> Router {
    use handlers::*;
    let api = Router::new()
        .route("/health", get(health))
        .route("/openapi.yaml", get(openapi))
        .route("/config/default", get(default_config))
        .route("/config/validate", post(validate_config))
        .route("/analysis/feasibility", post(feasibility))
        .route("/analysis/cross-section", post(cross_section))
        .route("/experiments/presets", get(list_presets))
        .route("/experiments/compare", post(compare))
        .route(
            "/simulations",
            get(list_simulations).post(create_simulation),
        )
        .route(
            "/simulations/{id}",
            axum::routing::delete(delete_simulation),
        )
        .route("/simulations/{id}/start", post(start))
        .route("/simulations/{id}/pause", post(pause))
        .route("/simulations/{id}/resume", post(resume))
        .route("/simulations/{id}/stop", post(stop))
        .route("/simulations/{id}/reset", post(reset))
        .route("/simulations/{id}/run", post(run_now))
        .route("/simulations/{id}/playback", put(set_playback))
        .route("/simulations/{id}/status", get(status))
        .route("/simulations/{id}/telemetry", get(telemetry))
        .route("/simulations/{id}/results", get(results))
        .route("/simulations/{id}/ws", get(ws::ws_handler));
    Router::new()
        .nest("/api", api)
        .fallback(|| async { error::ApiError::not_found("route") })
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
