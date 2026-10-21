//! HTTP-level integration tests of the API (in-process, via tower).

use api_server::{app, state::AppState};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::time::Duration;
use tower::ServiceExt;

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    let body = match body {
        Some(v) => {
            req = req.header("content-type", "application/json");
            Body::from(v.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into()));
    (status, value)
}

async fn default_config(app: &Router) -> Value {
    let (st, cfg) = call(app, "GET", "/api/config/default", None).await;
    assert_eq!(st, StatusCode::OK);
    cfg
}

#[tokio::test(flavor = "multi_thread")]
async fn health_and_openapi() {
    let app = app(AppState::new());
    let (st, body) = call(&app, "GET", "/api/health", None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    let (st, body) = call(&app, "GET", "/api/openapi.yaml", None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(body.as_str().unwrap().starts_with("openapi: 3.1.0"));
    let (st, body) = call(&app, "GET", "/api/nope", None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");
}

#[tokio::test(flavor = "multi_thread")]
async fn validation_errors_are_structured() {
    let app = app(AppState::new());
    let mut cfg = default_config(&app).await;
    cfg["robot"]["wheel_radius"] = json!(-0.01);
    cfg["time_step"] = json!(0.0);
    let (st, body) = call(&app, "POST", "/api/simulations", Some(cfg.clone())).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"]["code"], "validation_failed");
    let fields: Vec<String> = body["error"]["details"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["field"].as_str().unwrap().to_string())
        .collect();
    assert!(
        fields.contains(&"robot.wheel_radius".to_string()),
        "{fields:?}"
    );
    assert!(fields.contains(&"time_step".to_string()));

    let (st, body) = call(&app, "POST", "/api/config/validate", Some(cfg)).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["valid"], false);

    // Malformed JSON / wrong types
    let (st, body) = call(
        &app,
        "POST",
        "/api/simulations",
        Some(json!({"robot": {"mass": "heavy"}})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "invalid_json");
}

#[tokio::test(flavor = "multi_thread")]
async fn lifecycle_over_http() {
    let app = app(AppState::new());
    let cfg = default_config(&app).await;
    let (st, created) = call(
        &app,
        "POST",
        "/api/simulations?playback_speed=200",
        Some(cfg),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(created["status"], "ready");
    let id = created["id"].as_str().unwrap().to_string();

    // Invalid transitions → 409
    let (st, body) = call(&app, "POST", &format!("/api/simulations/{id}/pause"), None).await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "invalid_state_transition");

    let (st, body) = call(&app, "POST", &format!("/api/simulations/{id}/start"), None).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "running");

    tokio::time::sleep(Duration::from_millis(150)).await;
    let (st, body) = call(&app, "POST", &format!("/api/simulations/{id}/pause"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["status"], "paused");
    let t_paused = body["time"].as_f64().unwrap();
    assert!(t_paused > 0.0, "simulation advanced while running");
    tokio::time::sleep(Duration::from_millis(120)).await;
    let (_, body) = call(&app, "GET", &format!("/api/simulations/{id}/status"), None).await;
    assert_eq!(
        body["time"].as_f64().unwrap(),
        t_paused,
        "paused simulation must not advance"
    );

    let (st, body) = call(
        &app,
        "PUT",
        &format!("/api/simulations/{id}/playback"),
        Some(json!({"playback_speed": 1000})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["playback_speed"], 1000.0);
    let (st, _) = call(
        &app,
        "POST",
        &format!("/api/simulations/{id}/resume"),
        Some(json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // Wait until finished.
    let mut status = String::new();
    for _ in 0..300 {
        let (_, body) = call(&app, "GET", &format!("/api/simulations/{id}/status"), None).await;
        status = body["status"].as_str().unwrap().to_string();
        if status != "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(status, "completed");

    let (st, res) = call(&app, "GET", &format!("/api/simulations/{id}/results"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(res["metrics"]["goal_reached"], true);
    assert!(res["metrics"]["position_error"]["rmse"].as_f64().unwrap() > 0.0);
    let n = res["telemetry"].as_array().unwrap().len();

    let (_, page) = call(
        &app,
        "GET",
        &format!("/api/simulations/{id}/telemetry?from=10&stride=5"),
        None,
    )
    .await;
    assert_eq!(page["total"].as_u64().unwrap() as usize, n);
    assert_eq!(
        page["samples"].as_array().unwrap().len(),
        (n - 10).div_ceil(5)
    );
    let (st, csv) = call(
        &app,
        "GET",
        &format!("/api/simulations/{id}/telemetry?format=csv"),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(csv.as_str().unwrap().lines().count(), n + 1);

    let (st, body) = call(&app, "POST", &format!("/api/simulations/{id}/reset"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["status"], "ready");
    assert_eq!(body["time"], 0.0);

    let (st, res) = call(&app, "POST", &format!("/api/simulations/{id}/run"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(res["status"], "completed");
    assert_eq!(
        res["telemetry"].as_array().unwrap().len(),
        n,
        "deterministic re-run"
    );

    let (st, _) = call(&app, "DELETE", &format!("/api/simulations/{id}"), None).await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    let (st, _) = call(&app, "GET", &format!("/api/simulations/{id}/status"), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = call(&app, "GET", "/api/simulations/not-a-uuid/status", None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_cancels_running_simulation() {
    let app = app(AppState::new());
    let cfg = default_config(&app).await;
    let (_, created) = call(&app, "POST", "/api/simulations?playback_speed=1", Some(cfg)).await;
    let id = created["id"].as_str().unwrap().to_string();
    call(&app, "POST", &format!("/api/simulations/{id}/start"), None).await;
    tokio::time::sleep(Duration::from_millis(80)).await;
    let (st, body) = call(&app, "POST", &format!("/api/simulations/{id}/stop"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["status"], "cancelled");
    let (st, _) = call(&app, "POST", &format!("/api/simulations/{id}/resume"), None).await;
    assert_eq!(st, StatusCode::CONFLICT);
}

#[tokio::test(flavor = "multi_thread")]
async fn presets_feasibility_and_comparison() {
    let app = app(AppState::new());
    let (st, presets) = call(&app, "GET", "/api/experiments/presets", None).await;
    assert_eq!(st, StatusCode::OK);
    let presets = presets.as_array().unwrap().clone();
    assert!(presets.len() >= 6);
    let b2 = presets.iter().find(|p| p["code"] == "B2").unwrap();

    let (st, rep) = call(
        &app,
        "POST",
        "/api/analysis/feasibility",
        Some(b2["config"].clone()),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(rep["feasible"], false);
    assert!(!rep["geometry"].as_array().unwrap().is_empty());
    assert!(rep["min_feasible_diameter"]["geometric"].as_f64().unwrap() > 0.1);

    let a = presets.iter().find(|p| p["code"] == "A").unwrap();
    let (st, cmp) = call(
        &app,
        "POST",
        "/api/experiments/compare",
        Some(json!({ "config": a["config"], "controllers": a["controllers"] })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{cmp}");
    let runs = cmp["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 3);
    assert_eq!(cmp["run_ids"].as_array().unwrap().len(), 3);
    assert!(
        runs.iter()
            .all(|r| r["scenario_hash"] == cmp["scenario_hash"])
    );
    assert!(
        cmp["report"]
            .as_str()
            .unwrap()
            .contains("Controller comparison")
    );

    let (_, list) = call(&app, "GET", "/api/simulations", None).await;
    assert_eq!(list.as_array().unwrap().len(), 3);

    let (st, _) = call(
        &app,
        "POST",
        "/api/experiments/compare",
        Some(json!({ "config": a["config"], "controllers": [] })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test(flavor = "multi_thread")]
async fn cross_section_endpoint() {
    let app = app(AppState::new());
    let cfg = default_config(&app).await;
    let (st, v) = call(
        &app,
        "POST",
        "/api/analysis/cross-section",
        Some(json!({"robot": cfg["robot"], "diameter": 0.25})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["admissible"], true);
    assert_eq!(v["body"].as_array().unwrap().len(), 4);
    let (st, _) = call(
        &app,
        "POST",
        "/api/analysis/cross-section",
        Some(json!({"robot": cfg["robot"], "diameter": -1.0})),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
}
