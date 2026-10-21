## Controller comparison – D – Curved pipeline (S-bend)

_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._

All runs use the same scenario (hash `7b5999d45e2fc680`): identical pipeline, robot, reference, initial conditions, disturbances and seed.

| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
| Kinematic baseline (Kanayama) | completed | 2.06 mm | 7.93 mm | 1.11 mm | 2.95 mm | 0.45° | 15.21 mm | 0 | 11.12 J | 26.61 s |
| PID tracking (fixed gains) | completed | 2.15 mm | 7.89 mm | 1.32 mm | 3.80 mm | 0.55° | 15.13 mm | 0 | 11.36 J | 26.74 s |
| Gain-scheduled PID | completed | 1.80 mm | 7.84 mm | 0.62 mm | 1.74 mm | 0.37° | 15.15 mm | 0 | 10.99 J | 26.73 s |

### Observations (derived from the table)

- Lowest position RMSE among completed runs: Gain-scheduled PID (1.80 mm), 12.5 % lower than the kinematic baseline.
- Lowest cross-track RMSE among completed runs: Gain-scheduled PID (0.62 mm), 43.9 % lower than the kinematic baseline.
- Lowest maximum cross-track error among completed runs: Gain-scheduled PID (1.74 mm), 40.9 % lower than the kinematic baseline.
- Lowest mechanical energy among completed runs: Gain-scheduled PID (10.99 J), 1.1 % lower than the kinematic baseline.
- No run collided with the pipe wall.

Differences reflect this specific scenario and parameter set; they are not a general ranking of the control methods.

