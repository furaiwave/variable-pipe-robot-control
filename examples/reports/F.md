## Controller comparison – F – Controller comparison

_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._

All runs use the same scenario (hash `1645680fd70cb8b1`): identical pipeline, robot, reference, initial conditions, disturbances and seed.

| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
| Kinematic baseline (Kanayama) | completed | 6.74 mm | 19.69 mm | 6.38 mm | 18.35 mm | 0.92° | 12.68 mm | 3 | 14.58 J | 33.69 s |
| PID tracking (fixed gains) | completed | 3.84 mm | 17.15 mm | 3.48 mm | 15.72 mm | 0.99° | 12.91 mm | 0 | 14.95 J | 32.16 s |
| Gain-scheduled PID | completed | 3.94 mm | 17.54 mm | 3.59 mm | 15.96 mm | 0.93° | 12.82 mm | 0 | 15.23 J | 32.17 s |

### Observations (derived from the table)

- Lowest position RMSE among completed runs: PID tracking (fixed gains) (3.84 mm), 43.0 % lower than the kinematic baseline.
- Lowest cross-track RMSE among completed runs: PID tracking (fixed gains) (3.48 mm), 45.4 % lower than the kinematic baseline.
- Lowest maximum cross-track error among completed runs: PID tracking (fixed gains) (15.72 mm), 14.4 % lower than the kinematic baseline.
- Lowest mechanical energy among completed runs: Kinematic baseline (Kanayama) (14.58 J).
- No run collided with the pipe wall.

Differences reflect this specific scenario and parameter set; they are not a general ranking of the control methods.

