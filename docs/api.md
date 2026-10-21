# API reference

Base URL: `http://127.0.0.1:8080/api` (set with the `HOST` / `PORT` environment variables). In development the Vite server proxies `/api`, including WebSocket upgrades. The machine-readable specification is [`openapi.yaml`](openapi.yaml), also served at `GET /api/openapi.yaml`.

All bodies are JSON with snake_case fields and SI units. Shapes are defined in `apps/web/src/types/api.ts`, which mirrors the Rust structs.

## Errors

```json
{ "error": { "code": "validation_failed", "message": "…", "details": [ { "field": "robot.wheel_radius", "message": "must be greater than 0 (got -0.01)" } ] } }
```

| Status | code | When |
|---|---|---|
| 400 | `invalid_json`, `bad_request` | malformed body, wrong types, bad id, bad query |
| 404 | `not_found` | unknown simulation or route |
| 409 | `invalid_state_transition` | e.g. pausing a `ready` simulation |
| 415 | `unsupported_media_type` | missing JSON content type |
| 422 | `validation_failed` | semantic validation (ranges, geometry, cross-field rules) |
| 500 | `internal_error` | worker task failure |

## Endpoints

| Method & path | Description |
|---|---|
| `GET /health` | `{status, engine_version, uptime_s, simulations}` |
| `GET /config/default` | Default `SimulationConfig` |
| `POST /config/validate` | `{valid, issues[]}` (always 200 for well-formed JSON) |
| `POST /analysis/feasibility` | Static analysis + sampled geometry (`FeasibilityReport`) |
| `POST /analysis/cross-section` | `{robot, diameter, lateral_offset?, safety_margin?}` → `CrossSectionView` |
| `GET /experiments/presets` | Experiments A–F, B2, E2 |
| `POST /experiments/compare` | `{config, controllers?}` → `{scenario_hash, name, report, run_ids[], runs[]}` |
| `GET /simulations` | Summaries of stored simulations (max 64; oldest finished ones evicted) |
| `POST /simulations?playback_speed=` | Create (state `ready`) → 201 `StatusResponse` |
| `DELETE /simulations/{id}` | Delete (cancels a running one) → 204 |
| `POST /simulations/{id}/start` | `ready → running`; optional body `{playback_speed}` |
| `POST /simulations/{id}/pause` | `running → paused` |
| `POST /simulations/{id}/resume` | `paused → running`; optional `{playback_speed}` |
| `POST /simulations/{id}/stop` | `ready/running/paused → cancelled` |
| `POST /simulations/{id}/reset` | Any → `ready` with the initial state |
| `POST /simulations/{id}/run` | Run to completion as fast as possible → `SimulationResults` |
| `PUT /simulations/{id}/playback` | `{playback_speed}` (0.05–1000 simulated s per wall s) |
| `GET /simulations/{id}/status` | `StatusResponse` (snapshot + id + playback speed) |
| `GET /simulations/{id}/telemetry?from=&stride=&format=json\|csv` | Telemetry page or CSV |
| `GET /simulations/{id}/results` | Configuration, metrics, events, telemetry, report |
| `GET /simulations/{id}/ws` | WebSocket stream |

## WebSocket protocol

Messages from server to client, tagged by `type`:

```json
{ "type": "telemetry", "from": 120, "samples": [ { "t": 2.4, "x": …, … } ] }
{ "type": "events",    "events": [ { "kind": "safety_clearance", "severity": "warning", … } ] }
{ "type": "snapshot",  "id": "…", "playback_speed": 10, "snapshot": { "status": "running", "time": 2.4, … } }
```

- `from` is the index of the first sample in the batch. `from = 0` after a reset means the client should clear its buffer.
- A snapshot is sent on every runner tick (about 30 Hz) and as a 1 s heartbeat.
- Commands go through REST; client messages on the socket are ignored.

## Telemetry flags

`flags` is a bitmask. Bit *i* corresponds to `ViolationKind::ALL[i]`:

| Bit | Kind |
|---|---|
| 0 | collision |
| 1 | safety_clearance |
| 2 | contact_angle |
| 3 | wheel_outside_pipe |
| 4 | step_not_climbable |
| 5 | wheel_speed_saturation |
| 6 | torque_saturation |
| 7 | traction_limit |
| 8 | tipping_risk |
| 9 | stall |
| 10 | numerical_failure |
| 11 | timeout |

Two further bits are not violations: bit 16 means the controller output was saturated, and bit 17 means the wheel command was rate-limited.

## Task management

- Live runs use a Tokio task per simulation. It holds the simulation mutex only while stepping, and each tick has a 20 ms CPU budget.
- "Run instantly", comparisons, feasibility analysis and simulation construction run on `spawn_blocking`, so the async reactor is never blocked.
- Stop and delete set a cancellation flag that is polled every 256 steps.
