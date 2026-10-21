//! Fixed-step simulation loop and lifecycle state machine.
//!
//! Each call to [`Simulation::step`] advances simulated time by exactly
//! Δt = `config.time_step`. Physics never depends on wall-clock time or on
//! the rendering rate of a client; playback speed only changes how many
//! steps a caller executes per wall-clock interval.

use crate::analysis::{climb_angle_limit, step_contact_angle, wall_height};
use crate::collision::{ClearanceModel, ClearanceReport};
use crate::config::SimulationConfig;
use crate::metrics::{MetricsAccumulator, PerformanceMetrics, StepMetrics};
use crate::reference::ReferenceGenerator;
use crate::rng::Rng;
use crate::telemetry::{
    EventTracker, FLAG_CONTROLLER_SATURATED, FLAG_RATE_LIMITED, Observation, Severity,
    TelemetrySample, ViolationEvent, ViolationKind,
};
use control_algorithms::{
    ControlInput, ControlOutput, Controller, LocalGeometry, ReferenceState, StageOutput,
    WheelCommandStage, WheelLimits,
};
use pipeline_geometry::Pipeline;
use robot_core::dynamics::{self, DynamicsInput, DynamicsOutput};
use robot_core::envelope::RobotEnvelope;
use robot_core::kinematics::{self, Twist, WheelSpeeds};
use robot_core::{Pose2, ValidationErrors, wrap_angle};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimulationStatus {
    Ready,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl SimulationStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SimError {
    #[error(transparent)]
    Validation(#[from] ValidationErrors),
    #[error("cannot {action} a simulation in state {from:?}")]
    InvalidTransition {
        action: &'static str,
        from: SimulationStatus,
    },
}

/// Why and where a run failed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FailureInfo {
    pub kind: ViolationKind,
    pub message: String,
    pub time: f64,
    pub station: f64,
    pub x: f64,
    pub y: f64,
    pub value: f64,
    pub limit: f64,
}

/// Lightweight status for polling / streaming.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StatusSnapshot {
    pub status: SimulationStatus,
    pub time: f64,
    pub step: u64,
    pub progress: f64,
    pub station: f64,
    pub start_station: f64,
    pub goal_station: f64,
    pub pipeline_length: f64,
    pub telemetry_count: usize,
    pub violation_count: usize,
    pub collision_count: usize,
    pub latest: Option<TelemetrySample>,
    pub failure: Option<FailureInfo>,
    pub controller: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SimulationResults {
    pub engine_version: String,
    pub scenario_hash: String,
    pub name: String,
    pub controller: String,
    pub controller_name: String,
    pub status: SimulationStatus,
    pub failure: Option<FailureInfo>,
    pub metrics: PerformanceMetrics,
    pub events: Vec<ViolationEvent>,
    pub telemetry: Vec<TelemetrySample>,
    pub config: SimulationConfig,
    /// Automatically generated plain-text (Markdown) summary.
    pub report: String,
}

/// Physical state of the robot.
#[derive(Clone, Copy, Debug)]
struct RobotState {
    pose: Pose2,
    wheels: WheelSpeeds,
}

pub struct Simulation {
    config: SimulationConfig,
    pipeline: Pipeline,
    envelope: RobotEnvelope,
    margin_profile: Vec<(f64, f64)>,
    controller: Box<dyn Controller>,
    stage: WheelCommandStage,
    reference: ReferenceGenerator,
    rng: Rng,
    radius_left: f64,
    radius_right: f64,
    start_station: f64,
    goal_station: f64,
    decimation: u64,

    status: SimulationStatus,
    time: f64,
    step: u64,
    state: RobotState,
    clearance: ClearanceReport,
    last_ctrl: ControlOutput,
    last_stage: StageOutput,
    last_dyn: DynamicsOutput,
    /// Progress watchdog: station and time of the last significant progress.
    progress_mark: (f64, f64),
    /// Whether a force (torque/traction) limit was active since the mark.
    limited_since_mark: (bool, bool),
    /// Simulated time at which the reference reached the goal.
    reference_done_at: Option<f64>,

    telemetry: Vec<TelemetrySample>,
    events: EventTracker,
    metrics: MetricsAccumulator,
    failure: Option<FailureInfo>,
    execution_secs: f64,
}

impl Simulation {
    pub fn new(config: SimulationConfig) -> Result<Self, SimError> {
        config.validate()?;
        let pipeline = Pipeline::new(config.pipeline.clone())?;
        let envelope = RobotEnvelope::new(&config.robot);
        let total = pipeline.total_length();
        let start_station = config.start_station();
        let goal_station = config.goal_station(total);
        let margin_profile =
            Self::build_margin_profile(&config, &pipeline, &envelope, start_station, goal_station);
        let decimation = ((config.telemetry_interval / config.time_step).round() as u64).max(1);
        let r = config.robot.wheel_radius;
        let mut sim = Self {
            controller: config.controller.build(),
            stage: WheelCommandStage::new(WheelLimits::from(&config.robot)),
            reference: ReferenceGenerator::new(
                config.reference.clone(),
                &config.robot,
                start_station,
                goal_station,
            ),
            rng: Rng::new(config.seed),
            radius_left: r,
            radius_right: r * (1.0 + config.disturbances.wheel_radius_mismatch),
            start_station,
            goal_station,
            decimation,
            status: SimulationStatus::Ready,
            time: 0.0,
            step: 0,
            state: RobotState {
                pose: Pose2::default(),
                wheels: WheelSpeeds::default(),
            },
            clearance: ClearanceReport {
                station: start_station,
                lateral: 0.0,
                min_clearance: 0.0,
                required_clearance: 0.0,
                min_margin: 0.0,
                critical: None,
                max_contact_angle: 0.0,
                wheel_outside: false,
                pitch: 0.0,
                roll: 0.0,
                base_height: 0.0,
                contacts: vec![],
            },
            last_ctrl: ControlOutput::default(),
            last_stage: StageOutput::default(),
            last_dyn: DynamicsOutput::default(),
            progress_mark: (start_station, 0.0),
            limited_since_mark: (false, false),
            reference_done_at: None,
            telemetry: Vec::new(),
            events: EventTracker::default(),
            metrics: MetricsAccumulator::default(),
            failure: None,
            execution_secs: 0.0,
            config,
            pipeline,
            envelope,
            margin_profile,
        };
        sim.reset_state();
        Ok(sim)
    }

    /// Lateral feasibility margin of an aligned robot sampled along the
    /// path; used as the scheduling variable for gain scheduling.
    fn build_margin_profile(
        config: &SimulationConfig,
        pipeline: &Pipeline,
        envelope: &RobotEnvelope,
        s0: f64,
        s1: f64,
    ) -> Vec<(f64, f64)> {
        let model = ClearanceModel {
            pipeline,
            robot: &config.robot,
            envelope,
            safety_margin: config.safety_margin,
        };
        let ds = ((s1 - s0) / 400.0).clamp(0.01, 0.05);
        let n = ((s1 - s0) / ds).ceil().max(1.0) as usize;
        (0..=n)
            .map(|k| {
                let s = s0 + (s1 - s0) * k as f64 / n as f64;
                (
                    s,
                    model
                        .lateral_margin(s, 1.0)
                        .min(model.lateral_margin(s, -1.0)),
                )
            })
            .collect()
    }

    fn min_margin_between(&self, a: f64, b: f64) -> f64 {
        let mut m = f64::INFINITY;
        let p = &self.margin_profile;
        let i0 = p.partition_point(|x| x.0 < a).saturating_sub(1);
        for &(s, v) in &p[i0..] {
            if s > b && m.is_finite() {
                break;
            }
            m = m.min(v);
        }
        m
    }

    fn model(&self) -> ClearanceModel<'_> {
        ClearanceModel {
            pipeline: &self.pipeline,
            robot: &self.config.robot,
            envelope: &self.envelope,
            safety_margin: self.config.safety_margin,
        }
    }

    fn reset_state(&mut self) {
        let init = &self.config.initial;
        let pose =
            self.model()
                .aligned_pose(self.start_station, init.lateral_offset, init.heading_error);
        self.state = RobotState {
            pose,
            wheels: WheelSpeeds::default(),
        };
        self.clearance = self.model().evaluate(pose, self.start_station);
        self.controller.reset();
        self.stage.reset(WheelSpeeds::default());
        self.reference = ReferenceGenerator::new(
            self.config.reference.clone(),
            &self.config.robot,
            self.start_station,
            self.goal_station,
        );
        self.rng = Rng::new(self.config.seed);
        self.time = 0.0;
        self.step = 0;
        self.last_ctrl = ControlOutput::default();
        self.last_stage = StageOutput::default();
        self.last_dyn = DynamicsOutput::default();
        self.progress_mark = (self.start_station, 0.0);
        self.limited_since_mark = (false, false);
        self.reference_done_at = None;
        self.telemetry.clear();
        self.events.clear();
        self.metrics = MetricsAccumulator::default();
        self.failure = None;
        self.execution_secs = 0.0;
        self.status = SimulationStatus::Ready;
        let reference = self.reference.state(&self.pipeline);
        let sample = self.sample(&reference, 0);
        self.telemetry.push(sample);
    }

    // ------------------------------------------------------------ lifecycle

    pub fn status(&self) -> SimulationStatus {
        self.status
    }

    pub fn config(&self) -> &SimulationConfig {
        &self.config
    }

    pub fn pipeline(&self) -> &Pipeline {
        &self.pipeline
    }

    fn transition(
        &mut self,
        action: &'static str,
        allowed: &[SimulationStatus],
        to: SimulationStatus,
    ) -> Result<(), SimError> {
        if allowed.contains(&self.status) {
            self.status = to;
            Ok(())
        } else {
            Err(SimError::InvalidTransition {
                action,
                from: self.status,
            })
        }
    }

    pub fn start(&mut self) -> Result<(), SimError> {
        self.transition(
            "start",
            &[SimulationStatus::Ready],
            SimulationStatus::Running,
        )
    }

    pub fn pause(&mut self) -> Result<(), SimError> {
        self.transition(
            "pause",
            &[SimulationStatus::Running],
            SimulationStatus::Paused,
        )
    }

    pub fn resume(&mut self) -> Result<(), SimError> {
        self.transition(
            "resume",
            &[SimulationStatus::Paused],
            SimulationStatus::Running,
        )
    }

    pub fn stop(&mut self) -> Result<(), SimError> {
        self.transition(
            "stop",
            &[
                SimulationStatus::Ready,
                SimulationStatus::Running,
                SimulationStatus::Paused,
            ],
            SimulationStatus::Cancelled,
        )
    }

    /// Return to `Ready` with the initial state (allowed from any state).
    pub fn reset(&mut self) {
        self.reset_state();
    }

    // ------------------------------------------------------------ stepping

    fn fail(&mut self, kind: ViolationKind, message: String, value: f64, limit: f64) {
        let p = self.state.pose;
        self.failure = Some(FailureInfo {
            kind,
            message,
            time: self.time,
            station: self.clearance.station,
            x: p.x,
            y: p.y,
            value,
            limit,
        });
        self.status = SimulationStatus::Failed;
    }

    fn noisy_estimate(&mut self) -> Pose2 {
        let n = self.config.robot.sensor_noise.clone();
        let mut p = self.state.pose;
        if n.position_std > 0.0 {
            p.x += n.position_std * self.rng.gaussian();
            p.y += n.position_std * self.rng.gaussian();
        }
        if n.heading_std > 0.0 {
            p.theta = wrap_angle(p.theta + n.heading_std * self.rng.gaussian());
        }
        p
    }

    /// Advance by one fixed step. Only valid while `Running`.
    pub fn step(&mut self) -> Result<SimulationStatus, SimError> {
        if self.status != SimulationStatus::Running {
            return Err(SimError::InvalidTransition {
                action: "step",
                from: self.status,
            });
        }
        let t0 = Instant::now();
        self.step_inner();
        self.execution_secs += t0.elapsed().as_secs_f64();
        Ok(self.status)
    }

    fn step_inner(&mut self) {
        let dt = self.config.time_step;
        let robot = self.config.robot.clone();

        // (1) Validate the current state.
        if !self.state.pose.is_finite() || !self.state.wheels.is_finite() {
            self.fail(
                ViolationKind::NumericalFailure,
                "Non-finite robot state detected".into(),
                f64::NAN,
                0.0,
            );
            return;
        }
        // Initial-pose feasibility (reported at t = 0, before moving).
        if self.step == 0 && (self.clearance.wheel_outside || self.clearance.min_clearance < 0.0) {
            let kind = if self.clearance.wheel_outside {
                ViolationKind::WheelOutsidePipe
            } else {
                ViolationKind::Collision
            };
            self.fail(
                kind,
                format!(
                    "Initial pose is infeasible at s = {:.3} m (clearance {:.1} mm)",
                    self.clearance.station,
                    self.clearance.min_clearance * 1e3
                ),
                self.clearance.min_clearance,
                0.0,
            );
            return;
        }

        // (2) Local pipeline geometry.
        let s = self.clearance.station;
        let env_len = robot.envelope_length();
        let geometry = LocalGeometry {
            diameter: 2.0 * self.pipeline.effective_radius(s),
            curvature: self.pipeline.curvature(s),
            curvature_ahead: self
                .pipeline
                .max_abs_curvature(s - 0.5 * env_len, s + env_len),
            inclination: self.pipeline.inclination(s),
            lateral_margin_ahead: self.min_margin_between(s - 0.5 * env_len, s + env_len),
        };

        // (3) Clearance / feasibility of the current pose is `self.clearance`
        //     (evaluated at the end of the previous step).
        // (4) Desired state.
        let reference = self.reference.state(&self.pipeline);

        // (5) Controller.
        let estimate = self.noisy_estimate();
        let measured = kinematics::forward(
            robot.wheel_radius,
            robot.wheel_radius,
            robot.track_width,
            self.state.wheels,
        );
        let ctrl = self.controller.compute(&ControlInput {
            estimate,
            measured,
            reference,
            geometry,
            dt,
        });

        // (6) Wheel commands with speed/curvature/acceleration limits.
        let stage = self.stage.process(ctrl.twist, dt);
        self.controller
            .saturation_feedback(ctrl.twist, stage.applied, dt);

        // (7) Motor lag and force/torque/traction limits.
        let w = self.state.wheels;
        let lag = |w: f64, c: f64| {
            dynamics::motor_lag_acceleration(w, c, robot.motor_time_constant, dt)
                .clamp(-robot.max_wheel_acceleration, robot.max_wheel_acceleration)
        };
        let accel_request = WheelSpeeds {
            left: lag(w.left, stage.wheels.left),
            right: lag(w.right, stage.wheels.right),
        };
        let slope = self.effective_slope();
        let dynout = dynamics::resolve(
            &robot,
            &DynamicsInput {
                wheels: w,
                accel_request,
                slope,
                radius_left: self.radius_left,
                radius_right: self.radius_right,
            },
        );

        // (8) Integrate: wheel speeds exactly (constant acceleration), pose by RK4.
        let w1 = WheelSpeeds {
            left: w.left + dynout.accel.left * dt,
            right: w.right + dynout.accel.right * dt,
        };
        let tw0 = kinematics::forward(self.radius_left, self.radius_right, robot.track_width, w);
        let tw1 = kinematics::forward(self.radius_left, self.radius_right, robot.track_width, w1);
        let prev_contacts = self.clearance.contacts.clone();
        self.state.pose = kinematics::rk4_step(self.state.pose, tw0, tw1, dt);
        self.state.wheels = w1;
        self.time += dt;
        self.step += 1;
        self.reference.advance(&self.pipeline, dt);
        self.last_ctrl = ctrl;
        self.last_stage = stage;
        self.last_dyn = dynout;

        if !self.state.pose.is_finite() || !w1.is_finite() {
            self.fail(
                ViolationKind::NumericalFailure,
                "Integration produced a non-finite state".into(),
                f64::NAN,
                0.0,
            );
            return;
        }

        // (9) Collision and geometric constraints at the new pose.
        self.clearance = self.model().evaluate(self.state.pose, s);
        let ref_now = self.reference.state(&self.pipeline);
        self.check_constraints(&prev_contacts, tw1.v, &ref_now, dt);

        // (10) Telemetry and metrics.
        let flags = self.current_flags();
        self.record_metrics(&ref_now, tw1.v, dt);
        if self.step % self.decimation == 0 || self.status != SimulationStatus::Running {
            let sample = self.sample(&ref_now, flags);
            self.telemetry.push(sample);
        }
        if self.status != SimulationStatus::Running {
            return; // (11) fatal violation already handled
        }

        // Goal / timeout.
        let station = self.clearance.station;
        // Completion: after the reference has stopped at the goal, let the
        // robot settle (|e| < 2 mm and |v| < 2 mm/s) for at most 3 s so the
        // final error is not measured while it is still coasting.
        if self.reference.is_finished() && self.reference_done_at.is_none() {
            self.reference_done_at = Some(self.time);
        }
        let settled = {
            let (e_pos, ..) = self.errors(&ref_now);
            (e_pos < 0.002 && tw1.v.abs() < 0.002)
                || self.reference_done_at.is_some_and(|t| self.time - t >= 3.0)
        };
        if self.reference.is_finished() && station >= self.goal_station - 0.05 && settled {
            self.status = SimulationStatus::Completed;
            self.push_final_sample(&ref_now, flags);
        } else if self.time >= self.config.max_duration - 1e-12 {
            self.fail(
                ViolationKind::Timeout,
                format!(
                    "Time limit {:.1} s reached at s = {:.3} m before arriving at the goal (s = {:.3} m)",
                    self.config.max_duration, station, self.goal_station
                ),
                station,
                self.goal_station,
            );
            self.push_final_sample(&ref_now, flags);
        }
    }

    fn push_final_sample(&mut self, reference: &ReferenceState, flags: u32) {
        if self
            .telemetry
            .last()
            .is_none_or(|l| l.t < self.time - 1e-12)
        {
            let s = self.sample(reference, flags);
            self.telemetry.push(s);
        }
    }

    fn obs(
        &self,
        value: f64,
        limit: f64,
        unit: &'static str,
        higher_is_worse: bool,
    ) -> Observation<'static> {
        Observation {
            t: self.time,
            s: self.clearance.station,
            x: self.state.pose.x,
            y: self.state.pose.y,
            value,
            limit,
            unit,
            higher_is_worse,
        }
    }

    fn check_constraints(
        &mut self,
        prev_contacts: &[crate::collision::ContactState],
        v: f64,
        reference: &ReferenceState,
        dt: f64,
    ) {
        let robot = self.config.robot.clone();
        let c = self.clearance.clone();
        let station = c.station;

        // Wheel outside the pipe – always fatal.
        if c.wheel_outside {
            self.events.update(
                ViolationKind::WheelOutsidePipe,
                Severity::Fatal,
                true,
                &self.obs(c.min_clearance, 0.0, "m", false),
                || format!("A wheel contact left the pipe cross-section at s = {station:.3} m"),
            );
            self.fail(
                ViolationKind::WheelOutsidePipe,
                format!(
                    "Wheel contact outside the pipe cross-section at s = {station:.3} m (lateral offset {:.1} mm)",
                    c.lateral * 1e3
                ),
                c.lateral,
                0.0,
            );
            return;
        }

        // Steps and wall ramps under each wheel (fatal if not climbable).
        // A wheel of radius r meets a step of rise h when its axle is
        // r·sin β ahead of the step edge, β = acos(1 − h/r); the check is
        // therefore triggered as soon as the edge lies within r·sin β (plus
        // the distance covered in one step) ahead of the contact, i.e. before
        // the wheel rim reaches the step face.
        if v.abs() > 1e-4 && prev_contacts.len() == c.contacts.len() {
            let r = robot.wheel_radius;
            for (prev, now) in prev_contacts.iter().zip(&c.contacts) {
                let forward = if (now.s - prev.s).abs() > 1e-12 {
                    now.s > prev.s
                } else {
                    v > 0.0
                };
                let slope = self.pipeline.inclination(now.s);
                let axle_rank = if forward {
                    now.axle
                } else {
                    robot.axle_count() - 1 - now.axle
                };
                let beta_max = climb_angle_limit(&robot, axle_rank, slope);
                for disc in self.pipeline.discontinuities() {
                    let (r_from, r_to) = if forward {
                        (disc.radius_before, disc.radius_after)
                    } else {
                        (disc.radius_after, disc.radius_before)
                    };
                    let rise = match (wall_height(r_to, now.d), wall_height(r_from, now.d)) {
                        (Some(z1), Some(z0)) => z1 - z0,
                        (None, _) => r,
                        _ => 0.0,
                    };
                    if rise <= 0.0 {
                        continue;
                    }
                    let beta = step_contact_angle(rise, r);
                    let reach = r * beta.sin();
                    let gap = if forward {
                        disc.s - now.s
                    } else {
                        now.s - disc.s
                    };
                    let met = gap <= reach + v.abs() * dt + 1e-9 && gap > -r;
                    if met && beta > beta_max {
                        let h_max = r * (1.0 - beta_max.cos());
                        self.events.update(
                            ViolationKind::StepNotClimbable,
                            Severity::Fatal,
                            true,
                            &self.obs(rise, h_max, "m", true),
                            || format!("Step of {:.1} mm at s = {:.3} m", rise * 1e3, disc.s),
                        );
                        self.fail(
                            ViolationKind::StepNotClimbable,
                            format!(
                                "Impassable step at s = {:.3} m: wall rises {:.1} mm under axle {} (contact angle {:.1}° > climbable {:.1}°, max step {:.1} mm)",
                                disc.s,
                                rise * 1e3,
                                now.axle,
                                beta.to_degrees(),
                                beta_max.to_degrees(),
                                h_max * 1e3
                            ),
                            rise,
                            h_max,
                        );
                        return;
                    }
                }
                // Gradual wall ramp (diameter transitions) under the wheel.
                let near_disc = self
                    .pipeline
                    .discontinuities()
                    .iter()
                    .any(|d| (d.s - now.s).abs() < 3e-3);
                if !near_disc {
                    let h = 2e-3;
                    if let (Some(z1), Some(z0)) = (
                        wall_height(self.pipeline.effective_radius(now.s + h), now.d),
                        wall_height(self.pipeline.effective_radius(now.s - h), now.d),
                    ) {
                        let dir = if forward { 1.0 } else { -1.0 };
                        let ramp = (dir * (z1 - z0) / (2.0 * h)).atan();
                        if ramp > beta_max {
                            self.fail(
                                ViolationKind::StepNotClimbable,
                                format!(
                                    "Wall ramp of {:.1}° under axle {} at s = {:.3} m exceeds the climbable {:.1}°",
                                    ramp.to_degrees(),
                                    now.axle,
                                    now.s,
                                    beta_max.to_degrees()
                                ),
                                ramp,
                                beta_max,
                            );
                            return;
                        }
                    }
                }
            }
        }

        // Collision.
        let collision = c.min_clearance < 0.0;
        let fatal_collision = collision && self.config.stop_on_collision;
        let crit = c.critical;
        self.events.update(
            ViolationKind::Collision,
            if self.config.stop_on_collision {
                Severity::Fatal
            } else {
                Severity::Warning
            },
            collision,
            &self.obs(c.min_clearance, 0.0, "m", false),
            || {
                let what = crit.map(|p| format!("{:?}", p.kind)).unwrap_or_default();
                format!(
                    "Envelope point ({what}) penetrates the wall at s = {:.3} m",
                    crit.map_or(station, |p| p.s)
                )
            },
        );
        if fatal_collision {
            let at = crit.map_or(station, |p| p.s);
            self.fail(
                ViolationKind::Collision,
                format!(
                    "Collision: {} penetrates the pipe wall by {:.1} mm at s = {:.3} m (local diameter {:.1} mm)",
                    crit.map(|p| format!("{:?}", p.kind).to_lowercase()).unwrap_or_else(|| "robot".into()),
                    -c.min_clearance * 1e3,
                    at,
                    2.0 * self.pipeline.effective_radius(at) * 1e3
                ),
                c.min_clearance,
                0.0,
            );
            return;
        }

        // Safety clearance (warning).
        let req = c.required_clearance;
        self.events.update(
            ViolationKind::SafetyClearance,
            Severity::Warning,
            !collision && c.min_margin < 0.0,
            &self.obs(c.min_clearance, req, "m", false),
            || {
                format!(
                    "Clearance below required {:.1} mm at s = {station:.3} m",
                    req * 1e3
                )
            },
        );

        // Contact angle (warning).
        let max_ca = robot.max_contact_angle;
        self.events.update(
            ViolationKind::ContactAngle,
            Severity::Warning,
            c.max_contact_angle > max_ca,
            &self.obs(c.max_contact_angle, max_ca, "rad", true),
            || {
                format!(
                    "Wall contact angle above {:.1}° at s = {station:.3} m",
                    max_ca.to_degrees()
                )
            },
        );

        // Actuator / traction limits (warnings).
        let st = self.last_stage.flags;
        let wheel_sat = st.wheel_speed_scaled;
        let peak_w = self.last_stage.wheels.max_abs();
        self.events.update(
            ViolationKind::WheelSpeedSaturation,
            Severity::Warning,
            wheel_sat,
            &self.obs(peak_w, robot.max_wheel_speed, "rad/s", true),
            || "Wheel speed command limited".into(),
        );
        let d = self.last_dyn;
        let demand = d.torque_demand_left.abs().max(d.torque_demand_right.abs());
        self.events.update(
            ViolationKind::TorqueSaturation,
            Severity::Warning,
            d.torque_limited,
            &self.obs(demand, robot.max_motor_torque, "N·m", true),
            || {
                format!(
                    "Motor torque demand above {:.3} N·m",
                    robot.max_motor_torque
                )
            },
        );
        self.events.update(
            ViolationKind::TractionLimit,
            Severity::Warning,
            d.traction_limited,
            &self.obs(demand, robot.max_motor_torque, "N·m", true),
            || "Required tractive force exceeds friction limit (wheel slip)".into(),
        );
        self.events.update(
            ViolationKind::TippingRisk,
            Severity::Warning,
            d.min_axle_load_fraction <= 0.0,
            &self.obs(d.min_axle_load_fraction, 0.0, "-", false),
            || "An axle lost its normal load".into(),
        );

        // Stall watchdog: the reference is ahead but the robot has not
        // advanced by 5 mm within 3 s of simulated time.
        if station > self.progress_mark.0 + 0.005 {
            self.progress_mark = (station, self.time);
            self.limited_since_mark = (false, false);
        }
        self.limited_since_mark.0 |= d.torque_limited;
        self.limited_since_mark.1 |= d.traction_limited;
        if reference.s - station > 0.05 && self.time - self.progress_mark.1 > 3.0 {
            let cause = match self.limited_since_mark {
                (_, true) => "the traction (friction) limit",
                (true, false) => "the motor torque limit",
                _ => "insufficient control action",
            };
            self.fail(
                ViolationKind::Stall,
                format!(
                    "Stall at s = {station:.3} m: no progress for 3 s because of {cause} (effective slope {:.1}°, peak torque demand {:.3} N·m, limit {:.3} N·m)",
                    self.effective_slope().to_degrees(),
                    demand,
                    robot.max_motor_torque
                ),
                v,
                0.0,
            );
        }
        let _ = dt;
    }

    /// Effective longitudinal slope: mean segment inclination under the
    /// wheel contacts plus the pitch caused by wall-height differences.
    fn effective_slope(&self) -> f64 {
        let c = &self.clearance.contacts;
        let incl = if c.is_empty() {
            self.pipeline.inclination(self.clearance.station)
        } else {
            c.iter()
                .map(|k| self.pipeline.inclination(k.s))
                .sum::<f64>()
                / c.len() as f64
        };
        incl + self.clearance.pitch
    }

    fn current_flags(&self) -> u32 {
        let mut f = 0;
        for k in ViolationKind::ALL {
            if self.events.is_active(k) {
                f |= k.flag();
            }
        }
        if let Some(fi) = &self.failure {
            f |= fi.kind.flag();
        }
        if self.last_ctrl.diagnostics.saturated {
            f |= FLAG_CONTROLLER_SATURATED;
        }
        if self.last_stage.flags.rate_limited {
            f |= FLAG_RATE_LIMITED;
        }
        f
    }

    fn errors(&self, reference: &ReferenceState) -> (f64, f64, f64, f64) {
        let p = self.state.pose;
        let e_pos = (reference.pose.position() - p.position()).norm();
        let e_lat = self.clearance.lateral - self.config.reference.lateral_offset;
        let e_along = reference.s - self.clearance.station;
        let e_head = wrap_angle(reference.pose.theta - p.theta);
        (e_pos, e_lat, e_along, e_head)
    }

    fn record_metrics(&mut self, reference: &ReferenceState, v: f64, dt: f64) {
        let (e_pos, e_lat, _, e_head) = self.errors(reference);
        let d = self.last_dyn;
        let n_side = self.config.robot.motors_per_side();
        let w = self.state.wheels;
        let power =
            n_side * (d.torque_left * w.left).abs() + n_side * (d.torque_right * w.right).abs();
        self.metrics.push(&StepMetrics {
            dt,
            e_pos,
            e_lat,
            e_heading: e_head,
            v,
            wheel_peak: w.max_abs(),
            clearance: self.clearance.min_clearance,
            station: self.clearance.station,
            contact_angle: self.clearance.max_contact_angle,
            torque_peak: d.torque_left.abs().max(d.torque_right.abs()),
            demand_peak: d.torque_demand_left.abs().max(d.torque_demand_right.abs()),
            power,
            wheel_saturated: self.last_stage.flags.wheel_speed_scaled
                || self.last_stage.flags.linear_clamped
                || self.last_stage.flags.angular_clamped,
            torque_saturated: d.torque_limited,
            traction_limited: d.traction_limited,
        });
    }

    fn sample(&self, reference: &ReferenceState, flags: u32) -> TelemetrySample {
        let p = self.state.pose;
        let robot = &self.config.robot;
        let tw = kinematics::forward(
            self.radius_left,
            self.radius_right,
            robot.track_width,
            self.state.wheels,
        );
        let (e_pos, e_lat, e_along, e_head) = self.errors(reference);
        let d = self.last_dyn;
        let st = self.last_stage;
        let s = self.clearance.station;
        TelemetrySample {
            t: self.time,
            x: p.x,
            y: p.y,
            theta: p.theta,
            s,
            d: self.clearance.lateral,
            x_ref: reference.pose.x,
            y_ref: reference.pose.y,
            theta_ref: reference.pose.theta,
            s_ref: reference.s,
            v_ref: reference.v,
            omega_ref: reference.omega,
            v: tw.v,
            omega: tw.omega,
            v_cmd: st.applied.v,
            omega_cmd: st.applied.omega,
            wheel_left: self.state.wheels.left,
            wheel_right: self.state.wheels.right,
            wheel_left_cmd: st.wheels.left,
            wheel_right_cmd: st.wheels.right,
            torque_left: d.torque_left,
            torque_right: d.torque_right,
            torque_demand_left: d.torque_demand_left,
            torque_demand_right: d.torque_demand_right,
            error_position: e_pos,
            error_lateral: e_lat,
            error_along: e_along,
            error_heading: e_head,
            clearance: self.clearance.min_clearance,
            required_clearance: self.clearance.required_clearance,
            diameter: 2.0 * self.pipeline.effective_radius(s),
            contact_angle: self.clearance.max_contact_angle,
            pitch: self.clearance.pitch,
            roll: self.clearance.roll,
            slope: self.effective_slope(),
            gain_multiplier: if self.step == 0 {
                1.0
            } else {
                self.last_ctrl.diagnostics.gain_multiplier
            },
            lateral_margin: self.min_margin_between(
                s - 0.5 * robot.envelope_length(),
                s + robot.envelope_length(),
            ),
            flags,
        }
    }

    /// Run while `Running` until simulated time reaches `t_target`, or the
    /// wall-clock budget is exhausted. Returns the number of steps executed.
    pub fn run_until(&mut self, t_target: f64, budget: Option<std::time::Duration>) -> u64 {
        let start = Instant::now();
        let mut n = 0;
        while self.status == SimulationStatus::Running && self.time < t_target - 1e-12 {
            let _ = self.step();
            n += 1;
            if n % 64 == 0 && budget.is_some_and(|b| start.elapsed() >= b) {
                break;
            }
        }
        n
    }

    /// Start (if `Ready`) and run to a terminal state. `cancel` is polled
    /// periodically; when set the run ends as `Cancelled`.
    pub fn run_to_completion(&mut self, cancel: Option<&AtomicBool>) -> SimulationStatus {
        if self.status == SimulationStatus::Ready {
            let _ = self.start();
        }
        if self.status == SimulationStatus::Paused {
            let _ = self.resume();
        }
        let mut n: u64 = 0;
        while self.status == SimulationStatus::Running {
            let _ = self.step();
            n += 1;
            if n % 256 == 0 && cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                let _ = self.stop();
            }
        }
        self.status
    }

    pub fn time(&self) -> f64 {
        self.time
    }

    pub fn telemetry(&self) -> &[TelemetrySample] {
        &self.telemetry
    }

    pub fn events(&self) -> &[ViolationEvent] {
        &self.events.events
    }

    pub fn failure(&self) -> Option<&FailureInfo> {
        self.failure.as_ref()
    }

    pub fn progress(&self) -> f64 {
        let span = self.goal_station - self.start_station;
        if span <= 0.0 {
            return 0.0;
        }
        ((self.clearance.station - self.start_station) / span).clamp(0.0, 1.0)
    }

    pub fn snapshot(&self) -> StatusSnapshot {
        StatusSnapshot {
            status: self.status,
            time: self.time,
            step: self.step,
            progress: self.progress(),
            station: self.clearance.station,
            start_station: self.start_station,
            goal_station: self.goal_station,
            pipeline_length: self.pipeline.total_length(),
            telemetry_count: self.telemetry.len(),
            violation_count: self.events.events.len()
                + usize::from(self.failure.as_ref().is_some_and(|f| {
                    matches!(
                        f.kind,
                        ViolationKind::Timeout
                            | ViolationKind::NumericalFailure
                            | ViolationKind::Stall
                    )
                })),
            collision_count: self.events.count(ViolationKind::Collision),
            latest: self.telemetry.last().copied(),
            failure: self.failure.clone(),
            controller: self.config.controller.kind().into(),
            name: self.config.name.clone(),
        }
    }

    pub fn metrics(&self) -> PerformanceMetrics {
        let progress = self.clearance.station - self.start_station;
        let mut m = self.metrics.finish(
            self.time,
            self.execution_secs * 1e3,
            progress,
            self.goal_station - self.start_station,
        );
        let events = &self.events.events;
        m.collision_count = self.events.count(ViolationKind::Collision);
        m.feasibility_violation_count = events.iter().filter(|e| e.kind.is_geometric()).count();
        m.constraint_violation_count = events.len();
        if let Some(f) = &self.failure
            && !events.iter().any(|e| e.kind == f.kind)
        {
            m.constraint_violation_count += 1;
            if f.kind.is_geometric() {
                m.feasibility_violation_count += 1;
            }
        }
        m.goal_reached = self.status == SimulationStatus::Completed;
        m
    }

    pub fn results(&self) -> SimulationResults {
        let metrics = self.metrics();
        let mut r = SimulationResults {
            engine_version: crate::ENGINE_VERSION.into(),
            scenario_hash: self.config.scenario_hash(),
            name: self.config.name.clone(),
            controller: self.config.controller.kind().into(),
            controller_name: self.config.controller.display_name().into(),
            status: self.status,
            failure: self.failure.clone(),
            metrics,
            events: self.events.events.clone(),
            telemetry: self.telemetry.clone(),
            config: self.config.clone(),
            report: String::new(),
        };
        r.report = crate::report::run_report(&r);
        r
    }

    /// Convenience: build, run to completion and return results.
    pub fn run(config: SimulationConfig) -> Result<SimulationResults, SimError> {
        let mut sim = Simulation::new(config)?;
        sim.run_to_completion(None);
        Ok(sim.results())
    }

    /// Position of the robot reference point (for tests and diagnostics).
    pub fn pose(&self) -> Pose2 {
        self.state.pose
    }

    pub fn clearance(&self) -> &ClearanceReport {
        &self.clearance
    }

    #[doc(hidden)]
    pub fn debug_twist(&self) -> Twist {
        kinematics::forward(
            self.radius_left,
            self.radius_right,
            self.config.robot.track_width,
            self.state.wheels,
        )
    }
}

#[allow(dead_code)]
fn _assert_send() {
    fn is_send<T: Send>() {}
    is_send::<Simulation>();
}
