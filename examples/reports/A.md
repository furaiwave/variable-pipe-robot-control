## Controller comparison – A – Constant-diameter pipeline

_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._

All runs use the same scenario (hash `a0d9571bff52b427`): identical pipeline, robot, reference, initial conditions, disturbances and seed.

| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
| Kinematic baseline (Kanayama) | completed | 2.83 mm | 12.08 mm | 2.26 mm | 10.00 mm | 0.45° | 21.52 mm | 0 | 3.36 J | 27.04 s |
| PID tracking (fixed gains) | completed | 2.60 mm | 11.28 mm | 2.00 mm | 10.00 mm | 0.61° | 20.88 mm | 0 | 3.67 J | 27.17 s |
| Gain-scheduled PID | completed | 2.66 mm | 11.37 mm | 2.07 mm | 10.00 mm | 0.62° | 20.98 mm | 0 | 3.69 J | 27.17 s |

### Observations (derived from the table)

- Lowest position RMSE among completed runs: PID tracking (fixed gains) (2.60 mm), 8.1 % lower than the kinematic baseline.
- Lowest cross-track RMSE among completed runs: PID tracking (fixed gains) (2.00 mm), 11.5 % lower than the kinematic baseline.
- Lowest maximum cross-track error among completed runs: tie between Kinematic baseline (Kanayama), PID tracking (fixed gains), Gain-scheduled PID (10.00 mm).
- Lowest mechanical energy among completed runs: Kinematic baseline (Kanayama) (3.36 J).
- No run collided with the pipe wall.

Differences reflect this specific scenario and parameter set; they are not a general ranking of the control methods.

