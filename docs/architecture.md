# System architecture

## 1. Goals and scope

**Goal.** Provide a software tool that designs and evaluates a motion-control system for a wheeled in-pipe robot. It must:

- model pipelines whose internal diameter changes (reducers, steps, restrictions) together with bends and inclines;
- predict whether a given robot can pass;
- implement several trajectory-tracking controllers;
- compare those controllers quantitatively under identical, reproducible conditions.

**Scope.** The model is a planar kinematic model with quasi-static force limits and a quasi-three-dimensional clearance check. Real hardware, sensors and a full 3D multibody simulation are out of scope (see `limitations.md`).

## 2. Requirements

### Functional

| ID | Requirement | Where |
|---|---|---|
| F1 | Edit a pipeline of connected segments (straight, transition, bend, incline, restriction) with validation | Pipeline editor, `pipeline-geometry` |
| F2 | Configure robot geometry, mass properties, limits, friction, motor response, sensor noise | Robot page, `robot-core::robot` |
| F3 | Select and parameterise ≥ 2 controllers; enable/disable them for comparison | Controllers page, `control-algorithms` |
| F4 | Run, pause, resume, stop, reset a deterministic simulation; change playback speed | Simulation page, `simulation-engine::simulation`, `api-server::state` |
| F5 | Detect collisions, insufficient clearance, unclimbable steps, stall and report *where* and *why* | `collision`, `simulation::check_constraints` |
| F6 | Predict feasibility before running (static analysis, minimum diameter) | `analysis` |
| F7 | Live telemetry, charts generated from telemetry | WebSocket, Results page |
| F8 | Metrics (RMSE, MAE, max, final error, velocity, wheel speed, distance, violations, duration) | `metrics` |
| F9 | CSV/JSON export, JSON import, multi-run comparison, generated reports | `lib/export.ts`, `report.rs` |
| F10 | Predefined experiments A–F | `experiments.rs` |

### Non-functional

- **Determinism.** The same configuration and seed produce bit-identical telemetry. This is enforced by a fixed step, a local PRNG and no wall-clock dependence (tested).
- **Separation of concerns.** All computation happens in Rust. The UI only presents data and sends commands.
- **Robustness.** Every input is validated on both client and server. NaN, infinity and impossible geometry are rejected. Numerical failures stop a run with a reported reason instead of crashing.
- **Responsiveness.** Integration is decoupled from rendering. Telemetry is buffered outside React state, and the UI re-renders at about 10 Hz.
- **Traceability.** Results embed the engine version, scenario hash, complete configuration and seed.

## 3. Components

```
┌───────────────────────── apps/web (React) ─────────────────────────┐
│ pages: Overview · Pipeline · Robot · Controllers · Simulation ·     │
│        Results · Experiments                                        │
│ stores (Zustand): config (persisted) · sim (live) · results         │
│ services/api.ts: typed REST client + WebSocket                      │
└──────────────┬───────────────────────────────▲─────────────────────┘
               │ JSON REST                      │ JSON WebSocket frames
┌──────────────▼───────────── crates/api-server ─┴─────────────────────┐
│ handlers.rs (validation, typed errors) · state.rs (registry, paced   │
│ runner tasks) · ws.rs (per-connection incremental telemetry)         │
└──────────────┬───────────────────────────────────────────────────────┘
┌──────────────▼──────────── crates/simulation-engine ──────────────────┐
│ config · analysis · collision · reference · simulation · telemetry ·  │
│ metrics · experiments · report · rng                                   │
├───────────────┬─────────────────────┬─────────────────────────────────┤
│ robot-core    │ pipeline-geometry   │ control-algorithms               │
└───────────────┴─────────────────────┴─────────────────────────────────┘
```

Crate dependencies are acyclic: `robot-core` ← `pipeline-geometry`, `robot-core` ← `control-algorithms`; all three ← `simulation-engine` ← `api-server`.

## 4. Data flow

1. **Configuration.** On first load the UI fetches `GET /config/default` and `GET /experiments/presets`. These provide the default parameters of every controller, so Rust stays the single source of default values. The configuration is persisted in `localStorage`.
2. **Editing.** Forms validate with Zod in display units (mm, °) and convert once to SI. The pipeline editor calls `POST /analysis/feasibility` (debounced), and the engine returns the sampled geometry, profiles, steps and issues. The canvas draws this geometry, so the drawing always matches the model the engine uses.
3. **Simulation.** `POST /simulations` validates the request and creates a `Simulation` in state `Ready`. `start` spawns a runner task. Every 33 ms it advances simulated time by *playback speed × elapsed wall time*, running whole fixed steps within a CPU budget, and then notifies subscribers.
4. **Streaming.** Each WebSocket connection keeps its own "samples sent" counter and sends `telemetry` batches (`from` index), `events` lists and `snapshot` frames. A reset shows up as `from = 0`. Slow clients receive larger batches instead of losing data.
5. **Rendering.** Telemetry is appended to a module-level buffer. The canvas polls it every animation frame, while React components see a version counter flushed at about 10 Hz.
6. **Results.** When a terminal state is reached, the UI fetches `GET /simulations/{id}/results`: configuration, metrics, events, telemetry and the generated report. Comparisons use `POST /experiments/compare`, which runs every controller to completion on a blocking worker thread.

## 5. Simulation state machine

```
          start            pause
  Ready ─────────▶ Running ──────▶ Paused
    ▲                │  ▲ resume     │
    │ reset (any)    │  └────────────┘
    │                ├──▶ Completed   (goal reached and settled)
    │                ├──▶ Failed      (fatal violation, numerical failure, timeout)
    └── stop ────────┴──▶ Cancelled   (from Ready/Running/Paused)
```

Invalid transitions return `409 invalid_state_transition`.

## 6. Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Engine | Rust | Deterministic, fast numerics, strong typing of the model |
| HTTP | Axum 0.8 + Tokio | Async server with WebSocket support; long runs on `spawn_blocking` |
| Serialisation | Serde (snake_case JSON) | Identical field names in Rust and TypeScript |
| Frontend | React 19, Vite 8, TypeScript (strict) | Required stack |
| UI kit | Tailwind 4 + shadcn/ui (Radix) + Lucide | Accessible primitives, consistent styling |
| State | Zustand | Small, allows non-reactive buffers for telemetry |
| Forms | React Hook Form + Zod | Declarative validation mirroring Rust ranges |
| Plots | Recharts; Canvas 2D for the pipe view | Charts from telemetry; Canvas for thousands of points at 60 fps |
