import type { SimulationResults, TelemetrySample } from '@/types/api'

/** Column order identical to the Rust CSV export (`telemetry::CSV_COLUMNS`). */
export const TELEMETRY_COLUMNS: (keyof TelemetrySample)[] = [
  't', 'x', 'y', 'theta', 's', 'd', 'x_ref', 'y_ref', 'theta_ref', 's_ref', 'v_ref', 'omega_ref', 'v', 'omega',
  'v_cmd', 'omega_cmd', 'wheel_left', 'wheel_right', 'wheel_left_cmd', 'wheel_right_cmd', 'torque_left',
  'torque_right', 'torque_demand_left', 'torque_demand_right', 'error_position', 'error_lateral', 'error_along',
  'error_heading', 'clearance', 'required_clearance', 'diameter', 'contact_angle', 'pitch', 'roll', 'slope',
  'gain_multiplier', 'lateral_margin', 'flags',
]

/** Telemetry → CSV (SI units, radians; full resolution, not decimated). */
export function telemetryToCsv(samples: TelemetrySample[]): string {
  const lines = [TELEMETRY_COLUMNS.join(',')]
  for (const s of samples) {
    lines.push(
      TELEMETRY_COLUMNS.map((c) => {
        const v = s[c]
        if (c === 'flags') return String(v)
        return Number.isFinite(v) ? v.toPrecision(10) : ''
      }).join(','),
    )
  }
  return lines.join('\n') + '\n'
}

export interface ExperimentExport {
  format: 'variable-pipe-robot-control/experiment'
  version: 1
  exported_at: string
  note: string
  results: SimulationResults
}

/** Complete experiment (configuration + metrics + events + telemetry + report) as JSON. */
export function resultsToJson(results: SimulationResults, now = new Date()): string {
  const doc: ExperimentExport = {
    format: 'variable-pipe-robot-control/experiment',
    version: 1,
    exported_at: now.toISOString(),
    note: 'Результати моделювання планарної кінематичної / квазістатичної моделі — не фізичні вимірювання. Для відтворення повторно запустіть `config` з тією ж версією рушія.',
    results,
  }
  return JSON.stringify(doc, null, 2)
}

/** Parse an exported experiment JSON (or a bare SimulationResults object). */
export function parseExperimentJson(text: string): SimulationResults {
  const data: unknown = JSON.parse(text)
  const obj = data as Partial<ExperimentExport> & Partial<SimulationResults>
  const results = (obj.format === 'variable-pipe-robot-control/experiment' ? obj.results : obj) as SimulationResults | undefined
  if (!results || !Array.isArray(results.telemetry) || typeof results.metrics !== 'object' || typeof results.config !== 'object') {
    throw new Error('Файл не містить результатів моделювання (відсутні телеметрія, метрики або конфігурація).')
  }
  return results
}

export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/_+/g, '_').slice(0, 80) || 'experiment'
}

/** Trigger a browser download. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportResultsCsv(r: SimulationResults): void {
  downloadText(`${safeFileName(r.name)}_${r.controller}_telemetry.csv`, telemetryToCsv(r.telemetry), 'text/csv')
}

export function exportResultsJson(r: SimulationResults): void {
  downloadText(`${safeFileName(r.name)}_${r.controller}.json`, resultsToJson(r), 'application/json')
}
