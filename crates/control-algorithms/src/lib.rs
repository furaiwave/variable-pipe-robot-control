//! Trajectory-tracking controllers for a differential-drive (skid-steer) robot.
//!
//! All controllers implement [`Controller`]: they receive the estimated pose,
//! the measured body twist, the reference state, local pipeline geometry and
//! the time step, and return a desired body twist (v, ω). The common
//! [`WheelCommandStage`] converts the twist into left/right wheel speed
//! commands and enforces velocity, wheel-speed and acceleration limits.
//!
//! Implemented controllers:
//! * [`KinematicController`] – nonlinear kinematic tracking law of Kanayama
//!   et al. (1990) with reference feed-forward. Proportional only; serves as
//!   the **baseline**.
//! * [`PidTrackingController`] – two PID loops (longitudinal and
//!   lateral/heading) with filtered derivative and back-calculation
//!   anti-windup, fixed gains.
//! * [`GainScheduledController`] – the same PID structure whose lateral gains
//!   are scheduled by explicit rules on local clearance and path curvature.
//!   This is *gain scheduling*, not parameter-estimating adaptive control.

mod config;
mod controller;
mod gain_scheduled;
mod kinematic;
mod pid;
mod pid_tracking;
mod wheel_stage;

pub use config::{
    ControllerConfig, GainScheduledParams, KinematicParams, LongitudinalMode, PidTrackingParams,
};
pub use controller::{
    ControlDiagnostics, ControlInput, ControlOutput, Controller, LocalGeometry, ReferenceState,
    TrackingError, tracking_error,
};
pub use gain_scheduled::{GainScheduledController, schedule_multiplier};
pub use kinematic::KinematicController;
pub use pid::{Pid, PidGains, PidOutput};
pub use pid_tracking::PidTrackingController;
pub use wheel_stage::{SaturationFlags, StageOutput, WheelCommandStage, WheelLimits};
