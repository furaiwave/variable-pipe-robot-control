//! Discrete geometric envelope of the robot used for clearance checks.
//!
//! The robot is represented by:
//! * wheel **contact points** – one per wheel, at the outer tread edge
//!   (x_axle, ±(L + w)/2, 0). These determine how the robot rests in the pipe;
//! * **check points** – body box edges (top and bottom, sampled along the
//!   long sides so that the inner flank in a bend is captured) and the upper
//!   half of each wheel rim on its outer face.
//!
//! Coordinates are in the body frame: `x` forward, `u` to the left, `h`
//! upwards measured from the wheel contact plane.

use crate::robot::RobotConfig;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointKind {
    BodyTop,
    BodyBottom,
    Wheel,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct EnvelopePoint {
    pub x: f64,
    pub u: f64,
    pub h: f64,
    pub kind: PointKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContactPoint {
    /// Axle index, rear (0) → front.
    pub axle: usize,
    /// +1 for the left side, −1 for the right side.
    pub side: i8,
    pub x: f64,
    pub u: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RobotEnvelope {
    pub contacts: Vec<ContactPoint>,
    pub points: Vec<EnvelopePoint>,
}

impl RobotEnvelope {
    pub fn new(robot: &RobotConfig) -> Self {
        let yc = robot.contact_half_span();
        let mut contacts = Vec::new();
        for (k, &x) in robot.axle_positions().iter().enumerate() {
            for side in [1i8, -1] {
                contacts.push(ContactPoint {
                    axle: k,
                    side,
                    x,
                    u: side as f64 * yc,
                });
            }
        }

        let mut points = Vec::new();
        let half_l = 0.5 * robot.body_length;
        let half_w = 0.5 * robot.body_width;
        let h_bottom = robot.chassis_clearance;
        let h_top = robot.chassis_clearance + robot.body_height;
        const ALONG: usize = 5;
        for i in 0..ALONG {
            let x = -half_l + robot.body_length * i as f64 / (ALONG - 1) as f64;
            for u in [half_w, -half_w] {
                points.push(EnvelopePoint {
                    x,
                    u,
                    h: h_top,
                    kind: PointKind::BodyTop,
                });
                points.push(EnvelopePoint {
                    x,
                    u,
                    h: h_bottom,
                    kind: PointKind::BodyBottom,
                });
            }
        }
        // Upper half of each wheel rim (outer face), 0°..180° in 30° steps.
        let r = robot.wheel_radius;
        for &xa in &robot.axle_positions() {
            for side in [1.0, -1.0] {
                for k in 0..=6 {
                    let phi = PI * k as f64 / 6.0;
                    points.push(EnvelopePoint {
                        x: xa + r * phi.cos(),
                        u: side * yc,
                        h: r + r * phi.sin(),
                        kind: PointKind::Wheel,
                    });
                }
            }
        }
        Self { contacts, points }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_counts() {
        let r = RobotConfig::default();
        let e = RobotEnvelope::new(&r);
        assert_eq!(e.contacts.len(), r.wheel_count as usize);
        assert_eq!(e.points.len(), 20 + r.wheel_count as usize * 7);
        let max_h = e.points.iter().map(|p| p.h).fold(0.0, f64::max);
        assert!((max_h - r.envelope_height()).abs() < 1e-12);
    }
}
