//! Controller interface and shared types.

use robot_core::kinematics::Twist;
use robot_core::{Pose2, wrap_angle};
use serde::{Deserialize, Serialize};

/// Desired state produced by the reference (trajectory) generator.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ReferenceState {
    pub pose: Pose2,
    /// Reference linear velocity v_r, m/s.
    pub v: f64,
    /// Reference yaw rate ω_r = v_r κ, rad/s.
    pub omega: f64,
    /// Reference arc-length station, m.
    pub s: f64,
}

/// Local pipeline information made available to controllers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LocalGeometry {
    /// Effective internal diameter at the robot station, m.
    pub diameter: f64,
    /// Centreline curvature at the robot station, 1/m.
    pub curvature: f64,
    /// Largest |curvature| within the look-ahead window, 1/m.
    pub curvature_ahead: f64,
    /// Longitudinal slope, rad.
    pub inclination: f64,
    /// Smallest *lateral feasibility margin* within the look-ahead window, m:
    /// the largest sideways displacement of an aligned robot that still
    /// satisfies every static constraint (clearance ≥ required safety
    /// clearance, wall contact angle ≤ limit). Negative values mean the
    /// section is infeasible even for a perfectly centred robot.
    pub lateral_margin_ahead: f64,
}

/// Tracking error expressed in the robot body frame (Kanayama convention):
/// [e_x, e_y]ᵀ = R(θ)ᵀ (p_r − p), e_θ = θ_r − θ.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TrackingError {
    pub e_x: f64,
    pub e_y: f64,
    pub e_theta: f64,
}

pub fn tracking_error(estimate: &Pose2, reference: &Pose2) -> TrackingError {
    let dx = reference.x - estimate.x;
    let dy = reference.y - estimate.y;
    let (s, c) = estimate.theta.sin_cos();
    TrackingError {
        e_x: c * dx + s * dy,
        e_y: -s * dx + c * dy,
        e_theta: wrap_angle(reference.theta - estimate.theta),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ControlInput {
    /// Pose estimate (true pose plus sensor noise).
    pub estimate: Pose2,
    /// Body twist measured from wheel encoders (nominal radius).
    pub measured: Twist,
    pub reference: ReferenceState,
    pub geometry: LocalGeometry,
    /// Controller sampling period, s.
    pub dt: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ControlDiagnostics {
    /// Gain multiplier applied by scheduling (1 for fixed-gain controllers).
    pub gain_multiplier: f64,
    /// Effective lateral proportional gain.
    pub lateral_kp: f64,
    pub integral_longitudinal: f64,
    pub integral_lateral: f64,
    /// True if the controller's own output limits clipped the command.
    pub saturated: bool,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ControlOutput {
    pub twist: Twist,
    pub error: TrackingError,
    pub diagnostics: ControlDiagnostics,
}

pub trait Controller: Send {
    /// Short machine-readable identifier (`kinematic`, `pid`, `gain_scheduled`).
    fn kind(&self) -> &'static str;
    fn compute(&mut self, input: &ControlInput) -> ControlOutput;
    /// Inform the controller about the twist that was actually commanded
    /// after downstream saturation, so integral terms can unwind.
    fn saturation_feedback(&mut self, _requested: Twist, _applied: Twist, _dt: f64) {}
    fn reset(&mut self);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_in_body_frame() {
        let est = Pose2::new(1.0, 1.0, std::f64::consts::FRAC_PI_2);
        let refp = Pose2::new(1.0, 2.0, std::f64::consts::FRAC_PI_2);
        let e = tracking_error(&est, &refp);
        // Reference is 1 m straight ahead of the robot.
        assert!((e.e_x - 1.0).abs() < 1e-12 && e.e_y.abs() < 1e-12 && e.e_theta.abs() < 1e-12);
        let refp = Pose2::new(0.0, 1.0, std::f64::consts::FRAC_PI_2);
        let e = tracking_error(&est, &refp);
        // Reference is 1 m to the left of a robot facing +y.
        assert!(e.e_x.abs() < 1e-12 && (e.e_y - 1.0).abs() < 1e-12);
    }
}
