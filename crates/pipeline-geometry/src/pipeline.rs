//! Resolved (validated, arc-length parametrised) pipeline and geometric queries.

use crate::model::{PipelineConfig, SegmentConfig, SegmentGeometry};
use robot_core::{Pose2, ValidationErrors, Validator, Vec2, wrap_angle};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::f64::consts::PI;

const EPS: f64 = 1e-9;

#[derive(Clone, Debug, Serialize)]
pub struct ResolvedSegment {
    pub index: usize,
    pub id: String,
    /// Arc-length station of the segment start, m.
    pub s_start: f64,
    pub length: f64,
    pub start: Pose2,
    pub end: Pose2,
    /// Elevation of the segment start relative to the inlet, m.
    pub elevation_start: f64,
    pub config: SegmentConfig,
}

impl ResolvedSegment {
    pub fn s_end(&self) -> f64 {
        self.s_start + self.length
    }

    fn bend_center(&self) -> Option<(Vec2, f64, f64)> {
        if let SegmentGeometry::Bend {
            bend_radius, angle, ..
        } = self.config.geometry
        {
            let sgn = angle.signum();
            let n = Vec2::from_angle(self.start.theta).perp();
            Some((
                self.start.position() + n * (bend_radius * sgn),
                bend_radius,
                sgn,
            ))
        } else {
            None
        }
    }

    /// Centreline pose at local arc length `t` (unclamped for straights).
    pub fn local_pose(&self, t: f64) -> Pose2 {
        match self.bend_center() {
            None => {
                let p = self.start.position() + Vec2::from_angle(self.start.theta) * t;
                Pose2::new(p.x, p.y, self.start.theta)
            }
            Some((c, rb, sgn)) => {
                let phi = t / rb;
                let p = c + (self.start.position() - c).rotate(sgn * phi);
                Pose2::new(p.x, p.y, wrap_angle(self.start.theta + sgn * phi))
            }
        }
    }

    /// Restriction height at local `t`; `left_limit` selects the value just
    /// before `t` (used to detect steps).
    fn restriction_height(&self, t: f64, left_limit: bool) -> f64 {
        self.config
            .restrictions
            .iter()
            .filter(|r| {
                if left_limit {
                    t > r.position + EPS && t <= r.position + r.length + EPS
                } else {
                    t >= r.position - EPS && t < r.position + r.length - EPS
                }
            })
            .map(|r| r.height)
            .fold(0.0, f64::max)
    }

    fn effective_radius(&self, t: f64, left_limit: bool) -> f64 {
        0.5 * self.config.geometry.diameter_at(t) - self.restriction_height(t, left_limit)
    }

    /// Project a point onto this segment. Returns (local t, signed lateral
    /// offset d, distance to the segment, interior flag).
    fn project(&self, p: Vec2) -> (f64, f64, f64, bool) {
        match self.bend_center() {
            None => {
                let u = Vec2::from_angle(self.start.theta);
                let n = u.perp();
                let r = p - self.start.position();
                let t = r.dot(u);
                let d = r.dot(n);
                if t >= -EPS && t <= self.length + EPS {
                    (t.clamp(0.0, self.length), d, d.abs(), true)
                } else {
                    let te = t.clamp(0.0, self.length);
                    let e = self.start.position() + u * te;
                    (te, d, (p - e).norm(), false)
                }
            }
            Some((c, rb, sgn)) => {
                let a0 = self.start.position() - c;
                let q = p - c;
                let rho = q.norm();
                let total = self.length / rb;
                let phi = if rho < 1e-12 {
                    -1.0
                } else {
                    sgn * a0.cross(q).atan2(a0.dot(q))
                };
                if rho >= 1e-12 && phi >= -EPS && phi <= total + EPS {
                    let d = sgn * (rb - rho);
                    (rb * phi.clamp(0.0, total), d, d.abs(), true)
                } else {
                    let s0 = self.start;
                    let s1 = self.end;
                    let d0 = (p - s0.position()).norm();
                    let d1 = (p - s1.position()).norm();
                    let (t, e) = if d0 <= d1 {
                        (0.0, s0)
                    } else {
                        (self.length, s1)
                    };
                    let n = Vec2::from_angle(e.theta).perp();
                    let d = (p - e.position()).dot(n);
                    (t, d, d0.min(d1), false)
                }
            }
        }
    }
}

/// Result of projecting a world point onto the centreline.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Projection {
    /// Arc-length station (may be < 0 or > total length outside the pipe ends).
    pub s: f64,
    /// Signed lateral offset from the centreline (+ left of travel direction), m.
    pub d: f64,
    pub segment: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscontinuityKind {
    SegmentJoint,
    Restriction,
}

/// Station where the effective internal radius jumps (sudden reduction /
/// expansion or a restriction edge).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Discontinuity {
    pub s: f64,
    pub radius_before: f64,
    pub radius_after: f64,
    pub kind: DiscontinuityKind,
}

/// Sampled centreline used for drawing and profile charts.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct GeometrySample {
    pub s: f64,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    /// Effective internal diameter including restrictions, m.
    pub diameter: f64,
    /// Nominal pipe diameter without restrictions, m.
    pub base_diameter: f64,
    pub elevation: f64,
    pub inclination: f64,
    pub curvature: f64,
    pub segment: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineSummary {
    pub total_length: f64,
    pub min_diameter: f64,
    pub min_diameter_station: f64,
    pub max_diameter: f64,
    pub segment_count: usize,
    pub bend_count: usize,
    pub total_turning_angle: f64,
    pub max_curvature: f64,
    pub elevation_change: f64,
    pub max_inclination: f64,
    pub step_count: usize,
}

#[derive(Clone, Debug)]
pub struct Pipeline {
    config: PipelineConfig,
    segments: Vec<ResolvedSegment>,
    total_length: f64,
    discontinuities: Vec<Discontinuity>,
}

impl Pipeline {
    pub fn new(config: PipelineConfig) -> Result<Self, ValidationErrors> {
        let mut v = Validator::new("pipeline");
        if config.segments.is_empty() {
            v.push("segments", "pipeline must contain at least one segment");
        }
        if config.segments.len() > 500 {
            v.push("segments", "at most 500 segments are supported");
        }
        let mut ids = HashSet::new();
        for (i, seg) in config.segments.iter().enumerate() {
            if !ids.insert(seg.id.as_str()) {
                v.push(
                    &format!("segments[{i}].id"),
                    format!("duplicate segment id '{}'", seg.id),
                );
            }
            seg.validate_into(&mut v, i);
        }
        if v.has_issues() {
            return Err(v.finish().unwrap_err());
        }

        let mut segments = Vec::with_capacity(config.segments.len());
        let mut pose = Pose2::new(0.0, 0.0, 0.0);
        let mut s = 0.0;
        let mut z = 0.0;
        for (index, seg) in config.segments.iter().enumerate() {
            let length = seg.geometry.length();
            let mut rs = ResolvedSegment {
                index,
                id: seg.id.clone(),
                s_start: s,
                length,
                start: pose,
                end: pose,
                elevation_start: z,
                config: seg.clone(),
            };
            rs.end = rs.local_pose(length);
            pose = rs.end;
            s += length;
            z += length * seg.inclination.sin();
            segments.push(rs);
        }
        if s > 5000.0 {
            v.push(
                "segments",
                format!("total length {s:.1} m exceeds the 5000 m limit"),
            );
            return Err(v.finish().unwrap_err());
        }

        let mut p = Pipeline {
            config,
            segments,
            total_length: s,
            discontinuities: Vec::new(),
        };
        p.discontinuities = p.find_discontinuities();
        p.check_self_overlap(&mut v);
        v.finish()?;
        Ok(p)
    }

    pub fn config(&self) -> &PipelineConfig {
        &self.config
    }

    pub fn segments(&self) -> &[ResolvedSegment] {
        &self.segments
    }

    pub fn total_length(&self) -> f64 {
        self.total_length
    }

    pub fn discontinuities(&self) -> &[Discontinuity] {
        &self.discontinuities
    }

    /// Index of the segment containing `s` (right-continuous; clamped to the ends).
    pub fn segment_index_at(&self, s: f64) -> usize {
        if s <= 0.0 {
            return 0;
        }
        let n = self.segments.len();
        if s >= self.total_length {
            return n - 1;
        }
        // partition_point: first segment whose end is > s
        self.segments
            .partition_point(|seg| seg.s_end() <= s)
            .min(n - 1)
    }

    fn segment_index_left(&self, s: f64) -> usize {
        if s <= 0.0 {
            return 0;
        }
        let n = self.segments.len();
        self.segments
            .partition_point(|seg| seg.s_end() < s)
            .min(n - 1)
    }

    pub fn segment_at(&self, s: f64) -> &ResolvedSegment {
        &self.segments[self.segment_index_at(s)]
    }

    /// Centreline pose at station `s`. Outside [0, L] the pipe is extended
    /// straight along the end tangents.
    pub fn centerline_pose(&self, s: f64) -> Pose2 {
        if s < 0.0 {
            return self.segments[0].local_pose(s);
        }
        if s > self.total_length {
            let last = self.segments.last().expect("non-empty");
            let p =
                last.end.position() + Vec2::from_angle(last.end.theta) * (s - self.total_length);
            return Pose2::new(p.x, p.y, last.end.theta);
        }
        let seg = self.segment_at(s);
        seg.local_pose(s - seg.s_start)
    }

    /// Effective internal radius (diameter/2 minus restriction height) at `s`.
    pub fn effective_radius(&self, s: f64) -> f64 {
        let seg = self.segment_at(s);
        let t = (s - seg.s_start).clamp(0.0, seg.length);
        seg.effective_radius(t, false)
    }

    /// Left limit of the effective radius at `s`.
    pub fn effective_radius_left(&self, s: f64) -> f64 {
        let seg = &self.segments[self.segment_index_left(s)];
        let t = (s - seg.s_start).clamp(0.0, seg.length);
        seg.effective_radius(t, true)
    }

    pub fn base_diameter(&self, s: f64) -> f64 {
        let seg = self.segment_at(s);
        seg.config
            .geometry
            .diameter_at((s - seg.s_start).clamp(0.0, seg.length))
    }

    pub fn inclination(&self, s: f64) -> f64 {
        self.segment_at(s).config.inclination
    }

    pub fn curvature(&self, s: f64) -> f64 {
        if s < 0.0 || s > self.total_length {
            return 0.0;
        }
        self.segment_at(s).config.geometry.curvature()
    }

    pub fn elevation(&self, s: f64) -> f64 {
        let seg = self.segment_at(s);
        seg.elevation_start + (s - seg.s_start) * seg.config.inclination.sin()
    }

    /// Local clearance requirement of the segment at `s`, if specified.
    pub fn segment_min_clearance(&self, s: f64) -> Option<f64> {
        self.segment_at(s).config.min_clearance
    }

    /// Largest |curvature| on the interval [s0, s1].
    pub fn max_abs_curvature(&self, s0: f64, s1: f64) -> f64 {
        let (a, b) = (s0.min(s1), s0.max(s1));
        self.segments
            .iter()
            .filter(|seg| seg.s_end() > a && seg.s_start < b)
            .map(|seg| seg.config.geometry.curvature().abs())
            .fold(0.0, f64::max)
    }

    /// Project a world point onto the centreline. `hint` = (station, window)
    /// restricts the search to segments overlapping [station − window,
    /// station + window], which keeps the projection unambiguous where the
    /// pipe doubles back on itself.
    pub fn project(&self, p: Vec2, hint: Option<(f64, f64)>) -> Projection {
        let (lo, hi) = match hint {
            Some((s, w)) => (s - w, s + w),
            None => (f64::NEG_INFINITY, f64::INFINITY),
        };
        let mut best = (
            f64::INFINITY,
            f64::INFINITY,
            Projection {
                s: 0.0,
                d: 0.0,
                segment: 0,
            },
        );
        let hint_s = hint.map(|h| h.0).unwrap_or(0.0);
        let consider = |dist: f64, proj: Projection, best: &mut (f64, f64, Projection)| {
            let tie = (proj.s - hint_s).abs();
            if dist < best.0 - 1e-12 || ((dist - best.0).abs() <= 1e-12 && tie < best.1) {
                *best = (dist, tie, proj);
            }
        };

        for seg in &self.segments {
            if seg.s_end() < lo || seg.s_start > hi {
                continue;
            }
            let (t, d, dist, _) = seg.project(p);
            consider(
                dist,
                Projection {
                    s: seg.s_start + t,
                    d,
                    segment: seg.index,
                },
                &mut best,
            );
        }
        // Straight extensions beyond the inlet and outlet.
        if lo <= 0.0 {
            let first = &self.segments[0];
            let u = Vec2::from_angle(first.start.theta);
            let r = p - first.start.position();
            let t = r.dot(u);
            if t < 0.0 {
                let d = r.dot(u.perp());
                consider(
                    d.abs(),
                    Projection {
                        s: t,
                        d,
                        segment: 0,
                    },
                    &mut best,
                );
            }
        }
        if hi >= self.total_length {
            let last = self.segments.last().expect("non-empty");
            let u = Vec2::from_angle(last.end.theta);
            let r = p - last.end.position();
            let t = r.dot(u);
            if t > 0.0 {
                let d = r.dot(u.perp());
                consider(
                    d.abs(),
                    Projection {
                        s: self.total_length + t,
                        d,
                        segment: last.index,
                    },
                    &mut best,
                );
            }
        }
        if best.0.is_infinite() {
            // Window did not intersect any segment: fall back to a global search.
            return self.project(p, None);
        }
        best.2
    }

    fn find_discontinuities(&self) -> Vec<Discontinuity> {
        let mut stations: Vec<(f64, DiscontinuityKind)> = Vec::new();
        for seg in &self.segments[1..] {
            stations.push((seg.s_start, DiscontinuityKind::SegmentJoint));
        }
        for seg in &self.segments {
            for r in &seg.config.restrictions {
                stations.push((seg.s_start + r.position, DiscontinuityKind::Restriction));
                stations.push((
                    seg.s_start + r.position + r.length,
                    DiscontinuityKind::Restriction,
                ));
            }
        }
        stations.sort_by(|a, b| a.0.total_cmp(&b.0));
        stations.dedup_by(|a, b| (a.0 - b.0).abs() < EPS);
        stations
            .into_iter()
            .filter(|(s, _)| *s > EPS && *s < self.total_length - EPS)
            .filter_map(|(s, kind)| {
                let before = self.effective_radius_left(s);
                let after = self.effective_radius(s);
                ((before - after).abs() > 1e-7).then_some(Discontinuity {
                    s,
                    radius_before: before,
                    radius_after: after,
                    kind,
                })
            })
            .collect()
    }

    /// Detect pipe sections whose walls overlap (e.g. a bend sequence that
    /// loops back onto earlier pipe). Points closer in arc length than
    /// π·R are skipped: within a valid bend (R_b > R) their chord is ≥ 2R.
    fn check_self_overlap(&self, v: &mut Validator) {
        let min_d = self
            .segments
            .iter()
            .map(|s| s.config.geometry.min_diameter())
            .fold(f64::INFINITY, f64::min);
        let ds = (0.5 * min_d).max(self.total_length / 1500.0).max(1e-3);
        let n = (self.total_length / ds).ceil() as usize + 1;
        let pts: Vec<(f64, Vec2, f64)> = (0..n)
            .map(|i| {
                let s = (i as f64 * ds).min(self.total_length);
                let seg = self.segment_at(s);
                let r = 0.5
                    * seg
                        .config
                        .geometry
                        .start_diameter()
                        .max(seg.config.geometry.end_diameter());
                (s, self.centerline_pose(s).position(), r)
            })
            .collect();
        for i in 0..pts.len() {
            for j in (i + 1)..pts.len() {
                let (si, pi, ri) = pts[i];
                let (sj, pj, rj) = pts[j];
                if sj - si <= PI * ri.max(rj) + ds {
                    continue;
                }
                if (pi - pj).norm() < ri + rj - 1e-6 {
                    v.push(
                        "segments",
                        format!("pipe walls overlap between s = {si:.3} m and s = {sj:.3} m (centreline loops back onto itself)"),
                    );
                    return;
                }
            }
        }
    }

    fn sample_at(&self, s: f64, left: bool) -> GeometrySample {
        let seg_idx = if left {
            self.segment_index_left(s)
        } else {
            self.segment_index_at(s)
        };
        let seg = &self.segments[seg_idx];
        let t = (s - seg.s_start).clamp(0.0, seg.length);
        let pose = seg.local_pose(t);
        GeometrySample {
            s,
            x: pose.x,
            y: pose.y,
            heading: pose.theta,
            diameter: 2.0 * seg.effective_radius(t, left),
            base_diameter: seg.config.geometry.diameter_at(t),
            elevation: seg.elevation_start + t * seg.config.inclination.sin(),
            inclination: seg.config.inclination,
            curvature: seg.config.geometry.curvature(),
            segment: seg_idx,
        }
    }

    /// Sample the centreline with spacing ≤ `max_ds`. Every discontinuity is
    /// emitted twice (left and right limit) so plots show a vertical step.
    pub fn sample(&self, max_ds: f64) -> Vec<GeometrySample> {
        let max_ds = max_ds.max(self.total_length / 20_000.0).max(1e-4);
        let mut stations: Vec<f64> = Vec::new();
        for seg in &self.segments {
            let n = (seg.length / max_ds).ceil().max(1.0) as usize;
            for k in 0..=n {
                stations.push(seg.s_start + seg.length * k as f64 / n as f64);
            }
            for r in &seg.config.restrictions {
                stations.push(seg.s_start + r.position);
                stations.push(seg.s_start + r.position + r.length);
            }
        }
        stations.sort_by(f64::total_cmp);
        stations.dedup_by(|a, b| (*a - *b).abs() < EPS);
        let mut out = Vec::with_capacity(stations.len() + 2 * self.discontinuities.len());
        let mut di = 0;
        for s in stations {
            while di < self.discontinuities.len() && self.discontinuities[di].s < s - EPS {
                di += 1;
            }
            if di < self.discontinuities.len() && (self.discontinuities[di].s - s).abs() < EPS {
                out.push(self.sample_at(s, true));
            }
            out.push(self.sample_at(s, false));
        }
        out
    }

    pub fn summary(&self) -> PipelineSummary {
        let samples = self.sample((self.total_length / 2000.0).max(0.002));
        let (mut dmin, mut smin, mut dmax) = (f64::INFINITY, 0.0, 0.0f64);
        for smp in &samples {
            if smp.diameter < dmin {
                dmin = smp.diameter;
                smin = smp.s;
            }
            dmax = dmax.max(smp.diameter);
        }
        let bends: Vec<_> = self
            .segments
            .iter()
            .filter_map(|s| match s.config.geometry {
                SegmentGeometry::Bend {
                    angle, bend_radius, ..
                } => Some((angle, bend_radius)),
                _ => None,
            })
            .collect();
        PipelineSummary {
            total_length: self.total_length,
            min_diameter: dmin,
            min_diameter_station: smin,
            max_diameter: dmax,
            segment_count: self.segments.len(),
            bend_count: bends.len(),
            total_turning_angle: bends.iter().map(|b| b.0.abs()).sum(),
            max_curvature: bends.iter().map(|b| 1.0 / b.1).fold(0.0, f64::max),
            elevation_change: self.elevation(self.total_length),
            max_inclination: self
                .segments
                .iter()
                .map(|s| s.config.inclination.abs())
                .fold(0.0, f64::max),
            step_count: self.discontinuities.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Restriction, TransitionProfile};

    fn seg(id: &str, g: SegmentGeometry) -> SegmentConfig {
        SegmentConfig {
            id: id.into(),
            label: String::new(),
            geometry: g,
            inclination: 0.0,
            min_clearance: None,
            restrictions: vec![],
        }
    }

    fn pipe(segs: Vec<SegmentConfig>) -> Pipeline {
        Pipeline::new(PipelineConfig {
            name: "t".into(),
            segments: segs,
        })
        .unwrap()
    }

    #[test]
    fn straight_and_bend_chain_is_continuous() {
        let p = pipe(vec![
            seg(
                "a",
                SegmentGeometry::Straight {
                    length: 1.0,
                    diameter: 0.25,
                },
            ),
            seg(
                "b",
                SegmentGeometry::Bend {
                    bend_radius: 0.5,
                    angle: PI / 2.0,
                    diameter: 0.25,
                },
            ),
            seg(
                "c",
                SegmentGeometry::Straight {
                    length: 1.0,
                    diameter: 0.25,
                },
            ),
        ]);
        let l = 2.0 + 0.5 * PI / 2.0;
        assert!((p.total_length() - l).abs() < 1e-12);
        let end = p.centerline_pose(l);
        assert!((end.x - 1.5).abs() < 1e-9, "{end:?}");
        assert!((end.y - 1.5).abs() < 1e-9);
        assert!((end.theta - PI / 2.0).abs() < 1e-9);
        // Continuity at joints
        for s in [1.0, 1.0 + 0.25 * PI] {
            let a = p.centerline_pose(s - 1e-7);
            let b = p.centerline_pose(s + 1e-7);
            assert!((a.position() - b.position()).norm() < 1e-6);
            assert!((a.theta - b.theta).abs() < 1e-6);
        }
    }

    #[test]
    fn projection_recovers_station_and_offset() {
        let p = pipe(vec![
            seg(
                "a",
                SegmentGeometry::Straight {
                    length: 1.0,
                    diameter: 0.25,
                },
            ),
            seg(
                "b",
                SegmentGeometry::Bend {
                    bend_radius: 0.6,
                    angle: -1.2,
                    diameter: 0.25,
                },
            ),
            seg(
                "c",
                SegmentGeometry::Straight {
                    length: 1.0,
                    diameter: 0.25,
                },
            ),
        ]);
        for &s in &[0.2, 0.9, 1.1, 1.5, 1.7, 2.0, 2.5] {
            for &d in &[-0.05, 0.0, 0.07] {
                let c = p.centerline_pose(s);
                let pt = c.position() + Vec2::from_angle(c.theta).perp() * d;
                let pr = p.project(pt, Some((s, 0.5)));
                assert!((pr.s - s).abs() < 1e-9, "s {s} d {d} -> {pr:?}");
                assert!((pr.d - d).abs() < 1e-9, "s {s} d {d} -> {pr:?}");
            }
        }
        // Beyond the ends (straight extension)
        let pr = p.project(Vec2::new(-0.3, 0.02), None);
        assert!((pr.s + 0.3).abs() < 1e-12 && (pr.d - 0.02).abs() < 1e-12);
    }

    #[test]
    fn diameter_transitions_and_steps() {
        let mut narrow = seg(
            "n",
            SegmentGeometry::Straight {
                length: 0.5,
                diameter: 0.2,
            },
        );
        narrow.restrictions.push(Restriction {
            position: 0.2,
            length: 0.05,
            height: 0.01,
            label: "weld".into(),
        });
        let p = pipe(vec![
            seg(
                "a",
                SegmentGeometry::Straight {
                    length: 1.0,
                    diameter: 0.3,
                },
            ),
            seg(
                "t",
                SegmentGeometry::Transition {
                    length: 1.0,
                    diameter_start: 0.3,
                    diameter_end: 0.25,
                    profile: TransitionProfile::Linear,
                },
            ),
            narrow,
        ]);
        assert!((p.base_diameter(1.5) - 0.275).abs() < 1e-12);
        // Gradual transition: no discontinuity at s = 1.0 or 2.0? 0.25 → 0.2 is a step at s = 2.0
        let d = p.discontinuities();
        assert_eq!(d.len(), 3, "{d:?}");
        assert!((d[0].s - 2.0).abs() < 1e-12);
        assert!(
            (d[0].radius_before - 0.125).abs() < 1e-12 && (d[0].radius_after - 0.1).abs() < 1e-12
        );
        assert!((p.effective_radius(2.21) - 0.09).abs() < 1e-12);
        assert!((p.effective_radius(2.26) - 0.1).abs() < 1e-12);
        let samples = p.sample(0.05);
        assert!(samples.windows(2).all(|w| w[1].s >= w[0].s));
        let summary = p.summary();
        assert!((summary.min_diameter - 0.18).abs() < 1e-9);
        assert_eq!(summary.step_count, 3);
    }

    #[test]
    fn smooth_transition_profile() {
        let g = SegmentGeometry::Transition {
            length: 1.0,
            diameter_start: 0.3,
            diameter_end: 0.2,
            profile: TransitionProfile::Smooth,
        };
        assert!((g.diameter_at(0.5) - 0.25).abs() < 1e-12);
        assert!((g.diameter_at(0.0) - 0.3).abs() < 1e-12);
        assert!((g.diameter_at(1.0) - 0.2).abs() < 1e-12);
    }

    #[test]
    fn rejects_invalid_geometry() {
        let bad = PipelineConfig {
            name: "bad".into(),
            segments: vec![
                seg(
                    "a",
                    SegmentGeometry::Straight {
                        length: -1.0,
                        diameter: 0.25,
                    },
                ),
                seg(
                    "a",
                    SegmentGeometry::Bend {
                        bend_radius: 0.1,
                        angle: 1.0,
                        diameter: 0.25,
                    },
                ),
                seg(
                    "c",
                    SegmentGeometry::Straight {
                        length: 1.0,
                        diameter: f64::NAN,
                    },
                ),
            ],
        };
        let err = Pipeline::new(bad).unwrap_err();
        let fields: Vec<_> = err.issues.iter().map(|i| i.field.clone()).collect();
        assert!(fields.iter().any(|f| f == "pipeline.segments[0].length"));
        assert!(fields.iter().any(|f| f == "pipeline.segments[1].id"));
        assert!(
            fields
                .iter()
                .any(|f| f == "pipeline.segments[1].bend_radius")
        );
        assert!(fields.iter().any(|f| f == "pipeline.segments[2].diameter"));
        assert!(
            Pipeline::new(PipelineConfig {
                name: "e".into(),
                segments: vec![]
            })
            .is_err()
        );
    }

    #[test]
    fn rejects_self_overlapping_pipe() {
        // Two 180° bends in the same direction bring the pipe back over its start.
        let p = PipelineConfig {
            name: "loop".into(),
            segments: vec![
                seg(
                    "a",
                    SegmentGeometry::Straight {
                        length: 1.0,
                        diameter: 0.25,
                    },
                ),
                seg(
                    "b",
                    SegmentGeometry::Bend {
                        bend_radius: 0.3,
                        angle: PI,
                        diameter: 0.25,
                    },
                ),
                seg(
                    "c",
                    SegmentGeometry::Straight {
                        length: 0.5,
                        diameter: 0.25,
                    },
                ),
                seg(
                    "d",
                    SegmentGeometry::Bend {
                        bend_radius: 0.3,
                        angle: PI,
                        diameter: 0.25,
                    },
                ),
                seg(
                    "e",
                    SegmentGeometry::Straight {
                        length: 0.5,
                        diameter: 0.25,
                    },
                ),
            ],
        };
        let err = Pipeline::new(p).unwrap_err();
        assert!(err.issues[0].message.contains("overlap"), "{err:?}");
    }

    #[test]
    fn json_round_trip() {
        let json = r#"{"name":"p","segments":[
            {"id":"s1","kind":"straight","length":1.0,"diameter":0.25},
            {"id":"s2","kind":"bend","bend_radius":0.5,"angle":0.5,"diameter":0.25,"inclination":0.1},
            {"id":"s3","kind":"transition","length":0.5,"diameter_start":0.25,"diameter_end":0.2,"profile":"smooth",
             "restrictions":[{"position":0.1,"length":0.02,"height":0.005}]}
        ]}"#;
        let cfg: PipelineConfig = serde_json::from_str(json).unwrap();
        let p = Pipeline::new(cfg.clone()).unwrap();
        assert_eq!(p.segments().len(), 3);
        let back: PipelineConfig =
            serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }
}
