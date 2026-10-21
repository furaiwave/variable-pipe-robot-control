/**
 * Data contracts shared with the Rust engine (serde JSON, snake_case).
 * Units: SI — metres, seconds, radians, kilograms, newtons, newton-metres.
 * Keep in sync with the Rust structs referenced in each comment.
 */

// ---------------------------------------------------------------- robot (robot-core/src/robot.rs)

export interface SensorNoise {
  position_std: number
  heading_std: number
}

export interface RobotConfig {
  name: string
  body_length: number
  body_width: number
  body_height: number
  chassis_clearance: number
  wheel_count: 4 | 6 | 8
  wheel_radius: number
  wheel_width: number
  wheelbase: number
  track_width: number
  mass: number
  com_offset_x: number
  com_height: number
  max_linear_velocity: number
  max_angular_velocity: number
  max_wheel_speed: number
  max_wheel_acceleration: number
  max_motor_torque: number
  rolling_resistance: number
  friction_coefficient: number
  lateral_friction_coefficient: number
  motor_time_constant: number
  max_contact_angle: number
  sensor_noise: SensorNoise
}

// ---------------------------------------------------------------- pipeline (pipeline-geometry/src/model.rs)

export interface Restriction {
  position: number
  length: number
  height: number
  label: string
}

interface SegmentBase {
  id: string
  label: string
  inclination: number
  min_clearance: number | null
  restrictions: Restriction[]
}

export interface StraightSegment extends SegmentBase {
  kind: 'straight'
  length: number
  diameter: number
}

export interface TransitionSegment extends SegmentBase {
  kind: 'transition'
  length: number
  diameter_start: number
  diameter_end: number
  profile: 'linear' | 'smooth'
}

export interface BendSegment extends SegmentBase {
  kind: 'bend'
  bend_radius: number
  /** Signed bend angle, rad (+ = left). */
  angle: number
  diameter: number
}

export type Segment = StraightSegment | TransitionSegment | BendSegment
export type SegmentKind = Segment['kind']

export interface PipelineConfig {
  name: string
  segments: Segment[]
}

// ---------------------------------------------------------------- controllers (control-algorithms/src/config.rs)

export interface PidGains {
  kp: number
  ki: number
  kd: number
  integral_limit: number
  output_limit: number
  derivative_filter: number
  anti_windup_gain: number
}

export interface KinematicParams {
  k_x: number
  k_y: number
  k_theta: number
}

export interface PidTrackingParams {
  longitudinal_mode: 'position' | 'velocity'
  longitudinal: PidGains
  lateral: PidGains
  lookahead: number
}

export interface GainScheduledParams {
  base: PidTrackingParams
  margin_reference: number
  curvature_length: number
  min_multiplier: number
  max_multiplier: number
  schedule_time_constant: number
}

export type ControllerType = 'kinematic' | 'pid' | 'gain_scheduled'

export type ControllerConfig =
  | ({ type: 'kinematic' } & KinematicParams)
  | ({ type: 'pid' } & PidTrackingParams)
  | ({ type: 'gain_scheduled' } & GainScheduledParams)

// ---------------------------------------------------------------- simulation config (simulation-engine/src/config.rs)

export interface ReferenceConfig {
  cruise_speed: number
  max_acceleration: number
  bend_speed_factor: number
  lateral_offset: number
}

export interface InitialConditions {
  station: number | null
  lateral_offset: number
  heading_error: number
}

export interface Disturbances {
  wheel_radius_mismatch: number
}

export interface SimulationConfig {
  name: string
  robot: RobotConfig
  pipeline: PipelineConfig
  controller: ControllerConfig
  reference: ReferenceConfig
  initial: InitialConditions
  disturbances: Disturbances
  time_step: number
  max_duration: number
  telemetry_interval: number
  safety_margin: number
  stop_on_collision: boolean
  seed: number
}

// ---------------------------------------------------------------- telemetry (simulation-engine/src/telemetry.rs)

export type ViolationKind =
  | 'collision'
  | 'safety_clearance'
  | 'contact_angle'
  | 'wheel_outside_pipe'
  | 'step_not_climbable'
  | 'wheel_speed_saturation'
  | 'torque_saturation'
  | 'traction_limit'
  | 'tipping_risk'
  | 'stall'
  | 'numerical_failure'
  | 'timeout'

export type Severity = 'warning' | 'fatal'

export interface TelemetrySample {
  t: number
  x: number
  y: number
  theta: number
  s: number
  d: number
  x_ref: number
  y_ref: number
  theta_ref: number
  s_ref: number
  v_ref: number
  omega_ref: number
  v: number
  omega: number
  v_cmd: number
  omega_cmd: number
  wheel_left: number
  wheel_right: number
  wheel_left_cmd: number
  wheel_right_cmd: number
  torque_left: number
  torque_right: number
  torque_demand_left: number
  torque_demand_right: number
  error_position: number
  error_lateral: number
  error_along: number
  error_heading: number
  clearance: number
  required_clearance: number
  diameter: number
  contact_angle: number
  pitch: number
  roll: number
  slope: number
  gain_multiplier: number
  lateral_margin: number
  flags: number
}

export interface ViolationEvent {
  kind: ViolationKind
  severity: Severity
  t_start: number
  t_end: number
  s_start: number
  s_end: number
  x: number
  y: number
  peak_value: number
  limit: number
  unit: string
  message: string
}

// ---------------------------------------------------------------- results (simulation-engine/src/simulation.rs, metrics.rs)

export type SimulationStatus = 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface FailureInfo {
  kind: ViolationKind
  message: string
  time: number
  station: number
  x: number
  y: number
  value: number
  limit: number
}

export interface ErrorStats {
  rmse: number
  mae: number
  max: number
  final_value: number
}

export interface PerformanceMetrics {
  position_error: ErrorStats
  lateral_error: ErrorStats
  heading_error: ErrorStats
  average_linear_velocity: number
  max_linear_velocity: number
  max_wheel_speed: number
  total_distance: number
  progress: number
  progress_ratio: number
  simulated_duration: number
  execution_time_ms: number
  steps: number
  min_clearance: number
  min_clearance_station: number
  max_contact_angle: number
  max_motor_torque: number
  max_torque_demand: number
  mechanical_energy: number
  wheel_saturation_ratio: number
  torque_saturation_ratio: number
  traction_limit_ratio: number
  collision_count: number
  feasibility_violation_count: number
  constraint_violation_count: number
  goal_reached: boolean
}

export interface StatusSnapshot {
  status: SimulationStatus
  time: number
  step: number
  progress: number
  station: number
  start_station: number
  goal_station: number
  pipeline_length: number
  telemetry_count: number
  violation_count: number
  collision_count: number
  latest: TelemetrySample | null
  failure: FailureInfo | null
  controller: ControllerType
  name: string
}

export interface StatusResponse extends StatusSnapshot {
  id: string
  playback_speed: number
}

export interface SimulationResults {
  engine_version: string
  scenario_hash: string
  name: string
  controller: ControllerType
  controller_name: string
  status: SimulationStatus
  failure: FailureInfo | null
  metrics: PerformanceMetrics
  events: ViolationEvent[]
  telemetry: TelemetrySample[]
  config: SimulationConfig
  report: string
}

export interface SimulationSummary {
  id: string
  name: string
  controller: ControllerType
  status: SimulationStatus
  created_at_ms: number
  time: number
  progress: number
  scenario_hash: string
  playback_speed: number
}

export interface TelemetryPage {
  from: number
  total: number
  stride: number
  samples: TelemetrySample[]
}

// ---------------------------------------------------------------- analysis (simulation-engine/src/analysis.rs)

export type PointKind = 'body_top' | 'body_bottom' | 'wheel'

export interface GeometrySample {
  s: number
  x: number
  y: number
  heading: number
  diameter: number
  base_diameter: number
  elevation: number
  inclination: number
  curvature: number
  segment: number
}

export interface ProfileSample {
  s: number
  diameter: number
  clearance: number
  required: number
  lateral_margin: number
  contact_angle: number
  ramp_angle: number
  binding: PointKind | null
}

export interface StepCheck {
  s: number
  radius_before: number
  radius_after: number
  kind: 'segment_joint' | 'restriction'
  rise: number
  contact_angle: number
  max_angle: number
  climbable: boolean
}

export interface FeasibilityIssue {
  kind: ViolationKind
  s_start: number
  s_end: number
  value: number
  limit: number
  message: string
}

export interface MinDiameter {
  geometric: number
  geometric_binding: string
  recommended: number
  recommended_binding: string
}

export interface PipelineSummary {
  total_length: number
  min_diameter: number
  min_diameter_station: number
  max_diameter: number
  segment_count: number
  bend_count: number
  total_turning_angle: number
  max_curvature: number
  elevation_change: number
  max_inclination: number
  step_count: number
}

export interface FeasibilityReport {
  feasible: boolean
  has_warnings: boolean
  issues: FeasibilityIssue[]
  start_station: number
  goal_station: number
  profile: ProfileSample[]
  steps: StepCheck[]
  min_clearance: number
  min_clearance_station: number
  min_lateral_margin: number
  min_lateral_margin_station: number
  max_contact_angle: number
  min_feasible_diameter: MinDiameter | null
  max_climb_angle: number
  max_step_height: number
  slope_limit: { max_slope: number; traction_limit: number; torque_limit: number }
  envelope: { length: number; width: number; height: number; contact_half_span: number }
  summary: PipelineSummary
  geometry: GeometrySample[]
}

export interface CrossSectionView {
  diameter: number
  lateral_offset: number
  clearance: number
  required: number
  contact_angle: number
  max_contact_angle: number
  roll: number
  admissible: boolean
  binding: string
  body: [number, number][]
  wheels: [number, number][][]
  contacts: [number, number][]
  critical: [number, number] | null
}

// ---------------------------------------------------------------- experiments

export interface ExperimentPreset {
  id: string
  code: string
  title: string
  objective: string
  description: string
  config: SimulationConfig
  controllers: ControllerConfig[]
}

export interface CompareResponse {
  scenario_hash: string
  name: string
  report: string
  run_ids: string[]
  runs: SimulationResults[]
}

export interface ValidationIssue {
  field: string
  message: string
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: ValidationIssue[] }
}

// ---------------------------------------------------------------- WebSocket (api-server/src/ws.rs)

export type WsMessage =
  | { type: 'snapshot'; id: string; playback_speed: number; snapshot: StatusSnapshot }
  | { type: 'telemetry'; from: number; samples: TelemetrySample[] }
  | { type: 'events'; events: ViolationEvent[] }
