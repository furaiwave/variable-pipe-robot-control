//! Robot mechanical and motion parameters.
//!
//! The default values describe a *hypothetical* small skid-steer inspection
//! robot. They are illustrative assumptions chosen to be plausible for
//! 200–300 mm pipes; they are not measured specifications of real hardware.

use crate::validation::{ValidationErrors, Validator};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// Additive white Gaussian noise applied to the pose estimate that the
/// controller sees (the true pose is integrated without noise).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SensorNoise {
    /// Standard deviation of x/y position noise, m.
    pub position_std: f64,
    /// Standard deviation of heading noise, rad.
    pub heading_std: f64,
}

impl Default for SensorNoise {
    fn default() -> Self {
        Self {
            position_std: 0.0,
            heading_std: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RobotConfig {
    pub name: String,
    /// Body (chassis box) length along the direction of travel, m.
    pub body_length: f64,
    /// Body width, m.
    pub body_width: f64,
    /// Body height, m.
    pub body_height: f64,
    /// Height of the body underside above the wheel contact plane, m.
    pub chassis_clearance: f64,
    /// Total number of wheels (even: 4, 6 or 8). Wheels on one side are
    /// driven together (skid-steer), so the kinematics are those of a
    /// differential drive with an effective track width.
    pub wheel_count: u32,
    /// Effective rolling radius r, m.
    pub wheel_radius: f64,
    /// Wheel width, m.
    pub wheel_width: f64,
    /// Longitudinal distance between the front and rear axle, m.
    pub wheelbase: f64,
    /// Lateral distance L between left and right wheel mid-planes
    /// (the kinematic track width), m.
    pub track_width: f64,
    /// Total mass, kg.
    pub mass: f64,
    /// Longitudinal centre-of-mass offset from the geometric centre (+ forward), m.
    pub com_offset_x: f64,
    /// Centre-of-mass height above the contact plane, m.
    pub com_height: f64,
    /// Linear velocity limit, m/s.
    pub max_linear_velocity: f64,
    /// Yaw-rate limit, rad/s.
    pub max_angular_velocity: f64,
    /// Wheel angular speed limit, rad/s.
    pub max_wheel_speed: f64,
    /// Wheel angular acceleration limit, rad/s².
    pub max_wheel_acceleration: f64,
    /// Peak torque per drive motor (one motor per wheel), N·m.
    pub max_motor_torque: f64,
    /// Rolling-resistance coefficient C_rr (dimensionless).
    pub rolling_resistance: f64,
    /// Longitudinal wheel–wall friction coefficient μ.
    pub friction_coefficient: f64,
    /// Lateral friction coefficient μ_lat used for skid-steer turning resistance.
    pub lateral_friction_coefficient: f64,
    /// First-order motor/speed-loop time constant τ_m, s.
    pub motor_time_constant: f64,
    /// Maximum admissible wall contact angle of the wheels (angle between the
    /// wall normal at the contact point and the vertical), rad.
    pub max_contact_angle: f64,
    pub sensor_noise: SensorNoise,
}

impl Default for RobotConfig {
    fn default() -> Self {
        Self {
            name: "Illustrative 4WD inspection robot".into(),
            body_length: 0.20,
            body_width: 0.10,
            body_height: 0.07,
            chassis_clearance: 0.02,
            wheel_count: 4,
            wheel_radius: 0.03,
            wheel_width: 0.02,
            wheelbase: 0.10,
            track_width: 0.12,
            mass: 2.5,
            com_offset_x: 0.0,
            com_height: 0.05,
            max_linear_velocity: 0.30,
            max_angular_velocity: 1.5,
            max_wheel_speed: 12.0,
            max_wheel_acceleration: 30.0,
            max_motor_torque: 0.10,
            rolling_resistance: 0.03,
            friction_coefficient: 0.6,
            lateral_friction_coefficient: 0.3,
            motor_time_constant: 0.08,
            max_contact_angle: 50.0_f64.to_radians(),
            sensor_noise: SensorNoise::default(),
        }
    }
}

impl RobotConfig {
    pub fn validate(&self) -> Result<(), ValidationErrors> {
        let mut v = Validator::new("robot");
        v.range("body_length", self.body_length, 0.01, 5.0);
        v.range("body_width", self.body_width, 0.01, 5.0);
        v.range("body_height", self.body_height, 0.005, 5.0);
        v.range("chassis_clearance", self.chassis_clearance, 0.0, 1.0);
        v.check(
            matches!(self.wheel_count, 4 | 6 | 8),
            "wheel_count",
            "must be 4, 6 or 8 (two drive sides with 2–4 axles)",
        );
        v.range("wheel_radius", self.wheel_radius, 0.005, 1.0);
        v.range("wheel_width", self.wheel_width, 0.002, 0.5);
        v.range("wheelbase", self.wheelbase, 0.01, 5.0);
        v.range("track_width", self.track_width, 0.01, 5.0);
        v.range("mass", self.mass, 0.05, 1000.0);
        v.finite("com_offset_x", self.com_offset_x);
        v.range("com_height", self.com_height, 0.0, 2.0);
        v.range("max_linear_velocity", self.max_linear_velocity, 0.001, 10.0);
        v.range(
            "max_angular_velocity",
            self.max_angular_velocity,
            0.01,
            20.0,
        );
        v.range("max_wheel_speed", self.max_wheel_speed, 0.1, 1000.0);
        v.range(
            "max_wheel_acceleration",
            self.max_wheel_acceleration,
            0.1,
            10_000.0,
        );
        v.range("max_motor_torque", self.max_motor_torque, 1e-4, 1000.0);
        v.range("rolling_resistance", self.rolling_resistance, 0.0, 0.5);
        v.range("friction_coefficient", self.friction_coefficient, 0.05, 2.0);
        v.range(
            "lateral_friction_coefficient",
            self.lateral_friction_coefficient,
            0.0,
            2.0,
        );
        v.range("motor_time_constant", self.motor_time_constant, 0.001, 2.0);
        v.range(
            "max_contact_angle",
            self.max_contact_angle,
            1f64.to_radians(),
            85f64.to_radians(),
        );
        v.range(
            "sensor_noise.position_std",
            self.sensor_noise.position_std,
            0.0,
            0.1,
        );
        v.range(
            "sensor_noise.heading_std",
            self.sensor_noise.heading_std,
            0.0,
            0.5,
        );

        if v.has_issues() {
            return v.finish();
        }
        // Cross-field consistency checks.
        v.check(
            self.track_width > self.wheel_width,
            "track_width",
            "must exceed the wheel width (wheels would overlap)",
        );
        v.check(
            self.com_offset_x.abs() < 0.5 * self.wheelbase,
            "com_offset_x",
            "centre of mass must lie between the front and rear axle",
        );
        v.check(
            self.axle_spacing() >= 2.0 * self.wheel_radius,
            "wheelbase",
            format!(
                "axle spacing {:.3} m is smaller than the wheel diameter {:.3} m (adjacent wheels would overlap)",
                self.axle_spacing(),
                2.0 * self.wheel_radius
            ),
        );
        v.check(
            self.max_linear_velocity <= self.max_wheel_speed * self.wheel_radius + 1e-12,
            "max_linear_velocity",
            format!(
                "exceeds the wheel speed limit × wheel radius ({:.3} m/s)",
                self.max_wheel_speed * self.wheel_radius
            ),
        );
        v.check(
            self.chassis_clearance < self.wheel_radius * 2.0,
            "chassis_clearance",
            "body underside must be below the wheel top (2r)",
        );
        v.finish()
    }

    pub fn axle_count(&self) -> usize {
        (self.wheel_count / 2).max(2) as usize
    }

    pub fn axle_spacing(&self) -> f64 {
        self.wheelbase / (self.axle_count() as f64 - 1.0)
    }

    /// Longitudinal axle positions in the body frame, rear → front.
    pub fn axle_positions(&self) -> Vec<f64> {
        let n = self.axle_count();
        (0..n)
            .map(|k| -0.5 * self.wheelbase + self.wheelbase * k as f64 / (n as f64 - 1.0))
            .collect()
    }

    /// Lateral position of the wheel–wall contact (outer rim edge). A
    /// cylindrical wheel resting inside a concave circular wall touches it at
    /// the outer edge of its tread.
    pub fn contact_half_span(&self) -> f64 {
        0.5 * (self.track_width + self.wheel_width)
    }

    /// Overall planar envelope width (body or wheels, whichever is wider), m.
    pub fn envelope_width(&self) -> f64 {
        self.body_width.max(self.track_width + self.wheel_width)
    }

    /// Overall planar envelope length (body or wheels), m.
    pub fn envelope_length(&self) -> f64 {
        self.body_length
            .max(self.wheelbase + 2.0 * self.wheel_radius)
    }

    /// Overall height above the contact plane, m.
    pub fn envelope_height(&self) -> f64 {
        (self.chassis_clearance + self.body_height).max(2.0 * self.wheel_radius)
    }

    /// Yaw moment of inertia approximated as a uniform box, kg·m².
    pub fn yaw_inertia(&self) -> f64 {
        let l = self.envelope_length();
        let w = self.envelope_width();
        self.mass * (l * l + w * w) / 12.0
    }

    pub fn motors_per_side(&self) -> f64 {
        (self.wheel_count / 2) as f64
    }

    /// Normal-load fraction carried by each axle (rear → front) on a slope of
    /// angle `slope` (positive = climbing). Uses a linear (elastic, equally
    /// stiff supports) load distribution, which reduces to exact statics for
    /// two axles. Fractions sum to 1; negative values indicate lift-off.
    pub fn axle_load_fractions(&self, slope: f64) -> Vec<f64> {
        let xs = self.axle_positions();
        let n = xs.len() as f64;
        let sum_x2: f64 = xs.iter().map(|x| x * x).sum();
        // Effective CoM shift: the weight component along the slope acting at
        // height h moves the resultant towards the rear when climbing.
        let x_eff = self.com_offset_x - self.com_height * slope.tan();
        xs.iter().map(|x| 1.0 / n + x * x_eff / sum_x2).collect()
    }

    /// Maximum climbable contact angle β_max for the front axle meeting a step
    /// or ramp, from quasi-static friction-cone equilibrium:
    ///
    /// β_max = atan(μ) + atan(μ · W_rest / W_axle)
    ///
    /// where the remaining axles push with at most μ·W_rest. See
    /// `docs/mathematical-model.md` for the derivation.
    pub fn max_climb_angle(&self) -> f64 {
        let f = self.axle_load_fractions(0.0);
        let front = f.last().copied().unwrap_or(0.5).clamp(0.02, 0.98);
        let mu = self.friction_coefficient;
        (mu.atan() + (mu * (1.0 - front) / front).atan()).min(0.5 * PI)
    }

    /// Maximum climbable step height for a wheel of radius r:
    /// h_max = r (1 − cos β_max).
    pub fn max_step_height(&self) -> f64 {
        self.wheel_radius * (1.0 - self.max_climb_angle().cos())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_valid() {
        RobotConfig::default().validate().unwrap();
    }

    #[test]
    fn rejects_invalid_values() {
        let r = RobotConfig {
            wheel_radius: -0.1,
            mass: f64::NAN,
            wheel_count: 3,
            ..RobotConfig::default()
        };
        let err = r.validate().unwrap_err();
        let fields: Vec<_> = err.issues.iter().map(|i| i.field.as_str()).collect();
        assert!(fields.contains(&"robot.wheel_radius"));
        assert!(fields.contains(&"robot.mass"));
        assert!(fields.contains(&"robot.wheel_count"));
    }

    #[test]
    fn rejects_inconsistent_speed_limits() {
        let r = RobotConfig {
            max_linear_velocity: 1.0,
            ..RobotConfig::default()
        };
        assert!(r.validate().is_err());
    }

    #[test]
    fn axle_loads_sum_to_one_and_shift_rearwards_uphill() {
        for wheels in [4, 6, 8] {
            let r = RobotConfig {
                wheel_count: wheels,
                wheelbase: 0.2,
                ..RobotConfig::default()
            };
            let flat = r.axle_load_fractions(0.0);
            let up = r.axle_load_fractions(0.3);
            assert!((flat.iter().sum::<f64>() - 1.0).abs() < 1e-12);
            assert!((up.iter().sum::<f64>() - 1.0).abs() < 1e-12);
            assert!(up.last().unwrap() < flat.last().unwrap());
        }
    }

    #[test]
    fn climb_angle_two_equal_axles() {
        let r = RobotConfig::default();
        let mu: f64 = r.friction_coefficient;
        // Equal axle loads → W_rest/W_front = 1.
        let expected = 2.0 * mu.atan();
        assert!((r.max_climb_angle() - expected).abs() < 1e-12);
        assert!(r.max_step_height() < r.wheel_radius);
    }
}
