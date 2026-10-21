//! Minimal planar vector / pose primitives.

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use std::ops::{Add, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    pub fn from_angle(theta: f64) -> Self {
        Self::new(theta.cos(), theta.sin())
    }
    pub fn dot(self, o: Vec2) -> f64 {
        self.x * o.x + self.y * o.y
    }
    /// z-component of the 3D cross product.
    pub fn cross(self, o: Vec2) -> f64 {
        self.x * o.y - self.y * o.x
    }
    pub fn norm(self) -> f64 {
        self.x.hypot(self.y)
    }
    /// Rotate by +90° (left normal of a direction vector).
    pub fn perp(self) -> Vec2 {
        Vec2::new(-self.y, self.x)
    }
    pub fn rotate(self, angle: f64) -> Vec2 {
        let (s, c) = angle.sin_cos();
        Vec2::new(c * self.x - s * self.y, s * self.x + c * self.y)
    }
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x + o.x, self.y + o.y)
    }
}
impl Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x - o.x, self.y - o.y)
    }
}
impl Mul<f64> for Vec2 {
    type Output = Vec2;
    fn mul(self, k: f64) -> Vec2 {
        Vec2::new(self.x * k, self.y * k)
    }
}
impl Neg for Vec2 {
    type Output = Vec2;
    fn neg(self) -> Vec2 {
        Vec2::new(-self.x, -self.y)
    }
}

/// Planar pose (x, y, θ) of the robot reference point (geometric centre of
/// the wheel layout) in the world frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Pose2 {
    pub x: f64,
    pub y: f64,
    pub theta: f64,
}

impl Pose2 {
    pub const fn new(x: f64, y: f64, theta: f64) -> Self {
        Self { x, y, theta }
    }
    pub fn position(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    /// Transform a point given in the robot body frame (x forward, y left)
    /// into the world frame.
    pub fn transform(&self, local: Vec2) -> Vec2 {
        self.position() + local.rotate(self.theta)
    }
    /// Express a world point in the robot body frame.
    pub fn inverse_transform(&self, world: Vec2) -> Vec2 {
        (world - self.position()).rotate(-self.theta)
    }
    pub fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.theta.is_finite()
    }
}

/// Wrap an angle into the half-open interval (-π, π].
pub fn wrap_angle(a: f64) -> f64 {
    if !a.is_finite() {
        return a;
    }
    let mut r = (a + PI).rem_euclid(2.0 * PI) - PI;
    if r <= -PI {
        r += 2.0 * PI;
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_angle_range() {
        for k in -20..=20 {
            let a = k as f64 * 0.77;
            let w = wrap_angle(a);
            assert!(w > -PI && w <= PI, "{a} -> {w}");
            // a and w differ by an integer number of turns
            let turns = (a - w) / (2.0 * PI);
            assert!((turns - turns.round()).abs() < 1e-9);
        }
        assert!((wrap_angle(3.0 * PI) - PI).abs() < 1e-12);
        assert!((wrap_angle(-PI) - PI).abs() < 1e-12);
    }

    #[test]
    fn pose_transform_round_trip() {
        let p = Pose2::new(1.0, -2.0, 0.7);
        let local = Vec2::new(0.3, -0.1);
        let w = p.transform(local);
        let back = p.inverse_transform(w);
        assert!((back - local).norm() < 1e-12);
    }
}
