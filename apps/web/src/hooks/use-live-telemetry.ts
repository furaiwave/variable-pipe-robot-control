import { useMemo } from 'react'
import { decimate } from '@/lib/decimate'
import { getTelemetry, useSimStore } from '@/stores/sim-store'
import type { TelemetrySample } from '@/types/api'

/**
 * Decimated copy of the live telemetry for charts, recomputed at most at the
 * store's flush rate (~10 Hz). `windowSeconds` limits the time span.
 */
export function useLiveSeries(maxPoints = 600, windowSeconds?: number): TelemetrySample[] {
  const version = useSimStore((s) => s.telemetryVersion)
  return useMemo(() => {
    const all = getTelemetry()
    let data: readonly TelemetrySample[] = all
    if (windowSeconds && all.length) {
      const t0 = all[all.length - 1]!.t - windowSeconds
      let i = all.length - 1
      while (i > 0 && all[i - 1]!.t >= t0) i--
      data = all.slice(i)
    }
    return decimate(data, maxPoints)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, maxPoints, windowSeconds])
}

/** Latest sample (re-rendered at the flush rate). */
export function useLatestSample(): TelemetrySample | null {
  useSimStore((s) => s.telemetryVersion)
  const snapshot = useSimStore((s) => s.snapshot)
  const all = getTelemetry()
  return all[all.length - 1] ?? snapshot?.latest ?? null
}
