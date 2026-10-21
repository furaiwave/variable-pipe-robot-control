//! Serializable controller configurations and factory.

use crate::controller::Controller;
use crate::gain_scheduled::GainScheduledController;
use crate::kinematic::KinematicController;
use crate::pid::PidGains;
use crate::pid_tracking::PidTrackingController;
use robot_core::{ValidationErrors, Validator};
use serde::{Deserialize, Serialize};

/// Kanayama kinematic tracking law gains.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct KinematicParams {
    /// Longitudinal gain K_x, 1/s.
    pub k_x: f64,
    /// Lateral gain K_y, 1/m².
    pub k_y: f64,
    /// Heading gain K_θ, 1/m.
    pub k_theta: f64,
}

impl Default for KinematicParams {
    fn default() -> Self {
        Self {
            k_x: 1.5,
            k_y: 50.0,
            k_theta: 10.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LongitudinalMode {
    /// Regulate the along-track position error e_x (trajectory tracking).
    #[default]
    Position,
    /// Regulate the velocity error v_r − v (velocity tracking; along-track
    /// position drift is not corrected).
    Velocity,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PidTrackingParams {
    pub longitudinal_mode: LongitudinalMode,
    /// Longitudinal loop (output: velocity correction, m/s).
    pub longitudinal: PidGains,
    /// Lateral loop on the look-ahead cross-track error (output: yaw-rate
    /// correction, rad/s).
    pub lateral: PidGains,
    /// Look-ahead distance l_a used in e_c = e_y cos e_θ + l_a sin e_θ, m.
    pub lookahead: f64,
}

impl Default for PidTrackingParams {
    fn default() -> Self {
        Self {
            longitudinal_mode: LongitudinalMode::Position,
            longitudinal: PidGains {
                kp: 1.5,
                ki: 0.3,
                kd: 0.0,
                integral_limit: 0.05,
                output_limit: 0.15,
                derivative_filter: 0.05,
                anti_windup_gain: 2.0,
            },
            lateral: PidGains {
                kp: 8.0,
                ki: 2.0,
                kd: 0.5,
                integral_limit: 0.5,
                output_limit: 2.0,
                derivative_filter: 0.05,
                anti_windup_gain: 2.0,
            },
            lookahead: 0.15,
        }
    }
}

/// Gain-scheduling rules on top of the PID tracking structure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GainScheduledParams {
    /// Base PID structure and nominal gains.
    pub base: PidTrackingParams,
    /// Lateral margin c_ref at which a section counts as "wide" (σ = 0), m.
    pub margin_reference: f64,
    /// Length scale ℓ_κ: curvature 1/ℓ_κ counts as "tight bend" (κ_n = 1), m.
    pub curvature_length: f64,
    /// Gain multiplier in wide, straight sections.
    pub min_multiplier: f64,
    /// Gain multiplier in the tightest sections.
    pub max_multiplier: f64,
    /// First-order filter time constant on the multiplier (bumpless scheduling), s.
    pub schedule_time_constant: f64,
}

impl Default for GainScheduledParams {
    fn default() -> Self {
        Self {
            base: PidTrackingParams::default(),
            margin_reference: 0.03,
            curvature_length: 0.3,
            min_multiplier: 0.6,
            max_multiplier: 2.5,
            schedule_time_constant: 0.2,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControllerConfig {
    Kinematic(KinematicParams),
    Pid(PidTrackingParams),
    GainScheduled(GainScheduledParams),
}

impl Default for ControllerConfig {
    fn default() -> Self {
        ControllerConfig::Pid(PidTrackingParams::default())
    }
}

impl ControllerConfig {
    pub fn kind(&self) -> &'static str {
        match self {
            ControllerConfig::Kinematic(_) => "kinematic",
            ControllerConfig::Pid(_) => "pid",
            ControllerConfig::GainScheduled(_) => "gain_scheduled",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            ControllerConfig::Kinematic(_) => "Kinematic baseline (Kanayama)",
            ControllerConfig::Pid(_) => "PID tracking (fixed gains)",
            ControllerConfig::GainScheduled(_) => "Gain-scheduled PID",
        }
    }

    pub fn validate(&self) -> Result<(), ValidationErrors> {
        let mut v = Validator::new("controller");
        match self {
            ControllerConfig::Kinematic(p) => {
                v.range("k_x", p.k_x, 0.0, 1e3);
                v.range("k_y", p.k_y, 0.0, 1e5);
                v.range("k_theta", p.k_theta, 0.0, 1e4);
            }
            ControllerConfig::Pid(p) => validate_pid(&mut v, p, ""),
            ControllerConfig::GainScheduled(p) => {
                validate_pid(&mut v, &p.base, "base.");
                v.range("margin_reference", p.margin_reference, 1e-4, 1.0);
                v.range("curvature_length", p.curvature_length, 1e-3, 100.0);
                v.range("min_multiplier", p.min_multiplier, 0.05, 20.0);
                v.range("max_multiplier", p.max_multiplier, 0.05, 20.0);
                v.range(
                    "schedule_time_constant",
                    p.schedule_time_constant,
                    0.0,
                    10.0,
                );
                if p.min_multiplier.is_finite() && p.max_multiplier.is_finite() {
                    v.check(
                        p.min_multiplier <= p.max_multiplier,
                        "max_multiplier",
                        "must be ≥ min_multiplier",
                    );
                }
            }
        }
        v.finish()
    }

    pub fn build(&self) -> Box<dyn Controller> {
        match self {
            ControllerConfig::Kinematic(p) => Box::new(KinematicController::new(p.clone())),
            ControllerConfig::Pid(p) => Box::new(PidTrackingController::new(p.clone())),
            ControllerConfig::GainScheduled(p) => Box::new(GainScheduledController::new(p.clone())),
        }
    }
}

fn validate_pid(v: &mut Validator, p: &PidTrackingParams, prefix: &str) {
    p.longitudinal
        .validate_into(v, &format!("{prefix}longitudinal"));
    p.lateral.validate_into(v, &format!("{prefix}lateral"));
    v.range(&format!("{prefix}lookahead"), p.lookahead, 0.0, 5.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_tagging() {
        let c = ControllerConfig::GainScheduled(GainScheduledParams::default());
        let j = serde_json::to_value(&c).unwrap();
        assert_eq!(j["type"], "gain_scheduled");
        let back: ControllerConfig = serde_json::from_value(j).unwrap();
        assert_eq!(back, c);
        let k: ControllerConfig = serde_json::from_str(r#"{"type":"kinematic"}"#).unwrap();
        assert_eq!(k, ControllerConfig::Kinematic(KinematicParams::default()));
    }

    #[test]
    fn validation_rejects_negative_gains() {
        let mut p = PidTrackingParams::default();
        p.lateral.kp = -1.0;
        let err = ControllerConfig::Pid(p).validate().unwrap_err();
        assert_eq!(err.issues[0].field, "controller.lateral.kp");
        for c in [
            ControllerConfig::Kinematic(KinematicParams::default()),
            ControllerConfig::Pid(PidTrackingParams::default()),
            ControllerConfig::GainScheduled(GainScheduledParams::default()),
        ] {
            c.validate().unwrap();
        }
    }
}
