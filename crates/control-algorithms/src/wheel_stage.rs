//! Conversion of a body-twist command into wheel speed commands with limits.
//!
//! Processing order:
//! 1. clamp v to ±v_max and ω to ±ω_max;
//! 2. inverse kinematics ω_R = (v + ωL/2)/r, ω_L = (v − ωL/2)/r;
//! 3. if max(|ω_L|, |ω_R|) > ω_w,max scale *both* wheel speeds by the same
//!    factor – this preserves the commanded path curvature κ = ω/v;
//! 4. rate-limit the wheel commands to |Δω_w| ≤ α_max Δt (same scale factor
//!    for both wheels).

use robot_core::RobotConfig;
use robot_core::kinematics::{Twist, WheelSpeeds, forward, inverse};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WheelLimits {
    pub radius: f64,
    pub track: f64,
    pub max_linear_velocity: f64,
    pub max_angular_velocity: f64,
    pub max_wheel_speed: f64,
    pub max_wheel_acceleration: f64,
}

impl From<&RobotConfig> for WheelLimits {
    fn from(r: &RobotConfig) -> Self {
        Self {
            radius: r.wheel_radius,
            track: r.track_width,
            max_linear_velocity: r.max_linear_velocity,
            max_angular_velocity: r.max_angular_velocity,
            max_wheel_speed: r.max_wheel_speed,
            max_wheel_acceleration: r.max_wheel_acceleration,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SaturationFlags {
    pub linear_clamped: bool,
    pub angular_clamped: bool,
    pub wheel_speed_scaled: bool,
    pub rate_limited: bool,
}

impl SaturationFlags {
    pub fn any(&self) -> bool {
        self.linear_clamped || self.angular_clamped || self.wheel_speed_scaled || self.rate_limited
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct StageOutput {
    pub wheels: WheelSpeeds,
    /// Twist corresponding to the final wheel commands (nominal radius).
    pub applied: Twist,
    pub flags: SaturationFlags,
}

#[derive(Clone, Debug)]
pub struct WheelCommandStage {
    limits: WheelLimits,
    prev: WheelSpeeds,
}

impl WheelCommandStage {
    pub fn new(limits: WheelLimits) -> Self {
        Self {
            limits,
            prev: WheelSpeeds::default(),
        }
    }

    pub fn reset(&mut self, current: WheelSpeeds) {
        self.prev = current;
    }

    pub fn process(&mut self, requested: Twist, dt: f64) -> StageOutput {
        let l = self.limits;
        let mut flags = SaturationFlags::default();
        let (mut v, mut w) = (requested.v, requested.omega);
        if !v.is_finite() || !w.is_finite() {
            // Defensive: never forward NaN to the actuators.
            v = 0.0;
            w = 0.0;
            flags.linear_clamped = true;
            flags.angular_clamped = true;
        }
        if v.abs() > l.max_linear_velocity {
            v = v.signum() * l.max_linear_velocity;
            flags.linear_clamped = true;
        }
        if w.abs() > l.max_angular_velocity {
            w = w.signum() * l.max_angular_velocity;
            flags.angular_clamped = true;
        }
        let mut ws = inverse(l.radius, l.track, Twist { v, omega: w });
        let peak = ws.max_abs();
        if peak > l.max_wheel_speed {
            let k = l.max_wheel_speed / peak;
            ws.left *= k;
            ws.right *= k;
            flags.wheel_speed_scaled = true;
        }
        if dt > 0.0 && dt.is_finite() {
            let max_step = l.max_wheel_acceleration * dt;
            let dl = ws.left - self.prev.left;
            let dr = ws.right - self.prev.right;
            let peak_d = dl.abs().max(dr.abs());
            if peak_d > max_step {
                let k = max_step / peak_d;
                ws.left = self.prev.left + k * dl;
                ws.right = self.prev.right + k * dr;
                flags.rate_limited = true;
            }
        }
        self.prev = ws;
        StageOutput {
            wheels: ws,
            applied: forward(l.radius, l.radius, l.track, ws),
            flags,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage() -> WheelCommandStage {
        WheelCommandStage::new(WheelLimits::from(&RobotConfig::default()))
    }

    #[test]
    fn wheel_speed_saturation_preserves_curvature() {
        let r = RobotConfig::default();
        let mut s = WheelCommandStage::new(WheelLimits {
            max_linear_velocity: 10.0,
            max_angular_velocity: 100.0,
            max_wheel_acceleration: 1e9,
            ..WheelLimits::from(&r)
        });
        let req = Twist { v: 0.5, omega: 3.0 };
        let out = s.process(req, 0.01);
        assert!(out.flags.wheel_speed_scaled);
        assert!((out.wheels.max_abs() - r.max_wheel_speed).abs() < 1e-9);
        let k_req = req.omega / req.v;
        let k_out = out.applied.omega / out.applied.v;
        assert!((k_req - k_out).abs() < 1e-9);
    }

    #[test]
    fn velocity_limits_are_enforced() {
        let r = RobotConfig::default();
        let mut s = WheelCommandStage::new(WheelLimits {
            max_wheel_acceleration: 1e9,
            ..WheelLimits::from(&r)
        });
        let out = s.process(
            Twist {
                v: 5.0,
                omega: -9.0,
            },
            0.01,
        );
        assert!(out.flags.linear_clamped && out.flags.angular_clamped);
        assert!(out.applied.v <= r.max_linear_velocity + 1e-12);
        assert!(out.applied.omega.abs() <= r.max_angular_velocity + 1e-12);
    }

    #[test]
    fn acceleration_rate_limit() {
        let r = RobotConfig::default();
        let mut s = stage();
        let out = s.process(Twist { v: 0.3, omega: 0.0 }, 0.01);
        assert!(out.flags.rate_limited);
        assert!((out.wheels.left - r.max_wheel_acceleration * 0.01).abs() < 1e-12);
        // Converges after enough steps.
        let mut last = out;
        for _ in 0..200 {
            last = s.process(Twist { v: 0.3, omega: 0.0 }, 0.01);
        }
        assert!(!last.flags.any());
        assert!((last.applied.v - 0.3).abs() < 1e-12);
    }

    #[test]
    fn nan_command_is_neutralised() {
        let mut s = stage();
        let out = s.process(
            Twist {
                v: f64::NAN,
                omega: 0.0,
            },
            0.01,
        );
        assert!(out.wheels.is_finite());
        assert_eq!(out.wheels, WheelSpeeds::default());
    }
}
