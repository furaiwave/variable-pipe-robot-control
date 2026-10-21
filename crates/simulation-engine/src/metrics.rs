//! Performance metrics accumulated over **every** integration step (not only
//! the decimated telemetry), so they do not depend on the telemetry rate.

use serde::{Deserialize, Serialize};

/// Statistics of an error signal e(t_k), k = 1..N:
/// RMSE = √(Σe²/N), MAE = Σ|e|/N, max = max|e|, final = |e_N|.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ErrorStats {
    pub rmse: f64,
    pub mae: f64,
    pub max: f64,
    pub final_value: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ErrorAccumulator {
    n: u64,
    sum_abs: f64,
    sum_sq: f64,
    max: f64,
    last: f64,
}

impl ErrorAccumulator {
    pub fn push(&mut self, e: f64) {
        let a = e.abs();
        self.n += 1;
        self.sum_abs += a;
        self.sum_sq += a * a;
        self.max = self.max.max(a);
        self.last = a;
    }

    pub fn stats(&self) -> ErrorStats {
        if self.n == 0 {
            return ErrorStats::default();
        }
        let n = self.n as f64;
        ErrorStats {
            rmse: (self.sum_sq / n).sqrt(),
            mae: self.sum_abs / n,
            max: self.max,
            final_value: self.last,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub position_error: ErrorStats,
    pub lateral_error: ErrorStats,
    pub heading_error: ErrorStats,
    /// Time-average of the linear velocity, m/s.
    pub average_linear_velocity: f64,
    pub max_linear_velocity: f64,
    /// max |ω_wheel| over the run, rad/s.
    pub max_wheel_speed: f64,
    /// Path length travelled, ∫|v| dt, m.
    pub total_distance: f64,
    /// Net progress along the pipe (final station − start station), m.
    pub progress: f64,
    pub progress_ratio: f64,
    /// Simulated duration, s.
    pub simulated_duration: f64,
    /// Wall-clock time spent integrating, ms.
    pub execution_time_ms: f64,
    pub steps: u64,
    pub min_clearance: f64,
    pub min_clearance_station: f64,
    pub max_contact_angle: f64,
    /// Peak delivered torque per motor, N·m.
    pub max_motor_torque: f64,
    /// Peak requested torque per motor, N·m.
    pub max_torque_demand: f64,
    /// Mechanical energy delivered by all motors, ∫ Σ|τ ω| dt, J.
    pub mechanical_energy: f64,
    /// Fraction of steps with any wheel-command saturation.
    pub wheel_saturation_ratio: f64,
    pub torque_saturation_ratio: f64,
    pub traction_limit_ratio: f64,
    /// Number of collision episodes.
    pub collision_count: usize,
    /// Number of geometric feasibility violation episodes (collision,
    /// safety clearance, contact angle, wheel outside, step).
    pub feasibility_violation_count: usize,
    /// Total number of violation episodes of any kind.
    pub constraint_violation_count: usize,
    pub goal_reached: bool,
}

#[derive(Clone, Debug, Default)]
pub struct MetricsAccumulator {
    pub position: ErrorAccumulator,
    pub lateral: ErrorAccumulator,
    pub heading: ErrorAccumulator,
    steps: u64,
    sum_v: f64,
    max_v: f64,
    max_wheel: f64,
    distance: f64,
    min_clearance: Option<(f64, f64)>,
    max_contact_angle: f64,
    max_torque: f64,
    max_demand: f64,
    energy: f64,
    wheel_sat: u64,
    torque_sat: u64,
    traction: u64,
}

pub struct StepMetrics {
    pub dt: f64,
    pub e_pos: f64,
    pub e_lat: f64,
    pub e_heading: f64,
    pub v: f64,
    pub wheel_peak: f64,
    pub clearance: f64,
    pub station: f64,
    pub contact_angle: f64,
    pub torque_peak: f64,
    pub demand_peak: f64,
    pub power: f64,
    pub wheel_saturated: bool,
    pub torque_saturated: bool,
    pub traction_limited: bool,
}

impl MetricsAccumulator {
    pub fn push(&mut self, m: &StepMetrics) {
        self.position.push(m.e_pos);
        self.lateral.push(m.e_lat);
        self.heading.push(m.e_heading);
        self.steps += 1;
        self.sum_v += m.v;
        self.max_v = self.max_v.max(m.v.abs());
        self.max_wheel = self.max_wheel.max(m.wheel_peak);
        self.distance += m.v.abs() * m.dt;
        if self.min_clearance.is_none_or(|(c, _)| m.clearance < c) {
            self.min_clearance = Some((m.clearance, m.station));
        }
        self.max_contact_angle = self.max_contact_angle.max(m.contact_angle);
        self.max_torque = self.max_torque.max(m.torque_peak);
        self.max_demand = self.max_demand.max(m.demand_peak);
        self.energy += m.power.abs() * m.dt;
        self.wheel_sat += m.wheel_saturated as u64;
        self.torque_sat += m.torque_saturated as u64;
        self.traction += m.traction_limited as u64;
    }

    pub fn finish(
        &self,
        duration: f64,
        execution_ms: f64,
        progress: f64,
        required_progress: f64,
    ) -> PerformanceMetrics {
        let n = self.steps.max(1) as f64;
        let (min_c, min_s) = self.min_clearance.unwrap_or((f64::NAN, f64::NAN));
        PerformanceMetrics {
            position_error: self.position.stats(),
            lateral_error: self.lateral.stats(),
            heading_error: self.heading.stats(),
            average_linear_velocity: self.sum_v / n,
            max_linear_velocity: self.max_v,
            max_wheel_speed: self.max_wheel,
            total_distance: self.distance,
            progress,
            progress_ratio: if required_progress > 0.0 {
                (progress / required_progress).clamp(0.0, 1.0)
            } else {
                0.0
            },
            simulated_duration: duration,
            execution_time_ms: execution_ms,
            steps: self.steps,
            min_clearance: min_c,
            min_clearance_station: min_s,
            max_contact_angle: self.max_contact_angle,
            max_motor_torque: self.max_torque,
            max_torque_demand: self.max_demand,
            mechanical_energy: self.energy,
            wheel_saturation_ratio: self.wheel_sat as f64 / n,
            torque_saturation_ratio: self.torque_sat as f64 / n,
            traction_limit_ratio: self.traction as f64 / n,
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_statistics() {
        let mut a = ErrorAccumulator::default();
        for e in [3.0, -4.0, 0.0, 1.0] {
            a.push(e);
        }
        let s = a.stats();
        assert!((s.rmse - (26.0f64 / 4.0).sqrt()).abs() < 1e-12);
        assert!((s.mae - 2.0).abs() < 1e-12);
        assert_eq!(s.max, 4.0);
        assert_eq!(s.final_value, 1.0);
        assert_eq!(ErrorAccumulator::default().stats(), ErrorStats::default());
    }

    #[test]
    fn distance_and_average_velocity() {
        let mut m = MetricsAccumulator::default();
        for k in 0..100 {
            m.push(&StepMetrics {
                dt: 0.01,
                e_pos: 0.0,
                e_lat: 0.0,
                e_heading: 0.0,
                v: if k < 50 { 0.1 } else { 0.3 },
                wheel_peak: 1.0,
                clearance: 0.05 - k as f64 * 1e-4,
                station: k as f64,
                contact_angle: 0.1,
                torque_peak: 0.01,
                demand_peak: 0.02,
                power: 1.0,
                wheel_saturated: k % 2 == 0,
                torque_saturated: false,
                traction_limited: false,
            });
        }
        let r = m.finish(1.0, 0.0, 0.2, 0.4);
        assert!((r.total_distance - 0.2).abs() < 1e-12);
        assert!((r.average_linear_velocity - 0.2).abs() < 1e-12);
        assert!((r.min_clearance - (0.05 - 99e-4)).abs() < 1e-12);
        assert_eq!(r.min_clearance_station, 99.0);
        assert!((r.wheel_saturation_ratio - 0.5).abs() < 1e-12);
        assert!((r.mechanical_energy - 1.0).abs() < 1e-12);
        assert!((r.progress_ratio - 0.5).abs() < 1e-12);
    }
}
