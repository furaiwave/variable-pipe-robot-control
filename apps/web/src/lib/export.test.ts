import { describe, expect, it } from 'vitest'
import { results, sample } from '@/test/fixtures'
import { TELEMETRY_COLUMNS, parseExperimentJson, resultsToJson, safeFileName, telemetryToCsv } from './export'
import { decimate } from './decimate'
import { scenarioKey, stableStringify } from './scenario'
import { activeViolations, violationFlag } from './violations'

describe('CSV export', () => {
  it('writes a header and one row per sample in the engine column order', () => {
    const csv = telemetryToCsv([sample(0), sample(0.5, { flags: 3, clearance: -0.001 })])
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(TELEMETRY_COLUMNS.join(','))
    const row = lines[2]!.split(',')
    expect(row).toHaveLength(TELEMETRY_COLUMNS.length)
    expect(Number(row[0])).toBe(0.5)
    expect(row[row.length - 1]).toBe('3')
    expect(Number(row[TELEMETRY_COLUMNS.indexOf('clearance')])).toBeCloseTo(-0.001, 12)
  })

  it('leaves non-finite values empty', () => {
    const csv = telemetryToCsv([sample(0, { clearance: Number.NaN })])
    const row = csv.trim().split('\n')[1]!.split(',')
    expect(row[TELEMETRY_COLUMNS.indexOf('clearance')]).toBe('')
  })
})

describe('JSON export', () => {
  it('round-trips complete results with format metadata', () => {
    const r = results()
    const text = resultsToJson(r, new Date('2026-01-01T00:00:00Z'))
    const doc = JSON.parse(text)
    expect(doc.format).toBe('variable-pipe-robot-control/experiment')
    expect(doc.exported_at).toBe('2026-01-01T00:00:00.000Z')
    expect(doc.note).toMatch(/not physical measurements/)
    expect(parseExperimentJson(text)).toEqual(r)
    // A bare results object is accepted too.
    expect(parseExperimentJson(JSON.stringify(r)).name).toBe('Test run')
  })

  it('rejects files without results', () => {
    expect(() => parseExperimentJson('{"foo": 1}')).toThrow(/does not contain simulation results/)
    expect(() => parseExperimentJson('not json')).toThrow()
  })

  it('sanitises file names', () => {
    expect(safeFileName('E – Narrow passage / test')).toBe('E_Narrow_passage_test')
  })
})

describe('helpers', () => {
  it('decimate keeps endpoints and peaks', () => {
    const data = Array.from({ length: 10_000 }, (_, i) => ({ i, v: i === 5000 ? 100 : Math.sin(i / 100) }))
    const out = decimate(data, 500, (d) => d.v)
    expect(out.length).toBeLessThanOrEqual(500)
    expect(out[0]!.i).toBe(0)
    expect(out[out.length - 1]!.i).toBe(9999)
    expect(out.some((d) => d.v === 100)).toBe(true)
  })

  it('stable stringify ignores key order; scenario key ignores the controller', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }))
    const a = results().config
    const b = { ...a, controller: { type: 'kinematic', k_x: 1, k_y: 1, k_theta: 1 } as const }
    expect(scenarioKey(a)).toBe(scenarioKey(b))
    expect(scenarioKey({ ...a, seed: 99 })).not.toBe(scenarioKey(a))
  })

  it('violation flags decode', () => {
    const flags = violationFlag('collision') | violationFlag('stall')
    expect(activeViolations(flags)).toEqual(['collision', 'stall'])
  })
})
