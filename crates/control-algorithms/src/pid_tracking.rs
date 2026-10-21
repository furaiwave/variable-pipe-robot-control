//! PID trajectory-tracking controller with fixed gains.
//!
//! ```text
//! longitudinal (position mode): v = v_r cos e_θ + PID_x(e_x)
//! longitudinal (velocity mode): v = v_r + PID_v(v_r − v_meas)
//! lateral:                      ω = ω_r + PID_c(e_c),   e_c = e_y cos e_θ + l_a sin e_θ
//! ```
//!
//! e_c is the signed distance of a look-ahead point (l_a ahead of the
//! robot) from the reference path line. For small errors the closed lateral
//! loop with a proportional term K_p is ë + K_p l_a ė + K_p v e = 0, i.e. it is
//! stable for K_p, l_a, v > 0 with ω_n = √(K_p v) and ζ = l_a √(K_p / v) / 2.

use crate::config::{LongitudinalMode, PidTrackingParams};
use crate::controller::{
    ControlDiagnostics, ControlInput, ControlOutput, Controller, TrackingError, tracking_error,
};
use crate::pid::Pid;
use robot_core::kinematics::Twist;

pub struct PidTrackingController {
    params: PidTrackingParams,
    longitudinal: Pid,
    lateral: Pid,
    last_ff: Twist,
}

impl PidTrackingController {
    pub fn new(params: PidTrackingParams) -> Self {
        Self {
            longitudinal: Pid::new(params.longitudinal),
            lateral: Pid::new(params.lateral),
            params,
            last_ff: Twist::default(),
        }
    }

    pub fn params(&self) -> &PidTrackingParams {
        &self.params
    }

    /// Set the lateral loop gains at run time (used by gain scheduling).
    pub fn set_lateral_gains(&mut self, kp: f64, ki: f64, kd: f64) {
        self.lateral.gains.kp = kp;
        self.lateral.gains.ki = ki;
        self.lateral.gains.kd = kd;
    }

    pub fn lateral_error(&self, e: &TrackingError) -> f64 {
        e.e_y * e.e_theta.cos() + self.params.lookahead * e.e_theta.sin()
    }
}

impl Controller for PidTrackingController {
    fn kind(&self) -> &'static str {
        "pid"
    }

    fn compute(&mut self, input: &ControlInput) -> ControlOutput {
        let e = tracking_error(&input.estimate, &input.reference.pose);
        let r = &input.reference;

        let (v_ff, long) = match self.params.longitudinal_mode {
            LongitudinalMode::Position => (
                r.v * e.e_theta.cos(),
                self.longitudinal.update(e.e_x, input.dt),
            ),
            LongitudinalMode::Velocity => (
                r.v,
                self.longitudinal.update(r.v - input.measured.v, input.dt),
            ),
        };
        let e_c = self.lateral_error(&e);
        let lat = self.lateral.update(e_c, input.dt);

        self.last_ff = Twist {
            v: v_ff,
            omega: r.omega,
        };
        ControlOutput {
            twist: Twist {
                v: v_ff + long.output,
                omega: r.omega + lat.output,
            },
            error: e,
            diagnostics: ControlDiagnostics {
                gain_multiplier: 1.0,
                lateral_kp: self.lateral.gains.kp,
                integral_longitudinal: self.longitudinal.integral(),
                integral_lateral: self.lateral.integral(),
                saturated: long.saturated || lat.saturated,
            },
        }
    }

    fn saturation_feedback(&mut self, requested: Twist, applied: Twist, dt: f64) {
        // Portion of each loop's output that survived downstream limits.
        if (requested.v - applied.v).abs() > 1e-12 {
            self.longitudinal
                .external_saturation(applied.v - self.last_ff.v, dt);
        }
        if (requested.omega - applied.omega).abs() > 1e-12 {
            self.lateral
                .external_saturation(applied.omega - self.last_ff.omega, dt);
        }
    }

    fn reset(&mut self) {
        self.longitudinal.reset();
        self.lateral.reset();
        self.longitudinal.gains = self.params.longitudinal;
        self.lateral.gains = self.params.lateral;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controller::{LocalGeometry, ReferenceState};
    use robot_core::Pose2;
    use robot_core::kinematics::rk4_step;

    /// Closed loop on an ideal unicycle with a constant yaw-rate disturbance:
    /// the integral term must drive the lateral error to ~zero.
    #[test]
    fn integral_action_removes_constant_disturbance() {
        let mut c = PidTrackingController::new(PidTrackingParams::default());
        let dt = 0.01;
        let v_r = 0.2;
        let mut pose = Pose2::new(0.0, 0.03, 0.0);
        let mut last_e = 1.0;
        for k in 0..4000 {
            let s = k as f64 * dt * v_r;
            let reference = ReferenceState {
                pose: Pose2::new(s, 0.0, 0.0),
                v: v_r,
                omega: 0.0,
                s,
            };
            let out = c.compute(&ControlInput {
                estimate: pose,
                measured: Twist { v: v_r, omega: 0.0 },
                reference,
                geometry: LocalGeometry::default(),
                dt,
            });
            let applied = Twist {
                v: out.twist.v,
                omega: out.twist.omega + 0.05,
            };
            pose = rk4_step(pose, applied, applied, dt);
            last_e = out.error.e_y;
        }
        assert!(last_e.abs() < 1e-3, "residual lateral error {last_e}");
    }
}
