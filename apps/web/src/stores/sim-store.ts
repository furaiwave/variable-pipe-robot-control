/**
 * Live simulation state. The Rust server owns the simulation; this store
 * mirrors it through REST commands and the WebSocket telemetry stream.
 *
 * Telemetry samples are kept in a module-level buffer (not in React state)
 * so high-rate updates do not re-render the component tree. Components
 * subscribe to `telemetryVersion`, which is bumped at most ~10 times per
 * second; the canvas reads the buffer directly on every animation frame.
 */
import { create } from 'zustand'
import { ApiError, api } from '@/services/api'
import { isTerminal } from '@/lib/violations'
import { fullKey } from '@/lib/scenario'
import { useResultsStore } from '@/stores/results-store'
import type { SimulationConfig, StatusResponse, TelemetrySample, ViolationEvent, WsMessage } from '@/types/api'

const telemetry: { samples: TelemetrySample[] } = { samples: [] }

export function getTelemetry(): readonly TelemetrySample[] {
  return telemetry.samples
}

type Connection = 'disconnected' | 'connecting' | 'open'

interface SimState {
  simId: string | null
  /** Key of the configuration the current simulation was created from. */
  simKey: string | null
  snapshot: StatusResponse | null
  playback: number
  events: ViolationEvent[]
  connection: Connection
  busy: boolean
  error: string | null
  telemetryVersion: number

  start: (config: SimulationConfig) => Promise<void>
  runInstant: (config: SimulationConfig) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  reset: (config?: SimulationConfig) => Promise<void>
  setPlayback: (v: number) => Promise<void>
  clearError: () => void
  /** Internal: apply a WebSocket message. Exposed for tests. */
  _handleMessage: (m: WsMessage) => void
}

let closeStream: (() => void) | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingSnapshot: StatusResponse | null = null
let pendingTelemetry = false
let fetchedResultsFor = ''

function message(e: unknown): string {
  if (e instanceof ApiError) return e.describe()
  return e instanceof Error ? e.message : String(e)
}

export const useSimStore = create<SimState>()((set, get) => {
  function flush() {
    flushTimer = null
    const patch: Partial<SimState> = {}
    if (pendingSnapshot) {
      patch.snapshot = pendingSnapshot
      patch.playback = pendingSnapshot.playback_speed
      pendingSnapshot = null
    }
    if (pendingTelemetry) {
      patch.telemetryVersion = get().telemetryVersion + 1
      pendingTelemetry = false
    }
    set(patch)
    maybeFetchResults()
  }

  function scheduleFlush(immediate = false) {
    if (immediate) {
      if (flushTimer) clearTimeout(flushTimer)
      flush()
    } else if (!flushTimer) {
      flushTimer = setTimeout(flush, 100)
    }
  }

  /** When the run reaches a terminal state, fetch the full results once. */
  function maybeFetchResults() {
    const { snapshot, simId } = get()
    if (!snapshot || !simId || !isTerminal(snapshot.status)) return
    const key = `${simId}:${snapshot.status}:${snapshot.step}`
    if (fetchedResultsFor === key) return
    fetchedResultsFor = key
    api
      .results(simId)
      .then((r) => useResultsStore.getState().addRun(r, 'live', simId))
      .catch((e) => set({ error: `Could not fetch results: ${message(e)}` }))
  }

  function connect(id: string) {
    disconnect()
    set({ connection: 'connecting' })
    closeStream = api.openStream(id, {
      onOpen: () => set({ connection: 'open' }),
      onMessage: (m) => get()._handleMessage(m),
      onClose: () => {
        set({ connection: 'disconnected' })
        closeStream = null
        // Reconnect while the simulation still exists and may produce data.
        if (get().simId === id) {
          reconnectTimer = setTimeout(() => {
            if (get().simId === id && !isTerminal(get().snapshot?.status)) connect(id)
          }, 1500)
        }
      },
      onError: () => set({ connection: 'disconnected' }),
    })
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    closeStream?.()
    closeStream = null
  }

  function adopt(s: StatusResponse) {
    pendingSnapshot = s
    scheduleFlush(true)
  }

  async function ensureSimulation(config: SimulationConfig): Promise<string> {
    const key = fullKey(config)
    const { simId, simKey, playback } = get()
    if (simId && simKey === key) return simId
    if (simId) {
      disconnect()
      api.deleteSimulation(simId).catch(() => undefined)
    }
    telemetry.samples = []
    fetchedResultsFor = ''
    const created = await api.createSimulation(config, playback)
    set({ simId: created.id, simKey: key, events: [], telemetryVersion: get().telemetryVersion + 1 })
    adopt(created)
    connect(created.id)
    return created.id
  }

  async function guarded(fn: () => Promise<void>) {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      await fn()
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ busy: false })
    }
  }

  return {
    simId: null,
    simKey: null,
    snapshot: null,
    playback: 1,
    events: [],
    connection: 'disconnected',
    busy: false,
    error: null,
    telemetryVersion: 0,

    start: (config) =>
      guarded(async () => {
        const id = await ensureSimulation(config)
        let status = get().snapshot?.status
        if (status && isTerminal(status)) {
          adopt(await api.reset(id))
          status = 'ready'
        }
        if (status === 'paused') adopt(await api.resume(id, get().playback))
        else adopt(await api.start(id, get().playback))
      }),

    runInstant: (config) =>
      guarded(async () => {
        const id = await ensureSimulation(config)
        if (isTerminal(get().snapshot?.status)) adopt(await api.reset(id))
        const results = await api.runToCompletion(id)
        telemetry.samples = results.telemetry.slice()
        set({ events: results.events, telemetryVersion: get().telemetryVersion + 1 })
        adopt(await api.status(id))
      }),

    pause: () =>
      guarded(async () => {
        const id = get().simId
        if (id) adopt(await api.pause(id))
      }),

    resume: () =>
      guarded(async () => {
        const id = get().simId
        if (id) adopt(await api.resume(id, get().playback))
      }),

    stop: () =>
      guarded(async () => {
        const id = get().simId
        if (id) adopt(await api.stop(id))
      }),

    reset: (config) =>
      guarded(async () => {
        const { simId, simKey } = get()
        if (config && (!simId || simKey !== fullKey(config))) {
          await ensureSimulation(config)
          return
        }
        if (simId) {
          adopt(await api.reset(simId))
          if (!closeStream) connect(simId)
        }
      }),

    setPlayback: async (v) => {
      set({ playback: v })
      const id = get().simId
      if (!id) return
      try {
        adopt(await api.setPlayback(id, v))
      } catch (e) {
        set({ error: message(e) })
      }
    },

    clearError: () => set({ error: null }),

    _handleMessage: (m) => {
      switch (m.type) {
        case 'telemetry': {
          const buf = telemetry.samples
          if (m.from === 0 || m.from < buf.length) buf.length = m.from
          if (m.from === buf.length) {
            for (const s of m.samples) buf.push(s)
            pendingTelemetry = true
          }
          scheduleFlush()
          break
        }
        case 'events':
          set({ events: m.events })
          break
        case 'snapshot': {
          const prev = get().snapshot?.status
          pendingSnapshot = { ...m.snapshot, id: m.id, playback_speed: m.playback_speed }
          scheduleFlush(prev !== m.snapshot.status)
          break
        }
      }
    },
  }
})

/** Testing helper: reset module state. */
export function __resetSimStoreForTests() {
  telemetry.samples = []
  pendingSnapshot = null
  pendingTelemetry = false
  fetchedResultsFor = ''
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  closeStream?.()
  closeStream = null
  useSimStore.setState({
    simId: null,
    simKey: null,
    snapshot: null,
    playback: 1,
    events: [],
    connection: 'disconnected',
    busy: false,
    error: null,
    telemetryVersion: 0,
  })
}
