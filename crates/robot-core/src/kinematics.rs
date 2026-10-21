//! Differential-drive kinematics and pose integration.
//!
//! Forward kinematics (wheel speeds → body twist):
//!
//! ```text
//! v = (r_R ω_R + r_L ω_L) / 2
//! ω = (r_R ω_R − r_L ω_L) / L
//! ```
//!
//! With equal radii r this is the textbook form v = r/2 (ω_R + ω_L),
//! ω = r/L (ω_R − ω_L). Separate radii allow a deliberate wheel-radius
//! mismatch disturbance.
//!
//! Unicycle model of the pose (x, y, θ):
//!
//! ```text
//! ẋ = v cos θ,   ẏ = v sin θ,   θ̇ = ω
//! ```

use crate::math::{Pose2, wrap_angle};

/// Body twist of a planar robot.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Twist {
    /// Linear velocity, m/s.
    pub v: f64,
    /// Angular (yaw) velocity, rad/s.
    pub omega: f64,
}

/// Left/right wheel angular speeds, rad/s.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelSpeeds {
    pub left: f64,
    pub right: f64,
}

impl WheelSpeeds {
    pub fn max_abs(&self) -> f64 {
        self.left.abs().max(self.right.abs())
    }
    pub fn is_finite(&self) -> bool {
        self.left.is_finite() && self.right.is_finite()
    }
}

/// Forward kinematics with (possibly unequal) wheel radii.
pub fn forward(r_left: f64, r_right: f64, track: f64, w: WheelSpeeds) -> Twist {
    debug_assert!(track > 0.0);
    Twist {
        v: 0.5 * (r_right * w.right + r_left * w.left),
        omega: (r_right * w.right - r_left * w.left) / track,
    }
}

/// Inverse kinematics for nominal radius r:
/// ω_R = (v + ω L/2) / r,  ω_L = (v − ω L/2) / r.
pub fn inverse(radius: f64, track: f64, t: Twist) -> WheelSpeeds {
    debug_assert!(radius > 0.0);
    WheelSpeeds {
        left: (t.v - 0.5 * t.omega * track) / radius,
        right: (t.v + 0.5 * t.omega * track) / radius,
    }
}

fn derivative(p: &Pose2, v: f64, omega: f64) -> (f64, f64, f64) {
    (v * p.theta.cos(), v * p.theta.sin(), omega)
}

/// One classical fourth-order Runge–Kutta step of the unicycle model over
/// `dt`, with the twist varying linearly from `t0` (start of step) to `t1`
/// (end of step). Linear variation is exact when wheel accelerations are held
/// constant over the step (zero-order hold on accelerations), which is how the
/// simulation drives this function.
pub fn rk4_step(p: Pose2, t0: Twist, t1: Twist, dt: f64) -> Pose2 {
    let mid = Twist {
        v: 0.5 * (t0.v + t1.v),
        omega: 0.5 * (t0.omega + t1.omega),
    };
    let k1 = derivative(&p, t0.v, t0.omega);
    let p2 = Pose2::new(
        p.x + 0.5 * dt * k1.0,
        p.y + 0.5 * dt * k1.1,
        p.theta + 0.5 * dt * k1.2,
    );
    let k2 = derivative(&p2, mid.v, mid.omega);
    let p3 = Pose2::new(
        p.x + 0.5 * dt * k2.0,
        p.y + 0.5 * dt * k2.1,
        p.theta + 0.5 * dt * k2.2,
    );
    let k3 = derivative(&p3, mid.v, mid.omega);
    let p4 = Pose2::new(p.x + dt * k3.0, p.y + dt * k3.1, p.theta + dt * k3.2);
    let k4 = derivative(&p4, t1.v, t1.omega);
    Pose2::new(
        p.x + dt / 6.0 * (k1.0 + 2.0 * k2.0 + 2.0 * k3.0 + k4.0),
        p.y + dt / 6.0 * (k1.1 + 2.0 * k2.1 + 2.0 * k3.1 + k4.1),
        wrap_angle(p.theta + dt / 6.0 * (k1.2 + 2.0 * k2.2 + 2.0 * k3.2 + k4.2)),
    )
}

/// Closed-form solution of the unicycle model for a constant twist (used as
/// the reference in tests): motion along a circular arc, or a straight line
/// when ω ≈ 0.
pub fn exact_constant_twist(p: Pose2, t: Twist, dt: f64) -> Pose2 {
    if t.omega.abs() < 1e-12 {
        return Pose2::new(
            p.x + t.v * dt * p.theta.cos(),
            p.y + t.v * dt * p.theta.sin(),
            p.theta,
        );
    }
    let th1 = p.theta + t.omega * dt;
    let rho = t.v / t.omega;
    Pose2::new(
        p.x + rho * (th1.sin() - p.theta.sin()),
        p.y - rho * (th1.cos() - p.theta.cos()),
        wrap_angle(th1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn forward_inverse_round_trip() {
        let r = 0.03;
        let l = 0.12;
        for (v, w) in [(0.2, 0.0), (0.0, 1.0), (0.15, -0.7), (-0.1, 0.3)] {
            let ws = inverse(r, l, Twist { v, omega: w });
            let t = forward(r, r, l, ws);
            assert!((t.v - v).abs() < 1e-12);
            assert!((t.omega - w).abs() < 1e-12);
        }
    }

    #[test]
    fn textbook_forward_formula() {
        let r = 0.05;
        let l = 0.3;
        let t = forward(
            r,
            r,
            l,
            WheelSpeeds {
                left: 2.0,
                right: 4.0,
            },
        );
        assert!((t.v - r / 2.0 * (4.0 + 2.0)).abs() < 1e-12);
        assert!((t.omega - r / l * (4.0 - 2.0)).abs() < 1e-12);
    }

    #[test]
    fn straight_line_motion() {
        let mut p = Pose2::new(0.0, 0.0, 0.3);
        let t = Twist { v: 0.2, omega: 0.0 };
        for _ in 0..1000 {
            p = rk4_step(p, t, t, 0.01);
        }
        // 10 s at 0.2 m/s = 2 m along heading 0.3 rad.
        assert!((p.x - 2.0 * 0.3f64.cos()).abs() < 1e-9);
        assert!((p.y - 2.0 * 0.3f64.sin()).abs() < 1e-9);
        assert!((p.theta - 0.3).abs() < 1e-12);
    }

    #[test]
    fn circular_motion_matches_closed_form() {
        let t = Twist { v: 0.2, omega: 0.5 };
        let p0 = Pose2::new(0.0, 0.0, 0.0);
        let mut p = p0;
        let dt = 0.01;
        let n = 1257; // ≈ one full circle (2π / 0.5 = 12.566 s)
        for _ in 0..n {
            p = rk4_step(p, t, t, dt);
        }
        let exact = exact_constant_twist(p0, t, dt * n as f64);
        assert!((p.x - exact.x).abs() < 1e-8, "{p:?} vs {exact:?}");
        assert!((p.y - exact.y).abs() < 1e-8);
        // Radius check: centre at (0, v/ω).
        let rho = t.v / t.omega;
        let d = (p.x.powi(2) + (p.y - rho).powi(2)).sqrt();
        assert!((d - rho).abs() < 1e-8);
    }

    #[test]
    fn zero_velocity_keeps_pose() {
        let p0 = Pose2::new(1.0, 2.0, -PI / 3.0);
        let t = Twist::default();
        let p = rk4_step(p0, t, t, 0.05);
        assert_eq!((p.x, p.y), (p0.x, p0.y));
        assert!((p.theta - p0.theta).abs() < 1e-15);
    }

    #[test]
    fn in_place_rotation() {
        let t = Twist { v: 0.0, omega: 1.0 };
        let p = rk4_step(Pose2::default(), t, t, 0.5);
        assert!(p.x.abs() < 1e-15 && p.y.abs() < 1e-15);
        assert!((p.theta - 0.5).abs() < 1e-12);
    }

    #[test]
    fn rk4_fourth_order_convergence() {
        // Error must shrink ~16× when dt halves (accelerating twist).
        let p0 = Pose2::default();
        let run = |dt: f64| {
            let steps = (2.0 / dt).round() as usize;
            let mut p = p0;
            for k in 0..steps {
                let ta = k as f64 * dt;
                let tb = ta + dt;
                let tw = |t: f64| Twist {
                    v: 0.1 + 0.05 * t,
                    omega: 0.8 - 0.3 * t,
                };
                p = rk4_step(p, tw(ta), tw(tb), dt);
            }
            p
        };
        let fine = run(0.0005);
        let e1 = (run(0.1).x - fine.x).abs() + (run(0.1).y - fine.y).abs();
        let e2 = (run(0.05).x - fine.x).abs() + (run(0.05).y - fine.y).abs();
        assert!(e1 / e2 > 10.0, "ratio {}", e1 / e2);
    }
}
