import { create } from 'zustand'
import type { CompareResponse, SimulationResults } from '@/types/api'

export type RunSource = 'live' | 'instant' | 'comparison' | 'import'

export interface StoredRun {
  key: string
  simId: string | null
  receivedAt: number
  source: RunSource
  results: SimulationResults
}

export interface StoredComparison {
  key: string
  name: string
  scenarioHash: string
  report: string
  runKeys: string[]
  createdAt: number
}

const MAX_RUNS = 40

interface ResultsState {
  runs: StoredRun[]
  comparisons: StoredComparison[]
  /** Run keys selected for display/comparison on the results page. */
  selected: string[]
  addRun: (results: SimulationResults, source: RunSource, simId?: string | null) => string
  addComparison: (resp: CompareResponse) => StoredComparison
  removeRun: (key: string) => void
  clear: () => void
  setSelected: (keys: string[]) => void
  toggleSelected: (key: string) => void
}

let counter = 0
const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export const useResultsStore = create<ResultsState>()((set, get) => ({
  runs: [],
  comparisons: [],
  selected: [],

  addRun(results, source, simId = null) {
    // A live run is fetched again when its status changes; replace instead of duplicating.
    const existing = simId ? get().runs.find((r) => r.simId === simId && r.source === source) : undefined
    const key = existing?.key ?? newKey('run')
    const run: StoredRun = { key, simId, receivedAt: Date.now(), source, results }
    set((s) => {
      const others = s.runs.filter((r) => r.key !== key)
      const runs = [run, ...others].slice(0, MAX_RUNS)
      const alive = new Set(runs.map((r) => r.key))
      return { runs, selected: [key, ...s.selected.filter((k) => k !== key && alive.has(k))].slice(0, 1) }
    })
    return key
  },

  addComparison(resp) {
    const runKeys = resp.runs.map((r, i) => {
      const key = newKey('cmp')
      const run: StoredRun = { key, simId: resp.run_ids[i] ?? null, receivedAt: Date.now(), source: 'comparison', results: r }
      set((s) => ({ runs: [run, ...s.runs].slice(0, MAX_RUNS) }))
      return key
    })
    const cmp: StoredComparison = {
      key: newKey('comparison'),
      name: resp.name,
      scenarioHash: resp.scenario_hash,
      report: resp.report,
      runKeys,
      createdAt: Date.now(),
    }
    set((s) => ({ comparisons: [cmp, ...s.comparisons].slice(0, 20), selected: runKeys }))
    return cmp
  },

  removeRun: (key) =>
    set((s) => ({ runs: s.runs.filter((r) => r.key !== key), selected: s.selected.filter((k) => k !== key) })),
  clear: () => set({ runs: [], comparisons: [], selected: [] }),
  setSelected: (selected) => set({ selected }),
  toggleSelected: (key) =>
    set((s) => ({ selected: s.selected.includes(key) ? s.selected.filter((k) => k !== key) : [...s.selected, key] })),
}))

/** Latest completed/failed run per controller for a given scenario hash. */
export function latestByController(runs: StoredRun[], scenarioHash?: string): Map<string, StoredRun> {
  const out = new Map<string, StoredRun>()
  for (const r of runs) {
    if (scenarioHash && r.results.scenario_hash !== scenarioHash) continue
    if (r.results.status === 'ready' || r.results.status === 'running' || r.results.status === 'paused') continue
    if (!out.has(r.results.controller)) out.set(r.results.controller, r)
  }
  return out
}
