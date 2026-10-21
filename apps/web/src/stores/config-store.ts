import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { api } from '@/services/api'
import { makeSegment, segmentEndDiameter } from '@/lib/schemas'
import type {
  ControllerConfig,
  ControllerType,
  GainScheduledParams,
  KinematicParams,
  PidTrackingParams,
  PipelineConfig,
  RobotConfig,
  Segment,
  SegmentKind,
  SimulationConfig,
} from '@/types/api'

export interface ControllerParams {
  kinematic: KinematicParams
  pid: PidTrackingParams
  gain_scheduled: GainScheduledParams
}

export const CONTROLLER_TYPES: ControllerType[] = ['kinematic', 'pid', 'gain_scheduled']

export function controllerConfig(type: ControllerType, p: ControllerParams): ControllerConfig {
  switch (type) {
    case 'kinematic':
      return { type, ...p.kinematic }
    case 'pid':
      return { type, ...p.pid }
    case 'gain_scheduled':
      return { type, ...p.gain_scheduled }
  }
}

/** Split controller configs (e.g. from a preset) into per-type params. */
export function paramsFromConfigs(configs: ControllerConfig[], fallback?: ControllerParams): ControllerParams | null {
  const out: Partial<ControllerParams> = { ...fallback }
  for (const c of configs) {
    const { type, ...rest } = c
    ;(out as Record<string, unknown>)[type] = rest
  }
  return out.kinematic && out.pid && out.gain_scheduled ? (out as ControllerParams) : null
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ConfigState {
  /** Scenario configuration (robot, pipeline, reference, initial conditions, …). */
  config: SimulationConfig | null
  /** Parameters of every controller (only `active` is used for single runs). */
  controllers: ControllerParams | null
  /** Controllers participating in comparisons. */
  enabled: Record<ControllerType, boolean>
  active: ControllerType
  selectedSegmentId: string | null
  /** Incremented when the scenario is replaced as a whole (forms re-initialise). */
  revision: number
  loadStatus: LoadStatus
  loadError: string | null

  init: (force?: boolean) => Promise<void>
  setConfig: (c: SimulationConfig) => void
  setRobot: (r: RobotConfig) => void
  setPipeline: (p: PipelineConfig) => void
  updateSegment: (id: string, seg: Segment) => void
  addSegment: (kind: SegmentKind | 'narrow' | 'restriction', afterId?: string | null) => void
  removeSegment: (id: string) => void
  duplicateSegment: (id: string) => void
  moveSegment: (id: string, delta: -1 | 1) => void
  selectSegment: (id: string | null) => void
  setControllerParams: <T extends ControllerType>(type: T, params: ControllerParams[T]) => void
  setEnabled: (type: ControllerType, enabled: boolean) => void
  setActive: (type: ControllerType) => void
  loadScenario: (c: SimulationConfig, controllers?: ControllerConfig[]) => void
  /** Configuration with the active controller, ready for the API. */
  effectiveConfig: () => SimulationConfig | null
}

function withPipeline(state: ConfigState, fn: (segs: Segment[]) => Segment[]): Partial<ConfigState> {
  if (!state.config) return {}
  return { config: { ...state.config, pipeline: { ...state.config.pipeline, segments: fn(state.config.pipeline.segments) } } }
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      controllers: null,
      enabled: { kinematic: true, pid: true, gain_scheduled: true },
      active: 'pid',
      selectedSegmentId: null,
      revision: 0,
      loadStatus: 'idle',
      loadError: null,

      async init(force = false) {
        const s = get()
        if (!force && s.config && s.controllers) {
          set({ loadStatus: 'ready' })
          return
        }
        set({ loadStatus: 'loading', loadError: null })
        try {
          const [config, presets] = await Promise.all([api.defaultConfig(), api.presets()])
          const all = presets.find((p) => p.controllers.length >= 3)?.controllers ?? []
          const controllers = paramsFromConfigs([...all, config.controller])
          if (!controllers) throw new Error('Server did not provide default parameters for all controllers')
          set({
            config,
            controllers,
            active: config.controller.type,
            selectedSegmentId: config.pipeline.segments[0]?.id ?? null,
            revision: get().revision + 1,
            loadStatus: 'ready',
          })
        } catch (e) {
          set({ loadStatus: 'error', loadError: e instanceof Error ? e.message : String(e) })
        }
      },

      setConfig: (config) => set((s) => ({ config, revision: s.revision + 1 })),
      setRobot: (robot) => set((s) => (s.config ? { config: { ...s.config, robot } } : {})),
      setPipeline: (pipeline) => set((s) => (s.config ? { config: { ...s.config, pipeline } } : {})),

      updateSegment: (id, seg) =>
        set((s) => ({
          ...withPipeline(s, (segs) => segs.map((x) => (x.id === id ? seg : x))),
          selectedSegmentId: s.selectedSegmentId === id ? seg.id : s.selectedSegmentId,
        })),

      addSegment: (kind, afterId) =>
        set((s) => {
          if (!s.config) return {}
          const segs = s.config.pipeline.segments
          const idx = afterId ? segs.findIndex((x) => x.id === afterId) : segs.length - 1
          const prev = segs[idx] ?? segs[segs.length - 1]
          const seg = makeSegment(kind, segs, prev ? segmentEndDiameter(prev) : 0.25)
          const next = [...segs]
          next.splice(idx + 1, 0, seg)
          return { ...withPipeline(s, () => next), selectedSegmentId: seg.id }
        }),

      removeSegment: (id) =>
        set((s) => {
          if (!s.config || s.config.pipeline.segments.length <= 1) return {}
          const segs = s.config.pipeline.segments
          const idx = segs.findIndex((x) => x.id === id)
          const next = segs.filter((x) => x.id !== id)
          return { ...withPipeline(s, () => next), selectedSegmentId: next[Math.max(0, idx - 1)]?.id ?? null }
        }),

      duplicateSegment: (id) =>
        set((s) => {
          if (!s.config) return {}
          const segs = s.config.pipeline.segments
          const idx = segs.findIndex((x) => x.id === id)
          if (idx < 0) return {}
          const ids = new Set(segs.map((x) => x.id))
          let n = 2
          while (ids.has(`${id}-${n}`)) n++
          const copy: Segment = { ...structuredClone(segs[idx]!), id: `${id}-${n}` }
          const next = [...segs]
          next.splice(idx + 1, 0, copy)
          return { ...withPipeline(s, () => next), selectedSegmentId: copy.id }
        }),

      moveSegment: (id, delta) =>
        set((s) =>
          withPipeline(s, (segs) => {
            const i = segs.findIndex((x) => x.id === id)
            const j = i + delta
            if (i < 0 || j < 0 || j >= segs.length) return segs
            const next = [...segs]
            ;[next[i], next[j]] = [next[j]!, next[i]!]
            return next
          }),
        ),

      selectSegment: (selectedSegmentId) => set({ selectedSegmentId }),

      setControllerParams: (type, params) =>
        set((s) => (s.controllers ? { controllers: { ...s.controllers, [type]: params } } : {})),
      setEnabled: (type, enabled) => set((s) => ({ enabled: { ...s.enabled, [type]: enabled } })),
      setActive: (active) => set({ active }),

      loadScenario: (c, controllers) =>
        set((s) => {
          const params = controllers ? paramsFromConfigs([...controllers, c.controller], s.controllers ?? undefined) : null
          return {
            config: c,
            controllers: params ?? paramsFromConfigs([c.controller], s.controllers ?? undefined) ?? s.controllers,
            active: c.controller.type,
            selectedSegmentId: c.pipeline.segments[0]?.id ?? null,
            revision: s.revision + 1,
          }
        }),

      effectiveConfig: () => {
        const { config, controllers, active } = get()
        if (!config || !controllers) return null
        return { ...config, controller: controllerConfig(active, controllers) }
      },
    }),
    {
      name: 'vprc-config-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        config: s.config,
        controllers: s.controllers,
        enabled: s.enabled,
        active: s.active,
        selectedSegmentId: s.selectedSegmentId,
      }),
    },
  ),
)
