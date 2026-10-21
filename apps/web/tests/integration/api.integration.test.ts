// @vitest-environment node
/**
 * Frontend ↔ Rust API integration: the production API client talks to a
 * real server process (started by global-setup.ts).
 */
import { describe, expect, inject, it } from 'vitest'
import { ApiError, createApiClient } from '@/services/api'
import { telemetryToCsv } from '@/lib/export'
import type { StatusSnapshot, TelemetrySample, ViolationEvent, WsMessage } from '@/types/api'

const api = createApiClient({ baseUrl: inject('apiUrl') })

describe('Rust API integration', () => {
  it('serves health, default configuration and presets', async () => {
    const h = await api.health()
    expect(h.status).toBe('ok')
    const cfg = await api.defaultConfig()
    expect(cfg.robot.wheel_count).toBe(4)
    expect(cfg.pipeline.segments.length).toBeGreaterThan(3)
    const presets = await api.presets()
    expect(presets.map((p) => p.code)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'E', 'F']))
  })

  it('rejects invalid configurations with field-level details', async () => {
    const cfg = await api.defaultConfig()
    cfg.robot.wheel_radius = -1
    const err = await api.createSimulation(cfg).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).details.map((d) => d.field)).toContain('robot.wheel_radius')
  })

  it('runs a live simulation and streams telemetry over WebSocket', async () => {
    const cfg = await api.defaultConfig()
    const created = await api.createSimulation(cfg, 200)
    expect(created.status).toBe('ready')
    await expect(api.pause(created.id)).rejects.toMatchObject({ status: 409 })

    const samples: TelemetrySample[] = []
    let events: ViolationEvent[] = []
    let last: StatusSnapshot | null = null
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stream timeout')), 60_000)
      const close = api.openStream(created.id, {
        onMessage: (m: WsMessage) => {
          if (m.type === 'telemetry') {
            if (m.from === 0) samples.length = 0
            samples.push(...m.samples)
          } else if (m.type === 'events') {
            events = m.events
          } else {
            last = m.snapshot
            if (['completed', 'failed', 'cancelled'].includes(m.snapshot.status) && samples.length === m.snapshot.telemetry_count) {
              clearTimeout(timer)
              close()
              resolve()
            }
          }
        },
        onError: () => reject(new Error('websocket error')),
      })
      void api.start(created.id).catch(reject)
    })
    await done
    expect(last!.status).toBe('completed')
    expect(samples.length).toBeGreaterThan(100)
    // Samples arrive in order with a fixed telemetry interval.
    for (let i = 1; i < samples.length - 1; i++) expect(samples[i]!.t).toBeGreaterThan(samples[i - 1]!.t)
    const results = await api.results(created.id)
    expect(results.metrics.goal_reached).toBe(true)
    expect(results.telemetry).toHaveLength(samples.length)
    expect(results.events).toHaveLength(events.length)
    // Client-side CSV export of the streamed telemetry.
    expect(telemetryToCsv(samples).trim().split('\n')).toHaveLength(samples.length + 1)

    // Reset → instant run reproduces the same telemetry (deterministic engine).
    expect((await api.reset(created.id)).status).toBe('ready')
    const again = await api.runToCompletion(created.id)
    expect(again.telemetry).toEqual(results.telemetry)
    await api.deleteSimulation(created.id)
  }, 90_000)

  it('pauses, changes playback speed, resumes and stops', async () => {
    const cfg = await api.defaultConfig()
    const s = await api.createSimulation(cfg, 1)
    await api.start(s.id)
    await new Promise((r) => setTimeout(r, 120))
    const paused = await api.pause(s.id)
    expect(paused.status).toBe('paused')
    await new Promise((r) => setTimeout(r, 120))
    expect((await api.status(s.id)).time).toBe(paused.time)
    expect((await api.setPlayback(s.id, 20)).playback_speed).toBe(20)
    expect((await api.resume(s.id)).status).toBe('running')
    expect((await api.stop(s.id)).status).toBe('cancelled')
  })

  it('compares controllers under identical conditions and analyses feasibility', async () => {
    const presets = await api.presets()
    const f = presets.find((p) => p.code === 'F')!
    const cmp = await api.compare(f.config, f.controllers)
    expect(cmp.runs).toHaveLength(3)
    expect(new Set(cmp.runs.map((r) => r.scenario_hash)).size).toBe(1)
    const rmse = cmp.runs.map((r) => r.metrics.lateral_error.rmse)
    expect(new Set(rmse.map((v) => v.toFixed(6))).size).toBe(3) // distinguishable results
    expect(cmp.report).toContain('Controller comparison')

    const b2 = presets.find((p) => p.code === 'B2')!
    const rep = await api.feasibility(b2.config)
    expect(rep.feasible).toBe(false)
    expect(rep.steps.some((s) => !s.climbable)).toBe(true)
  }, 60_000)
})
