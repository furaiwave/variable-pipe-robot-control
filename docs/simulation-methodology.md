# Simulation and experimental methodology

## 1. Fixed-step loop

Each call to `Simulation::step()` advances simulated time by exactly Δt and performs the following steps (`crates/simulation-engine/src/simulation.rs`):

1. **Validate the state.** A non-finite pose or wheel speed → `Failed(numerical_failure)`. An infeasible initial pose fails at t = 0.
2. **Local geometry** at the robot station: diameter, curvature, curvature ahead, inclination, and the lateral margin ahead (from the precomputed margin profile).
3. **Clearance / feasibility of the current pose.** This report is cached from the end of the previous step.
4. **Reference state** r(t).
5. **Controller.** Uses the noisy pose estimate and the encoder twist.
6. **Wheel-command stage.** Velocity clamps, curvature-preserving wheel-speed scaling, rate limit. Saturation is fed back to the controller.
7. **Motor lag, then torque / traction limits** at the effective slope.
8. **Integration.** Wheel speeds exactly, pose by RK4; then t += Δt and the reference advances.
9. **Constraint checks at the new pose.**
   - Fatal: wheel outside the section, collision (fatal if `stop_on_collision`), unclimbable step or ramp, stall.
   - Warnings: safety clearance, contact angle, wheel-speed / torque / traction saturation, axle lift-off.
10. **Telemetry and metrics.** Metrics are accumulated every step. A sample is stored every `telemetry_interval`, plus the final state. Violations are recorded as edge-triggered episodes, each with start/end time and station and its peak value.
11. **Termination.**
    - On a fatal violation: `Failed`, with a `FailureInfo` giving the kind, message, time, station, (x, y), value and limit.
    - `Completed` when the reference has stopped at the goal, the robot is within 5 cm of it, and it has settled (|e| < 2 mm and |v| < 2 mm/s, or at most 3 s after the reference stopped).
    - `Failed(timeout)` at `max_duration`.

Physics never depends on wall-clock time. The API runner only decides *how many* fixed steps to run per 33 ms tick (playback speed × elapsed wall time). "Run instantly" and comparisons run to completion on a worker thread.

**Goal and start.** Start s₀ = L_env/2 + 2 cm (robot fully inside); goal s_goal = L_total − L_env/2 − 2 cm.

## 2. Static (pre-run) analysis

`POST /analysis/feasibility` and `pipesim analyze` evaluate an ideal robot, centred and aligned, at stations along [s₀, s_goal]. Extra stations are added where the robot front, centre or rear meets a step. Outputs:
- clearance, lateral margin, contact-angle and ramp-angle profiles;
- a climbability check for each step;
- climbable slope;
- geometric and recommended minimum diameters;
- issue intervals.

The run is **feasible** if no hard constraint is violated (collision, wheel outside, unclimbable step or ramp, slope too steep). Safety-clearance and contact-angle issues are reported as warnings. Passing this analysis is necessary but not sufficient: tracking errors during the run can still violate constraints, and the dynamic simulation checks for that.

## 3. Performance metrics

These are computed over **all** integration steps k = 1..N, independently of the telemetry decimation:

| Metric | Definition |
|---|---|
| Position error e_p | ‖p − p_ref‖ (reference at the same time instant) |
| Cross-track error e_lat | d − d_ref (lateral offset from the reference path) |
| Heading error | wrap(θ_ref − θ) |
| RMSE / MAE / max / final | √(Σe²/N), Σ\|e\|/N, max\|e\|, \|e_N\| |
| Average linear velocity | Σ v_k / N |
| Max. wheel speed | max\|ω_wheel\| |
| Total distance | Σ \|v_k\| Δt |
| Progress | final station − start station (and ratio to the required path) |
| Min. clearance | min over steps (with its station) |
| Max. contact angle | max over steps |
| Max. torque (delivered / demand) | per motor |
| Mechanical energy | Σ n_side (\|τ_L ω_L\| + \|τ_R ω_R\|) Δt |
| Saturation ratios | share of steps with wheel-command, torque or traction limiting |
| Collisions | number of collision episodes |
| Failed feasibility checks | episodes of collision, safety clearance, contact angle, wheel outside, step |
| Constraint violations | all episodes (+ the terminal failure if it is not an episode) |
| Simulated duration / execution time | simulated seconds / wall-clock ms spent stepping |

## 4. Experimental methodology

Every experiment is a complete `SimulationConfig` (`crates/simulation-engine/src/experiments.rs`, exported to `examples/experiments/*.json`). For each one:

1. **Initial conditions.** Deterministic start station, lateral offset and heading error.
2. **Pipeline geometry.** Fixed segment list.
3. **Robot parameters.** The illustrative default robot, unless stated otherwise.
4. **Controller settings.** Default parameters of all three controllers.
5. **Identical runs.** The same configuration is run once per controller (`compare_controllers`), and the reports confirm that all runs share one scenario hash.
6. **Metrics.** The same metrics are computed for every run.
7. **Saved artefacts.** Configuration and results are exported as JSON, telemetry as CSV.
8. **Report.** Charts and an automatically generated report summarise the run. Statements in the report are only comparisons that follow directly from the numbers.

| ID | Scenario | Purpose |
|---|---|---|
| A | Straight DN250, 4 m, 10 mm initial offset | Baseline tracking |
| B | Sudden reduction 250 → 230 mm (13 mm step) | Passing a climbable step |
| B2 | Sudden reduction 250 → 200 mm (32 mm step) | Detecting an impassable step and its position |
| C | Linear reducer 250 → 190 mm over 0.8 m | Continuously shrinking clearance |
| D | S-bend in DN220 (+90° R0.5, −90° R0.35) | Bends |
| E | Reducer to D_geo,min + 4 mm (computed: 158 mm) | Near the feasibility limit |
| E2 | D_geo,min − 4 mm (computed: 150 mm) | Infeasible passage detected before success |
| F | Bends, reducer, 3 mm weld ring, expander, 10° incline; +3 % wheel mismatch, 15 mm/5° initial error, noise σ = 1 mm / 0.5°, seed 2024 | Controller comparison |

Results produced by the engine are kept in `examples/reports/`. A summary is in `control-algorithms.md` §5. All of them are **simulation outputs**.

## 5. Reproducibility

- **Determinism.** Fixed Δt, no wall-clock input, a local SplitMix64 PRNG with an explicit seed, and deterministic iteration order. Integration tests check that runs with the same seed are bit-identical, that a different seed differs, and that reset followed by a re-run reproduces the telemetry exactly.
- **Embedded metadata.** Every exported result carries the engine version, scenario hash (FNV-1a over all scenario inputs except the controller) and the full configuration.
- **Re-running.** `pipesim run <exported.json>` accepts either a configuration or an exported preset.
- **Results versus engine versions.** Results are reproducible for the same engine version; the floating-point evaluation order is fixed by the code.

## 6. Tests

| Area | Tests |
|---|---|
| Kinematics | forward/inverse round trip, textbook formula, straight line, circular motion vs closed form, zero velocity, in-place rotation, RK4 convergence order (`robot-core`) |
| Dynamics | unsaturated requests, holding torque on a slope, slide-back beyond traction, torque limiting, exact motor lag |
| Robot model | defaults valid, invalid values, inconsistent limits, axle-load sums and uphill shift, climb angle |
| Geometry | continuity at joints, projection (incl. bends, beyond ends), diameter transitions and steps, smooth profile, invalid geometry, self-overlap, JSON round trip |
| Control | PID P/I/D response, plant convergence with integral action, clamping, anti-windup, integral limit, invalid Δt; Kanayama feed-forward and steering sign; PID removes a constant disturbance; schedule rules; wheel-speed saturation preserves curvature; velocity clamps; rate limit; NaN commands; config serde/validation |
| Engine | analytic clearance, roll and contact angle, small-pipe collision, reduction ahead, bends, lateral margin; minimum diameter; step / ramp / slope checks; cross-section; reference profile and bend slow-down; metrics; CSV; event episodes; deterministic RNG |
| Engine end to end | default completes, straight-line speed, determinism with noise, state transitions, reset reproduction, B2 step failure location, E/E2 passage limits, distinguishable controllers, stall on 40° incline, invalid config, infeasible initial pose, all presets terminate without numerical failure |
| HTTP API | health/OpenAPI/404, 422 details, 400 invalid JSON, full lifecycle incl. 409 transitions, pause holds time, playback, telemetry paging and CSV, reset + deterministic re-run, delete; stop/cancel; presets + feasibility + compare; cross-section |
| Frontend unit/component | Zod schemas (robot, segment, settings), templates, CSV/JSON export and import, decimation, scenario key, flags, API client errors (422/409/network/non-JSON/204), store segment editing, WebSocket message handling, robot form editing/validation/server errors, segment form commit/validation/restrictions, simulation state display, failure reporting, metrics table, safe Markdown |
| Frontend ↔ Rust integration | real server spawned: health/config/presets, 422 mapping, live WebSocket run to completion, pause/playback/resume/stop, deterministic re-run, comparison (distinguishable results), feasibility; every page rendered with engine data |

Run them with `cargo test --workspace`, `npm --prefix apps/web test` and `npm run test:integration`.
