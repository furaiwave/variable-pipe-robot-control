//! Discrete PID controller with filtered derivative, output clamping and
//! back-calculation anti-windup.
//!
//! ```text
//! u_unsat = Kp e + I + Kd ḋ_f
//! u       = clamp(u_unsat, ±u_max)
//! I      ← clamp(I + Δt (Ki e + Kt (u − u_unsat)), ±I_max)
//! ḋ_f    ← ḋ_f + Δt/(T_f + Δt) · ((e − e_prev)/Δt − ḋ_f)
//! ```
//!
//! The integral state I is stored in output units, so changing Ki at run time
//! (gain scheduling) does not cause output jumps (bumpless).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PidGains {
    pub kp: f64,
    pub ki: f64,
    pub kd: f64,
    /// Bound on the integral contribution (output units).
    pub integral_limit: f64,
    /// Symmetric output saturation |u| ≤ output_limit.
    pub output_limit: f64,
    /// Derivative low-pass filter time constant T_f, s.
    pub derivative_filter: f64,
    /// Back-calculation tracking gain K_t, 1/s.
    pub anti_windup_gain: f64,
}

impl PidGains {
    pub fn validate_into(&self, v: &mut robot_core::Validator, prefix: &str) {
        let f = |n: &str| format!("{prefix}.{n}");
        v.range(&f("kp"), self.kp, 0.0, 1e4);
        v.range(&f("ki"), self.ki, 0.0, 1e4);
        v.range(&f("kd"), self.kd, 0.0, 1e4);
        v.range(&f("integral_limit"), self.integral_limit, 0.0, 1e4);
        v.range(&f("output_limit"), self.output_limit, 1e-6, 1e4);
        v.range(&f("derivative_filter"), self.derivative_filter, 0.0, 10.0);
        v.range(&f("anti_windup_gain"), self.anti_windup_gain, 0.0, 1e4);
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PidOutput {
    pub p: f64,
    pub i: f64,
    pub d: f64,
    pub unsaturated: f64,
    pub output: f64,
    pub saturated: bool,
}

#[derive(Clone, Debug)]
pub struct Pid {
    pub gains: PidGains,
    integral: f64,
    prev_error: Option<f64>,
    d_filtered: f64,
    last_output: f64,
}

impl Pid {
    pub fn new(gains: PidGains) -> Self {
        Self {
            gains,
            integral: 0.0,
            prev_error: None,
            d_filtered: 0.0,
            last_output: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.integral = 0.0;
        self.prev_error = None;
        self.d_filtered = 0.0;
        self.last_output = 0.0;
    }

    pub fn integral(&self) -> f64 {
        self.integral
    }

    /// Compute one PID update. Invalid inputs (non-finite error, dt ≤ 0 or
    /// non-finite dt) leave the internal state untouched and return the
    /// proportional term only (zero for a non-finite error).
    pub fn update(&mut self, error: f64, dt: f64) -> PidOutput {
        let g = self.gains;
        let lim = g.output_limit.abs();
        if !error.is_finite() {
            return PidOutput::default();
        }
        if !(dt.is_finite() && dt > 0.0) {
            let p = g.kp * error;
            let out = p.clamp(-lim, lim);
            return PidOutput {
                p,
                unsaturated: p,
                output: out,
                saturated: out != p,
                ..Default::default()
            };
        }

        let d = match self.prev_error {
            None => 0.0,
            Some(prev) => {
                let raw = (error - prev) / dt;
                let alpha = dt / (g.derivative_filter.max(0.0) + dt);
                self.d_filtered += alpha * (raw - self.d_filtered);
                self.d_filtered
            }
        };
        self.prev_error = Some(error);

        let p = g.kp * error;
        let i = self.integral;
        let dterm = g.kd * d;
        let unsat = p + i + dterm;
        let out = unsat.clamp(-lim, lim);

        let il = g.integral_limit.abs();
        self.integral = (self.integral + dt * (g.ki * error + g.anti_windup_gain * (out - unsat)))
            .clamp(-il, il);
        self.last_output = out;

        PidOutput {
            p,
            i,
            d: dterm,
            unsaturated: unsat,
            output: out,
            saturated: out != unsat,
        }
    }

    /// Back-calculation for saturation that happens *downstream* of this
    /// controller (e.g. wheel-speed limits): `applied` is the portion of the
    /// output that was actually realised.
    pub fn external_saturation(&mut self, applied: f64, dt: f64) {
        if !(dt.is_finite() && dt > 0.0 && applied.is_finite()) {
            return;
        }
        let il = self.gains.integral_limit.abs();
        self.integral = (self.integral
            + dt * self.gains.anti_windup_gain * (applied - self.last_output))
            .clamp(-il, il);
        self.last_output = applied;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gains() -> PidGains {
        PidGains {
            kp: 2.0,
            ki: 1.0,
            kd: 0.0,
            integral_limit: 10.0,
            output_limit: 1.0,
            derivative_filter: 0.0,
            anti_windup_gain: 0.0,
        }
    }

    #[test]
    fn proportional_and_integral_response() {
        let mut pid = Pid::new(gains());
        let o1 = pid.update(0.1, 0.1);
        assert!((o1.output - 0.2).abs() < 1e-12); // I starts at zero
        let o2 = pid.update(0.1, 0.1);
        assert!((o2.output - (0.2 + 0.01)).abs() < 1e-12);
    }

    #[test]
    fn first_order_plant_reaches_setpoint_with_integral() {
        // Plant: ẏ = −y + u + disturbance; PI removes the steady-state error.
        let mut pid = Pid::new(PidGains {
            output_limit: 100.0,
            ..gains()
        });
        let (mut y, dt) = (0.0, 0.01);
        for _ in 0..3000 {
            let u = pid.update(1.0 - y, dt).output;
            y += dt * (-y + u - 0.3);
        }
        assert!((y - 1.0).abs() < 1e-3, "y = {y}");
    }

    #[test]
    fn derivative_term_reacts_to_error_rate() {
        let mut pid = Pid::new(PidGains {
            kp: 0.0,
            ki: 0.0,
            kd: 1.0,
            output_limit: 100.0,
            ..gains()
        });
        assert_eq!(pid.update(0.0, 0.1).output, 0.0); // no derivative kick on first sample
        let o = pid.update(0.5, 0.1);
        assert!((o.d - 5.0).abs() < 1e-12);
    }

    #[test]
    fn output_is_clamped() {
        let mut pid = Pid::new(gains());
        let o = pid.update(10.0, 0.01);
        assert_eq!(o.output, 1.0);
        assert!(o.saturated);
    }

    #[test]
    fn back_calculation_limits_windup() {
        // Long saturation followed by an error sign change: with anti-windup
        // the output must leave saturation much sooner.
        let run = |kt: f64| {
            let mut pid = Pid::new(PidGains {
                anti_windup_gain: kt,
                integral_limit: 1e3,
                ..gains()
            });
            for _ in 0..500 {
                pid.update(5.0, 0.01);
            }
            let mut steps = 0;
            while pid.update(-0.2, 0.01).output >= 0.999 && steps < 100_000 {
                steps += 1;
            }
            (steps, pid.integral())
        };
        let (no_aw, i_no_aw) = run(0.0);
        let (aw, i_aw) = run(5.0);
        assert!(i_aw < i_no_aw);
        assert!(aw * 5 < no_aw, "with AW {aw} steps, without {no_aw}");
    }

    #[test]
    fn integral_limit_is_enforced() {
        let mut pid = Pid::new(PidGains {
            integral_limit: 0.05,
            output_limit: 100.0,
            ..gains()
        });
        for _ in 0..1000 {
            pid.update(1.0, 0.01);
        }
        assert!((pid.integral() - 0.05).abs() < 1e-12);
    }

    #[test]
    fn invalid_dt_is_safe() {
        let mut pid = Pid::new(gains());
        for dt in [0.0, -0.1, f64::NAN, f64::INFINITY] {
            let o = pid.update(0.1, dt);
            assert!(o.output.is_finite());
            assert_eq!(pid.integral(), 0.0);
        }
        let o = pid.update(f64::NAN, 0.01);
        assert_eq!(o.output, 0.0);
    }
}
