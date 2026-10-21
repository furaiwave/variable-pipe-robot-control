//! End-to-end tests of the simulation engine.

use control_algorithms::{ControllerConfig, KinematicParams, PidTrackingParams};
use simulation_engine::config::{SimulationConfig, default_pipeline};
use simulation_engine::experiments::{compare_controllers, presets};
use simulation_engine::simulation::{SimError, Simulation, SimulationStatus};
use simulation_engine::telemetry::ViolationKind;
use simulation_engine::{ExperimentPreset, analyze_feasibility};

fn preset(code: &str) -> ExperimentPreset {
    presets()
        .into_iter()
        .find(|p| p.code == code)
        .expect("preset exists")
}

#[test]
fn default_scenario_completes_and_reaches_goal() {
    let r = Simulation::run(SimulationConfig::default()).unwrap();
    assert_eq!(r.status, SimulationStatus::Completed, "{:?}", r.failure);
    let m = &r.metrics;
    assert!(m.goal_reached);
    assert!(m.progress_ratio > 0.97);
    assert_eq!(m.collision_count, 0);
    assert!(m.position_error.rmse.is_finite() && m.position_error.rmse < 0.02);
    assert!(m.max_wheel_speed <= SimulationConfig::default().robot.max_wheel_speed + 1e-9);
    assert!(m.min_clearance > 0.0);
    assert!(r.report.contains("Simulation report"));
    // Telemetry decimation: one sample per 0.02 s (+ initial and final).
    let expected = (m.simulated_duration / 0.02).round() as usize;
    assert!(
        (r.telemetry.len() as i64 - expected as i64).abs() <= 2,
        "{} vs {expected}",
        r.telemetry.len()
    );
}

#[test]
fn straight_pipe_robot_moves_along_x_with_reference_speed() {
    let cfg = preset("A").config;
    let mut sim = Simulation::new(cfg).unwrap();
    sim.start().unwrap();
    sim.run_until(10.0, None);
    let last = *sim.telemetry().last().unwrap();
    // After the ramp-up the robot moves at cruise speed along +x.
    assert!((last.v - 0.15).abs() < 0.005, "v = {}", last.v);
    assert!(last.theta.abs() < 0.02);
    assert!(last.x > 1.0);
}

#[test]
fn simulation_is_deterministic_including_noise() {
    let mut cfg = preset("F").config;
    cfg.max_duration = 8.0;
    let a = Simulation::run(cfg.clone()).unwrap();
    let b = Simulation::run(cfg.clone()).unwrap();
    assert_eq!(a.telemetry, b.telemetry);
    assert_eq!(a.metrics.position_error, b.metrics.position_error);
    cfg.seed += 1;
    let c = Simulation::run(cfg).unwrap();
    assert_ne!(
        a.telemetry, c.telemetry,
        "different seed must change the noisy run"
    );
}

#[test]
fn lifecycle_state_transitions() {
    let mut sim = Simulation::new(SimulationConfig::default()).unwrap();
    assert_eq!(sim.status(), SimulationStatus::Ready);
    assert!(matches!(
        sim.pause(),
        Err(SimError::InvalidTransition { .. })
    ));
    assert!(matches!(
        sim.resume(),
        Err(SimError::InvalidTransition { .. })
    ));
    assert!(sim.step().is_err(), "stepping requires Running");
    sim.start().unwrap();
    assert!(sim.start().is_err());
    sim.run_until(1.0, None);
    assert!((sim.time() - 1.0).abs() < 1e-9);
    sim.pause().unwrap();
    let t = sim.time();
    let pose = sim.pose();
    assert!(sim.step().is_err());
    assert_eq!(sim.time(), t);
    assert_eq!(sim.pose(), pose, "paused simulation must not move");
    sim.resume().unwrap();
    sim.run_until(1.5, None);
    sim.stop().unwrap();
    assert_eq!(sim.status(), SimulationStatus::Cancelled);
    assert!(sim.resume().is_err());
    sim.reset();
    assert_eq!(sim.status(), SimulationStatus::Ready);
    assert_eq!(sim.time(), 0.0);
    assert_eq!(sim.telemetry().len(), 1);
}

#[test]
fn reset_reproduces_identical_run() {
    let cfg = SimulationConfig {
        max_duration: 5.0,
        ..Default::default()
    };
    let mut sim = Simulation::new(cfg).unwrap();
    sim.run_to_completion(None);
    let first = sim.telemetry().to_vec();
    sim.reset();
    sim.run_to_completion(None);
    assert_eq!(first, sim.telemetry());
}

#[test]
fn zero_reference_keeps_robot_still_while_ready() {
    let sim = Simulation::new(SimulationConfig::default()).unwrap();
    let s = sim.telemetry()[0];
    assert_eq!(s.v, 0.0);
    assert_eq!(s.wheel_left, 0.0);
    assert_eq!(s.t, 0.0);
}

#[test]
fn unclimbable_step_is_detected_with_position() {
    let p = preset("B2");
    let analysis = analyze_feasibility(&p.config).unwrap();
    assert!(
        !analysis.feasible,
        "static analysis must predict the failure"
    );
    let r = Simulation::run(p.config).unwrap();
    assert_eq!(r.status, SimulationStatus::Failed);
    let f = r.failure.unwrap();
    assert_eq!(f.kind, ViolationKind::StepNotClimbable);
    assert!(f.message.contains("s = 1.500"), "{}", f.message);
    assert!(!r.metrics.goal_reached);
}

#[test]
fn passage_below_geometric_limit_collides_and_above_passes() {
    let below = Simulation::run(preset("E2").config).unwrap();
    assert_eq!(below.status, SimulationStatus::Failed);
    assert_eq!(
        below.failure.as_ref().unwrap().kind,
        ViolationKind::Collision
    );
    let st = below.failure.unwrap().station;
    assert!(st > 1.0 && st < 2.0, "failure inside the reducer: {st}");

    let near = Simulation::run(preset("E").config).unwrap();
    assert_eq!(
        near.status,
        SimulationStatus::Completed,
        "{:?}",
        near.failure
    );
    assert!(
        near.metrics.min_clearance < 0.005,
        "near-limit passage must be tight"
    );
}

#[test]
fn controllers_produce_distinguishable_results() {
    let p = preset("F");
    let cmp = compare_controllers(&p.config, &p.controllers, None).unwrap();
    assert_eq!(cmp.runs.len(), 3);
    assert!(
        cmp.runs
            .iter()
            .all(|r| r.scenario_hash == cmp.scenario_hash)
    );
    let rmse: Vec<f64> = cmp
        .runs
        .iter()
        .map(|r| r.metrics.lateral_error.rmse)
        .collect();
    // The PID integral term must reduce the cross-track error caused by the
    // wheel-radius mismatch compared with the proportional kinematic law.
    assert!(rmse[1] < 0.8 * rmse[0], "{rmse:?}");
    assert!(cmp.report.contains("Controller comparison"));
}

#[test]
fn steep_incline_stalls_with_reason() {
    let mut cfg = SimulationConfig::default();
    let mut seg = default_pipeline().segments[0].clone();
    seg.id = "steep".into();
    seg.inclination = 40f64.to_radians();
    let mut flat = default_pipeline().segments[0].clone();
    flat.id = "flat".into();
    cfg.pipeline.segments = vec![flat, seg];
    cfg.max_duration = 60.0;
    let r = Simulation::run(cfg).unwrap();
    assert_eq!(r.status, SimulationStatus::Failed);
    let f = r.failure.unwrap();
    assert_eq!(f.kind, ViolationKind::Stall, "{}", f.message);
    assert!(
        f.station > 0.9,
        "stall happens on the incline: {}",
        f.station
    );
}

#[test]
fn invalid_configuration_is_rejected() {
    let mut cfg = SimulationConfig::default();
    cfg.robot.wheel_radius = f64::NAN;
    cfg.time_step = -1.0;
    cfg.controller = ControllerConfig::Kinematic(KinematicParams {
        k_x: -1.0,
        ..Default::default()
    });
    match Simulation::new(cfg) {
        Err(SimError::Validation(e)) => {
            let fields: Vec<_> = e.issues.iter().map(|i| i.field.as_str()).collect();
            assert!(fields.contains(&"robot.wheel_radius"), "{fields:?}");
            assert!(fields.contains(&"time_step"));
            assert!(fields.contains(&"controller.k_x"));
        }
        other => panic!("expected validation error, got {:?}", other.err()),
    }
}

#[test]
fn initial_pose_outside_pipe_fails_immediately() {
    let mut cfg = SimulationConfig::default();
    cfg.initial.lateral_offset = 0.2;
    cfg.controller = ControllerConfig::Pid(PidTrackingParams::default());
    let r = Simulation::run(cfg).unwrap();
    assert_eq!(r.status, SimulationStatus::Failed);
    assert_eq!(r.metrics.simulated_duration, 0.0);
    assert!(matches!(
        r.failure.unwrap().kind,
        ViolationKind::WheelOutsidePipe | ViolationKind::Collision
    ));
}

#[test]
fn every_preset_runs_without_numerical_failure() {
    for p in presets() {
        let r = Simulation::run(p.config.clone()).unwrap();
        assert!(r.status.is_terminal(), "{}", p.id);
        if let Some(f) = &r.failure {
            assert_ne!(f.kind, ViolationKind::NumericalFailure, "{}", p.id);
            assert_ne!(f.kind, ViolationKind::Timeout, "{}: {}", p.id, f.message);
        }
        assert!(
            r.telemetry
                .iter()
                .all(|s| s.x.is_finite() && s.v.is_finite())
        );
    }
}
