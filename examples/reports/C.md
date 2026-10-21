## Controller comparison – C – Gradual transition 250 → 190 mm

_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._

All runs use the same scenario (hash `b0473d2077dbe9b8`): identical pipeline, robot, reference, initial conditions, disturbances and seed.

| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
| Kinematic baseline (Kanayama) | completed | 3.26 mm | 12.08 mm | 2.60 mm | 10.00 mm | 0.52° | 16.56 mm | 0 | 3.59 J | 20.38 s |
| PID tracking (fixed gains) | completed | 3.00 mm | 11.28 mm | 2.30 mm | 10.00 mm | 0.70° | 16.56 mm | 0 | 3.90 J | 20.50 s |
| Gain-scheduled PID | completed | 3.05 mm | 11.37 mm | 2.38 mm | 10.00 mm | 0.71° | 16.56 mm | 0 | 3.93 J | 20.50 s |

### Observations (derived from the table)

- Lowest position RMSE among completed runs: PID tracking (fixed gains) (3.00 mm), 8.0 % lower than the kinematic baseline.
- Lowest cross-track RMSE among completed runs: PID tracking (fixed gains) (2.30 mm), 11.5 % lower than the kinematic baseline.
- Lowest maximum cross-track error among completed runs: tie between Kinematic baseline (Kanayama), PID tracking (fixed gains), Gain-scheduled PID (10.00 mm).
- Lowest mechanical energy among completed runs: Kinematic baseline (Kanayama) (3.59 J).
- No run collided with the pipe wall.

Differences reflect this specific scenario and parameter set; they are not a general ranking of the control methods.

