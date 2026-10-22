/** Display formatting. Internal values are SI; the UI shows engineering units. */

export const RAD2DEG = 180 / Math.PI
export const DEG2RAD = Math.PI / 180

const dash = '—'

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export const fmt = {
  num: (v: number | null | undefined, digits = 2) => (ok(v) ? v.toFixed(digits) : dash),
  mm: (m: number | null | undefined, digits = 1) => (ok(m) ? `${(m * 1000).toFixed(digits)} мм` : dash),
  m: (m: number | null | undefined, digits = 3) => (ok(m) ? `${m.toFixed(digits)} м` : dash),
  deg: (rad: number | null | undefined, digits = 1) => (ok(rad) ? `${(rad * RAD2DEG).toFixed(digits)}°` : dash),
  mps: (v: number | null | undefined, digits = 3) => (ok(v) ? `${v.toFixed(digits)} м/с` : dash),
  radps: (v: number | null | undefined, digits = 2) => (ok(v) ? `${v.toFixed(digits)} рад/с` : dash),
  nm: (v: number | null | undefined, digits = 3) => (ok(v) ? `${v.toFixed(digits)} Н·м` : dash),
  s: (v: number | null | undefined, digits = 2) => (ok(v) ? `${v.toFixed(digits)} с` : dash),
  pct: (ratio: number | null | undefined, digits = 1) => (ok(ratio) ? `${(ratio * 100).toFixed(digits)} %` : dash),
  j: (v: number | null | undefined, digits = 2) => (ok(v) ? `${v.toFixed(digits)} Дж` : dash),
  ms: (v: number | null | undefined, digits = 1) => (ok(v) ? `${v.toFixed(digits)} мс` : dash),
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
