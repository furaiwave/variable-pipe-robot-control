# Mathematical model

All quantities are in SI units: m, s, rad, kg, N, N·m. The tables below separate **theoretical assumptions** (A) from **implementation details** (I).

## 1. Coordinates

- The world frame is planar (x, y). The robot pose is (x, y, θ), and the reference point is the geometric centre of the wheel layout.
- The body frame has x pointing forward, u (or y) to the left and h upward from the wheel-contact plane.
- Path coordinates are (s, d): s is the arc length along the pipe centreline from the inlet, and d is the signed lateral offset (positive to the left of the travel direction). They are obtained by projecting a point onto the centreline (`Pipeline::project`).

## 2. Pipeline geometry

The pipeline is a chain of segments. Each segment starts at the end pose of the previous one, so the centreline is continuous in position and tangent (G¹) by construction.

| Segment | Centreline | Internal diameter D(t), t ∈ [0, ℓ] |
|---|---|---|
| Straight | p(t) = p₀ + t·(cos θ₀, sin θ₀) | D |
| Transition | as straight | D₀ + (D₁ − D₀)·w(t/ℓ), with w(u) = u (linear) or 3u² − 2u³ (smooth) |
| Bend (radius R_b, angle φ) | circle about c = p₀ + R_b·sgn(φ)·n₀, length ℓ = R_b·\|φ\| | D |

The local radius is R(s) = D(s)/2. A restriction of height h_r on [s_a, s_b] reduces it to R_eff(s) = R(s) − h_r. Where R_eff jumps (between segments, or at a restriction edge) there is a **step**. Steps are detected and stored with their left and right limits.

**Validation.** The checks include:
- positive finite lengths and diameters;
- R_b > D/2, so the inner wall of a bend does not self-intersect;
- |inclination| ≤ 60°;
- restrictions lie inside the segment, do not overlap, and are lower than 45 % of D;
- unique IDs;
- no wall overlap between distant parts of the pipe. Point pairs closer than π·R in arc length are skipped, because inside a valid bend their chord is ≥ 2R.

**Projection.** For a straight segment, t = (p − p₀)·u and d = (p − p₀)·n. For a bend, the angle about the centre gives t = R_b·φ and d = sgn(φ)·(R_b − |p − c|). The search is limited to segments within a window around the previous station, which keeps the result unambiguous where the pipe turns back on itself. Beyond the inlet and outlet the pipe is extended straight along the end tangents.

**Inclination (A).** Each segment has a scalar slope α. It enters the force balance (gravity) and the elevation profile z(s) = ∫ sin α ds. Bends are always in the plane of motion; vertical elbows are not modelled.

## 3. Robot kinematics

**Differential drive.** For skid steer, the wheels on one side are driven together:

```
v = (r_R ω_R + r_L ω_L) / 2            (= r/2 (ω_R + ω_L) for equal radii)
ω = (r_R ω_R − r_L ω_L) / L            (= r/L (ω_R − ω_L))
ω_R = (v + ωL/2)/r,   ω_L = (v − ωL/2)/r     (inverse, nominal radius)
```

- r: effective rolling radius.
- L: track width (distance between the left and right wheel mid-planes).
- r_L, r_R: actual radii. They differ only when a wheel-radius mismatch disturbance is configured. The controllers always assume the nominal r.

**Assumption (A).** Skid-steer slip is not modelled kinematically. Lateral skidding is represented only through the turning-resistance moment (§4), and L is used as the effective track.

**Unicycle model.** ẋ = v cos θ, ẏ = v sin θ, θ̇ = ω.

**Integration (I).** Within a step, wheel accelerations are held constant (zero-order hold), so v(t) and ω(t) are linear in t. The pose is integrated with classical RK4 using v(t₀), v(t₀ + Δt/2) and v(t₀ + Δt). Wheel speeds are integrated exactly. RK4 is 4th-order accurate in Δt; this is checked in a unit test where the error falls by more than 10× when Δt is halved. Straight-line and circular motion match the closed-form solutions to better than 1e−8 m. The model has no stiffness, because the motor lag is integrated by its exact exponential discretisation, so Δt is limited by accuracy rather than stability. The default is Δt = 5 ms; allowed values are 0.5–50 ms.

## 4. Simplified dynamics and actuator limits

1. **Speed loop.** Each side follows its command through a first-order lag, ω̇ = (ω_cmd − ω)/τ_m. Exactly discretised: ω(t + Δt) = ω_cmd + (ω − ω_cmd)·e^(−Δt/τ_m). The resulting acceleration is clamped to ±α_max.
2. **Required forces.** The requested wheel accelerations give requested body accelerations a and ε. The required forces are:

```
F_L + F_R = m a + m g sin α + C_rr m g cos α · tanh(v/0.01)
(F_R − F_L)·L/2 = I_z ε + M_r · tanh(ω/0.05),   M_r = μ_lat Σ_k N_k |x_k|
```

- I_z = m(L_env² + W_env²)/12 (uniform box).
- N_k: normal load on axle k (§6).
- x_k: axle position.
- tanh: a smooth sign that avoids chattering at rest.

3. **Limits.** Each side force is clamped to min(n_side τ_max / r, μ m g cos α / 2). Exceeding the torque limit raises *torque saturation*. Exceeding the friction limit raises *traction limit (wheel slip)*.
4. The accelerations produced by the clamped forces are applied. On a slope that is too steep, the robot therefore decelerates and slides back. A **stall watchdog** fails the run if the reference is more than 5 cm ahead and the robot has not advanced 5 mm within 3 s.

**Effective slope.** α_eff is the mean segment inclination under the wheel contacts plus the pitch of the chassis plane (§5). This makes the slope change gradually as the axles move onto an incline, and includes floor ramps caused by changes in diameter.

**Neglected (A).** Wheel rotational inertia, motor electrical dynamics, load transfer between the left and right sides, and suspension.

**Climbable slope** (static analysis):
- traction: tan α ≤ μ − C_rr;
- torque: n τ_max / r ≥ m g (sin α + C_rr cos α), solved by bisection.

## 5. Clearance and collision checking (quasi-3D)

The robot is represented by:

- **Contacts.** One per wheel, at the *outer* tread edge (x_k, ±(L + w)/2, 0). A cylindrical wheel resting inside a concave circular wall touches it at its outer edge.
- **Check points.**
  - The body box: top and bottom edges at 5 stations along each long side, which captures the inner flank in bends.
  - The upper half of every wheel rim on its outer face: 7 points from 0° to 180°.

For a pose:

1. Each contact is transformed to the world frame and projected to (s_i, d_i). If |d_i| ≥ R_eff(s_i) the wheel is outside the section, which is **fatal**. Otherwise the wall height is z_i = −√(R² − d_i²) and the contact angle is β_i = asin(|d_i|/R).
2. A least-squares plane z = z₀ + s_x·x + s_u·u is fitted through the contacts. This gives the rigid-chassis resting height, pitch = atan s_x and roll = atan s_u.
3. Each check point (x, u, h) is projected to (s, d). It is shifted laterally by −h·sin(roll) and lifted to z = z₀ + s_x x + s_u u + h cos(roll) cos(pitch). Its radial distance is ρ = √(d² + z²), and its clearance is c = R_eff(s) − ρ.
4. Results: the minimum clearance (negative means **collision**), the required clearance (the global safety margin, or the segment's own requirement if larger), the maximum contact angle, and the critical point.

The robot's **orientation and position in bends** are captured, because every point is projected individually onto the curved centreline. A **sudden reduction ahead** is seen by the front check points before the axle reaches it.

**Lateral feasibility margin.** This is the largest lateral shift δ of an aligned robot that keeps clearance ≥ required and β ≤ β_max. It is found by bisection on δ. A negative value (minus the deficit) means the station is inadmissible even when the robot is centred. The margin is used for gain scheduling and is shown in the profiles.

**Minimum feasible diameter** (straight pipe, centred robot, found by bisection):
- *geometric*: clearance ≥ 0 and wheels inside the section;
- *recommended*: additionally clearance ≥ safety margin and β ≤ β_max.

## 6. Axle loads and step climbing

**Axle loads.** A linear (elastic, equally stiff supports) load distribution is used:

```
N_k = W cos α · ( 1/n + x_k · x_eff / Σ x_j² ),   x_eff = x_CoM − h_CoM tan α
```

For two axles this reduces to exact statics. Climbing (α > 0) moves load rearwards. N_k ≤ 0 raises a *tipping risk* event.

**Step climbing** (quasi-static friction cone, derived here). Consider a front wheel of radius r pressed against a step edge of height h. The contact normal is tilted by β = acos(1 − h/r) from the vertical. The wheel is driven, so the edge can supply tangential friction up to μ N. The remaining axles can push with at most P ≤ μ W_rest. The wheel lifts off the floor when the edge reaction alone carries the axle load W_axle. Force balance at the limit (tangential force = μN) gives the push required:

```
P = W_axle · tan(β − atan μ)
```

Requiring P ≤ μ W_rest gives the climbable condition:

```
β ≤ β_max = atan μ + atan(μ · W_rest / W_axle),     h_max = r (1 − cos β_max)
```

For the default robot (μ = 0.6, equal axle loads) this gives β_max = 61.9° and h_max = 15.9 mm. The same criterion is applied to gradual wall ramps under a wheel, using the ramp angle as β.

**Rise at a wheel.** At lateral position d, the wall rises by Δz = √(R₁² − d²) − √(R₂² − d²) when the radius drops from R₁ to R₂. During simulation the check is triggered when the step edge comes within r·sin β (+ v·Δt) of the contact. Unclimbable steps and ramps are **fatal**. Climbable steps are passed without a dynamic transient (A).

## 7. Reference trajectory

The reference point moves along the centreline (optionally offset by d_r) with a speed profile limited by:
- cruise speed v_c;
- acceleration limit a_r;
- in bends, v ≤ k_b ω_max/|κ| and v(1 + |κ|L/2) ≤ 0.9 r ω_w,max, evaluated over the braking distance ahead;
- a stop at the goal: v ≤ √(2 a_r (s_goal − s)).

The reference yaw rate is ω_r = v κ/(1 − κ d_r). The reference does not depend on the controller.

## 8. Sensor noise

The controllers see a noisy pose estimate p̂ = p + N(0, σ²), produced by SplitMix64 + Box–Muller with a configurable seed. Wheel-encoder twist is computed with the nominal radius, so a wheel-radius mismatch is not observable from the encoders. The true pose is always used for metrics and constraints.
