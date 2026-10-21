//! Simplified longitudinal / yaw dynamics with actuator and traction limits.
//!
//! The model is deliberately low-order (suitable for a bachelor-level
//! simulation study):
//!
//! 1. Each drive side follows its wheel-speed command through a first-order
//!    lag with time constant τ_m (closed speed loop of the motor driver):
//!    ω̇ = (ω_cmd − ω)/τ_m, discretised exactly over the time step.
//! 2. The requested wheel accelerations are converted into requested body
//!    accelerations (a, ε) and then into the side tractive forces needed to
//!    produce them against gravity on the slope, rolling resistance and the
//!    skid-steer turning-resistance moment:
//!
//!    ```text
//!    F_L + F_R          = m a + m g sin α + C_rr m g cos α · sgn(v)
//!    (F_R − F_L) · L/2  = I_z ε + M_r · sgn(ω)
//!    M_r                = μ_lat Σ_k N_k |x_k|
//!    ```
//!
//! 3. Each side force is clamped to min(motor limit, traction limit):
//!    `n_side · τ_max / r` and `μ · N / 2`.
//! 4. The accelerations that the clamped forces actually produce are
//!    returned. When nothing saturates they equal the requested ones.
//!
//! Wheel rotational inertia, motor electrical dynamics, suspension and
//! load transfer between sides are neglected (see docs/limitations.md).

use crate::GRAVITY;
use crate::kinematics::WheelSpeeds;
use crate::robot::RobotConfig;

/// Smooth sign used for Coulomb-type resistances to avoid chattering at rest.
fn smooth_sign(x: f64, eps: f64) -> f64 {
    (x / eps).tanh()
}

/// Exact discretisation of a first-order lag over `dt`, expressed as the
/// constant acceleration that moves `w` to the lagged value at `t + dt`.
pub fn motor_lag_acceleration(w: f64, w_cmd: f64, tau: f64, dt: f64) -> f64 {
    if dt <= 0.0 || !dt.is_finite() {
        return 0.0;
    }
    if tau <= 1e-9 {
        return (w_cmd - w) / dt;
    }
    let w_next = w_cmd + (w - w_cmd) * (-dt / tau).exp();
    (w_next - w) / dt
}

#[derive(Clone, Copy, Debug)]
pub struct DynamicsInput {
    /// Current wheel speeds, rad/s.
    pub wheels: WheelSpeeds,
    /// Requested wheel accelerations, rad/s².
    pub accel_request: WheelSpeeds,
    /// Effective longitudinal slope α (positive = climbing), rad.
    pub slope: f64,
    /// Actual rolling radius of the left/right wheels, m.
    pub radius_left: f64,
    pub radius_right: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DynamicsOutput {
    /// Realised wheel accelerations, rad/s².
    pub accel: WheelSpeeds,
    /// Delivered torque per motor on each side, N·m.
    pub torque_left: f64,
    pub torque_right: f64,
    /// Torque per motor that the request would have needed, N·m.
    pub torque_demand_left: f64,
    pub torque_demand_right: f64,
    /// True when a motor torque limit clipped the request.
    pub torque_limited: bool,
    /// True when the friction (traction) limit clipped the request → wheel slip.
    pub traction_limited: bool,
    /// Static resistance (gravity + rolling) along the path, N.
    pub resistance_force: f64,
    /// Turning-resistance moment magnitude, N·m.
    pub turning_moment: f64,
    /// Minimum normal-load fraction over all axles (≤ 0 → lift-off risk).
    pub min_axle_load_fraction: f64,
}

/// Resolve requested wheel accelerations into realisable ones.
pub fn resolve(robot: &RobotConfig, input: &DynamicsInput) -> DynamicsOutput {
    let m = robot.mass;
    let track = robot.track_width;
    let iz = robot.yaw_inertia();
    let (rl, rr) = (input.radius_left, input.radius_right);
    let w = input.wheels;
    let al = input.accel_request;

    let v = 0.5 * (rr * w.right + rl * w.left);
    let omega = (rr * w.right - rl * w.left) / track;
    let a_req = 0.5 * (rr * al.right + rl * al.left);
    let eps_req = (rr * al.right - rl * al.left) / track;

    let cos_a = input.slope.cos();
    let normal = m * GRAVITY * cos_a;
    let f_grav = m * GRAVITY * input.slope.sin();
    let f_roll = robot.rolling_resistance * normal * smooth_sign(v, 0.01);

    let fractions = robot.axle_load_fractions(input.slope);
    let min_frac = fractions.iter().copied().fold(f64::INFINITY, f64::min);
    let m_turn_mag: f64 = robot
        .axle_positions()
        .iter()
        .zip(&fractions)
        .map(|(x, f)| robot.lateral_friction_coefficient * normal * f.max(0.0) * x.abs())
        .sum();
    let m_turn = m_turn_mag * smooth_sign(omega, 0.05);

    let f_total_req = m * a_req + f_grav + f_roll;
    let m_req = iz * eps_req + m_turn;
    let fr_req = 0.5 * f_total_req + m_req / track;
    let fl_req = 0.5 * f_total_req - m_req / track;

    let n_side = robot.motors_per_side();
    let motor_lim_l = n_side * robot.max_motor_torque / rl;
    let motor_lim_r = n_side * robot.max_motor_torque / rr;
    let traction_lim = robot.friction_coefficient * normal.max(0.0) * 0.5;

    let clamp_side = |f: f64, motor_lim: f64| -> (f64, bool, bool) {
        let lim = motor_lim.min(traction_lim);
        if f.abs() <= lim {
            (f, false, false)
        } else {
            let traction = traction_lim < motor_lim;
            (f.signum() * lim, !traction, traction)
        }
    };
    let (fl, tl_l, sl_l) = clamp_side(fl_req, motor_lim_l);
    let (fr, tl_r, sl_r) = clamp_side(fr_req, motor_lim_r);

    let a = (fl + fr - f_grav - f_roll) / m;
    let eps = ((fr - fl) * 0.5 * track - m_turn) / iz;

    DynamicsOutput {
        accel: WheelSpeeds {
            left: (a - 0.5 * eps * track) / rl,
            right: (a + 0.5 * eps * track) / rr,
        },
        torque_left: fl * rl / n_side,
        torque_right: fr * rr / n_side,
        torque_demand_left: fl_req * rl / n_side,
        torque_demand_right: fr_req * rr / n_side,
        torque_limited: tl_l || tl_r,
        traction_limited: sl_l || sl_r,
        resistance_force: f_grav + f_roll,
        turning_moment: m_turn_mag,
        min_axle_load_fraction: min_frac,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(slope: f64, wheels: WheelSpeeds, req: WheelSpeeds) -> DynamicsInput {
        let r = RobotConfig::default().wheel_radius;
        DynamicsInput {
            wheels,
            accel_request: req,
            slope,
            radius_left: r,
            radius_right: r,
        }
    }

    #[test]
    fn unsaturated_request_is_realised() {
        let robot = RobotConfig::default();
        let out = resolve(
            &robot,
            &input(
                0.0,
                WheelSpeeds {
                    left: 3.0,
                    right: 3.0,
                },
                WheelSpeeds {
                    left: 1.0,
                    right: 1.2,
                },
            ),
        );
        assert!(!out.torque_limited && !out.traction_limited);
        assert!((out.accel.left - 1.0).abs() < 1e-9);
        assert!((out.accel.right - 1.2).abs() < 1e-9);
    }

    #[test]
    fn holding_on_slope_needs_gravity_torque() {
        let robot = RobotConfig::default();
        let slope = 10f64.to_radians();
        let out = resolve(
            &robot,
            &input(slope, WheelSpeeds::default(), WheelSpeeds::default()),
        );
        let expected_per_motor =
            robot.mass * GRAVITY * slope.sin() * robot.wheel_radius / robot.wheel_count as f64;
        assert!((out.torque_left - expected_per_motor).abs() < 1e-9);
        assert!(out.accel.left.abs() < 1e-9);
    }

    #[test]
    fn excessive_slope_saturates_and_robot_slides_back() {
        let robot = RobotConfig::default(); // μ = 0.6 → max ≈ 31°
        let out = resolve(
            &robot,
            &input(
                40f64.to_radians(),
                WheelSpeeds::default(),
                WheelSpeeds::default(),
            ),
        );
        assert!(out.torque_limited || out.traction_limited);
        assert!(out.accel.left < 0.0 && out.accel.right < 0.0);
    }

    #[test]
    fn huge_acceleration_request_is_torque_limited() {
        let robot = RobotConfig::default();
        let out = resolve(
            &robot,
            &input(
                0.0,
                WheelSpeeds::default(),
                WheelSpeeds {
                    left: 500.0,
                    right: 500.0,
                },
            ),
        );
        assert!(out.torque_limited || out.traction_limited);
        assert!(out.accel.left < 500.0);
        assert!(out.torque_left.abs() <= robot.max_motor_torque + 1e-12);
    }

    #[test]
    fn motor_lag_is_exact_first_order() {
        let tau = 0.1;
        let dt = 0.01;
        let mut w = 0.0;
        for _ in 0..10 {
            w += motor_lag_acceleration(w, 10.0, tau, dt) * dt;
        }
        // After t = τ the response reaches 1 − e^{-1} of the step.
        assert!((w - 10.0 * (1.0 - (-1.0f64).exp())).abs() < 1e-9);
        assert_eq!(motor_lag_acceleration(1.0, 2.0, tau, 0.0), 0.0);
    }
}
