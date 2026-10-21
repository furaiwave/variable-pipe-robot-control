//! Kinematic tracking controller (baseline).
//!
//! Control law of Kanayama, Kimura, Miyazaki and Noguchi, "A stable tracking
//! control method for an autonomous mobile robot" (IEEE ICRA 1990):
//!
//! ```text
//! v = v_r cos e_θ + K_x e_x
//! ω = ω_r + v_r (K_y e_y + K_θ sin e_θ)
//! ```
//!
//! with the error expressed in the robot frame. The law combines reference
//! feed-forward with proportional feedback and has no integral action, so a
//! constant disturbance (e.g. wheel-radius mismatch) leaves a steady-state
//! offset – which is exactly why it serves as the baseline.

use crate::config::KinematicParams;
use crate::controller::{
    ControlDiagnostics, ControlInput, ControlOutput, Controller, tracking_error,
};
use robot_core::kinematics::Twist;

pub struct KinematicController {
    params: KinematicParams,
}

impl KinematicController {
    pub fn new(params: KinematicParams) -> Self {
        Self { params }
    }
}

impl Controller for KinematicController {
    fn kind(&self) -> &'static str {
        "kinematic"
    }

    fn compute(&mut self, input: &ControlInput) -> ControlOutput {
        let e = tracking_error(&input.estimate, &input.reference.pose);
        let r = &input.reference;
        let p = &self.params;
        let v = r.v * e.e_theta.cos() + p.k_x * e.e_x;
        let omega = r.omega + r.v * (p.k_y * e.e_y + p.k_theta * e.e_theta.sin());
        ControlOutput {
            twist: Twist { v, omega },
            error: e,
            diagnostics: ControlDiagnostics {
                gain_multiplier: 1.0,
                lateral_kp: r.v * p.k_y,
                ..Default::default()
            },
        }
    }

    fn reset(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controller::{LocalGeometry, ReferenceState};
    use robot_core::Pose2;

    #[test]
    fn zero_error_gives_feedforward() {
        let mut c = KinematicController::new(KinematicParams::default());
        let reference = ReferenceState {
            pose: Pose2::new(1.0, 0.0, 0.0),
            v: 0.2,
            omega: 0.1,
            s: 1.0,
        };
        let out = c.compute(&ControlInput {
            estimate: reference.pose,
            measured: Twist::default(),
            reference,
            geometry: LocalGeometry::default(),
            dt: 0.01,
        });
        assert!((out.twist.v - 0.2).abs() < 1e-12 && (out.twist.omega - 0.1).abs() < 1e-12);
    }

    #[test]
    fn steers_towards_reference_on_the_left() {
        let mut c = KinematicController::new(KinematicParams::default());
        let reference = ReferenceState {
            pose: Pose2::new(0.0, 0.05, 0.0),
            v: 0.2,
            omega: 0.0,
            s: 0.0,
        };
        let out = c.compute(&ControlInput {
            estimate: Pose2::default(),
            measured: Twist::default(),
            reference,
            geometry: LocalGeometry::default(),
            dt: 0.01,
        });
        assert!(out.twist.omega > 0.0);
    }
}
