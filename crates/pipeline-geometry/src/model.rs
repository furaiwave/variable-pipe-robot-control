//! Serializable pipeline configuration and per-segment validation.

use robot_core::Validator;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionProfile {
    /// Diameter varies linearly (conical reducer/expander).
    #[default]
    Linear,
    /// Cubic smoothstep 3t² − 2t³ (zero wall slope at both ends).
    Smooth,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SegmentGeometry {
    /// Straight pipe with a constant internal diameter.
    Straight { length: f64, diameter: f64 },
    /// Straight pipe whose internal diameter changes gradually.
    Transition {
        length: f64,
        diameter_start: f64,
        diameter_end: f64,
        #[serde(default)]
        profile: TransitionProfile,
    },
    /// Circular bend of the centreline in the plane of motion. A positive
    /// angle turns left (counter-clockwise).
    Bend {
        bend_radius: f64,
        angle: f64,
        diameter: f64,
    },
}

/// Local internal restriction (e.g. a weld bead ring, a partially closed
/// valve seat or a deposit ring) that reduces the internal radius by
/// `height` over `[position, position + length]` of the segment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Restriction {
    /// Start, measured from the segment start, m.
    pub position: f64,
    pub length: f64,
    /// Radial protrusion from the wall, m.
    pub height: f64,
    #[serde(default)]
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SegmentConfig {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(flatten)]
    pub geometry: SegmentGeometry,
    /// Longitudinal slope of the segment (positive = uphill in the direction
    /// of travel), rad.
    #[serde(default)]
    pub inclination: f64,
    /// Optional local safety clearance requirement overriding the global one
    /// when larger, m.
    #[serde(default)]
    pub min_clearance: Option<f64>,
    #[serde(default)]
    pub restrictions: Vec<Restriction>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub name: String,
    pub segments: Vec<SegmentConfig>,
}

pub const MIN_DIAMETER: f64 = 0.02;
pub const MAX_DIAMETER: f64 = 5.0;
pub const MAX_INCLINATION_DEG: f64 = 60.0;

impl SegmentGeometry {
    pub fn length(&self) -> f64 {
        match *self {
            SegmentGeometry::Straight { length, .. } => length,
            SegmentGeometry::Transition { length, .. } => length,
            SegmentGeometry::Bend {
                bend_radius, angle, ..
            } => bend_radius * angle.abs(),
        }
    }

    /// Diameter at local arc length `t` ∈ [0, length].
    pub fn diameter_at(&self, t: f64) -> f64 {
        match *self {
            SegmentGeometry::Straight { diameter, .. } => diameter,
            SegmentGeometry::Bend { diameter, .. } => diameter,
            SegmentGeometry::Transition {
                length,
                diameter_start,
                diameter_end,
                profile,
            } => {
                let u = (t / length).clamp(0.0, 1.0);
                let w = match profile {
                    TransitionProfile::Linear => u,
                    TransitionProfile::Smooth => u * u * (3.0 - 2.0 * u),
                };
                diameter_start + (diameter_end - diameter_start) * w
            }
        }
    }

    pub fn start_diameter(&self) -> f64 {
        self.diameter_at(0.0)
    }

    pub fn end_diameter(&self) -> f64 {
        self.diameter_at(self.length())
    }

    pub fn min_diameter(&self) -> f64 {
        self.start_diameter().min(self.end_diameter())
    }

    /// Signed curvature (1/m), positive for left turns.
    pub fn curvature(&self) -> f64 {
        match *self {
            SegmentGeometry::Bend {
                bend_radius, angle, ..
            } => angle.signum() / bend_radius,
            _ => 0.0,
        }
    }
}

impl SegmentConfig {
    pub(crate) fn validate_into(&self, v: &mut Validator, idx: usize) {
        let p = |f: &str| format!("segments[{idx}].{f}");
        let diam = |v: &mut Validator, f: &str, d: f64| {
            v.range(&p(f), d, MIN_DIAMETER, MAX_DIAMETER);
        };
        match self.geometry {
            SegmentGeometry::Straight { length, diameter } => {
                v.range(&p("length"), length, 0.01, 1000.0);
                diam(v, "diameter", diameter);
            }
            SegmentGeometry::Transition {
                length,
                diameter_start,
                diameter_end,
                ..
            } => {
                v.range(&p("length"), length, 0.01, 1000.0);
                diam(v, "diameter_start", diameter_start);
                diam(v, "diameter_end", diameter_end);
            }
            SegmentGeometry::Bend {
                bend_radius,
                angle,
                diameter,
            } => {
                diam(v, "diameter", diameter);
                v.range(&p("bend_radius"), bend_radius, 0.01, 1000.0);
                if v.finite(&p("angle"), angle)
                    && (angle.abs() < 0.1f64.to_radians() || angle.abs() > PI + 1e-9)
                {
                    v.push(&p("angle"), "magnitude must be within (0.1°, 180°]");
                }
                if bend_radius.is_finite() && diameter.is_finite() && bend_radius <= 0.5 * diameter
                {
                    v.push(
                        &p("bend_radius"),
                        format!(
                            "centreline bend radius {bend_radius} m must exceed the pipe radius {} m (inner wall would self-intersect)",
                            0.5 * diameter
                        ),
                    );
                }
            }
        }
        let max_inc = MAX_INCLINATION_DEG.to_radians();
        v.range(&p("inclination"), self.inclination, -max_inc, max_inc);
        if let Some(c) = self.min_clearance {
            v.range(&p("min_clearance"), c, 0.0, 0.5);
        }
        if self.id.trim().is_empty() {
            v.push(&p("id"), "must not be empty");
        }

        let len = self.geometry.length();
        let dmin = self.geometry.min_diameter();
        let mut spans: Vec<(f64, f64)> = Vec::new();
        for (k, r) in self.restrictions.iter().enumerate() {
            let rp = |f: &str| format!("segments[{idx}].restrictions[{k}].{f}");
            v.range(&rp("position"), r.position, 0.0, len.max(0.0));
            v.range(&rp("length"), r.length, 0.001, len.max(0.001));
            v.range(&rp("height"), r.height, 1e-4, 0.45 * dmin.max(MIN_DIAMETER));
            if r.position.is_finite() && r.length.is_finite() {
                if r.position + r.length > len + 1e-9 {
                    v.push(
                        &rp("length"),
                        "restriction extends beyond the end of the segment",
                    );
                }
                spans.push((r.position, r.position + r.length));
            }
        }
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        for w in spans.windows(2) {
            if w[1].0 < w[0].1 - 1e-12 {
                v.push(&p("restrictions"), "restrictions must not overlap");
                break;
            }
        }
    }
}
