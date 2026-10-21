//! Simulation / experiment configuration.

use control_algorithms::ControllerConfig;
use pipeline_geometry::{PipelineConfig, SegmentConfig, SegmentGeometry, TransitionProfile};
use robot_core::{RobotConfig, ValidationErrors, Validator};
use serde::{Deserialize, Serialize};

/// Reference (desired) motion along the pipe centreline. The same reference
/// is used for every controller so comparisons are fair.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReferenceConfig {
    /// Cruise speed along the path, m/s.
    pub cruise_speed: f64,
    /// Longitudinal acceleration/deceleration limit of the reference, m/s².
    pub max_acceleration: f64,
    /// In bends the reference speed is limited to factor · ω_max / |κ|.
    pub bend_speed_factor: f64,
    /// Desired constant lateral offset from the centreline (+ left), m.
    pub lateral_offset: f64,
}

impl Default for ReferenceConfig {
    fn default() -> Self {
        Self {
            cruise_speed: 0.15,
            max_acceleration: 0.2,
            bend_speed_factor: 0.7,
            lateral_offset: 0.0,
        }
    }
}

/// Deterministic initial conditions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InitialConditions {
    /// Initial arc-length station of the robot centre, m. `None` → the robot
    /// starts fully inside the pipe (half envelope length + 2 cm).
    pub station: Option<f64>,
    /// Initial lateral offset from the centreline (+ left), m.
    pub lateral_offset: f64,
    /// Initial heading error relative to the centreline tangent, rad.
    pub heading_error: f64,
}

/// Deliberate, deterministic disturbances.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Disturbances {
    /// Relative error of the *right* wheel rolling radius, e.g. 0.02 = +2 %.
    /// The controller assumes the nominal radius; this produces a constant
    /// unmodelled yaw disturbance.
    pub wheel_radius_mismatch: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SimulationConfig {
    pub name: String,
    pub robot: RobotConfig,
    pub pipeline: PipelineConfig,
    pub controller: ControllerConfig,
    pub reference: ReferenceConfig,
    pub initial: InitialConditions,
    pub disturbances: Disturbances,
    /// Fixed integration (and control) time step Δt, s.
    pub time_step: f64,
    /// Simulated-time limit, s. Reaching it without arriving at the goal is a failure.
    pub max_duration: f64,
    /// Telemetry sampling interval (multiple of Δt), s.
    pub telemetry_interval: f64,
    /// Global required radial safety clearance, m.
    pub safety_margin: f64,
    /// Stop the run at the first collision (fatal) or keep counting.
    pub stop_on_collision: bool,
    /// Seed of the noise generator (only used when sensor noise > 0).
    pub seed: u64,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            name: "Default demonstration".into(),
            robot: RobotConfig::default(),
            pipeline: default_pipeline(),
            controller: ControllerConfig::default(),
            reference: ReferenceConfig::default(),
            initial: InitialConditions {
                station: None,
                lateral_offset: 0.01,
                heading_error: 0.0,
            },
            disturbances: Disturbances::default(),
            time_step: 0.005,
            max_duration: 120.0,
            telemetry_interval: 0.02,
            safety_margin: 0.005,
            stop_on_collision: true,
            seed: 1,
        }
    }
}

pub(crate) fn straight(id: &str, label: &str, length: f64, diameter: f64) -> SegmentConfig {
    SegmentConfig {
        id: id.into(),
        label: label.into(),
        geometry: SegmentGeometry::Straight { length, diameter },
        inclination: 0.0,
        min_clearance: None,
        restrictions: vec![],
    }
}

pub(crate) fn transition(id: &str, label: &str, length: f64, d0: f64, d1: f64) -> SegmentConfig {
    SegmentConfig {
        id: id.into(),
        label: label.into(),
        geometry: SegmentGeometry::Transition {
            length,
            diameter_start: d0,
            diameter_end: d1,
            profile: TransitionProfile::Linear,
        },
        inclination: 0.0,
        min_clearance: None,
        restrictions: vec![],
    }
}

pub(crate) fn bend(
    id: &str,
    label: &str,
    radius: f64,
    angle_deg: f64,
    diameter: f64,
) -> SegmentConfig {
    SegmentConfig {
        id: id.into(),
        label: label.into(),
        geometry: SegmentGeometry::Bend {
            bend_radius: radius,
            angle: angle_deg.to_radians(),
            diameter,
        },
        inclination: 0.0,
        min_clearance: None,
        restrictions: vec![],
    }
}

/// Mixed demonstration pipeline: reducer, narrow straight, bend, incline and expander.
pub fn default_pipeline() -> PipelineConfig {
    let mut incline = straight("s4", "Inclined run (8°)", 0.8, 0.20);
    incline.inclination = 8f64.to_radians();
    PipelineConfig {
        name: "Demonstration line DN250 → DN200".into(),
        segments: vec![
            straight("s1", "Inlet DN250", 1.0, 0.25),
            transition("s2", "Reducer 250→200", 0.3, 0.25, 0.20),
            straight("s3", "Narrow run DN200", 0.6, 0.20),
            bend("b1", "Bend 60° R0.6", 0.6, 60.0, 0.20),
            incline,
            transition("s5", "Expander 200→250", 0.3, 0.20, 0.25),
            straight("s6", "Outlet DN250", 0.8, 0.25),
        ],
    }
}

impl SimulationConfig {
    pub fn validate(&self) -> Result<(), ValidationErrors> {
        let mut v = Validator::new("");
        if let Err(e) = self.robot.validate() {
            v.merge(e);
        }
        if let Err(e) = pipeline_geometry::Pipeline::new(self.pipeline.clone()) {
            v.merge(e);
        }
        if let Err(e) = self.controller.validate() {
            v.merge(e);
        }
        let r = &self.reference;
        v.range("reference.cruise_speed", r.cruise_speed, 0.001, 10.0);
        if r.cruise_speed.is_finite() && self.robot.max_linear_velocity.is_finite() {
            v.check(
                r.cruise_speed <= self.robot.max_linear_velocity,
                "reference.cruise_speed",
                format!(
                    "must not exceed the robot's maximum linear velocity ({} m/s)",
                    self.robot.max_linear_velocity
                ),
            );
        }
        v.range(
            "reference.max_acceleration",
            r.max_acceleration,
            0.001,
            20.0,
        );
        v.range(
            "reference.bend_speed_factor",
            r.bend_speed_factor,
            0.05,
            1.0,
        );
        v.range("reference.lateral_offset", r.lateral_offset, -1.0, 1.0);
        if let Some(s) = self.initial.station {
            v.finite("initial.station", s);
        }
        v.range(
            "initial.lateral_offset",
            self.initial.lateral_offset,
            -1.0,
            1.0,
        );
        v.range(
            "initial.heading_error",
            self.initial.heading_error,
            -1.0,
            1.0,
        );
        v.range(
            "disturbances.wheel_radius_mismatch",
            self.disturbances.wheel_radius_mismatch,
            -0.2,
            0.2,
        );
        v.range("time_step", self.time_step, 0.0005, 0.05);
        v.range("max_duration", self.max_duration, 0.1, 3600.0);
        v.range("telemetry_interval", self.telemetry_interval, 0.0005, 5.0);
        if self.time_step.is_finite() && self.telemetry_interval.is_finite() {
            v.check(
                self.telemetry_interval >= self.time_step,
                "telemetry_interval",
                "must be ≥ time_step",
            );
        }
        if self.max_duration.is_finite() && self.time_step.is_finite() && self.time_step > 0.0 {
            v.check(
                self.max_duration / self.time_step <= 2.0e6,
                "max_duration",
                "too many steps (max_duration / time_step must be ≤ 2·10⁶)",
            );
        }
        v.range("safety_margin", self.safety_margin, 0.0, 0.5);
        if !v.has_issues()
            && let Ok(p) = pipeline_geometry::Pipeline::new(self.pipeline.clone())
        {
            let start = self.start_station();
            let goal = self.goal_station(p.total_length());
            v.check(
                goal > start + 0.05,
                "pipeline.segments",
                format!(
                    "pipeline ({:.3} m) is too short for the robot: start station {start:.3} m, goal station {goal:.3} m",
                    p.total_length()
                ),
            );
            v.check(start >= 0.0, "initial.station", "must be ≥ 0");
        }
        v.finish()
    }

    pub fn start_station(&self) -> f64 {
        self.initial
            .station
            .unwrap_or(0.5 * self.robot.envelope_length() + 0.02)
    }

    /// Goal station of the robot centre: the front of the robot reaches the
    /// outlet minus 2 cm.
    pub fn goal_station(&self, total_length: f64) -> f64 {
        total_length - 0.5 * self.robot.envelope_length() - 0.02
    }

    /// Hash of everything that defines the *scenario* (all inputs except the
    /// controller and run-time display settings). Runs with the same hash
    /// are directly comparable.
    pub fn scenario_hash(&self) -> String {
        #[derive(Serialize)]
        struct Scenario<'a> {
            robot: &'a RobotConfig,
            pipeline: &'a PipelineConfig,
            reference: &'a ReferenceConfig,
            initial: &'a InitialConditions,
            disturbances: &'a Disturbances,
            time_step: f64,
            safety_margin: f64,
            seed: u64,
        }
        let s = serde_json::to_string(&Scenario {
            robot: &self.robot,
            pipeline: &self.pipeline,
            reference: &self.reference,
            initial: &self.initial,
            disturbances: &self.disturbances,
            time_step: self.time_step,
            safety_margin: self.safety_margin,
            seed: self.seed,
        })
        .unwrap_or_default();
        format!("{:016x}", fnv1a(s.as_bytes()))
    }
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        SimulationConfig::default().validate().unwrap();
    }

    #[test]
    fn rejects_bad_time_step_and_short_pipe() {
        let mut c = SimulationConfig {
            time_step: 0.0,
            ..Default::default()
        };
        assert!(c.validate().is_err());
        c.time_step = 0.005;
        c.pipeline.segments = vec![straight("x", "", 0.2, 0.25)];
        let err = c.validate().unwrap_err();
        assert!(
            err.issues.iter().any(|i| i.message.contains("too short")),
            "{err:?}"
        );
    }

    #[test]
    fn scenario_hash_ignores_controller() {
        let a = SimulationConfig::default();
        let mut b = a.clone();
        b.controller = ControllerConfig::Kinematic(Default::default());
        assert_eq!(a.scenario_hash(), b.scenario_hash());
        b.seed = 2;
        assert_ne!(a.scenario_hash(), b.scenario_hash());
    }
}
