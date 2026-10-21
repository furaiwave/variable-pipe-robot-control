//! REST handlers.

use crate::error::{ApiError, ApiJson, ApiResult};
use crate::state::{AppState, SimEntry, ensure_runner};
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use control_algorithms::ControllerConfig;
use robot_core::{RobotConfig, ValidationIssue};
use serde::{Deserialize, Serialize};
use simulation_engine::analysis::{CrossSectionView, FeasibilityReport};
use simulation_engine::experiments::{ExperimentPreset, all_controllers, presets};
use simulation_engine::telemetry::{TelemetrySample, to_csv};
use simulation_engine::{
    SimulationConfig, SimulationResults, SimulationStatus, StatusSnapshot, analyze_feasibility,
    cross_section_view,
};
use std::sync::Arc;
use uuid::Uuid;

fn parse_id(id: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(id)
        .map_err(|_| ApiError::bad_request(format!("'{id}' is not a valid simulation id")))
}

fn entry(state: &AppState, id: &str) -> ApiResult<Arc<SimEntry>> {
    let uuid = parse_id(id)?;
    state
        .get(&uuid)
        .ok_or_else(|| ApiError::not_found(&format!("simulation {uuid}")))
}

#[derive(Serialize)]
pub struct Health {
    status: &'static str,
    engine_version: &'static str,
    uptime_s: f64,
    simulations: usize,
}

pub async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok",
        engine_version: simulation_engine::ENGINE_VERSION,
        uptime_s: state.started.elapsed().as_secs_f64(),
        simulations: state.list().len(),
    })
}

pub async fn default_config() -> Json<SimulationConfig> {
    Json(SimulationConfig::default())
}

#[derive(Serialize)]
pub struct ValidationResponse {
    valid: bool,
    issues: Vec<ValidationIssue>,
}

pub async fn validate_config(ApiJson(cfg): ApiJson<SimulationConfig>) -> Json<ValidationResponse> {
    match cfg.validate() {
        Ok(()) => Json(ValidationResponse {
            valid: true,
            issues: vec![],
        }),
        Err(e) => Json(ValidationResponse {
            valid: false,
            issues: e.issues,
        }),
    }
}

pub async fn feasibility(
    ApiJson(cfg): ApiJson<SimulationConfig>,
) -> ApiResult<Json<FeasibilityReport>> {
    let report = tokio::task::spawn_blocking(move || analyze_feasibility(&cfg))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))??;
    Ok(Json(report))
}

#[derive(Deserialize)]
pub struct CrossSectionRequest {
    robot: RobotConfig,
    diameter: f64,
    #[serde(default)]
    lateral_offset: f64,
    #[serde(default = "default_margin")]
    safety_margin: f64,
}

fn default_margin() -> f64 {
    0.005
}

pub async fn cross_section(
    ApiJson(req): ApiJson<CrossSectionRequest>,
) -> ApiResult<Json<CrossSectionView>> {
    let mut v = robot_core::Validator::new("");
    v.range("diameter", req.diameter, 0.02, 5.0);
    v.range("lateral_offset", req.lateral_offset, -2.5, 2.5);
    v.range("safety_margin", req.safety_margin, 0.0, 0.5);
    v.finish()?;
    Ok(Json(cross_section_view(
        &req.robot,
        req.diameter,
        req.lateral_offset,
        req.safety_margin,
    )?))
}

pub async fn list_presets() -> Json<Vec<ExperimentPreset>> {
    Json(presets())
}

// ---------------------------------------------------------------- simulations

#[derive(Serialize)]
pub struct SimulationSummary {
    id: Uuid,
    name: String,
    controller: String,
    status: SimulationStatus,
    created_at_ms: u64,
    time: f64,
    progress: f64,
    scenario_hash: String,
    playback_speed: f64,
}

fn summary(e: &SimEntry) -> SimulationSummary {
    let sim = e.lock();
    let snap = sim.snapshot();
    SimulationSummary {
        id: e.id,
        name: snap.name,
        controller: snap.controller,
        status: snap.status,
        created_at_ms: e.created_at_ms,
        time: snap.time,
        progress: snap.progress,
        scenario_hash: sim.config().scenario_hash(),
        playback_speed: e.playback(),
    }
}

pub async fn list_simulations(State(state): State<AppState>) -> Json<Vec<SimulationSummary>> {
    Json(state.list().iter().map(|e| summary(e)).collect())
}

#[derive(Serialize)]
pub struct StatusResponse {
    id: Uuid,
    playback_speed: f64,
    #[serde(flatten)]
    snapshot: StatusSnapshot,
}

fn status_of(e: &SimEntry) -> StatusResponse {
    StatusResponse {
        id: e.id,
        playback_speed: e.playback(),
        snapshot: e.lock().snapshot(),
    }
}

#[derive(Deserialize, Default)]
pub struct CreateQuery {
    playback_speed: Option<f64>,
}

pub async fn create_simulation(
    State(state): State<AppState>,
    Query(q): Query<CreateQuery>,
    ApiJson(cfg): ApiJson<SimulationConfig>,
) -> ApiResult<(StatusCode, Json<StatusResponse>)> {
    let playback = q.playback_speed.unwrap_or(1.0);
    if !playback.is_finite() {
        return Err(ApiError::bad_request("playback_speed must be finite"));
    }
    // Construction computes the lateral-margin profile; keep it off the reactor.
    let st = state.clone();
    let entry = tokio::task::spawn_blocking(move || st.create(cfg, playback))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))??;
    tracing::info!(id = %entry.id, "simulation created");
    Ok((StatusCode::CREATED, Json(status_of(&entry))))
}

#[derive(Deserialize, Default)]
pub struct PlaybackBody {
    playback_speed: Option<f64>,
}

/// Optional JSON body: empty → None.
fn optional_playback(body: &axum::body::Bytes) -> ApiResult<Option<PlaybackBody>> {
    if body.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok(None);
    }
    serde_json::from_slice(body)
        .map(Some)
        .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, "invalid_json", e.to_string()))
}

fn apply_playback(e: &SimEntry, body: Option<PlaybackBody>) -> ApiResult<()> {
    if let Some(v) = body.and_then(|b| b.playback_speed) {
        if !v.is_finite() || v <= 0.0 {
            return Err(ApiError::bad_request(
                "playback_speed must be a positive finite number",
            ));
        }
        e.set_playback(v);
    }
    Ok(())
}

pub async fn start(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    apply_playback(&e, optional_playback(&body)?)?;
    e.lock().start()?;
    e.cancel.store(false, std::sync::atomic::Ordering::Relaxed);
    ensure_runner(e.clone());
    e.notify();
    Ok(Json(status_of(&e)))
}

pub async fn pause(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    e.lock().pause()?;
    e.notify();
    Ok(Json(status_of(&e)))
}

pub async fn resume(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    apply_playback(&e, optional_playback(&body)?)?;
    e.lock().resume()?;
    ensure_runner(e.clone());
    e.notify();
    Ok(Json(status_of(&e)))
}

pub async fn stop(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    e.cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    let r = e.lock().stop();
    e.cancel.store(false, std::sync::atomic::Ordering::Relaxed);
    r?;
    e.notify();
    Ok(Json(status_of(&e)))
}

pub async fn reset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    e.lock().reset();
    e.notify();
    Ok(Json(status_of(&e)))
}

pub async fn set_playback(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<PlaybackBody>,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    if body.playback_speed.is_none() {
        return Err(ApiError::bad_request("playback_speed is required"));
    }
    apply_playback(&e, Some(body))?;
    e.notify();
    Ok(Json(status_of(&e)))
}

/// Run to completion as fast as possible (off the async reactor).
pub async fn run_now(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<SimulationResults>> {
    let e = entry(&state, &id)?;
    {
        let st = e.lock().status();
        if st.is_terminal() {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "invalid_state_transition",
                format!("simulation already finished ({st:?}); reset it first"),
            ));
        }
    }
    let e2 = e.clone();
    let results = tokio::task::spawn_blocking(move || {
        let mut sim = e2.lock();
        sim.run_to_completion(Some(&e2.cancel));
        sim.results()
    })
    .await
    .map_err(|err| ApiError::internal(err.to_string()))?;
    e.notify();
    Ok(Json(results))
}

pub async fn status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StatusResponse>> {
    let e = entry(&state, &id)?;
    Ok(Json(status_of(&e)))
}

#[derive(Deserialize)]
pub struct TelemetryQuery {
    #[serde(default)]
    from: usize,
    #[serde(default)]
    stride: Option<usize>,
    #[serde(default)]
    format: Option<String>,
}

#[derive(Serialize)]
pub struct TelemetryPage {
    from: usize,
    total: usize,
    stride: usize,
    samples: Vec<TelemetrySample>,
}

pub async fn telemetry(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<TelemetryQuery>,
) -> ApiResult<Response> {
    let e = entry(&state, &id)?;
    let stride = q.stride.unwrap_or(1).max(1);
    let sim = e.lock();
    let all = sim.telemetry();
    let from = q.from.min(all.len());
    let samples: Vec<TelemetrySample> = all[from..].iter().step_by(stride).copied().collect();
    let total = all.len();
    drop(sim);
    match q.format.as_deref() {
        Some("csv") => Ok((
            [
                (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"telemetry.csv\"",
                ),
            ],
            to_csv(&samples),
        )
            .into_response()),
        None | Some("json") => Ok(Json(TelemetryPage {
            from,
            total,
            stride,
            samples,
        })
        .into_response()),
        Some(other) => Err(ApiError::bad_request(format!(
            "unsupported format '{other}' (use json or csv)"
        ))),
    }
}

pub async fn results(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<SimulationResults>> {
    let e = entry(&state, &id)?;
    let r = e.lock().results();
    Ok(Json(r))
}

pub async fn delete_simulation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let uuid = parse_id(&id)?;
    let e = state
        .remove(&uuid)
        .ok_or_else(|| ApiError::not_found(&format!("simulation {uuid}")))?;
    e.cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- comparison

#[derive(Deserialize)]
pub struct CompareRequest {
    config: SimulationConfig,
    /// Controllers to compare; defaults to all implemented controllers.
    #[serde(default)]
    controllers: Option<Vec<ControllerConfig>>,
}

#[derive(Serialize)]
pub struct CompareResponse {
    scenario_hash: String,
    name: String,
    report: String,
    run_ids: Vec<Uuid>,
    runs: Vec<SimulationResults>,
}

pub async fn compare(
    State(state): State<AppState>,
    ApiJson(req): ApiJson<CompareRequest>,
) -> ApiResult<Json<CompareResponse>> {
    let controllers = req.controllers.unwrap_or_else(all_controllers);
    if controllers.is_empty() || controllers.len() > 6 {
        return Err(ApiError::bad_request(
            "between 1 and 6 controllers can be compared",
        ));
    }
    req.config.validate()?;
    for c in &controllers {
        c.validate()?;
    }
    let cfg = req.config;
    let st = state.clone();
    let resp = tokio::task::spawn_blocking(move || -> ApiResult<CompareResponse> {
        // Same scenario, one run per controller; finished runs are registered
        // so they can be fetched and exported by id.
        let mut runs = Vec::with_capacity(controllers.len());
        let mut run_ids = Vec::with_capacity(controllers.len());
        for c in &controllers {
            let mut run_cfg = cfg.clone();
            run_cfg.controller = c.clone();
            let mut sim = simulation_engine::Simulation::new(run_cfg)?;
            sim.run_to_completion(None);
            runs.push(sim.results());
            run_ids.push(st.insert(sim, 1.0).id);
        }
        Ok(CompareResponse {
            scenario_hash: cfg.scenario_hash(),
            name: cfg.name.clone(),
            report: simulation_engine::report::comparison_report(&cfg.name, &runs),
            run_ids,
            runs,
        })
    })
    .await
    .map_err(|e| ApiError::internal(e.to_string()))??;
    Ok(Json(resp))
}

pub async fn openapi() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/yaml; charset=utf-8")],
        include_str!("../../../docs/openapi.yaml"),
    )
}
