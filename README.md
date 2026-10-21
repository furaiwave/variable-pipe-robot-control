# Variable-Pipe Robot Control

**Розробка системи керування переміщенням колісного робота в трубопроводах зі змінним прохідним перерізом**
*Development of a control system for the movement of a wheeled robot inside pipelines with variable cross-sections* — software for a bachelor's thesis.

The application simulates a small skid-steer inspection robot driving through a pipeline. The pipeline can have reducers, sudden steps, bends, inclines and internal restrictions. The application lets you:

- configure the pipe and the robot;
- choose and tune a trajectory-tracking controller;
- run a deterministic simulation and watch it live;
- analyse and export the results;
- compare controllers under identical conditions.

All numbers come from the implemented model. Nothing is generated randomly or hard-coded. All results are **simulation results of a planar kinematic / quasi-static model**, not physical measurements.

## Architecture

```
React + TypeScript (apps/web) ──REST + WebSocket──▶ Axum API (crates/api-server) ──▶ Rust engine
   UI, forms, canvas, charts                          task runner, validation          (owns all state)
```

| Crate / app | Responsibility |
|---|---|
| `crates/robot-core` | SI math primitives, validation, robot model, differential-drive kinematics, RK4, motor/force dynamics, robot envelope |
| `crates/pipeline-geometry` | Pipeline segments (straight / transition / bend + restrictions), arc-length parametrisation, projection, sampling, continuity and self-overlap validation |
| `crates/control-algorithms` | Kanayama kinematic baseline, PID tracking (anti-windup), gain-scheduled PID, wheel-command saturation stage |
| `crates/simulation-engine` | Quasi-3D clearance model, static feasibility analysis, reference generator, fixed-step loop and state machine, telemetry, metrics, experiments A–F, reports, `pipesim` CLI, Criterion benchmarks |
| `crates/api-server` | REST + WebSocket API, paced real-time runners, typed errors, OpenAPI document |
| `apps/web` | React 19, Vite, Tailwind 4, shadcn/ui, Zustand, React Hook Form + Zod, Recharts, Canvas pipe view |

Details: [docs/architecture.md](docs/architecture.md).

## Features

| Feature | Status |
|---|---|
| Pipeline editor: straight, gradual transition (linear/smooth), sudden steps, circular bends, inclination, narrow passages, internal restrictions, per-segment clearance requirement, validation | Fully implemented |
| Robot configuration (dimensions, wheels, mass, CoM, limits, friction, motor response, sensor noise), schematic and engine-computed cross-section | Fully implemented |
| Differential-drive kinematics and RK4 integration | Fully implemented |
| Motor lag, acceleration, torque and traction limits | Simplified (quasi-static forces, no wheel inertia or electrical dynamics) |
| Clearance and collision checks | Simplified (quasi-3D: planar footprint plus circular cross-section, rigid chassis) |
| Step and ramp climbing check | Simplified (friction-cone statics) |
| Controllers: kinematic baseline, PID with anti-windup, gain-scheduled PID | Fully implemented |
| Simulation lifecycle (start / pause / resume / stop / reset / run instantly), playback speed, live WebSocket telemetry | Fully implemented |
| Static (pre-run) feasibility analysis, minimum feasible diameter | Fully implemented (within the geometry model) |
| Results: charts, metrics, events, generated reports, CSV/JSON export, JSON import, multi-run comparison | Fully implemented |
| Predefined experiments A–F (+ B2, E2 failure cases) | Fully implemented |
| Adaptive control with on-line parameter estimation | Not implemented (the scheduled controller is gain scheduling, and is labelled as such) |
| 3D dynamics, vertical bends, suspension, wheel slip kinematics | Not implemented (see [limitations](docs/limitations.md)) |
| Docker deployment | Not implemented (not verifiable in the development environment) |

## Requirements

- Rust ≥ 1.85 (developed with 1.99), Cargo
- Node.js ≥ 20 (developed with 24) and npm

## Install, run, test, build

```bash
# install frontend dependencies and build the API once
npm run setup

# run API (port 8080) + web UI (http://localhost:5173) together
npm run dev              # or: npm run dev:release (optimised engine)

# …or separately, in two terminals
cargo run --release -p api-server          # PORT / HOST env vars, default 127.0.0.1:8080
npm --prefix apps/web run dev              # Vite proxies /api (incl. WebSocket) to :8080

# tests
cargo test --workspace                     # Rust unit + integration tests (engine and HTTP API)
npm --prefix apps/web test                 # frontend unit/component tests (Vitest + RTL)
npm run test:integration                   # frontend ↔ real Rust server (spawned automatically)

# quality
cargo clippy --workspace --all-targets -- -D warnings
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck

# production build
npm run build                              # cargo build --release + vite build (apps/web/dist)

# benchmarks
cargo bench -p simulation-engine
```

### Headless / reproducible runs (CLI)

```bash
cargo run --release -p simulation-engine --bin pipesim -- presets examples/experiments
cargo run --release -p simulation-engine --bin pipesim -- compare F --out f.json
cargo run --release -p simulation-engine --bin pipesim -- run examples/experiments/b-sudden-reduction.json --csv b.csv
cargo run --release -p simulation-engine --bin pipesim -- analyze E
```

`examples/reports/*.md` contain the comparison reports produced by these commands for every preset.

## Main mathematical assumptions

- Planar unicycle kinematics: ẋ = v cos θ, ẏ = v sin θ, θ̇ = ω. Differential-drive mapping: v = r/2 (ω_R + ω_L), ω = r/L (ω_R − ω_L). Skid steering is treated as a differential drive with effective track L.
- Pose integration uses classical RK4 with the wheel speeds varying linearly within each step. The fixed step defaults to Δt = 5 ms.
- Each motor speed loop is a first-order lag with time constant τ_m, discretised exactly. Wheel accelerations are limited by motor torque and by friction μN.
- Resistances: gravity on the effective slope, rolling resistance C_rr·N, and skid-steer turning moment μ_lat Σ N_k |x_k|.
- The pipe is a circle of radius R(s) = D(s)/2 at each station. Wheels rest on the wall at the outer tread edge, and the chassis is a rigid plane fitted through the contacts. Clearance is R − ρ for every envelope point.
- A step is climbable if the contact angle β = acos(1 − h/r) ≤ atan μ + atan(μ W_rest/W_axle).
- Bends lie in the plane of motion. Inclination enters only through gravity and the elevation profile.

Full derivations: [docs/mathematical-model.md](docs/mathematical-model.md).

## Documentation

- [Architecture and data flow](docs/architecture.md)
- [Mathematical model](docs/mathematical-model.md)
- [Control algorithms](docs/control-algorithms.md)
- [Simulation and experimental methodology, metrics, tests, reproducibility](docs/simulation-methodology.md)
- [API reference](docs/api.md) and [OpenAPI document](docs/openapi.yaml)
- [Assumptions, limitations and future work](docs/limitations.md)

## Project structure

```
├── Cargo.toml                 Rust workspace
├── package.json               convenience scripts (dev, test, build)
├── scripts/dev.mjs            starts API + web together
├── crates/
│   ├── robot-core/            math, validation, robot, kinematics, dynamics, envelope
│   ├── pipeline-geometry/     segment model, resolved pipeline, projection
│   ├── control-algorithms/    controllers, PID, wheel command stage
│   ├── simulation-engine/     collision, analysis, reference, simulation, telemetry,
│   │                          metrics, experiments, report, bin/pipesim, benches, tests
│   └── api-server/            axum app, handlers, state/runner, ws, error, tests
├── apps/web/                  React frontend
│   ├── src/components/        ui (shadcn), common, charts, pipe-view, analysis, layout
│   ├── src/features/          dashboard, pipeline-editor, robot-config, controllers,
│   │                          simulation, results, experiments
│   ├── src/{hooks,lib,services,stores,types,test}/
│   └── tests/integration/     tests against the real Rust server
├── docs/                      thesis-oriented documentation + openapi.yaml
└── examples/                  experiment presets (JSON) and generated reports
```

## Licence

MIT.
