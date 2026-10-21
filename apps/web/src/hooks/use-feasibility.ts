import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ApiError, api } from '@/services/api'
import { scenarioKey } from '@/lib/scenario'
import type { FeasibilityReport, SimulationConfig } from '@/types/api'

interface FeasibilityCache {
  key: string
  report: FeasibilityReport | null
  error: ApiError | null
  set: (key: string, report: FeasibilityReport | null, error: ApiError | null) => void
}

/** Shared cache so pages do not re-request the same analysis. */
export const useFeasibilityCache = create<FeasibilityCache>()((set) => ({
  key: '',
  report: null,
  error: null,
  set: (key, report, error) => set({ key, report, error }),
}))

/**
 * Static feasibility analysis of the current scenario (debounced). The
 * engine computes the geometry, clearance profile, steps and limits.
 */
export function useFeasibility(config: SimulationConfig | null, delay = 250) {
  const key = config ? scenarioKey(config) : ''
  const cache = useFeasibilityCache()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!config || useFeasibilityCache.getState().key === key) return
    const ctrl = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      api
        .feasibility(config, ctrl.signal)
        .then((r) => useFeasibilityCache.getState().set(key, r, null))
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return
          const err = e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e))
          useFeasibilityCache.getState().set(key, null, err)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false)
        })
    }, delay)
    return () => {
      clearTimeout(t)
      ctrl.abort()
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const fresh = cache.key === key
  return {
    report: fresh ? cache.report : cache.report, // keep last report visible while recomputing
    stale: !fresh,
    error: fresh ? cache.error : null,
    loading,
  }
}
