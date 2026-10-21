//! Quasi-three-dimensional clearance evaluation.
//!
//! Method (see docs/mathematical-model.md §4):
//!
//! 1. Every wheel contact point (outer tread edge) is transformed to the
//!    world plane and projected onto the centreline → (s_i, d_i). The wall of
//!    a circular pipe of local radius R(s_i) at lateral position d_i lies at
//!    height z_i = −√(R² − d_i²) below the pipe axis. If |d_i| ≥ R the wheel
//!    is outside the pipe (fatal).
//! 2. A plane z = z₀ + s_x x + s_u u is fitted (least squares) through the
//!    contact heights; it gives the robot's resting height, pitch atan(s_x)
//!    and roll atan(s_u). The chassis is rigid (no suspension).
//! 3. Each envelope check point (x, u, h) is transformed to the plane,
//!    projected → (s, d), shifted by the roll, and its radial distance
//!    ρ = √(d² + z²) from the local pipe axis is compared with R(s):
//!    clearance = R(s) − ρ. Negative clearance means penetration.
//!
//! The wall-contact angle of wheel i is asin(|d_i| / R).

use pipeline_geometry::Pipeline;
use robot_core::envelope::{PointKind, RobotEnvelope};
use robot_core::{Pose2, RobotConfig, Vec2};
use serde::{Deserialize, Serialize};
use std::f64::consts::FRAC_PI_2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ContactState {
    pub axle: usize,
    pub side: i8,
    pub s: f64,
    pub d: f64,
    /// Local effective pipe radius at the contact, m.
    pub radius: f64,
    /// Height of the wall below the pipe axis at the contact (negative), m.
    pub z: f64,
    /// Wall contact angle, rad.
    pub angle: f64,
    pub outside: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CriticalPoint {
    pub kind: PointKind,
    pub s: f64,
    pub d: f64,
    pub z: f64,
    pub radius: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClearanceReport {
    /// Station and lateral offset of the robot reference point.
    pub station: f64,
    pub lateral: f64,
    /// Minimum radial clearance over all check points, m (< 0: penetration).
    pub min_clearance: f64,
    /// Required clearance at the critical point, m.
    pub required_clearance: f64,
    /// Minimum of (clearance − required) over all check points, m.
    pub min_margin: f64,
    pub critical: Option<CriticalPoint>,
    pub max_contact_angle: f64,
    pub wheel_outside: bool,
    pub pitch: f64,
    pub roll: f64,
    /// Resting height of the contact plane centre below the pipe axis, m.
    pub base_height: f64,
    pub contacts: Vec<ContactState>,
}

/// Rigid placement of the robot in the pipe (result of the plane fit).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Placement {
    pub z0: f64,
    pub slope_x: f64,
    pub slope_u: f64,
}

impl Placement {
    pub fn roll(&self) -> f64 {
        self.slope_u.atan()
    }
    pub fn pitch(&self) -> f64 {
        self.slope_x.atan()
    }
    /// Cross-section coordinates (lateral shift due to roll, height above the
    /// pipe axis) of a body point at (x, u, h).
    pub fn lift(&self, x: f64, u: f64, h: f64) -> (f64, f64) {
        let roll = self.roll();
        let z = self.z0 + self.slope_x * x + self.slope_u * u + h * roll.cos() * self.pitch().cos();
        (-h * roll.sin(), z)
    }
}

pub struct ClearanceModel<'a> {
    pub pipeline: &'a Pipeline,
    pub robot: &'a RobotConfig,
    pub envelope: &'a RobotEnvelope,
    pub safety_margin: f64,
}

impl<'a> ClearanceModel<'a> {
    fn window(&self) -> f64 {
        1.5 * self.robot.envelope_length() + 0.1
    }

    pub fn required_at(&self, s: f64) -> f64 {
        self.pipeline
            .segment_min_clearance(s)
            .map_or(self.safety_margin, |c| c.max(self.safety_margin))
    }

    /// Wheel contacts and plane fit for a pose.
    pub fn place(&self, pose: Pose2, s_hint: f64) -> (Placement, Vec<ContactState>, f64, f64) {
        let w = self.window();
        let center = self.pipeline.project(pose.position(), Some((s_hint, w)));
        let mut contacts = Vec::with_capacity(self.envelope.contacts.len());
        for c in &self.envelope.contacts {
            let wp = pose.transform(Vec2::new(c.x, c.u));
            let pr = self.pipeline.project(wp, Some((center.s, w)));
            let r = self.pipeline.effective_radius(pr.s);
            let outside = pr.d.abs() >= r;
            let (z, angle) = if outside {
                (0.0, FRAC_PI_2)
            } else {
                (-(r * r - pr.d * pr.d).sqrt(), (pr.d.abs() / r).asin())
            };
            contacts.push(ContactState {
                axle: c.axle,
                side: c.side,
                s: pr.s,
                d: pr.d,
                radius: r,
                z,
                angle,
                outside,
            });
        }
        let n = contacts.len() as f64;
        let z0 = contacts.iter().map(|c| c.z).sum::<f64>() / n;
        let (mut sxz, mut sxx, mut suz, mut suu) = (0.0, 0.0, 0.0, 0.0);
        for (c, e) in contacts.iter().zip(&self.envelope.contacts) {
            sxz += e.x * (c.z - z0);
            sxx += e.x * e.x;
            suz += e.u * (c.z - z0);
            suu += e.u * e.u;
        }
        let placement = Placement {
            z0,
            slope_x: if sxx > 0.0 { sxz / sxx } else { 0.0 },
            slope_u: if suu > 0.0 { suz / suu } else { 0.0 },
        };
        (placement, contacts, center.s, center.d)
    }

    pub fn evaluate(&self, pose: Pose2, s_hint: f64) -> ClearanceReport {
        let (placement, contacts, station, lateral) = self.place(pose, s_hint);
        let w = self.window();
        let mut min_clearance = f64::INFINITY;
        let mut min_margin = f64::INFINITY;
        let mut required_clearance = self.safety_margin;
        let mut critical = None;
        let wheel_outside = contacts.iter().any(|c| c.outside);
        for c in &contacts {
            if c.outside {
                let pen = c.radius - c.d.abs();
                if pen < min_clearance {
                    min_clearance = pen;
                    min_margin = pen - self.required_at(c.s);
                    critical = Some(CriticalPoint {
                        kind: PointKind::Wheel,
                        s: c.s,
                        d: c.d,
                        z: 0.0,
                        radius: c.radius,
                    });
                }
            }
        }
        for p in &self.envelope.points {
            let wp = pose.transform(Vec2::new(p.x, p.u));
            let pr = self.pipeline.project(wp, Some((station, w)));
            let (shift, z) = placement.lift(p.x, p.u, p.h);
            let d = pr.d + shift;
            let r = self.pipeline.effective_radius(pr.s);
            let clearance = r - d.hypot(z);
            let req = self.required_at(pr.s);
            if clearance - req < min_margin {
                min_margin = clearance - req;
            }
            if clearance < min_clearance {
                min_clearance = clearance;
                required_clearance = req;
                critical = Some(CriticalPoint {
                    kind: p.kind,
                    s: pr.s,
                    d,
                    z,
                    radius: r,
                });
            }
        }
        ClearanceReport {
            station,
            lateral,
            min_clearance,
            required_clearance,
            min_margin,
            critical,
            max_contact_angle: contacts.iter().map(|c| c.angle).fold(0.0, f64::max),
            wheel_outside,
            pitch: placement.pitch(),
            roll: placement.roll(),
            base_height: placement.z0,
            contacts,
        }
    }

    /// Pose of a robot aligned with the centreline at station `s`, shifted
    /// laterally by `d` (+ left) and rotated by `heading_error`.
    pub fn aligned_pose(&self, s: f64, d: f64, heading_error: f64) -> Pose2 {
        let c = self.pipeline.centerline_pose(s);
        let p = c.position() + Vec2::from_angle(c.theta).perp() * d;
        Pose2::new(p.x, p.y, c.theta + heading_error)
    }

    /// Whether a report satisfies all static constraints.
    pub fn is_admissible(&self, r: &ClearanceReport) -> bool {
        !r.wheel_outside
            && r.min_margin >= 0.0
            && r.max_contact_angle <= self.robot.max_contact_angle
    }

    /// Largest lateral displacement δ ≥ 0 (to the given side) of an aligned
    /// robot at station `s` that keeps all static constraints satisfied.
    /// Returns a negative value (−deficit) if even δ = 0 is inadmissible.
    pub fn lateral_margin(&self, s: f64, side: f64) -> f64 {
        let base = self.evaluate(self.aligned_pose(s, 0.0, 0.0), s);
        if !self.is_admissible(&base) {
            let angle_deficit = (base.max_contact_angle - self.robot.max_contact_angle).max(0.0)
                * self.pipeline.effective_radius(s);
            return -(angle_deficit.max(-base.min_margin).max(1e-4));
        }
        let mut lo = 0.0;
        let mut hi = self.pipeline.effective_radius(s);
        for _ in 0..18 {
            let mid = 0.5 * (lo + hi);
            let r = self.evaluate(self.aligned_pose(s, side * mid, 0.0), s);
            if self.is_admissible(&r) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        lo
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{bend, straight};
    use pipeline_geometry::PipelineConfig;

    fn setup(
        segs: Vec<pipeline_geometry::SegmentConfig>,
    ) -> (Pipeline, RobotConfig, RobotEnvelope) {
        let p = Pipeline::new(PipelineConfig {
            name: "t".into(),
            segments: segs,
        })
        .unwrap();
        let r = RobotConfig::default();
        let e = RobotEnvelope::new(&r);
        (p, r, e)
    }

    #[test]
    fn centred_robot_in_wide_pipe_has_analytic_clearance() {
        let (p, r, e) = setup(vec![straight("a", "", 2.0, 0.25)]);
        let m = ClearanceModel {
            pipeline: &p,
            robot: &r,
            envelope: &e,
            safety_margin: 0.005,
        };
        let rep = m.evaluate(m.aligned_pose(1.0, 0.0, 0.0), 1.0);
        let big_r: f64 = 0.125;
        let yc = r.contact_half_span();
        let zc = -(big_r * big_r - yc * yc).sqrt();
        // Body top corner and wheel-top candidates
        let top = (0.5 * r.body_width).hypot(zc + r.chassis_clearance + r.body_height);
        let bottom = (0.5 * r.body_width).hypot(zc + r.chassis_clearance);
        // Lowest rim check points sit at h = r (front/rear of the wheel).
        let wheel = yc.hypot(zc + r.wheel_radius);
        let expected = big_r - top.max(bottom).max(wheel);
        assert!(
            (rep.min_clearance - expected).abs() < 1e-9,
            "{} vs {}",
            rep.min_clearance,
            expected
        );
        assert!(rep.pitch.abs() < 1e-12 && rep.roll.abs() < 1e-12);
        assert!(((rep.max_contact_angle) - (yc / big_r).asin()).abs() < 1e-12);
        assert!(!rep.wheel_outside);
    }

    #[test]
    fn lateral_offset_rolls_robot_and_raises_contact_angle() {
        let (p, r, e) = setup(vec![straight("a", "", 2.0, 0.25)]);
        let m = ClearanceModel {
            pipeline: &p,
            robot: &r,
            envelope: &e,
            safety_margin: 0.0,
        };
        let a = m.evaluate(m.aligned_pose(1.0, 0.0, 0.0), 1.0);
        let b = m.evaluate(m.aligned_pose(1.0, 0.02, 0.0), 1.0);
        assert!(b.max_contact_angle > a.max_contact_angle);
        // Shifted left → left contact higher → positive roll slope.
        assert!(b.roll > 0.0);
    }

    #[test]
    fn too_small_pipe_collides_and_wheels_fall_outside() {
        let (p, r, e) = setup(vec![straight("a", "", 2.0, 0.12)]);
        let m = ClearanceModel {
            pipeline: &p,
            robot: &r,
            envelope: &e,
            safety_margin: 0.0,
        };
        let rep = m.evaluate(m.aligned_pose(1.0, 0.0, 0.0), 1.0);
        assert!(rep.wheel_outside); // contact half-span 0.07 > R = 0.06
        assert!(rep.min_clearance < 0.0);
    }

    #[test]
    fn diameter_reduction_ahead_is_detected_by_front_points() {
        // 0.25 → 0.15 sudden reduction at s = 1.0
        let (p, r, e) = setup(vec![
            straight("a", "", 1.0, 0.25),
            straight("b", "", 1.0, 0.15),
        ]);
        let m = ClearanceModel {
            pipeline: &p,
            robot: &r,
            envelope: &e,
            safety_margin: 0.0,
        };
        let far = m.evaluate(m.aligned_pose(0.5, 0.0, 0.0), 0.5);
        let touching = m.evaluate(m.aligned_pose(0.95, 0.0, 0.0), 0.95);
        assert!(far.min_clearance > 0.0);
        assert!(touching.min_clearance < far.min_clearance);
        assert!(touching.critical.unwrap().s >= 1.0);
    }

    #[test]
    fn bend_reduces_clearance_versus_straight() {
        let (p, r, e) = setup(vec![
            straight("a", "", 1.0, 0.16),
            bend("b", "", 0.12, 90.0, 0.16),
            straight("c", "", 1.0, 0.16),
        ]);
        let m = ClearanceModel {
            pipeline: &p,
            robot: &r,
            envelope: &e,
            safety_margin: 0.0,
        };
        let straight_rep = m.evaluate(m.aligned_pose(0.5, 0.0, 0.0), 0.5);
        let s_mid = 1.0 + 0.12 * std::f64::consts::FRAC_PI_4;
        let bend_rep = m.evaluate(m.aligned_pose(s_mid, 0.0, 0.0), s_mid);
        assert!(bend_rep.min_clearance < straight_rep.min_clearance);
    }

    #[test]
    fn lateral_margin_matches_contact_angle_limit() {
        let (p, r, e) = setup(vec![straight("a", "", 2.0, 0.20)]);
        let m = ClearanceModel {
            pipeline: &p,
            robot: &r,
            envelope: &e,
            safety_margin: 0.0,
        };
        let margin = m.lateral_margin(1.0, 1.0);
        // Contact angle binds: |d| + y_c ≤ R sin β_max (approx., roll ignored).
        let approx = 0.1 * r.max_contact_angle.sin() - r.contact_half_span();
        assert!(
            margin > 0.0 && (margin - approx).abs() < 2e-3,
            "{margin} vs {approx}"
        );
    }
}
