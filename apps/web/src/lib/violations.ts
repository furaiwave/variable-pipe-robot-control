import type { ControllerType, SimulationStatus, ViolationKind } from '@/types/api'

/** Order must match `ViolationKind::ALL` in crates/simulation-engine/src/telemetry.rs. */
export const VIOLATION_KINDS: ViolationKind[] = [
  'collision',
  'safety_clearance',
  'contact_angle',
  'wheel_outside_pipe',
  'step_not_climbable',
  'wheel_speed_saturation',
  'torque_saturation',
  'traction_limit',
  'tipping_risk',
  'stall',
  'numerical_failure',
  'timeout',
]

export const FLAG_CONTROLLER_SATURATED = 1 << 16
export const FLAG_RATE_LIMITED = 1 << 17

export const VIOLATION_LABELS: Record<ViolationKind, string> = {
  collision: 'Collision with pipe wall',
  safety_clearance: 'Safety clearance violated',
  contact_angle: 'Wall contact angle exceeded',
  wheel_outside_pipe: 'Wheel outside pipe cross-section',
  step_not_climbable: 'Step / ramp not climbable',
  wheel_speed_saturation: 'Wheel speed saturation',
  torque_saturation: 'Motor torque saturation',
  traction_limit: 'Traction limit (wheel slip)',
  tipping_risk: 'Axle lift-off (tipping risk)',
  stall: 'Stall (no progress)',
  numerical_failure: 'Numerical failure',
  timeout: 'Time limit reached',
}

export function violationFlag(kind: ViolationKind): number {
  return 1 << VIOLATION_KINDS.indexOf(kind)
}

export function activeViolations(flags: number): ViolationKind[] {
  return VIOLATION_KINDS.filter((k) => (flags & violationFlag(k)) !== 0)
}

export const CONTROLLER_NAMES: Record<ControllerType, string> = {
  kinematic: 'Kinematic baseline (Kanayama)',
  pid: 'PID tracking (fixed gains)',
  gain_scheduled: 'Gain-scheduled PID',
}

export const CONTROLLER_SHORT: Record<ControllerType, string> = {
  kinematic: 'Kinematic',
  pid: 'PID',
  gain_scheduled: 'Gain-scheduled',
}

export const STATUS_LABELS: Record<SimulationStatus, string> = {
  ready: 'Ready',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function isTerminal(s: SimulationStatus | null | undefined): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}
