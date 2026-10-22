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
  collision: 'Зіткнення зі стінкою труби',
  safety_clearance: 'Порушено безпечний зазор',
  contact_angle: 'Перевищено кут контакту зі стінкою',
  wheel_outside_pipe: 'Колесо поза перерізом труби',
  step_not_climbable: 'Сходинку / рампу неможливо подолати',
  wheel_speed_saturation: 'Насичення швидкості коліс',
  torque_saturation: 'Насичення моменту двигуна',
  traction_limit: 'Межа зчеплення (пробуксовка)',
  tipping_risk: 'Відрив осі (ризик перекидання)',
  stall: 'Зупинка (немає просування)',
  numerical_failure: 'Чисельний збій',
  timeout: 'Вичерпано ліміт часу',
}

export function violationFlag(kind: ViolationKind): number {
  return 1 << VIOLATION_KINDS.indexOf(kind)
}

export function activeViolations(flags: number): ViolationKind[] {
  return VIOLATION_KINDS.filter((k) => (flags & violationFlag(k)) !== 0)
}

export const CONTROLLER_NAMES: Record<ControllerType, string> = {
  kinematic: 'Кінематичний базовий (Kanayama)',
  pid: 'ПІД-стеження (фіксовані коефіцієнти)',
  gain_scheduled: 'ПІД з плануванням коефіцієнтів',
}

export const CONTROLLER_SHORT: Record<ControllerType, string> = {
  kinematic: 'Кінематичний',
  pid: 'ПІД',
  gain_scheduled: 'ПІД з плануванням',
}

export const STATUS_LABELS: Record<SimulationStatus, string> = {
  ready: 'Готово до запуску',
  running: 'Виконується',
  paused: 'Призупинено',
  completed: 'Завершено',
  failed: 'Збій',
  cancelled: 'Скасовано',
}

/** Ukrainian names of the binding constraints reported by the engine. */
const BINDING_LABELS: Record<string, string> = {
  'wheel contact outside cross-section': 'контакт колеса поза перерізом',
  'wall contact angle limit': 'межа кута контакту зі стінкою',
  'body top clearance': 'зазор над корпусом',
  'body underside clearance': 'зазор під днищем',
  'wheel clearance': 'зазор колеса',
  'minimum supported diameter': 'мінімальний підтримуваний діаметр',
  unknown: 'невідомо',
}

export function bindingLabel(binding: string): string {
  return BINDING_LABELS[binding] ?? binding
}

export function isTerminal(s: SimulationStatus | null | undefined): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}
