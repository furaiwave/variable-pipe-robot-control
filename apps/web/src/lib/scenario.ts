import type { SimulationConfig } from '@/types/api'

/** JSON with sorted object keys, so equal values give equal strings. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}

/**
 * Key of everything that defines a scenario except the controller (same
 * inputs as the engine's `scenario_hash`). Runs with equal keys are directly
 * comparable.
 */
export function scenarioKey(c: SimulationConfig): string {
  const { robot, pipeline, reference, initial, disturbances, time_step, safety_margin, seed } = c
  return stableStringify({ robot, pipeline, reference, initial, disturbances, time_step, safety_margin, seed })
}

export function fullKey(c: SimulationConfig | null): string {
  return c ? stableStringify(c) : ''
}
