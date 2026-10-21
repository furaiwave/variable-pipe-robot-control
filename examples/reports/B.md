## Controller comparison – B – Sudden diameter reduction 250 → 230 mm

_Generated automatically from **simulation** results of the implemented planar kinematic/quasi-static model. These are not physical laboratory measurements._

All runs use the same scenario (hash `3d9d2f421d740033`): identical pipeline, robot, reference, initial conditions, disturbances and seed.

| Controller | Outcome | Pos. RMSE | Pos. max | Cross-track RMSE | Cross-track max | Heading RMSE | Min clearance | Violations | Energy | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
| Kinematic baseline (Kanayama) | completed | 2.36 mm | 8.91 mm | 1.30 mm | 5.00 mm | 0.26° | 13.45 mm | 0 | 2.49 J | 20.38 s |
| PID tracking (fixed gains) | completed | 2.25 mm | 8.52 mm | 1.15 mm | 5.00 mm | 0.35° | 13.45 mm | 0 | 2.65 J | 20.50 s |
| Gain-scheduled PID | completed | 2.27 mm | 8.56 mm | 1.19 mm | 5.00 mm | 0.35° | 13.43 mm | 0 | 2.64 J | 20.50 s |

### Observations (derived from the table)

- Lowest position RMSE among completed runs: PID tracking (fixed gains) (2.25 mm), 4.9 % lower than the kinematic baseline.
- Lowest cross-track RMSE among completed runs: PID tracking (fixed gains) (1.15 mm), 11.5 % lower than the kinematic baseline.
- Lowest maximum cross-track error among completed runs: tie between Kinematic baseline (Kanayama), PID tracking (fixed gains), Gain-scheduled PID (5.00 mm).
- Lowest mechanical energy among completed runs: Kinematic baseline (Kanayama) (2.49 J).
- No run collided with the pipe wall.

Differences reflect this specific scenario and parameter set; they are not a general ranking of the control methods.

