import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { controllerParams, defaultConfig, results, sample } from '@/test/fixtures'
import { useConfigStore } from './config-store'
import { useResultsStore } from './results-store'
import { __resetSimStoreForTests, getTelemetry, useSimStore } from './sim-store'

describe('config store – pipeline segment editing', () => {
  beforeEach(() => {
    useConfigStore.setState({ config: defaultConfig(), controllers: controllerParams(), selectedSegmentId: 's1' })
  })

  it('adds a segment after the selection and selects it', () => {
    const before = useConfigStore.getState().config!.pipeline.segments.length
    useConfigStore.getState().addSegment('bend', 's1')
    const s = useConfigStore.getState()
    const segs = s.config!.pipeline.segments
    expect(segs).toHaveLength(before + 1)
    expect(segs[1]!.kind).toBe('bend')
    expect(s.selectedSegmentId).toBe(segs[1]!.id)
    // continues the diameter of the previous segment
    if (segs[1]!.kind === 'bend' && segs[0]!.kind === 'straight') expect(segs[1]!.diameter).toBe(segs[0]!.diameter)
  })

  it('updates, moves, duplicates and removes segments', () => {
    const st = useConfigStore.getState
    const first = st().config!.pipeline.segments[0]!
    st().updateSegment('s1', { ...first, id: 'inlet', label: 'Inlet' })
    expect(st().config!.pipeline.segments[0]!.id).toBe('inlet')
    expect(st().selectedSegmentId).toBe('inlet')
    st().moveSegment('inlet', 1)
    expect(st().config!.pipeline.segments[1]!.id).toBe('inlet')
    st().duplicateSegment('inlet')
    expect(st().config!.pipeline.segments[2]!.id).toBe('inlet-2')
    const n = st().config!.pipeline.segments.length
    st().removeSegment('inlet-2')
    expect(st().config!.pipeline.segments).toHaveLength(n - 1)
  })

  it('never removes the last segment', () => {
    const cfg = defaultConfig()
    cfg.pipeline.segments = cfg.pipeline.segments.slice(0, 1)
    useConfigStore.setState({ config: cfg })
    useConfigStore.getState().removeSegment(cfg.pipeline.segments[0]!.id)
    expect(useConfigStore.getState().config!.pipeline.segments).toHaveLength(1)
  })

  it('builds the effective config with the active controller', () => {
    useConfigStore.getState().setActive('gain_scheduled')
    const eff = useConfigStore.getState().effectiveConfig()!
    expect(eff.controller.type).toBe('gain_scheduled')
  })
})

describe('sim store – telemetry stream handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSimStoreForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('appends telemetry batches, resets on from = 0 and throttles React updates', () => {
    const h = useSimStore.getState()._handleMessage
    h({ type: 'telemetry', from: 0, samples: [sample(0), sample(0.02)] })
    h({ type: 'telemetry', from: 2, samples: [sample(0.04)] })
    expect(getTelemetry()).toHaveLength(3)
    expect(useSimStore.getState().telemetryVersion).toBe(0) // not flushed yet
    vi.advanceTimersByTime(150)
    expect(useSimStore.getState().telemetryVersion).toBe(1)
    // gap (from beyond buffer) is ignored, reset truncates
    h({ type: 'telemetry', from: 10, samples: [sample(1)] })
    expect(getTelemetry()).toHaveLength(3)
    h({ type: 'telemetry', from: 0, samples: [sample(0)] })
    expect(getTelemetry()).toHaveLength(1)
  })

  it('applies status snapshots immediately when the state changes', () => {
    const snap = {
      status: 'running' as const, time: 1, step: 200, progress: 0.1, station: 0.3, start_station: 0.12, goal_station: 4,
      pipeline_length: 4.4, telemetry_count: 50, violation_count: 0, collision_count: 0, latest: null, failure: null,
      controller: 'pid' as const, name: 'x',
    }
    useSimStore.getState()._handleMessage({ type: 'snapshot', id: 'id1', playback_speed: 5, snapshot: snap })
    expect(useSimStore.getState().snapshot?.status).toBe('running')
    expect(useSimStore.getState().playback).toBe(5)
  })
})

describe('results store', () => {
  it('keeps one entry per live simulation and selects the newest', () => {
    useResultsStore.getState().clear()
    const k1 = useResultsStore.getState().addRun(results({ status: 'failed' }), 'live', 'sim-1')
    const k2 = useResultsStore.getState().addRun(results(), 'live', 'sim-1')
    expect(k1).toBe(k2)
    expect(useResultsStore.getState().runs).toHaveLength(1)
    expect(useResultsStore.getState().selected).toEqual([k1])
  })
})
