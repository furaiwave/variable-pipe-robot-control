//! Reference trajectory generator.
//!
//! The reference point moves along the centreline (optionally offset
//! laterally by d_r) with a speed profile v_r(t) that respects:
//!
//! * the cruise speed v_c;
//! * an acceleration limit a_r (trapezoidal profile);
//! * a curvature limit in bends, v ≤ k_b ω_max / |κ| and the wheel-speed
//!   limit v (1 + |κ| L/2) ≤ 0.9 r ω_w,max, evaluated over the braking
//!   distance ahead so the reference slows down *before* a bend;
//! * a stop at the goal station: v ≤ √(2 a_r (s_goal − s)).
//!
//! The generator is independent of the controller, so every controller in a
//! comparison tracks exactly the same reference.

use crate::config::ReferenceConfig;
use control_algorithms::ReferenceState;
use pipeline_geometry::Pipeline;
use robot_core::{Pose2, RobotConfig, Vec2};

#[derive(Clone, Debug)]
pub struct ReferenceGenerator {
    cfg: ReferenceConfig,
    s: f64,
    v: f64,
    s_goal: f64,
    omega_max: f64,
    wheel_speed_cap: f64,
    half_track: f64,
    lookahead_extra: f64,
}

impl ReferenceGenerator {
    pub fn new(cfg: ReferenceConfig, robot: &RobotConfig, s_start: f64, s_goal: f64) -> Self {
        Self {
            cfg,
            s: s_start,
            v: 0.0,
            s_goal,
            omega_max: robot.max_angular_velocity,
            wheel_speed_cap: 0.9 * robot.wheel_radius * robot.max_wheel_speed,
            half_track: 0.5 * robot.track_width,
            lookahead_extra: 0.5 * robot.envelope_length(),
        }
    }

    pub fn station(&self) -> f64 {
        self.s
    }

    pub fn speed(&self) -> f64 {
        self.v
    }

    pub fn is_finished(&self) -> bool {
        self.s >= self.s_goal - 1e-9 && self.v <= 1e-9
    }

    /// Ratio ds/dσ between centreline and offset-path arc length.
    fn path_scale(&self, kappa: f64) -> f64 {
        let k = 1.0 - kappa * self.cfg.lateral_offset;
        if k > 0.05 { 1.0 / k } else { 20.0 }
    }

    pub fn state(&self, pipeline: &Pipeline) -> ReferenceState {
        let c = pipeline.centerline_pose(self.s);
        let p = c.position() + Vec2::from_angle(c.theta).perp() * self.cfg.lateral_offset;
        let kappa = pipeline.curvature(self.s);
        ReferenceState {
            pose: Pose2::new(p.x, p.y, c.theta),
            v: self.v,
            omega: self.v * kappa * self.path_scale(kappa),
            s: self.s,
        }
    }

    /// Speed limit imposed by curvature on [s, s + braking distance].
    fn curvature_limit(&self, pipeline: &Pipeline) -> f64 {
        let a = self.cfg.max_acceleration;
        let horizon = self.v * self.v / (2.0 * a) + self.lookahead_extra;
        let kappa = pipeline.max_abs_curvature(self.s, self.s + horizon);
        let mut v = self.cfg.cruise_speed.min(self.wheel_speed_cap);
        if kappa > 0.0 {
            v = v
                .min(self.cfg.bend_speed_factor * self.omega_max / kappa)
                .min(self.wheel_speed_cap / (1.0 + kappa * self.half_track));
        }
        v
    }

    pub fn advance(&mut self, pipeline: &Pipeline, dt: f64) {
        if dt <= 0.0 || self.is_finished() {
            return;
        }
        let a = self.cfg.max_acceleration;
        let remaining = (self.s_goal - self.s).max(0.0);
        let v_stop = (2.0 * a * remaining).sqrt();
        let target = self.curvature_limit(pipeline).min(v_stop);
        let v_new = (self.v + (target - self.v).clamp(-a * dt, a * dt)).max(0.0);
        let kappa = pipeline.curvature(self.s);
        self.s += 0.5 * (self.v + v_new) * dt * self.path_scale(kappa);
        self.v = v_new;
        if self.s >= self.s_goal || (remaining < 1e-4 && self.v < 1e-3) {
            self.s = self.s.min(self.s_goal);
            if self.s >= self.s_goal - 1e-4 {
                self.s = self.s_goal;
                self.v = 0.0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{bend, straight};
    use pipeline_geometry::PipelineConfig;

    #[test]
    fn trapezoidal_profile_reaches_goal_and_stops() {
        let p = Pipeline::new(PipelineConfig {
            name: "t".into(),
            segments: vec![straight("a", "", 3.0, 0.25)],
        })
        .unwrap();
        let robot = RobotConfig::default();
        let mut g = ReferenceGenerator::new(ReferenceConfig::default(), &robot, 0.2, 2.5);
        let dt = 0.005;
        let mut t = 0.0;
        let mut vmax: f64 = 0.0;
        while !g.is_finished() && t < 60.0 {
            g.advance(&p, dt);
            vmax = vmax.max(g.speed());
            t += dt;
        }
        assert!(g.is_finished());
        assert!((g.station() - 2.5).abs() < 1e-9);
        assert!((vmax - 0.15).abs() < 1e-9);
        // 2.3 m at 0.15 m/s plus accel/decel ramps (0.75 s each, half-speed) ≈ 16.08 s
        let expected = 2.3 / 0.15 + 0.15 / 0.2;
        assert!((t - expected).abs() < 0.1, "t = {t}, expected {expected}");
    }

    #[test]
    fn slows_down_in_tight_bend() {
        let p = Pipeline::new(PipelineConfig {
            name: "t".into(),
            segments: vec![
                straight("a", "", 2.0, 0.25),
                bend("b", "", 0.15, 90.0, 0.25),
                straight("c", "", 2.0, 0.25),
            ],
        })
        .unwrap();
        let robot = RobotConfig::default();
        let cfg = ReferenceConfig {
            cruise_speed: 0.3,
            ..Default::default()
        };
        let limit = cfg.bend_speed_factor * robot.max_angular_velocity * 0.15;
        let mut g = ReferenceGenerator::new(cfg, &robot, 0.2, 4.0);
        let mut max_in_bend: f64 = 0.0;
        for _ in 0..20_000 {
            g.advance(&p, 0.005);
            if g.station() > 2.0 && g.station() < 2.0 + 0.15 * std::f64::consts::FRAC_PI_2 {
                max_in_bend = max_in_bend.max(g.speed());
            }
        }
        assert!(
            max_in_bend > 0.0 && max_in_bend <= limit + 1e-9,
            "{max_in_bend} > {limit}"
        );
    }
}
