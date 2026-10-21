//! Automatically generated textual reports.
//!
//! Every number in a report is taken from the simulated results; the text
//! only states comparisons that follow directly from those numbers.

use crate::simulation::{SimulationResults, SimulationStatus};
use crate::telemetry::{Severity, ViolationKind};
use std::fmt::Write as _;

const DISCLAIMER: &str = "_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._";

fn mm(v: f64) -> String {
    if v.is_finite() {
        format!("{:.2} mm", v * 1e3)
    } else {
        "n/a".into()
    }
}

fn deg(v: f64) -> String {
    if v.is_finite() {
        format!("{:.2}°", v.to_degrees())
    } else {
        "n/a".into()
    }
}

pub fn outcome_line(r: &SimulationResults) -> String {
    match (&r.status, &r.failure) {
        (SimulationStatus::Completed, _) => format!(
            "**Completed** – goal reached after {:.2} s of simulated time.",
            r.metrics.simulated_duration
        ),
        (SimulationStatus::Failed, Some(f)) => format!(
            "**Failed** – {} at t = {:.2} s, s = {:.3} m: {}",
            f.kind.label(),
            f.time,
            f.station,
            f.message
        ),
        (SimulationStatus::Cancelled, _) => format!(
            "**Cancelled** by the user at t = {:.2} s.",
            r.metrics.simulated_duration
        ),
        (s, _) => format!("Run not finished (state: {s:?})."),
    }
}

pub fn run_report(r: &SimulationResults) -> String {
    let m = &r.metrics;
    let c = &r.config;
    let mut o = String::new();
    let _ = writeln!(o, "## Simulation report – {}\n", r.name);
    let _ = writeln!(o, "{DISCLAIMER}\n");
    let _ = writeln!(o, "- Controller: {}", r.controller_name);
    let _ = writeln!(o, "- Outcome: {}", outcome_line(r));
    let _ = writeln!(
        o,
        "- Scenario: pipeline \"{}\" ({} segments), robot \"{}\", Δt = {} s, seed = {}, scenario hash `{}`",
        c.pipeline.name,
        c.pipeline.segments.len(),
        c.robot.name,
        c.time_step,
        c.seed,
        r.scenario_hash
    );
    let _ = writeln!(
        o,
        "- Initial conditions: lateral offset {}, heading error {}; wheel-radius mismatch {:.2} %; sensor noise σ_xy = {}, σ_θ = {}",
        mm(c.initial.lateral_offset),
        deg(c.initial.heading_error),
        c.disturbances.wheel_radius_mismatch * 100.0,
        mm(c.robot.sensor_noise.position_std),
        deg(c.robot.sensor_noise.heading_std)
    );
    let _ = writeln!(o, "\n### Tracking performance\n");
    let _ = writeln!(o, "| Signal | RMSE | MAE | Max | Final |");
    let _ = writeln!(o, "|---|---|---|---|---|");
    for (name, e, f) in [
        ("Position error", &m.position_error, mm as fn(f64) -> String),
        ("Cross-track error", &m.lateral_error, mm),
        ("Heading error", &m.heading_error, deg),
    ] {
        let _ = writeln!(
            o,
            "| {name} | {} | {} | {} | {} |",
            f(e.rmse),
            f(e.mae),
            f(e.max),
            f(e.final_value)
        );
    }
    let _ = writeln!(o, "\n### Motion and actuation\n");
    let _ = writeln!(
        o,
        "- Average linear velocity: {:.4} m/s (max {:.4} m/s)",
        m.average_linear_velocity, m.max_linear_velocity
    );
    let _ = writeln!(
        o,
        "- Distance travelled: {:.3} m; progress {:.1} % of the required path",
        m.total_distance,
        m.progress_ratio * 100.0
    );
    let _ = writeln!(
        o,
        "- Max wheel speed: {:.2} rad/s (limit {:.2} rad/s)",
        m.max_wheel_speed, c.robot.max_wheel_speed
    );
    let _ = writeln!(
        o,
        "- Max motor torque demand: {:.4} N·m (limit {:.4} N·m); mechanical energy {:.2} J",
        m.max_torque_demand, c.robot.max_motor_torque, m.mechanical_energy
    );
    let _ = writeln!(
        o,
        "- Share of steps with wheel-command saturation {:.1} %, torque limit {:.1} %, traction limit {:.1} %",
        m.wheel_saturation_ratio * 100.0,
        m.torque_saturation_ratio * 100.0,
        m.traction_limit_ratio * 100.0
    );
    let _ = writeln!(
        o,
        "- Simulated duration {:.2} s in {} steps; execution time {:.1} ms",
        m.simulated_duration, m.steps, m.execution_time_ms
    );
    let _ = writeln!(o, "\n### Geometric feasibility\n");
    let _ = writeln!(
        o,
        "- Minimum clearance: {} at s = {:.3} m",
        mm(m.min_clearance),
        m.min_clearance_station
    );
    let _ = writeln!(
        o,
        "- Maximum wall contact angle: {} (limit {})",
        deg(m.max_contact_angle),
        deg(c.robot.max_contact_angle)
    );
    let _ = writeln!(
        o,
        "- Collisions: {}; feasibility violations: {}; all constraint-violation episodes: {}",
        m.collision_count, m.feasibility_violation_count, m.constraint_violation_count
    );
    if !r.events.is_empty() {
        let _ = writeln!(o, "\n### Constraint violations\n");
        let _ = writeln!(o, "| Kind | Severity | t [s] | s [m] | Message |");
        let _ = writeln!(o, "|---|---|---|---|---|");
        for e in r.events.iter().take(15) {
            let _ = writeln!(
                o,
                "| {} | {} | {:.2}–{:.2} | {:.3} | {} |",
                e.kind.label(),
                if e.severity == Severity::Fatal {
                    "fatal"
                } else {
                    "warning"
                },
                e.t_start,
                e.t_end,
                e.s_start,
                e.message
            );
        }
        if r.events.len() > 15 {
            let _ = writeln!(
                o,
                "\n… {} more episodes in the exported JSON.",
                r.events.len() - 15
            );
        }
    }
    o
}

/// Comparison report across runs of the same scenario.
pub fn comparison_report(name: &str, runs: &[SimulationResults]) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "## Controller comparison – {name}\n");
    let _ = writeln!(o, "{DISCLAIMER}\n");
    if let Some(first) = runs.first() {
        let same = runs.iter().all(|r| r.scenario_hash == first.scenario_hash);
        let _ = writeln!(
            o,
            "All runs use {} scenario (hash `{}`): identical pipeline, robot, reference, initial conditions, disturbances and seed.\n",
            if same {
                "the same"
            } else {
                "**different** (!)"
            },
            first.scenario_hash
        );
    }
    let _ = writeln!(
        o,
        "| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |"
    );
    let _ = writeln!(o, "|---|---|---|---|---|---|---|---|---|---|---|");
    for r in runs {
        let m = &r.metrics;
        let outcome = match (&r.status, &r.failure) {
            (SimulationStatus::Completed, _) => "completed".to_string(),
            (_, Some(f)) => format!("failed ({}) at s = {:.2} m", f.kind.label(), f.station),
            (s, _) => format!("{s:?}"),
        };
        let _ = writeln!(
            o,
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {:.2} J | {:.2} s |",
            r.controller_name,
            outcome,
            mm(m.position_error.rmse),
            mm(m.position_error.max),
            mm(m.lateral_error.rmse),
            mm(m.lateral_error.max),
            deg(m.heading_error.rmse),
            mm(m.min_clearance),
            m.constraint_violation_count,
            m.mechanical_energy,
            m.simulated_duration
        );
    }

    let _ = writeln!(o, "\n### Observations (derived from the table)\n");
    let completed: Vec<&SimulationResults> = runs
        .iter()
        .filter(|r| r.status == SimulationStatus::Completed)
        .collect();
    let failed: Vec<&SimulationResults> = runs
        .iter()
        .filter(|r| r.status == SimulationStatus::Failed)
        .collect();
    for f in &failed {
        if let Some(fi) = &f.failure {
            let _ = writeln!(
                o,
                "- {} did not reach the goal: {} at s = {:.3} m (t = {:.2} s).",
                f.controller_name,
                fi.kind.label().to_lowercase(),
                fi.station,
                fi.time
            );
        }
    }
    let pick = |key: &dyn Fn(&SimulationResults) -> f64| -> Option<&SimulationResults> {
        completed
            .iter()
            .copied()
            .min_by(|a, b| key(a).total_cmp(&key(b)))
    };
    let baseline = runs.iter().find(|r| r.controller == "kinematic");
    for (label, key) in [
        (
            "position RMSE",
            (&|r: &SimulationResults| r.metrics.position_error.rmse)
                as &dyn Fn(&SimulationResults) -> f64,
        ),
        ("cross-track RMSE", &|r: &SimulationResults| {
            r.metrics.lateral_error.rmse
        }),
        ("maximum cross-track error", &|r: &SimulationResults| {
            r.metrics.lateral_error.max
        }),
        ("mechanical energy", &|r: &SimulationResults| {
            r.metrics.mechanical_energy
        }),
    ] {
        if let Some(best) = pick(key) {
            let v = key(best);
            let fmt = |x: f64| {
                if label.contains("energy") {
                    format!("{x:.2} J")
                } else {
                    mm(x)
                }
            };
            // Values within 0.5 % (or 1 µm / 1 mJ) of the best count as a tie.
            let tol = (v.abs() * 0.005).max(1e-6);
            let tied: Vec<&str> = completed
                .iter()
                .filter(|r| (key(r) - v).abs() <= tol)
                .map(|r| r.controller_name.as_str())
                .collect();
            let mut line = if tied.len() > 1 {
                format!(
                    "- Lowest {label} among completed runs: tie between {} ({})",
                    tied.join(", "),
                    fmt(v)
                )
            } else {
                format!(
                    "- Lowest {label} among completed runs: {} ({})",
                    best.controller_name,
                    fmt(v)
                )
            };
            if tied.len() == 1
                && let Some(b) = baseline
                && b.controller != best.controller
                && b.status == SimulationStatus::Completed
            {
                let bv = key(b);
                if bv > 0.0 {
                    let _ = write!(
                        line,
                        ", {:.1} % lower than the kinematic baseline",
                        (1.0 - v / bv) * 100.0
                    );
                }
            }
            let _ = writeln!(o, "{line}.");
        }
    }
    let collisions: Vec<_> = runs
        .iter()
        .filter(|r| {
            r.metrics.collision_count > 0
                || r.failure
                    .as_ref()
                    .is_some_and(|f| f.kind == ViolationKind::Collision)
        })
        .map(|r| r.controller_name.as_str())
        .collect();
    if collisions.is_empty() {
        let _ = writeln!(o, "- No run collided with the pipe wall.");
    } else {
        let _ = writeln!(o, "- Runs with collisions: {}.", collisions.join(", "));
    }
    let _ = writeln!(
        o,
        "\nDifferences reflect this specific scenario and parameter set; they are not a general ranking of the control methods."
    );
    o
}
