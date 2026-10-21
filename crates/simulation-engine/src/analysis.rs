//! Static (pre-run) feasibility analysis.
//!
//! The analysis places an *ideal* robot – centred on the centreline and
//! aligned with its tangent – at every station and evaluates the same
//! constraints as the dynamic simulation. It answers "can the robot pass at
//! all, even with perfect tracking?" before any controller is involved.

use crate::collision::ClearanceModel;
use crate::config::SimulationConfig;
use crate::telemetry::ViolationKind;
use pipeline_geometry::{
    DiscontinuityKind, GeometrySample, MIN_DIAMETER, Pipeline, PipelineConfig, PipelineSummary,
    SegmentConfig, SegmentGeometry,
};
use robot_core::envelope::{PointKind, RobotEnvelope};
use robot_core::{GRAVITY, RobotConfig, ValidationErrors};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProfileSample {
    pub s: f64,
    pub diameter: f64,
    /// Clearance of the centred, aligned robot, m.
    pub clearance: f64,
    pub required: f64,
    /// Admissible lateral displacement (min of both sides), m.
    pub lateral_margin: f64,
    /// Wall contact angle of the centred robot, rad.
    pub contact_angle: f64,
    /// Floor ramp angle under the wheel contacts caused by diameter change, rad.
    pub ramp_angle: f64,
    pub binding: Option<PointKind>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct StepCheck {
    pub s: f64,
    pub radius_before: f64,
    pub radius_after: f64,
    pub kind: DiscontinuityKind,
    /// Vertical rise of the wall at the wheel contact line (+ = step up), m.
    pub rise: f64,
    /// Contact angle of the wheel on the step edge β = acos(1 − h/r), rad.
    pub contact_angle: f64,
    /// Climbable limit β_max for the front axle, rad.
    pub max_angle: f64,
    pub climbable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FeasibilityIssue {
    pub kind: ViolationKind,
    pub s_start: f64,
    pub s_end: f64,
    pub value: f64,
    pub limit: f64,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MinDiameter {
    /// Smallest straight-pipe diameter in which the centred robot fits
    /// geometrically (wheels inside the section, clearance ≥ 0), m.
    pub geometric: f64,
    pub geometric_binding: String,
    /// Smallest diameter that additionally satisfies the required safety
    /// clearance and the wall contact-angle limit, m.
    pub recommended: f64,
    pub recommended_binding: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SlopeLimit {
    /// Largest climbable inclination (traction and torque), rad.
    pub max_slope: f64,
    pub traction_limit: f64,
    pub torque_limit: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EnvelopeSize {
    pub length: f64,
    pub width: f64,
    pub height: f64,
    pub contact_half_span: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FeasibilityReport {
    /// No hard constraint (collision, wheel outside the section,
    /// unclimbable step/ramp, slope) is violated by the ideally centred robot.
    pub feasible: bool,
    /// Soft issues (safety clearance, wall contact angle) are present.
    pub has_warnings: bool,
    pub issues: Vec<FeasibilityIssue>,
    pub start_station: f64,
    pub goal_station: f64,
    pub profile: Vec<ProfileSample>,
    pub steps: Vec<StepCheck>,
    pub min_clearance: f64,
    pub min_clearance_station: f64,
    pub min_lateral_margin: f64,
    pub min_lateral_margin_station: f64,
    pub max_contact_angle: f64,
    pub min_feasible_diameter: Option<MinDiameter>,
    pub max_climb_angle: f64,
    pub max_step_height: f64,
    pub slope_limit: SlopeLimit,
    pub envelope: EnvelopeSize,
    pub summary: PipelineSummary,
    pub geometry: Vec<GeometrySample>,
}

/// Climbable contact-angle limit for axle `k` (friction-cone statics):
/// β_max = atan μ + atan(μ (1 − f_k) / f_k), f_k = normal-load share of the axle.
pub fn climb_angle_limit(robot: &RobotConfig, axle: usize, slope: f64) -> f64 {
    let f = robot.axle_load_fractions(slope);
    let fk = f.get(axle).copied().unwrap_or(0.5).clamp(0.02, 0.98);
    let mu = robot.friction_coefficient;
    (mu.atan() + (mu * (1.0 - fk) / fk).atan()).min(std::f64::consts::FRAC_PI_2)
}

/// β = acos(1 − h/r) for a step of height h met by a wheel of radius r.
pub fn step_contact_angle(rise: f64, wheel_radius: f64) -> f64 {
    if rise <= 0.0 {
        0.0
    } else if rise >= wheel_radius {
        std::f64::consts::FRAC_PI_2
    } else {
        (1.0 - rise / wheel_radius).acos()
    }
}

/// Wall height below the pipe axis at lateral position y for radius R
/// (None if the position is outside the cross-section).
pub fn wall_height(radius: f64, y: f64) -> Option<f64> {
    (y.abs() < radius).then(|| -(radius * radius - y * y).sqrt())
}

/// Largest climbable inclination.
/// Traction: μ cos α ≥ sin α + C_rr cos α ⇒ tan α ≤ μ − C_rr.
/// Torque:   n τ_max / r ≥ m g (sin α + C_rr cos α).
pub fn slope_limit(robot: &RobotConfig) -> SlopeLimit {
    let traction = (robot.friction_coefficient - robot.rolling_resistance)
        .max(0.0)
        .atan();
    let f_max = robot.wheel_count as f64 * robot.max_motor_torque / robot.wheel_radius;
    let w = robot.mass * GRAVITY;
    let need = |a: f64| w * (a.sin() + robot.rolling_resistance * a.cos());
    let torque = if need(0.0) > f_max {
        0.0
    } else if need(std::f64::consts::FRAC_PI_2 - 1e-9) <= f_max {
        std::f64::consts::FRAC_PI_2
    } else {
        let (mut lo, mut hi) = (0.0, std::f64::consts::FRAC_PI_2);
        for _ in 0..60 {
            let mid = 0.5 * (lo + hi);
            if need(mid) <= f_max {
                lo = mid
            } else {
                hi = mid
            }
        }
        lo
    };
    SlopeLimit {
        max_slope: traction.min(torque),
        traction_limit: traction,
        torque_limit: torque,
    }
}

fn straight_pipe(diameter: f64, length: f64) -> Result<Pipeline, ValidationErrors> {
    Pipeline::new(PipelineConfig {
        name: "probe".into(),
        segments: vec![SegmentConfig {
            id: "probe".into(),
            label: String::new(),
            geometry: SegmentGeometry::Straight { length, diameter },
            inclination: 0.0,
            min_clearance: None,
            restrictions: vec![],
        }],
    })
}

fn binding_name(
    model: &ClearanceModel<'_>,
    r: &crate::collision::ClearanceReport,
    with_contact_angle: bool,
) -> String {
    if r.wheel_outside {
        "wheel contact outside cross-section".into()
    } else if with_contact_angle && r.max_contact_angle > model.robot.max_contact_angle {
        "wall contact angle limit".into()
    } else {
        match r.critical.map(|c| c.kind) {
            Some(PointKind::BodyTop) => "body top clearance".into(),
            Some(PointKind::BodyBottom) => "body underside clearance".into(),
            Some(PointKind::Wheel) => "wheel clearance".into(),
            None => "unknown".into(),
        }
    }
}

/// Smallest diameter for which `ok(report)` holds for the centred robot
/// (bisection; admissibility is monotone in D for the implemented geometry).
fn bisect_diameter(
    robot: &RobotConfig,
    safety_margin: f64,
    with_contact_angle: bool,
    ok: &dyn Fn(&ClearanceModel<'_>, &crate::collision::ClearanceReport) -> bool,
) -> Option<(f64, String)> {
    let env = RobotEnvelope::new(robot);
    let length = 4.0 * robot.envelope_length() + 0.2;
    let probe = |d: f64| -> Option<(bool, String)> {
        let p = straight_pipe(d, length).ok()?;
        let m = ClearanceModel {
            pipeline: &p,
            robot,
            envelope: &env,
            safety_margin,
        };
        let r = m.evaluate(m.aligned_pose(0.5 * length, 0.0, 0.0), 0.5 * length);
        Some((ok(&m, &r), binding_name(&m, &r, with_contact_angle)))
    };
    let mut hi = 5.0;
    if !probe(hi)?.0 {
        return None;
    }
    let mut lo = MIN_DIAMETER;
    if probe(lo)?.0 {
        return Some((lo, "minimum supported diameter".into()));
    }
    for _ in 0..50 {
        let mid = 0.5 * (lo + hi);
        if probe(mid)?.0 { hi = mid } else { lo = mid }
    }
    Some((hi, probe(lo)?.1))
}

/// Geometric and recommended minimum straight-pipe diameters.
pub fn min_feasible_diameter(robot: &RobotConfig, safety_margin: f64) -> Option<MinDiameter> {
    let (geometric, geometric_binding) = bisect_diameter(robot, safety_margin, false, &|_, r| {
        !r.wheel_outside && r.min_clearance >= 0.0
    })?;
    let (recommended, recommended_binding) =
        bisect_diameter(robot, safety_margin, true, &|m, r| m.is_admissible(r))?;
    Some(MinDiameter {
        geometric,
        geometric_binding,
        recommended,
        recommended_binding,
    })
}

pub fn analyze_feasibility(
    config: &SimulationConfig,
) -> Result<FeasibilityReport, ValidationErrors> {
    config.robot.validate()?;
    let pipeline = Pipeline::new(config.pipeline.clone())?;
    let robot = &config.robot;
    let env = RobotEnvelope::new(robot);
    let model = ClearanceModel {
        pipeline: &pipeline,
        robot,
        envelope: &env,
        safety_margin: config.safety_margin,
    };
    let total = pipeline.total_length();
    let s0 = config.start_station().clamp(0.0, total);
    let s1 = config.goal_station(total).clamp(s0, total);

    // --- profile grid
    let ds = (total / 600.0).clamp(0.005, 0.05);
    let mut stations: Vec<f64> = Vec::new();
    let n = ((s1 - s0) / ds).ceil().max(1.0) as usize;
    for k in 0..=n {
        stations.push(s0 + (s1 - s0) * k as f64 / n as f64);
    }
    let half_len = 0.5 * robot.envelope_length();
    for d in pipeline.discontinuities() {
        // Stations where the robot front/rear meets a discontinuity.
        for off in [-half_len, half_len, 0.0] {
            let s = d.s - off;
            for e in [-1e-4, 1e-4] {
                if s + e > s0 && s + e < s1 {
                    stations.push(s + e);
                }
            }
        }
    }
    stations.sort_by(f64::total_cmp);
    stations.dedup_by(|a, b| (*a - *b).abs() < 1e-7);

    let yc = robot.contact_half_span();
    let ramp_at = |s: f64| -> f64 {
        let h = 2e-3;
        match (
            wall_height(pipeline.effective_radius(s + h), yc),
            wall_height(pipeline.effective_radius(s - h), yc),
        ) {
            (Some(a), Some(b)) => ((a - b) / (2.0 * h)).atan(),
            _ => 0.0,
        }
    };
    let ramp_disc = |s: f64| {
        pipeline
            .discontinuities()
            .iter()
            .any(|d| (d.s - s).abs() < 3e-3)
    };

    let mut profile = Vec::with_capacity(stations.len());
    for &s in &stations {
        let rep = model.evaluate(model.aligned_pose(s, 0.0, 0.0), s);
        let margin = model
            .lateral_margin(s, 1.0)
            .min(model.lateral_margin(s, -1.0));
        // Ramp under the front-most axle contact (the axle that meets it first).
        let front_s = rep
            .contacts
            .iter()
            .map(|c| c.s)
            .fold(f64::NEG_INFINITY, f64::max);
        let ramp = if ramp_disc(front_s) {
            0.0
        } else {
            ramp_at(front_s)
        };
        profile.push(ProfileSample {
            s,
            diameter: 2.0 * pipeline.effective_radius(s),
            clearance: rep.min_clearance,
            required: rep.required_clearance,
            lateral_margin: margin,
            contact_angle: rep.max_contact_angle,
            ramp_angle: ramp,
            binding: rep.critical.map(|c| c.kind),
        });
    }

    // --- issues: contiguous intervals
    let mut issues: Vec<FeasibilityIssue> = Vec::new();
    let mut push_intervals = |kind: ViolationKind,
                              pred: &dyn Fn(&ProfileSample) -> Option<f64>,
                              limit: f64,
                              higher_is_worse: bool,
                              msg: &dyn Fn(f64, f64, f64) -> String| {
        let mut cur: Option<(f64, f64, f64)> = None;
        for p in &profile {
            match (pred(p), cur.as_mut()) {
                (Some(v), None) => cur = Some((p.s, p.s, v)),
                (Some(v), Some(c)) => {
                    c.1 = p.s;
                    if (higher_is_worse && v > c.2) || (!higher_is_worse && v < c.2) {
                        c.2 = v;
                    }
                }
                (None, Some(_)) => {
                    let (a, b, v) = cur.take().unwrap();
                    issues.push(FeasibilityIssue {
                        kind,
                        s_start: a,
                        s_end: b,
                        value: v,
                        limit,
                        message: msg(a, b, v),
                    });
                }
                (None, None) => {}
            }
        }
        if let Some((a, b, v)) = cur {
            issues.push(FeasibilityIssue {
                kind,
                s_start: a,
                s_end: b,
                value: v,
                limit,
                message: msg(a, b, v),
            });
        }
    };
    push_intervals(
        ViolationKind::Collision,
        &|p| (p.clearance < 0.0).then_some(p.clearance),
        0.0,
        false,
        &|a, b, v| {
            format!(
                "Centred robot penetrates the wall by {:.1} mm between s = {a:.3} m and s = {b:.3} m",
                -v * 1e3
            )
        },
    );
    push_intervals(
        ViolationKind::SafetyClearance,
        &|p| (p.clearance >= 0.0 && p.clearance < p.required).then_some(p.clearance),
        config.safety_margin,
        false,
        &|a, b, v| {
            format!(
                "Clearance {:.1} mm is below the required safety clearance between s = {a:.3} m and s = {b:.3} m",
                v * 1e3
            )
        },
    );
    let max_ca = robot.max_contact_angle;
    push_intervals(
        ViolationKind::ContactAngle,
        &|p| (p.contact_angle > max_ca).then_some(p.contact_angle),
        max_ca,
        true,
        &|a, b, v| {
            format!(
                "Wall contact angle {:.1}° exceeds the {:.1}° limit between s = {a:.3} m and s = {b:.3} m (pipe too narrow for the wheel track)",
                v.to_degrees(),
                max_ca.to_degrees()
            )
        },
    );
    let beta_front = climb_angle_limit(robot, robot.axle_count() - 1, 0.0);
    push_intervals(
        ViolationKind::StepNotClimbable,
        &|p| (p.ramp_angle > beta_front).then_some(p.ramp_angle),
        beta_front,
        true,
        &|a, b, v| {
            format!(
                "Wall ramp of {:.1}° under the front wheels exceeds the climbable {:.1}° between s = {a:.3} m and s = {b:.3} m",
                v.to_degrees(),
                beta_front.to_degrees()
            )
        },
    );

    // --- steps
    let mut steps = Vec::new();
    for d in pipeline.discontinuities() {
        if d.s < s0 - half_len || d.s > s1 + half_len {
            continue;
        }
        let slope = pipeline.inclination(d.s);
        let beta_max = climb_angle_limit(robot, robot.axle_count() - 1, slope);
        let rise = match (
            wall_height(d.radius_after, yc),
            wall_height(d.radius_before, yc),
        ) {
            (Some(a), Some(b)) => a - b,
            (None, _) => robot.wheel_radius, // wheel cannot be placed after the step
            (Some(_), None) => 0.0,
        };
        let beta = step_contact_angle(rise, robot.wheel_radius);
        let climbable = beta <= beta_max;
        if !climbable {
            issues.push(FeasibilityIssue {
                kind: ViolationKind::StepNotClimbable,
                s_start: d.s,
                s_end: d.s,
                value: rise,
                limit: robot.wheel_radius * (1.0 - beta_max.cos()),
                message: format!(
                    "Step of {:.1} mm at s = {:.3} m needs contact angle {:.1}° > climbable {:.1}° (max step {:.1} mm)",
                    rise * 1e3,
                    d.s,
                    beta.to_degrees(),
                    beta_max.to_degrees(),
                    robot.wheel_radius * (1.0 - beta_max.cos()) * 1e3
                ),
            });
        }
        steps.push(StepCheck {
            s: d.s,
            radius_before: d.radius_before,
            radius_after: d.radius_after,
            kind: d.kind,
            rise,
            contact_angle: beta,
            max_angle: beta_max,
            climbable,
        });
    }

    // --- slopes
    let sl = slope_limit(robot);
    for seg in pipeline.segments() {
        let inc = seg.config.inclination;
        if inc > sl.max_slope {
            issues.push(FeasibilityIssue {
                kind: ViolationKind::Stall,
                s_start: seg.s_start,
                s_end: seg.s_end(),
                value: inc,
                limit: sl.max_slope,
                message: format!(
                    "Segment '{}' rises at {:.1}°, above the climbable {:.1}° ({}-limited)",
                    seg.id,
                    inc.to_degrees(),
                    sl.max_slope.to_degrees(),
                    if sl.traction_limit <= sl.torque_limit {
                        "traction"
                    } else {
                        "torque"
                    }
                ),
            });
        }
    }
    issues.sort_by(|a, b| a.s_start.total_cmp(&b.s_start));

    let (mut min_c, mut min_c_s, mut min_m, mut min_m_s, mut max_ca_seen) =
        (f64::INFINITY, s0, f64::INFINITY, s0, 0.0f64);
    for p in &profile {
        if p.clearance < min_c {
            min_c = p.clearance;
            min_c_s = p.s;
        }
        if p.lateral_margin < min_m {
            min_m = p.lateral_margin;
            min_m_s = p.s;
        }
        max_ca_seen = max_ca_seen.max(p.contact_angle);
    }

    let hard = |k: ViolationKind| {
        !matches!(
            k,
            ViolationKind::SafetyClearance | ViolationKind::ContactAngle
        )
    };
    let feasible = !issues.iter().any(|i| hard(i.kind));
    let has_warnings = issues.iter().any(|i| !hard(i.kind));
    let geometry = pipeline.sample((total / 800.0).clamp(0.002, 0.05));
    Ok(FeasibilityReport {
        feasible,
        has_warnings,
        issues,
        start_station: s0,
        goal_station: s1,
        profile,
        steps,
        min_clearance: min_c,
        min_clearance_station: min_c_s,
        min_lateral_margin: min_m,
        min_lateral_margin_station: min_m_s,
        max_contact_angle: max_ca_seen,
        min_feasible_diameter: min_feasible_diameter(robot, config.safety_margin),
        max_climb_angle: beta_front,
        max_step_height: robot.wheel_radius * (1.0 - beta_front.cos()),
        slope_limit: sl,
        envelope: EnvelopeSize {
            length: robot.envelope_length(),
            width: robot.envelope_width(),
            height: robot.envelope_height(),
            contact_half_span: yc,
        },
        summary: pipeline.summary(),
        geometry,
    })
}

/// Cross-section of the robot in a straight pipe (for the robot schematic).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CrossSectionView {
    pub diameter: f64,
    pub lateral_offset: f64,
    pub clearance: f64,
    pub required: f64,
    pub contact_angle: f64,
    pub max_contact_angle: f64,
    pub roll: f64,
    pub admissible: bool,
    pub binding: String,
    /// Body outline polygon in (lateral, height-above-axis) coordinates, m.
    pub body: Vec<[f64; 2]>,
    pub wheels: Vec<Vec<[f64; 2]>>,
    pub contacts: Vec<[f64; 2]>,
    pub critical: Option<[f64; 2]>,
}

pub fn cross_section_view(
    robot: &RobotConfig,
    diameter: f64,
    lateral_offset: f64,
    safety_margin: f64,
) -> Result<CrossSectionView, ValidationErrors> {
    robot.validate()?;
    let length = 4.0 * robot.envelope_length() + 0.2;
    let p = straight_pipe(diameter, length)?;
    let env = RobotEnvelope::new(robot);
    let m = ClearanceModel {
        pipeline: &p,
        robot,
        envelope: &env,
        safety_margin,
    };
    let s = 0.5 * length;
    let pose = m.aligned_pose(s, lateral_offset, 0.0);
    let rep = m.evaluate(pose, s);
    let (placement, contacts, _, _) = m.place(pose, s);
    let tf = |u: f64, h: f64| -> [f64; 2] {
        let (shift, z) = placement.lift(0.0, u, h);
        [lateral_offset + u + shift, z]
    };
    let hw = 0.5 * robot.body_width;
    let hb = robot.chassis_clearance;
    let ht = hb + robot.body_height;
    let body = vec![tf(-hw, hb), tf(hw, hb), tf(hw, ht), tf(-hw, ht)];
    let yc = robot.contact_half_span();
    let w = robot.wheel_width;
    let r2 = 2.0 * robot.wheel_radius;
    let wheels = [1.0, -1.0]
        .iter()
        .map(|&side: &f64| {
            let (a, b) = (side * yc, side * (yc - w));
            vec![tf(a, 0.0), tf(b, 0.0), tf(b, r2), tf(a, r2)]
        })
        .collect();
    let contacts_xy = contacts
        .iter()
        .filter(|c| c.axle == 0)
        .map(|c| [c.d, c.z])
        .collect();
    Ok(CrossSectionView {
        diameter,
        lateral_offset,
        clearance: rep.min_clearance,
        required: rep.required_clearance,
        contact_angle: rep.max_contact_angle,
        max_contact_angle: robot.max_contact_angle,
        roll: rep.roll,
        admissible: m.is_admissible(&rep),
        binding: binding_name(&m, &rep, true),
        body,
        wheels,
        contacts: contacts_xy,
        critical: rep.critical.map(|c| [c.d, c.z]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{straight, transition};

    #[test]
    fn min_diameter_is_bracketed() {
        let r = RobotConfig::default();
        let md = min_feasible_diameter(&r, 0.005).unwrap();
        // Default robot: contact angle binds → D ≈ 2 y_c / sin β_max.
        let expected = 2.0 * r.contact_half_span() / r.max_contact_angle.sin();
        assert!(
            (md.recommended - expected).abs() < 2e-3,
            "{md:?} vs {expected}"
        );
        assert!(md.recommended_binding.contains("contact angle"), "{md:?}");
        assert!(md.geometric < md.recommended);
        assert!(md.geometric > 2.0 * r.contact_half_span());
        let env = RobotEnvelope::new(&r);
        for (d, ok) in [
            (md.recommended + 1e-3, true),
            (md.recommended - 1e-3, false),
        ] {
            let p = straight_pipe(d, 2.0).unwrap();
            let m = ClearanceModel {
                pipeline: &p,
                robot: &r,
                envelope: &env,
                safety_margin: 0.005,
            };
            let rep = m.evaluate(m.aligned_pose(1.0, 0.0, 0.0), 1.0);
            assert_eq!(m.is_admissible(&rep), ok, "D = {d}");
        }
    }

    #[test]
    fn sudden_large_reduction_is_unclimbable() {
        let mut c = SimulationConfig::default();
        c.pipeline.segments = vec![straight("a", "", 1.0, 0.25), straight("b", "", 1.0, 0.20)];
        let rep = analyze_feasibility(&c).unwrap();
        assert_eq!(rep.steps.len(), 1);
        assert!(!rep.steps[0].climbable);
        assert!(!rep.feasible);
        assert!(
            rep.issues
                .iter()
                .any(|i| i.kind == ViolationKind::StepNotClimbable)
        );
    }

    #[test]
    fn small_reduction_and_gradual_transition_are_feasible() {
        let mut c = SimulationConfig::default();
        c.pipeline.segments = vec![
            straight("a", "", 1.0, 0.25),
            straight("b", "", 1.0, 0.235),
            transition("c", "", 0.8, 0.235, 0.20),
            straight("d", "", 0.5, 0.20),
        ];
        let rep = analyze_feasibility(&c).unwrap();
        assert!(rep.steps[0].climbable, "{:?}", rep.steps);
        assert!(rep.feasible, "{:?}", rep.issues);
        assert!(rep.min_lateral_margin > 0.0);
    }

    #[test]
    fn narrow_pipe_reports_contact_angle_warning() {
        let mut c = SimulationConfig::default();
        c.pipeline.segments = vec![
            straight("a", "", 1.0, 0.25),
            transition("b", "", 1.0, 0.25, 0.17),
            straight("c", "", 1.0, 0.17),
        ];
        let rep = analyze_feasibility(&c).unwrap();
        assert!(rep.feasible && rep.has_warnings, "{:?}", rep.issues);
        let ca = rep
            .issues
            .iter()
            .find(|i| i.kind == ViolationKind::ContactAngle)
            .unwrap();
        assert!(ca.s_start > 1.0 && ca.s_start < 2.1, "{ca:?}");
    }

    #[test]
    fn steep_incline_is_flagged() {
        let mut c = SimulationConfig::default();
        let mut s = straight("b", "", 1.0, 0.25);
        s.inclination = 45f64.to_radians();
        c.pipeline.segments = vec![straight("a", "", 1.0, 0.25), s];
        let rep = analyze_feasibility(&c).unwrap();
        assert!(rep.issues.iter().any(|i| i.kind == ViolationKind::Stall));
        assert!(!rep.feasible);
    }

    #[test]
    fn cross_section_view_is_consistent() {
        let r = RobotConfig::default();
        let v = cross_section_view(&r, 0.25, 0.0, 0.005).unwrap();
        assert!(v.admissible);
        assert_eq!(v.body.len(), 4);
        assert_eq!(v.wheels.len(), 2);
        // Symmetric when centred.
        assert!((v.body[0][0] + v.body[1][0]).abs() < 1e-12);
        let v2 = cross_section_view(&r, 0.17, 0.0, 0.005).unwrap();
        assert!(!v2.admissible);
        assert!(v2.binding.contains("contact angle"));
    }
}
