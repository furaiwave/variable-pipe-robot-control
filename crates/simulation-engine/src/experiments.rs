//! Predefined experiments (A–F) and controller comparison.
//!
//! Every preset is a complete, deterministic [`SimulationConfig`]. Presets
//! that depend on the robot's feasibility limit (E) compute that limit from
//! the geometry model at construction time instead of hard-coding it.

use crate::analysis::min_feasible_diameter;
use crate::config::{SimulationConfig, bend, straight, transition};
use crate::report::comparison_report;
use crate::simulation::{SimError, Simulation, SimulationResults};
use control_algorithms::{
    ControllerConfig, GainScheduledParams, KinematicParams, PidTrackingParams,
};
use pipeline_geometry::{PipelineConfig, Restriction};
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExperimentPreset {
    pub id: String,
    pub code: String,
    pub title: String,
    pub objective: String,
    pub description: String,
    pub config: SimulationConfig,
    /// Controllers to compare under identical conditions.
    pub controllers: Vec<ControllerConfig>,
}

pub fn all_controllers() -> Vec<ControllerConfig> {
    vec![
        ControllerConfig::Kinematic(KinematicParams::default()),
        ControllerConfig::Pid(PidTrackingParams::default()),
        ControllerConfig::GainScheduled(GainScheduledParams::default()),
    ]
}

fn base(name: &str, pipeline: PipelineConfig) -> SimulationConfig {
    SimulationConfig {
        name: name.into(),
        pipeline,
        ..SimulationConfig::default()
    }
}

pub fn presets() -> Vec<ExperimentPreset> {
    let mut out = Vec::new();

    // A ── constant diameter baseline
    {
        let mut c = base(
            "A – Constant-diameter pipeline",
            PipelineConfig {
                name: "Straight DN250, 4 m".into(),
                segments: vec![straight("a1", "Straight DN250", 4.0, 0.25)],
            },
        );
        c.initial.lateral_offset = 0.01;
        out.push(ExperimentPreset {
            id: "a-constant-diameter".into(),
            code: "A".into(),
            title: "Constant-diameter pipeline".into(),
            objective: "Baseline tracking and steady motion without geometric excitation.".into(),
            description: "4 m straight pipe, D = 250 mm. Robot starts 10 mm left of the centreline, aligned. \
                          Reference: 0.15 m/s cruise, 0.2 m/s² ramps. No disturbances, no noise."
                .into(),
            config: c,
            controllers: all_controllers(),
        });
    }

    // B ── sudden diameter reduction (climbable) + an unclimbable variant
    {
        let mut c = base(
            "B – Sudden diameter reduction 250 → 230 mm",
            PipelineConfig {
                name: "Sudden reduction 250→230".into(),
                segments: vec![
                    straight("b1", "DN250", 1.5, 0.25),
                    straight("b2", "Reduced 230 mm", 1.5, 0.23),
                ],
            },
        );
        c.initial.lateral_offset = 0.005;
        out.push(ExperimentPreset {
            id: "b-sudden-reduction".into(),
            code: "B".into(),
            title: "Sudden diameter reduction".into(),
            objective: "Check passage through an abrupt step and the controller response to it.".into(),
            description: "1.5 m at D = 250 mm followed by an abrupt reduction to 230 mm (wall step at the \
                          wheel contact line ≈ 13 mm). The step is checked with the friction-cone climbing \
                          criterion for each axle."
                .into(),
            config: c,
            controllers: all_controllers(),
        });
        let mut c2 = base(
            "B2 – Sudden diameter reduction 250 → 200 mm",
            PipelineConfig {
                name: "Sudden reduction 250→200".into(),
                segments: vec![
                    straight("b1", "DN250", 1.5, 0.25),
                    straight("b2", "Reduced 200 mm", 1.5, 0.20),
                ],
            },
        );
        c2.initial.lateral_offset = 0.005;
        out.push(ExperimentPreset {
            id: "b2-sudden-reduction-large".into(),
            code: "B2".into(),
            title: "Sudden reduction beyond the step limit".into(),
            objective: "Demonstrate detection of an impassable step and reporting of its position."
                .into(),
            description:
                "Same as B but reduced to 200 mm: the wall step at the wheel contact line \
                          (≈ 32 mm) exceeds the wheel radius. Static analysis and the dynamic run \
                          should both report the failure location."
                    .into(),
            config: c2,
            controllers: vec![ControllerConfig::Pid(PidTrackingParams::default())],
        });
    }

    // C ── gradual transition
    {
        let mut c = base(
            "C – Gradual transition 250 → 190 mm",
            PipelineConfig {
                name: "Gradual reducer 250→190".into(),
                segments: vec![
                    straight("c1", "DN250", 1.0, 0.25),
                    transition("c2", "Reducer 250→190", 0.8, 0.25, 0.19),
                    straight("c3", "D190", 1.2, 0.19),
                ],
            },
        );
        c.initial.lateral_offset = 0.01;
        out.push(ExperimentPreset {
            id: "c-gradual-transition".into(),
            code: "C".into(),
            title: "Gradual diameter transition".into(),
            objective: "Tracking while the available clearance and lateral margin shrink continuously.".into(),
            description: "Linear (conical) reducer from 250 to 190 mm over 0.8 m. The wall under the \
                          wheels forms a ramp; the robot pitches and the lateral feasibility margin drops."
                .into(),
            config: c,
            controllers: all_controllers(),
        });
    }

    // D ── curved pipeline
    {
        let mut c = base(
            "D – Curved pipeline (S-bend)",
            PipelineConfig {
                name: "S-bend DN220".into(),
                segments: vec![
                    straight("d1", "Straight", 1.0, 0.22),
                    bend("d2", "Bend +90° R0.5", 0.5, 90.0, 0.22),
                    straight("d3", "Straight", 0.6, 0.22),
                    bend("d4", "Bend −90° R0.35", 0.35, -90.0, 0.22),
                    straight("d5", "Straight", 1.0, 0.22),
                ],
            },
        );
        c.initial.lateral_offset = 0.0;
        out.push(ExperimentPreset {
            id: "d-curved-pipeline".into(),
            code: "D".into(),
            title: "Curved pipeline".into(),
            objective:
                "Trajectory following and geometric feasibility in bends of different radius."
                    .into(),
            description:
                "S-bend in a 220 mm pipe: +90° bend (R = 0.5 m), straight, −90° bend (R = 0.35 m). \
                          The reference slows down in bends to respect the yaw-rate limit."
                    .into(),
            config: c,
            controllers: all_controllers(),
        });
    }

    // E ── narrow passage near the feasibility limit (computed)
    {
        let probe = SimulationConfig::default();
        if let Some(md) = min_feasible_diameter(&probe.robot, probe.safety_margin) {
            let round_up = |d: f64| (d * 1000.0).ceil() / 1000.0;
            let near = round_up(md.geometric + 0.004);
            let below = round_up(md.geometric - 0.004);
            let make = |d: f64, name: &str| -> SimulationConfig {
                let mut c = base(
                    name,
                    PipelineConfig {
                        name: format!("Narrow passage D = {:.0} mm", d * 1e3),
                        segments: vec![
                            straight("e1", "DN250", 1.0, 0.25),
                            transition("e2", "Reducer", 0.6, 0.25, d),
                            straight("e3", "Narrow passage", 0.6, d),
                            transition("e4", "Expander", 0.6, d, 0.25),
                            straight("e5", "DN250", 0.6, 0.25),
                        ],
                    },
                );
                c.initial.lateral_offset = 0.01;
                c.reference.cruise_speed = 0.1;
                c
            };
            out.push(ExperimentPreset {
                id: "e-narrow-passage".into(),
                code: "E".into(),
                title: "Narrow passage near the feasibility limit".into(),
                objective: "Identify the minimum feasible passage and test controllers just above it.".into(),
                description: format!(
                    "Geometry model limits for this robot (centred, straight pipe): geometric minimum \
                     D_min = {:.1} mm ({}), recommended minimum {:.1} mm ({}). The passage is set to \
                     {:.0} mm, i.e. ≈ 4 mm above the geometric limit: tracking accuracy decides whether \
                     the robot passes without touching the wall.",
                    md.geometric * 1e3,
                    md.geometric_binding,
                    md.recommended * 1e3,
                    md.recommended_binding,
                    near * 1e3
                ),
                config: make(near, "E – Narrow passage near the feasibility limit"),
                controllers: all_controllers(),
            });
            out.push(ExperimentPreset {
                id: "e2-narrow-passage-infeasible".into(),
                code: "E2".into(),
                title: "Narrow passage below the feasibility limit".into(),
                objective:
                    "Confirm that an infeasible passage is detected before success is reported."
                        .into(),
                description: format!(
                    "Passage of {:.0} mm, ≈ 4 mm below the geometric minimum of {:.1} mm.",
                    below * 1e3,
                    md.geometric * 1e3
                ),
                config: make(below, "E2 – Narrow passage below the feasibility limit"),
                controllers: vec![ControllerConfig::Pid(PidTrackingParams::default())],
            });
        }
    }

    // F ── controller comparison with disturbances
    {
        let mut weld = straight("f4", "Narrow run with weld ring", 0.8, 0.20);
        weld.restrictions.push(Restriction {
            position: 0.4,
            length: 0.01,
            height: 0.003,
            label: "Weld bead".into(),
        });
        let mut incline = straight("f6", "Inclined 10°", 0.8, 0.22);
        incline.inclination = 10f64.to_radians();
        let mut c = base(
            "F – Controller comparison",
            PipelineConfig {
                name: "Mixed line with disturbances".into(),
                segments: vec![
                    straight("f1", "DN250", 1.0, 0.25),
                    bend("f2", "Bend +60° R0.6", 0.6, 60.0, 0.25),
                    transition("f3", "Reducer 250→200", 0.4, 0.25, 0.20),
                    weld,
                    bend("f5", "Bend −45° R0.4", 0.4, -45.0, 0.20),
                    transition("f5b", "Expander 200→220", 0.2, 0.20, 0.22),
                    incline,
                    straight("f7", "Outlet", 0.6, 0.22),
                ],
            },
        );
        c.initial.lateral_offset = 0.015;
        c.initial.heading_error = 5f64.to_radians();
        c.disturbances.wheel_radius_mismatch = 0.03;
        c.robot.sensor_noise.position_std = 0.001;
        c.robot.sensor_noise.heading_std = 0.5f64.to_radians();
        c.seed = 2024;
        out.push(ExperimentPreset {
            id: "f-controller-comparison".into(),
            code: "F".into(),
            title: "Controller comparison".into(),
            objective: "Compare the kinematic baseline, fixed-gain PID and gain-scheduled PID under identical conditions.".into(),
            description: "Bends, a reducer to 200 mm with a 3 mm weld ring, an expander and a 10° incline. \
                          Disturbances: +3 % right-wheel radius mismatch (unmodelled yaw drift), initial \
                          offset 15 mm and 5° heading error, sensor noise σ = 1 mm / 0.5° (seed 2024)."
                .into(),
            config: c,
            controllers: all_controllers(),
        });
    }
    out
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub scenario_hash: String,
    pub name: String,
    pub runs: Vec<SimulationResults>,
    pub report: String,
}

/// Run the same scenario with each controller (sequentially, deterministic).
pub fn compare_controllers(
    base: &SimulationConfig,
    controllers: &[ControllerConfig],
    cancel: Option<&AtomicBool>,
) -> Result<ComparisonResult, SimError> {
    let mut runs = Vec::with_capacity(controllers.len());
    for c in controllers {
        let mut cfg = base.clone();
        cfg.controller = c.clone();
        let mut sim = Simulation::new(cfg)?;
        sim.run_to_completion(cancel);
        runs.push(sim.results());
    }
    Ok(ComparisonResult {
        scenario_hash: base.scenario_hash(),
        name: base.name.clone(),
        report: comparison_report(&base.name, &runs),
        runs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_valid_and_unique() {
        let p = presets();
        assert!(p.len() >= 6);
        let mut ids: Vec<_> = p.iter().map(|x| x.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), p.len());
        for e in &p {
            e.config
                .validate()
                .unwrap_or_else(|err| panic!("{}: {err}", e.id));
            assert!(!e.controllers.is_empty());
        }
    }
}
