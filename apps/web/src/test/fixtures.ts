import raw from './fixtures.json'
import { paramsFromConfigs, type ControllerParams } from '@/stores/config-store'
import type { ControllerConfig, PerformanceMetrics, SimulationConfig, SimulationResults, TelemetrySample } from '@/types/api'

/** Default configuration exactly as served by the Rust engine (captured JSON). */
export const defaultConfig = (): SimulationConfig => structuredClone(raw.config) as SimulationConfig
export const controllerConfigs = (): ControllerConfig[] => structuredClone(raw.controllers) as ControllerConfig[]
export const controllerParams = (): ControllerParams => paramsFromConfigs(controllerConfigs())!

export function sample(t: number, over: Partial<TelemetrySample> = {}): TelemetrySample {
  return {
    t, x: 0.15 * t, y: 0.001, theta: 0, s: 0.15 * t, d: 0.001, x_ref: 0.15 * t, y_ref: 0, theta_ref: 0, s_ref: 0.15 * t,
    v_ref: 0.15, omega_ref: 0, v: 0.15, omega: 0, v_cmd: 0.15, omega_cmd: 0, wheel_left: 5, wheel_right: 5,
    wheel_left_cmd: 5, wheel_right_cmd: 5, torque_left: 0.01, torque_right: 0.01, torque_demand_left: 0.01,
    torque_demand_right: 0.01, error_position: 0.001, error_lateral: 0.001, error_along: 0, error_heading: 0,
    clearance: 0.02, required_clearance: 0.005, diameter: 0.25, contact_angle: 0.6, pitch: 0, roll: 0, slope: 0,
    gain_multiplier: 1, lateral_margin: 0.02, flags: 0, ...over,
  }
}

export function metrics(over: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  const e = { rmse: 0.0021, mae: 0.0015, max: 0.012, final_value: 0.0004 }
  return {
    position_error: e, lateral_error: e, heading_error: { rmse: 0.01, mae: 0.008, max: 0.05, final_value: 0.001 },
    average_linear_velocity: 0.14, max_linear_velocity: 0.15, max_wheel_speed: 5.1, total_distance: 3.8, progress: 3.8,
    progress_ratio: 1, simulated_duration: 25.75, execution_time_ms: 42.5, steps: 5150, min_clearance: 0.0185,
    min_clearance_station: 1.23, max_contact_angle: 0.7, max_motor_torque: 0.03, max_torque_demand: 0.035,
    mechanical_energy: 3.36, wheel_saturation_ratio: 0.01, torque_saturation_ratio: 0, traction_limit_ratio: 0,
    collision_count: 0, feasibility_violation_count: 0, constraint_violation_count: 0, goal_reached: true, ...over,
  }
}

export function results(over: Partial<SimulationResults> = {}): SimulationResults {
  return {
    engine_version: 'simulation-engine 0.1.0',
    scenario_hash: 'abc123',
    name: 'Test run',
    controller: 'pid',
    controller_name: 'PID tracking (fixed gains)',
    status: 'completed',
    failure: null,
    metrics: metrics(),
    events: [],
    telemetry: [0, 0.02, 0.04, 0.06].map((t) => sample(t)),
    config: defaultConfig(),
    report: '## Simulation report – Test run\n\n- Controller: PID\n',
    ...over,
  }
}
