//! Telemetry samples, constraint-violation events and CSV export.

use serde::{Deserialize, Serialize};
use std::fmt::Write as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationKind {
    /// Robot envelope penetrates the pipe wall (clearance < 0).
    Collision,
    /// Clearance below the required safety clearance.
    SafetyClearance,
    /// Wall contact angle above the admissible limit (risk of lateral slip / roll-over).
    ContactAngle,
    /// A wheel contact lies outside the local pipe cross-section.
    WheelOutsidePipe,
    /// A step / wall ramp exceeds the climbable contact angle.
    StepNotClimbable,
    /// Wheel speed command limited by the wheel speed limit.
    WheelSpeedSaturation,
    /// Motor torque demand exceeded the motor torque limit.
    TorqueSaturation,
    /// Required tractive force exceeded the friction limit (wheel slip).
    TractionLimit,
    /// An axle lost normal load (lift-off / tipping risk).
    TippingRisk,
    /// Robot cannot make progress (insufficient torque/traction).
    Stall,
    /// Non-finite state detected.
    NumericalFailure,
    /// Simulated time limit reached before the goal.
    Timeout,
}

impl ViolationKind {
    pub const ALL: [ViolationKind; 12] = [
        ViolationKind::Collision,
        ViolationKind::SafetyClearance,
        ViolationKind::ContactAngle,
        ViolationKind::WheelOutsidePipe,
        ViolationKind::StepNotClimbable,
        ViolationKind::WheelSpeedSaturation,
        ViolationKind::TorqueSaturation,
        ViolationKind::TractionLimit,
        ViolationKind::TippingRisk,
        ViolationKind::Stall,
        ViolationKind::NumericalFailure,
        ViolationKind::Timeout,
    ];

    pub fn index(self) -> usize {
        Self::ALL.iter().position(|k| *k == self).unwrap_or(0)
    }

    /// Bit used in [`TelemetrySample::flags`].
    pub fn flag(self) -> u32 {
        1 << self.index()
    }

    pub fn label(self) -> &'static str {
        match self {
            ViolationKind::Collision => "Collision with pipe wall",
            ViolationKind::SafetyClearance => "Safety clearance violated",
            ViolationKind::ContactAngle => "Wall contact angle exceeded",
            ViolationKind::WheelOutsidePipe => "Wheel outside pipe cross-section",
            ViolationKind::StepNotClimbable => "Step / ramp not climbable",
            ViolationKind::WheelSpeedSaturation => "Wheel speed saturation",
            ViolationKind::TorqueSaturation => "Motor torque saturation",
            ViolationKind::TractionLimit => "Traction limit (wheel slip)",
            ViolationKind::TippingRisk => "Axle lift-off (tipping risk)",
            ViolationKind::Stall => "Stall (no progress)",
            ViolationKind::NumericalFailure => "Numerical failure",
            ViolationKind::Timeout => "Time limit reached",
        }
    }

    /// Whether the violation counts as a geometric feasibility failure.
    pub fn is_geometric(self) -> bool {
        matches!(
            self,
            ViolationKind::Collision
                | ViolationKind::SafetyClearance
                | ViolationKind::ContactAngle
                | ViolationKind::WheelOutsidePipe
                | ViolationKind::StepNotClimbable
        )
    }
}

/// Extra telemetry flag (not a violation): controller output limited.
pub const FLAG_CONTROLLER_SATURATED: u32 = 1 << 16;
/// Extra telemetry flag: wheel command acceleration rate limited.
pub const FLAG_RATE_LIMITED: u32 = 1 << 17;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Warning,
    Fatal,
}

/// One episode of a constraint violation (from activation to release).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ViolationEvent {
    pub kind: ViolationKind,
    pub severity: Severity,
    pub t_start: f64,
    pub t_end: f64,
    pub s_start: f64,
    pub s_end: f64,
    pub x: f64,
    pub y: f64,
    /// Worst value observed during the episode.
    pub peak_value: f64,
    pub limit: f64,
    pub unit: String,
    pub message: String,
}

/// Edge-triggered event recorder: one event per contiguous episode.
#[derive(Clone, Debug, Default)]
pub struct EventTracker {
    active: [Option<usize>; 12],
    pub events: Vec<ViolationEvent>,
}

pub struct Observation<'a> {
    pub t: f64,
    pub s: f64,
    pub x: f64,
    pub y: f64,
    pub value: f64,
    pub limit: f64,
    pub unit: &'a str,
    /// `true` if larger values are worse (peak = max), `false` for min.
    pub higher_is_worse: bool,
}

impl EventTracker {
    pub fn update(
        &mut self,
        kind: ViolationKind,
        severity: Severity,
        active: bool,
        obs: &Observation<'_>,
        message: impl FnOnce() -> String,
    ) {
        let slot = kind.index();
        match (self.active[slot], active) {
            (None, true) => {
                self.events.push(ViolationEvent {
                    kind,
                    severity,
                    t_start: obs.t,
                    t_end: obs.t,
                    s_start: obs.s,
                    s_end: obs.s,
                    x: obs.x,
                    y: obs.y,
                    peak_value: obs.value,
                    limit: obs.limit,
                    unit: obs.unit.to_string(),
                    message: message(),
                });
                self.active[slot] = Some(self.events.len() - 1);
            }
            (Some(i), true) => {
                let e = &mut self.events[i];
                e.t_end = obs.t;
                e.s_end = obs.s;
                let worse = if obs.higher_is_worse {
                    obs.value > e.peak_value
                } else {
                    obs.value < e.peak_value
                };
                if worse {
                    e.peak_value = obs.value;
                }
            }
            (Some(_), false) => self.active[slot] = None,
            (None, false) => {}
        }
    }

    pub fn is_active(&self, kind: ViolationKind) -> bool {
        self.active[kind.index()].is_some()
    }

    pub fn count(&self, kind: ViolationKind) -> usize {
        self.events.iter().filter(|e| e.kind == kind).count()
    }

    pub fn clear(&mut self) {
        *self = Self::default();
    }
}

/// Sampled simulation state. Field names are part of the public JSON/CSV
/// contract (mirrored in the TypeScript types).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TelemetrySample {
    /// Simulated time, s.
    pub t: f64,
    // --- true pose and path coordinates
    pub x: f64,
    pub y: f64,
    pub theta: f64,
    /// Arc-length station of the robot centre, m.
    pub s: f64,
    /// Lateral offset from the centreline, m.
    pub d: f64,
    // --- reference
    pub x_ref: f64,
    pub y_ref: f64,
    pub theta_ref: f64,
    pub s_ref: f64,
    pub v_ref: f64,
    pub omega_ref: f64,
    // --- motion
    pub v: f64,
    pub omega: f64,
    pub v_cmd: f64,
    pub omega_cmd: f64,
    pub wheel_left: f64,
    pub wheel_right: f64,
    pub wheel_left_cmd: f64,
    pub wheel_right_cmd: f64,
    /// Delivered torque per motor, N·m.
    pub torque_left: f64,
    pub torque_right: f64,
    /// Requested (demanded) torque per motor before limiting, N·m.
    pub torque_demand_left: f64,
    pub torque_demand_right: f64,
    // --- errors
    /// Euclidean distance to the reference point, m.
    pub error_position: f64,
    /// Cross-track error relative to the reference path, m.
    pub error_lateral: f64,
    /// Along-track lag s_ref − s, m.
    pub error_along: f64,
    /// Heading error θ_ref − θ, rad.
    pub error_heading: f64,
    // --- geometry / constraints
    pub clearance: f64,
    pub required_clearance: f64,
    pub diameter: f64,
    pub contact_angle: f64,
    pub pitch: f64,
    pub roll: f64,
    pub slope: f64,
    // --- controller diagnostics
    pub gain_multiplier: f64,
    pub lateral_margin: f64,
    /// Bitmask of active violations (`ViolationKind::flag`) and FLAG_* bits.
    pub flags: u32,
}

pub const CSV_COLUMNS: &[&str] = &[
    "t",
    "x",
    "y",
    "theta",
    "s",
    "d",
    "x_ref",
    "y_ref",
    "theta_ref",
    "s_ref",
    "v_ref",
    "omega_ref",
    "v",
    "omega",
    "v_cmd",
    "omega_cmd",
    "wheel_left",
    "wheel_right",
    "wheel_left_cmd",
    "wheel_right_cmd",
    "torque_left",
    "torque_right",
    "torque_demand_left",
    "torque_demand_right",
    "error_position",
    "error_lateral",
    "error_along",
    "error_heading",
    "clearance",
    "required_clearance",
    "diameter",
    "contact_angle",
    "pitch",
    "roll",
    "slope",
    "gain_multiplier",
    "lateral_margin",
    "flags",
];

impl TelemetrySample {
    fn values(&self) -> [f64; 37] {
        [
            self.t,
            self.x,
            self.y,
            self.theta,
            self.s,
            self.d,
            self.x_ref,
            self.y_ref,
            self.theta_ref,
            self.s_ref,
            self.v_ref,
            self.omega_ref,
            self.v,
            self.omega,
            self.v_cmd,
            self.omega_cmd,
            self.wheel_left,
            self.wheel_right,
            self.wheel_left_cmd,
            self.wheel_right_cmd,
            self.torque_left,
            self.torque_right,
            self.torque_demand_left,
            self.torque_demand_right,
            self.error_position,
            self.error_lateral,
            self.error_along,
            self.error_heading,
            self.clearance,
            self.required_clearance,
            self.diameter,
            self.contact_angle,
            self.pitch,
            self.roll,
            self.slope,
            self.gain_multiplier,
            self.lateral_margin,
        ]
    }
}

/// Telemetry as CSV (SI units, radians).
pub fn to_csv(samples: &[TelemetrySample]) -> String {
    let mut out = String::with_capacity(samples.len() * 400);
    out.push_str(&CSV_COLUMNS.join(","));
    out.push('\n');
    for s in samples {
        for v in s.values() {
            let _ = write!(out, "{v:.9},");
        }
        let _ = writeln!(out, "{}", s.flags);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs(t: f64, value: f64) -> Observation<'static> {
        Observation {
            t,
            s: t,
            x: 0.0,
            y: 0.0,
            value,
            limit: 0.0,
            unit: "m",
            higher_is_worse: false,
        }
    }

    #[test]
    fn episodes_are_edge_triggered() {
        let mut tr = EventTracker::default();
        let k = ViolationKind::SafetyClearance;
        tr.update(k, Severity::Warning, true, &obs(0.0, -0.001), String::new);
        tr.update(k, Severity::Warning, true, &obs(0.1, -0.003), String::new);
        tr.update(k, Severity::Warning, false, &obs(0.2, 0.0), String::new);
        tr.update(k, Severity::Warning, true, &obs(0.3, -0.002), String::new);
        assert_eq!(tr.count(k), 2);
        assert_eq!(tr.events[0].peak_value, -0.003);
        assert_eq!(tr.events[0].t_end, 0.1);
        assert!(tr.is_active(k));
    }

    #[test]
    fn csv_has_header_and_rows() {
        let csv = to_csv(&[
            TelemetrySample::default(),
            TelemetrySample {
                t: 0.5,
                flags: 3,
                ..Default::default()
            },
        ]);
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].split(',').count(), CSV_COLUMNS.len());
        assert_eq!(lines[2].split(',').count(), CSV_COLUMNS.len());
        assert!(lines[2].starts_with("0.500000000,"));
        assert!(lines[2].ends_with(",3"));
    }

    #[test]
    fn flags_are_unique() {
        let mut acc = 0u32;
        for k in ViolationKind::ALL {
            assert_eq!(acc & k.flag(), 0);
            acc |= k.flag();
        }
        assert_eq!(acc & (FLAG_CONTROLLER_SATURATED | FLAG_RATE_LIMITED), 0);
    }
}
