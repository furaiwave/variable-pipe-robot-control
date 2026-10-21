//! Core robot model for the in-pipe wheeled robot simulator.
//!
//! Units are SI throughout: metres, seconds, radians, kilograms, newtons and
//! newton-metres. Angles are always radians internally.

pub mod dynamics;
pub mod envelope;
pub mod kinematics;
pub mod math;
pub mod robot;
pub mod validation;

pub use math::{Pose2, Vec2, wrap_angle};
pub use robot::{RobotConfig, SensorNoise};
pub use validation::{ValidationErrors, ValidationIssue, Validator};

/// Standard gravitational acceleration, m/s².
pub const GRAVITY: f64 = 9.806_65;
