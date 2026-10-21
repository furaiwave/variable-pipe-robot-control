//! Geometry-based gain-scheduled PID tracking controller.
//!
//! The controller re-uses [`PidTrackingController`] and changes the lateral
//! loop gains at every step according to explicit scheduling rules:
//!
//! ```text
//! σ   = 1 − clamp(c_m / c_ref, 0, 1)          (tightness from lateral margin c_m)
//! κ_n = clamp(|κ_ahead| · ℓ_κ, 0, 1)          (tightness from curvature)
//! m*  = m_min + (m_max − m_min) · max(σ, κ_n)
//! m  ← m + Δt/(T_s + Δt) · (m* − m)            (bumpless first-order filter)
//! K_p = m K_p0,   K_i = m K_i0,   K_d = √m K_d0
//! ```
//!
//! In wide, straight sections the gains are *reduced* (m_min < 1) to lower
//! control effort and noise sensitivity; in narrow passages and bends they
//! are raised to keep the cross-track deviation small where clearance is
//! scarce. Because the integral state is stored in output units the gain
//! change is bumpless. This is classical gain scheduling on measured/known
//! scheduling variables; no plant parameters are estimated on-line.

use crate::config::GainScheduledParams;
use crate::controller::{ControlInput, ControlOutput, Controller};
use crate::pid_tracking::PidTrackingController;
use robot_core::kinematics::Twist;

/// Target gain multiplier m* for given scheduling variables.
pub fn schedule_multiplier(
    p: &GainScheduledParams,
    lateral_margin: f64,
    curvature_ahead: f64,
) -> f64 {
    let margin = if lateral_margin.is_finite() {
        lateral_margin
    } else {
        p.margin_reference
    };
    let sigma = 1.0 - (margin / p.margin_reference).clamp(0.0, 1.0);
    let kappa_n = (curvature_ahead.abs() * p.curvature_length).clamp(0.0, 1.0);
    p.min_multiplier + (p.max_multiplier - p.min_multiplier) * sigma.max(kappa_n)
}

pub struct GainScheduledController {
    params: GainScheduledParams,
    inner: PidTrackingController,
    multiplier: Option<f64>,
}

impl GainScheduledController {
    pub fn new(params: GainScheduledParams) -> Self {
        Self {
            inner: PidTrackingController::new(params.base.clone()),
            params,
            multiplier: None,
        }
    }
}

impl Controller for GainScheduledController {
    fn kind(&self) -> &'static str {
        "gain_scheduled"
    }

    fn compute(&mut self, input: &ControlInput) -> ControlOutput {
        let target = schedule_multiplier(
            &self.params,
            input.geometry.lateral_margin_ahead,
            input.geometry.curvature_ahead,
        );
        let m = match self.multiplier {
            None => target,
            Some(m) if input.dt > 0.0 && input.dt.is_finite() => {
                let a = input.dt / (self.params.schedule_time_constant.max(0.0) + input.dt);
                m + a * (target - m)
            }
            Some(m) => m,
        };
        self.multiplier = Some(m);

        let g = self.params.base.lateral;
        self.inner
            .set_lateral_gains(g.kp * m, g.ki * m, g.kd * m.sqrt());
        let mut out = self.inner.compute(input);
        out.diagnostics.gain_multiplier = m;
        out
    }

    fn saturation_feedback(&mut self, requested: Twist, applied: Twist, dt: f64) {
        self.inner.saturation_feedback(requested, applied, dt);
    }

    fn reset(&mut self) {
        self.inner.reset();
        self.multiplier = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_rules() {
        let p = GainScheduledParams::default();
        // Wide and straight → minimum multiplier.
        assert!((schedule_multiplier(&p, 1.0, 0.0) - p.min_multiplier).abs() < 1e-12);
        // No margin → maximum.
        assert!((schedule_multiplier(&p, 0.0, 0.0) - p.max_multiplier).abs() < 1e-12);
        assert!((schedule_multiplier(&p, -0.01, 0.0) - p.max_multiplier).abs() < 1e-12);
        // Tight bend dominates a wide section.
        assert!(
            (schedule_multiplier(&p, 1.0, 1.0 / p.curvature_length) - p.max_multiplier).abs()
                < 1e-12
        );
        // Half margin → midway.
        let mid = schedule_multiplier(&p, 0.5 * p.margin_reference, 0.0);
        assert!((mid - 0.5 * (p.min_multiplier + p.max_multiplier)).abs() < 1e-12);
        // Monotone in margin.
        assert!(schedule_multiplier(&p, 0.01, 0.0) > schedule_multiplier(&p, 0.02, 0.0));
    }
}
