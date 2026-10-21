## Controller comparison – E – Narrow passage near the feasibility limit

_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._

All runs use the same scenario (hash `5e345916820ad3f9`): identical pipeline, robot, reference, initial conditions, disturbances and seed.

| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
| Kinematic baseline (Kanayama) | completed | 2.54 mm | 11.43 mm | 2.30 mm | 10.00 mm | 0.50° | 1.13 mm | 3 | 4.94 J | 33.19 s |
| PID tracking (fixed gains) | completed | 2.18 mm | 11.08 mm | 1.90 mm | 10.00 mm | 0.64° | 1.13 mm | 3 | 5.23 J | 33.31 s |
| Gain-scheduled PID | completed | 2.22 mm | 11.13 mm | 1.95 mm | 10.00 mm | 0.64° | 1.14 mm | 3 | 5.23 J | 33.31 s |

### Observations (derived from the table)

- Lowest position RMSE among completed runs: PID tracking (fixed gains) (2.18 mm), 14.2 % lower than the kinematic baseline.
- Lowest cross-track RMSE among completed runs: PID tracking (fixed gains) (1.90 mm), 17.2 % lower than the kinematic baseline.
- Lowest maximum cross-track error among completed runs: tie between Kinematic baseline (Kanayama), PID tracking (fixed gains), Gain-scheduled PID (10.00 mm).
- Lowest mechanical energy among completed runs: Kinematic baseline (Kanayama) (4.94 J).
- No run collided with the pipe wall.

Differences reflect this specific scenario and parameter set; they are not a general ranking of the control methods.

