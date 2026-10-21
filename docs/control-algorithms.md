# Control algorithms

## 1. Common interface

```rust
trait Controller {
    fn compute(&mut self, input: &ControlInput) -> ControlOutput;   // desired (v, ω)
    fn saturation_feedback(&mut self, requested: Twist, applied: Twist, dt: f64);
    fn reset(&mut self);
}
```

`ControlInput` contains:
- the pose estimate (with sensor noise);
- the body twist measured from the wheel encoders;
- the reference state (pose, v_r, ω_r, s_r);
- local geometry: diameter, curvature, curvature ahead, inclination and lateral feasibility margin ahead;
- Δt.

`ControlOutput` contains the desired twist, the tracking error and diagnostics (gain multiplier, integral states, saturation flag).

**Tracking error.** Expressed in the robot frame, following Kanayama: [e_x, e_y]ᵀ = R(θ)ᵀ (p_r − p), e_θ = wrap(θ_r − θ).

### Wheel-command stage (shared by all controllers)

1. Clamp |v| ≤ v_max and |ω| ≤ ω_max.
2. Inverse kinematics: ω_R = (v + ωL/2)/r, ω_L = (v − ωL/2)/r.
3. If max |ω_w| > ω_w,max, scale both wheels by the same factor. This preserves the commanded curvature κ = ω/v.
4. Rate-limit the commands: |Δω_w| ≤ α_max Δt.

The twist actually applied is fed back to the controller (`saturation_feedback`) for anti-windup. Every flag is recorded in the telemetry.

## 2. Kinematic baseline (Kanayama)

Control law from Kanayama, Kimura, Miyazaki and Noguchi, "A stable tracking control method for an autonomous mobile robot", IEEE ICRA 1990:

```
v = v_r cos e_θ + K_x e_x
ω = ω_r + v_r (K_y e_y + K_θ sin e_θ)
```

It combines reference feed-forward with proportional feedback and has no integral action. A constant disturbance therefore leaves a steady-state offset. For example, a yaw drift d caused by wheel-radius mismatch gives e_y ≈ d/(v_r K_y). Defaults: K_x = 1.5 s⁻¹, K_y = 50 m⁻², K_θ = 10 m⁻¹. For small errors at v_r = 0.15 m/s the lateral dynamics have ω_n = v_r √K_y ≈ 1.06 rad/s and ζ = K_θ/(2√K_y) ≈ 0.71.

## 3. PID tracking controller (fixed gains)

```
trajectory mode:  v = v_r cos e_θ + PID_x(e_x)
velocity mode:    v = v_r + PID_v(v_r − v_meas)
lateral:          ω = ω_r + PID_c(e_c),   e_c = e_y cos e_θ + l_a sin e_θ
```

e_c is the signed distance of a look-ahead point (l_a in front of the robot) from the reference path line. With proportional action only and small errors the lateral loop is ë + K_p l_a ė + K_p v e = 0. It is stable for K_p, l_a, v > 0, with ω_n = √(K_p v) and ζ = (l_a/2)√(K_p/v).

**Discrete PID** (`pid.rs`):

```
u_unsat = K_p e + I + K_d ḋ_f
u       = clamp(u_unsat, ±u_max)                              (output saturation)
I      ← clamp(I + Δt (K_i e + K_t (u − u_unsat)), ±I_max)    (back-calculation anti-windup + clamp)
ḋ_f    ← ḋ_f + Δt/(T_f + Δt) · ((e − e_prev)/Δt − ḋ_f)        (filtered derivative; 0 on first sample)
```

- Downstream saturation in the wheel stage is also back-calculated: I += K_t Δt (u_applied − u).
- I is stored in output units, so changing the gains at run time does not cause a jump in the output (bumpless).
- Invalid Δt (≤ 0, NaN, ∞) leaves the state untouched and returns only the clamped P term. A non-finite error returns 0.

**Defaults.**
- Lateral loop: K_p = 8, K_i = 2, K_d = 0.5, output ±2 rad/s, I_max = 0.5, T_f = 0.05 s, K_t = 2 s⁻¹.
- Look-ahead: l_a = 0.15 m.
- Longitudinal loop: K_p = 1.5, K_i = 0.3, output ±0.15 m/s.

## 4. Gain-scheduled PID

This controller has the same structure as §3, but its lateral gains are recomputed every step from explicit rules:

```
σ   = 1 − clamp(c_m / c_ref, 0, 1)            c_m: min lateral feasibility margin ahead
κ_n = clamp(|κ_ahead| · ℓ_κ, 0, 1)             κ_ahead: max |curvature| over the robot length ahead
m*  = m_min + (m_max − m_min) · max(σ, κ_n)
m  ← m + Δt/(T_s + Δt) (m* − m)               (first-order filter → bumpless)
K_p = m K_p0,  K_i = m K_i0,  K_d = √m K_d0
```

Defaults: c_ref = 30 mm, ℓ_κ = 0.3 m, m_min = 0.6, m_max = 2.5, T_s = 0.2 s.

**Rationale.**
- In wide straight sections the multiplier is below 1. This reduces control effort and sensitivity to noise.
- In narrow passages and bends the multiplier rises. This increases ω_n and, with a fixed l_a, ζ ∝ √K_p as well, so cross-track errors shrink where the lateral margin is small.

**Classification.** This is **gain scheduling** on scheduling variables known in advance: the pipeline geometry from the static analysis. No plant parameters are estimated on-line, so it is *not* model-reference or self-tuning adaptive control, and it carries no claim of optimality. The fixed-gain PID of §3 with identical base gains is its baseline.

## 5. Observed behaviour (simulation, generated reports in `examples/reports`)

All values are from the implemented model with default parameters and identical scenarios. They describe this parameter set only, not a general ranking of the methods.

| Experiment | Kinematic | PID | Gain-scheduled |
|---|---|---|---|
| A straight, 10 mm initial offset — cross-track RMSE | 2.26 mm | 2.00 mm | 2.07 mm |
| D S-bend — cross-track RMSE / max | 1.11 / 2.95 mm | 1.32 / 3.80 mm | **0.62 / 1.74 mm** |
| E narrow passage (D = 158 mm) — min clearance, violations | 1.13 mm, 3 | 1.13 mm, 3 | 1.14 mm, 3 |
| F mixed line, +3 % wheel mismatch, noise — cross-track RMSE | 6.38 mm (3 contact-angle violations) | **3.48 mm** (0) | 3.59 mm (0) |

- Integral action (PID, gain-scheduled) roughly halves the cross-track RMSE caused by the unmodelled wheel-radius mismatch.
- Gain scheduling helps most in bends (D).
- In E all controllers violate the soft contact-angle and safety-clearance limits, because the passage is below the *recommended* diameter. The run still succeeds because it is above the *geometric* limit.
