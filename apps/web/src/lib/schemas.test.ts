import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/test/fixtures'
import {
  applySettings,
  formToRobot,
  formToSegment,
  makeSegment,
  robotFormSchema,
  robotToForm,
  segmentFormSchema,
  segmentToForm,
  settingsToForm,
  simSettingsSchema,
} from './schemas'
import type { Segment } from '@/types/api'

describe('robot form schema', () => {
  it('accepts the engine default robot and round-trips SI values', () => {
    const robot = defaultConfig().robot
    const form = robotToForm(robot)
    expect(form.wheel_radius).toBeCloseTo(30) // displayed in mm
    expect(form.max_contact_angle).toBeCloseTo(50) // displayed in degrees
    const parsed = robotFormSchema.safeParse(form)
    expect(parsed.success).toBe(true)
    const back = formToRobot(parsed.data!)
    for (const k of ['wheel_radius', 'track_width', 'max_contact_angle', 'mass'] as const) {
      expect(back[k]).toBeCloseTo(robot[k], 12)
    }
  })

  it('rejects non-positive, NaN and out-of-range values', () => {
    const form = robotToForm(defaultConfig().robot)
    const res = robotFormSchema.safeParse({ ...form, wheel_radius: -5, mass: Number.NaN, friction_coefficient: 9 })
    expect(res.success).toBe(false)
    const paths = res.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('wheel_radius')
    expect(paths).toContain('mass')
    expect(paths).toContain('friction_coefficient')
  })

  it('applies physical cross-field checks', () => {
    const form = robotToForm(defaultConfig().robot)
    const res = robotFormSchema.safeParse({ ...form, track_width: 10, wheel_width: 20, max_linear_velocity: 5, com_offset_x: 200 })
    expect(res.success).toBe(false)
    const paths = res.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['track_width', 'max_linear_velocity', 'com_offset_x']))
  })
})

describe('segment form schema', () => {
  const bend: Segment = {
    id: 'b1', label: 'Bend', kind: 'bend', bend_radius: 0.5, angle: Math.PI / 2, diameter: 0.2,
    inclination: 0.1, min_clearance: null, restrictions: [{ position: 0.1, length: 0.01, height: 0.003, label: 'w' }],
  }

  it('round-trips a bend with a restriction', () => {
    const form = segmentToForm(bend)
    expect(form.angle).toBeCloseTo(90)
    expect(form.diameter).toBeCloseTo(200)
    expect(segmentFormSchema.safeParse(form).success).toBe(true)
    const back = formToSegment(form)
    expect(back.kind).toBe('bend')
    if (back.kind === 'bend') {
      expect(back.angle).toBeCloseTo(Math.PI / 2, 12)
      expect(back.diameter).toBeCloseTo(0.2, 12)
    }
    expect(back.restrictions[0]!.height).toBeCloseTo(0.003, 12)
  })

  it('rejects a bend radius smaller than the pipe radius and an overlong restriction', () => {
    const form = segmentToForm({ ...bend, bend_radius: 0.05 })
    form.restrictions[0]!.position = 10
    const res = segmentFormSchema.safeParse(form)
    expect(res.success).toBe(false)
    const paths = res.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('bend_radius')
    expect(paths).toContain('restrictions.0.length')
  })

  it('creates templates that continue the previous diameter', () => {
    const segs = defaultConfig().pipeline.segments
    const t = makeSegment('transition', segs, 0.2)
    expect(t.kind).toBe('transition')
    if (t.kind === 'transition') expect(t.diameter_start).toBe(0.2)
    const n = makeSegment('narrow', segs, 0.2)
    expect(n.kind === 'straight' && n.diameter < 0.2).toBe(true)
    expect(new Set([...segs.map((s) => s.id), t.id]).size).toBe(segs.length + 1)
  })
})

describe('simulation settings schema', () => {
  it('round-trips settings and validates the telemetry interval', () => {
    const cfg = defaultConfig()
    const form = settingsToForm(cfg)
    expect(simSettingsSchema.safeParse(form).success).toBe(true)
    const back = applySettings(cfg, form)
    expect(back.time_step).toBeCloseTo(cfg.time_step, 12)
    expect(back.initial.lateral_offset).toBeCloseTo(cfg.initial.lateral_offset, 12)
    const bad = simSettingsSchema.safeParse({ ...form, telemetry_interval_ms: 1, time_step_ms: 5 })
    expect(bad.success).toBe(false)
  })
})
