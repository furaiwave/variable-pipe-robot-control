# Assumptions, limitations and future work

This software is a **simulation study**. No result has been validated against physical experiments, and the default robot parameters are illustrative assumptions, not measured hardware data. Do not read the outputs as hardware-level predictions.

## Modelling assumptions and limitations

| Area | Assumption / limitation | Consequence |
|---|---|---|
| Kinematics | Planar unicycle; skid steering treated as differential drive with track L; no kinematic wheel slip | Lateral skidding and slip-induced odometry drift are not simulated |
| Geometry | Pipe cross-section is circular; bends lie in the plane of motion; inclination is a scalar slope; plan view uses true arc length | Vertical elbows, 3D routing and oval or damaged sections are not represented |
| Clearance | Quasi-3D: discrete envelope points, rigid chassis fitted to the wheel contacts, small-angle pitch/roll; contact at the outer tread edge; points between samples not checked | Conservative only to the point resolution; no suspension or compliance |
| Gravity | No self-centring in the pipe: lateral deviation is caused only by the controller and disturbances | A real robot on a curved floor may be pulled back towards the bottom |
| Dynamics | Quasi-static force balance; first-order motor lag; no wheel inertia, no electrical motor model, no left/right load transfer; Coulomb-type resistances smoothed with tanh | Transients during step climbing and impacts are not modelled |
| Step climbing | Friction-cone statics with a linear axle-load distribution; climbable steps are passed without a transient | Gives a feasibility criterion, not a climbing trajectory |
| Sensors | Gaussian pose noise; perfect wheel encoders (nominal radius) | No sensor fusion or localisation in a real pipe |
| Reference | Centreline path with a speed profile; no on-line planning | Controllers track, they do not plan around obstacles |
| Adaptive control | Gain scheduling only; no on-line estimation | Not MRAC or self-tuning |
| Collision response | Collision ends the run (or is counted); no contact forces | No bouncing or sliding along the wall |
| Persistence | Results are kept in memory (server: 64 simulations; browser: 40 runs) | Export JSON/CSV to keep results |
| Deployment | Local development setup; no authentication; permissive CORS | Not intended for public network exposure |
| Docker | Not provided | Run natively with Cargo and npm |

## Feature status

- **Fully implemented:** pipeline editor and validation, robot configuration, kinematics and RK4, three controllers, wheel-command stage, simulation lifecycle, WebSocket streaming, static feasibility analysis, metrics, reports, CSV/JSON export and import, experiments A–F, tests.
- **Simplified:** dynamics and actuator limits, clearance model (quasi-3D), step climbing, sensor noise.
- **Experimental:** gain-scheduling rule constants (c_ref, ℓ_κ, m_min, m_max) are heuristic choices, not the result of optimisation.
- **Not implemented:** 3D multibody dynamics, wheel slip kinematics, vertical bends, on-line parameter estimation, hardware-in-the-loop, Docker.

## Suggested future improvements

1. Validate the model on a physical prototype. Identify τ_m, μ, μ_lat and C_rr experimentally and compare trajectories.
2. Add 3D centreline geometry (vertical elbows) and a full rigid-body clearance check (signed distance to a swept torus).
3. Add a lateral gravity self-centring term and wheel slip (e.g. a brush or Pacejka-type longitudinal slip model) for skid steering.
4. Add a dynamic step-climbing model with suspension, and a power and energy budget for the batteries.
5. Implement true adaptive control (e.g. on-line estimation of wheel-radius mismatch or slip) and model-predictive control that respects the clearance constraints, and compare them against the existing baselines.
6. Add state estimation (odometry + IMU + pipe-wall ranging) instead of an ideal noisy pose.
7. Run parameter sweeps and Monte-Carlo studies over seeds; export summary statistics.
8. Persistent experiment storage and a container-based deployment.
