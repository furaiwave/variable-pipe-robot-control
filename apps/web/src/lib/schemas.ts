/**
 * Frontend validation. Forms work in display units (mm, °, …); every field
 * spec declares its SI scale so values are converted exactly once on commit.
 * Ranges mirror the Rust validators, which remain authoritative (the server
 * re-validates every request).
 */
import { z } from 'zod'
import { DEG2RAD, RAD2DEG } from '@/lib/format'
import type {
  GainScheduledParams,
  KinematicParams,
  PidGains,
  PidTrackingParams,
  RobotConfig,
  Segment,
  SegmentKind,
  SimulationConfig,
} from '@/types/api'

export interface FieldSpec<K extends string = string> {
  key: K
  label: string
  unit: string
  /** display value = SI value × scale */
  scale: number
  min: number
  max: number
  step?: number
  hint?: string
}

const num = (spec: FieldSpec) =>
  z
    .number({ error: 'Введіть число' })
    .refine((v) => Number.isFinite(v), 'Введіть скінченне число')
    .refine((v) => v >= spec.min, `Має бути ≥ ${spec.min}`)
    .refine((v) => v <= spec.max, `Має бути ≤ ${spec.max}`)

function shapeOf<K extends string>(specs: FieldSpec<K>[]) {
  const shape: Record<string, ReturnType<typeof num>> = {}
  for (const s of specs) shape[s.key] = num(s)
  return shape as Record<K, ReturnType<typeof num>>
}

// ------------------------------------------------------------------ robot

export type RobotNumericKey =
  | 'body_length' | 'body_width' | 'body_height' | 'chassis_clearance' | 'wheel_radius' | 'wheel_width'
  | 'wheelbase' | 'track_width' | 'mass' | 'com_offset_x' | 'com_height' | 'max_linear_velocity'
  | 'max_angular_velocity' | 'max_wheel_speed' | 'max_wheel_acceleration' | 'max_motor_torque'
  | 'rolling_resistance' | 'friction_coefficient' | 'lateral_friction_coefficient' | 'motor_time_constant'
  | 'max_contact_angle' | 'noise_position_std' | 'noise_heading_std'

const MM = 1000

export const ROBOT_GROUPS: { title: string; fields: FieldSpec<RobotNumericKey>[] }[] = [
  {
    title: 'Корпус і колеса',
    fields: [
      { key: 'body_length', label: 'Довжина корпусу', unit: 'мм', scale: MM, min: 10, max: 5000 },
      { key: 'body_width', label: 'Ширина корпусу', unit: 'мм', scale: MM, min: 10, max: 5000 },
      { key: 'body_height', label: 'Висота корпусу', unit: 'мм', scale: MM, min: 5, max: 5000 },
      { key: 'chassis_clearance', label: 'Кліренс шасі', unit: 'мм', scale: MM, min: 0, max: 1000, hint: 'Висота днища над площиною контакту коліс' },
      { key: 'wheel_radius', label: 'Радіус колеса r', unit: 'мм', scale: MM, min: 5, max: 1000 },
      { key: 'wheel_width', label: 'Ширина колеса', unit: 'мм', scale: MM, min: 2, max: 500 },
      { key: 'wheelbase', label: 'Колісна база (передня–задня вісь)', unit: 'мм', scale: MM, min: 10, max: 5000 },
      { key: 'track_width', label: 'Колія L', unit: 'мм', scale: MM, min: 10, max: 5000, hint: 'Відстань між середніми площинами лівих і правих коліс' },
    ],
  },
  {
    title: 'Масові характеристики',
    fields: [
      { key: 'mass', label: 'Маса', unit: 'кг', scale: 1, min: 0.05, max: 1000, step: 0.1 },
      { key: 'com_offset_x', label: 'Поздовжнє зміщення центру мас', unit: 'мм', scale: MM, min: -2500, max: 2500, hint: '+ вперед від геометричного центру' },
      { key: 'com_height', label: 'Висота центру мас', unit: 'мм', scale: MM, min: 0, max: 2000 },
    ],
  },
  {
    title: 'Обмеження руху',
    fields: [
      { key: 'max_linear_velocity', label: 'Макс. лінійна швидкість', unit: 'м/с', scale: 1, min: 0.001, max: 10, step: 0.01 },
      { key: 'max_angular_velocity', label: 'Макс. кутова швидкість', unit: 'рад/с', scale: 1, min: 0.01, max: 20, step: 0.1 },
      { key: 'max_wheel_speed', label: 'Макс. швидкість колеса', unit: 'рад/с', scale: 1, min: 0.1, max: 1000, step: 0.5 },
      { key: 'max_wheel_acceleration', label: 'Макс. прискорення колеса', unit: 'рад/с²', scale: 1, min: 0.1, max: 10000, step: 1 },
    ],
  },
  {
    title: 'Привід і контакт',
    fields: [
      { key: 'max_motor_torque', label: 'Макс. момент двигуна (на двигун)', unit: 'Н·м', scale: 1, min: 0.0001, max: 1000, step: 0.01 },
      { key: 'motor_time_constant', label: 'Стала часу двигуна τ', unit: 'с', scale: 1, min: 0.001, max: 2, step: 0.01 },
      { key: 'rolling_resistance', label: 'Опір коченню C_rr', unit: '–', scale: 1, min: 0, max: 0.5, step: 0.005 },
      { key: 'friction_coefficient', label: 'Тертя колесо–стінка μ', unit: '–', scale: 1, min: 0.05, max: 2, step: 0.05 },
      { key: 'lateral_friction_coefficient', label: 'Бічне тертя μ_lat', unit: '–', scale: 1, min: 0, max: 2, step: 0.05, hint: 'Опір повороту при бортовому керуванні' },
      { key: 'max_contact_angle', label: 'Макс. кут контакту зі стінкою', unit: '°', scale: RAD2DEG, min: 1, max: 85, step: 1 },
    ],
  },
  {
    title: 'Шум сенсорів (необов’язково)',
    fields: [
      { key: 'noise_position_std', label: 'Шум положення σ', unit: 'мм', scale: MM, min: 0, max: 100, step: 0.1 },
      { key: 'noise_heading_std', label: 'Шум курсу σ', unit: '°', scale: RAD2DEG, min: 0, max: 28, step: 0.1 },
    ],
  },
]

export const ROBOT_FIELDS = ROBOT_GROUPS.flatMap((g) => g.fields)

export const robotFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Вкажіть назву').max(120),
    wheel_count: z.union([z.literal(4), z.literal(6), z.literal(8)]),
    ...shapeOf(ROBOT_FIELDS),
  })
  .superRefine((v, ctx) => {
    if (v.track_width <= v.wheel_width) {
      ctx.addIssue({ code: 'custom', path: ['track_width'], message: 'Має перевищувати ширину колеса' })
    }
    if (Math.abs(v.com_offset_x) >= v.wheelbase / 2) {
      ctx.addIssue({ code: 'custom', path: ['com_offset_x'], message: 'Центр мас має бути між передньою і задньою осями' })
    }
    const axleSpacing = v.wheelbase / (v.wheel_count / 2 - 1)
    if (axleSpacing < 2 * v.wheel_radius) {
      ctx.addIssue({ code: 'custom', path: ['wheelbase'], message: `Відстань між осями ${axleSpacing.toFixed(1)} мм < діаметра колеса (колеса перекриваються)` })
    }
    const vMax = (v.max_wheel_speed * v.wheel_radius) / MM
    if (v.max_linear_velocity > vMax + 1e-12) {
      ctx.addIssue({ code: 'custom', path: ['max_linear_velocity'], message: `Перевищує швидкість колеса × радіус (${vMax.toFixed(3)} м/с)` })
    }
    if (v.chassis_clearance >= 2 * v.wheel_radius) {
      ctx.addIssue({ code: 'custom', path: ['chassis_clearance'], message: 'Має бути нижче верху колеса (2r)' })
    }
  })

export type RobotFormValues = z.infer<typeof robotFormSchema>

function siValue(r: RobotConfig, key: RobotNumericKey): number {
  if (key === 'noise_position_std') return r.sensor_noise.position_std
  if (key === 'noise_heading_std') return r.sensor_noise.heading_std
  return r[key]
}

const round = (v: number) => Math.round(v * 1e9) / 1e9

export function robotToForm(r: RobotConfig): RobotFormValues {
  const out: Record<string, unknown> = { name: r.name, wheel_count: r.wheel_count }
  for (const f of ROBOT_FIELDS) out[f.key] = round(siValue(r, f.key) * f.scale)
  return out as RobotFormValues
}

export function formToRobot(v: RobotFormValues): RobotConfig {
  const si = (key: RobotNumericKey) => {
    const spec = ROBOT_FIELDS.find((f) => f.key === key)!
    return v[key] / spec.scale
  }
  return {
    name: v.name.trim(),
    wheel_count: v.wheel_count,
    body_length: si('body_length'),
    body_width: si('body_width'),
    body_height: si('body_height'),
    chassis_clearance: si('chassis_clearance'),
    wheel_radius: si('wheel_radius'),
    wheel_width: si('wheel_width'),
    wheelbase: si('wheelbase'),
    track_width: si('track_width'),
    mass: si('mass'),
    com_offset_x: si('com_offset_x'),
    com_height: si('com_height'),
    max_linear_velocity: si('max_linear_velocity'),
    max_angular_velocity: si('max_angular_velocity'),
    max_wheel_speed: si('max_wheel_speed'),
    max_wheel_acceleration: si('max_wheel_acceleration'),
    max_motor_torque: si('max_motor_torque'),
    rolling_resistance: si('rolling_resistance'),
    friction_coefficient: si('friction_coefficient'),
    lateral_friction_coefficient: si('lateral_friction_coefficient'),
    motor_time_constant: si('motor_time_constant'),
    max_contact_angle: si('max_contact_angle'),
    sensor_noise: { position_std: si('noise_position_std'), heading_std: si('noise_heading_std') },
  }
}

// ------------------------------------------------------------------ pipeline segments

export const SEGMENT_FIELDS = {
  length: { key: 'length', label: 'Довжина', unit: 'м', scale: 1, min: 0.01, max: 1000, step: 0.05 },
  diameter: { key: 'diameter', label: 'Внутрішній діаметр', unit: 'мм', scale: MM, min: 20, max: 5000, step: 1 },
  diameter_start: { key: 'diameter_start', label: 'Початковий діаметр', unit: 'мм', scale: MM, min: 20, max: 5000, step: 1 },
  diameter_end: { key: 'diameter_end', label: 'Кінцевий діаметр', unit: 'мм', scale: MM, min: 20, max: 5000, step: 1 },
  bend_radius: { key: 'bend_radius', label: 'Радіус вигину (осьова лінія)', unit: 'м', scale: 1, min: 0.01, max: 1000, step: 0.05 },
  angle: { key: 'angle', label: 'Кут вигину (+ ліворуч)', unit: '°', scale: RAD2DEG, min: -180, max: 180, step: 5 },
  inclination: { key: 'inclination', label: 'Нахил (+ угору)', unit: '°', scale: RAD2DEG, min: -60, max: 60, step: 1 },
} satisfies Record<string, FieldSpec>

const restrictionSchema = z.object({
  position: z.number({ error: 'Введіть число' }).min(0, 'Має бути ≥ 0'),
  length: z.number({ error: 'Введіть число' }).min(1, 'Має бути ≥ 1 мм'),
  height: z.number({ error: 'Введіть число' }).min(0.1, 'Має бути ≥ 0.1 мм'),
  label: z.string().max(80),
})

export const segmentFormSchema = z
  .object({
    kind: z.enum(['straight', 'transition', 'bend']),
    id: z.string().trim().min(1, 'Вкажіть ідентифікатор').max(40),
    label: z.string().max(80),
    length: num(SEGMENT_FIELDS.length),
    diameter: num(SEGMENT_FIELDS.diameter),
    diameter_start: num(SEGMENT_FIELDS.diameter_start),
    diameter_end: num(SEGMENT_FIELDS.diameter_end),
    profile: z.enum(['linear', 'smooth']),
    bend_radius: num(SEGMENT_FIELDS.bend_radius),
    angle: num(SEGMENT_FIELDS.angle),
    inclination: num(SEGMENT_FIELDS.inclination),
    /** mm; NaN/empty = not set */
    min_clearance: z.number().nullable(),
    /** position in m; length and height in mm */
    restrictions: z.array(restrictionSchema),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'bend') {
      if (Math.abs(v.angle) < 0.1) ctx.addIssue({ code: 'custom', path: ['angle'], message: 'Модуль має бути ≥ 0.1°' })
      if (v.bend_radius * MM <= v.diameter / 2) {
        ctx.addIssue({ code: 'custom', path: ['bend_radius'], message: `Має перевищувати радіус труби (${(v.diameter / 2).toFixed(0)} мм)` })
      }
    }
    if (v.min_clearance !== null && Number.isFinite(v.min_clearance) && (v.min_clearance < 0 || v.min_clearance > 500)) {
      ctx.addIssue({ code: 'custom', path: ['min_clearance'], message: 'Має бути в межах [0, 500] мм' })
    }
    const len = v.kind === 'bend' ? v.bend_radius * Math.abs(v.angle) * DEG2RAD : v.length
    const dmin = v.kind === 'transition' ? Math.min(v.diameter_start, v.diameter_end) : v.diameter
    const spans: [number, number][] = []
    v.restrictions.forEach((r, i) => {
      if (r.position + r.length / MM > len + 1e-9) {
        ctx.addIssue({ code: 'custom', path: ['restrictions', i, 'length'], message: `Виходить за кінець сегмента (${len.toFixed(3)} м)` })
      }
      if (r.height >= 0.45 * dmin) {
        ctx.addIssue({ code: 'custom', path: ['restrictions', i, 'height'], message: `Має бути < 45 % діаметра (${(0.45 * dmin).toFixed(1)} мм)` })
      }
      spans.push([r.position, r.position + r.length / MM])
    })
    spans.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i++) {
      if (spans[i]![0] < spans[i - 1]![1] - 1e-12) {
        ctx.addIssue({ code: 'custom', path: ['restrictions'], message: 'Звуження не повинні перекриватися' })
        break
      }
    }
  })

export type SegmentFormValues = z.infer<typeof segmentFormSchema>

export function segmentToForm(s: Segment): SegmentFormValues {
  const d = s.kind === 'transition' ? s.diameter_start : s.diameter
  return {
    kind: s.kind,
    id: s.id,
    label: s.label ?? '',
    length: s.kind === 'bend' ? round(s.bend_radius * Math.abs(s.angle)) : s.length,
    diameter: round(d * MM),
    diameter_start: round((s.kind === 'transition' ? s.diameter_start : d) * MM),
    diameter_end: round((s.kind === 'transition' ? s.diameter_end : d) * MM),
    profile: s.kind === 'transition' ? s.profile : 'linear',
    bend_radius: s.kind === 'bend' ? s.bend_radius : 0.5,
    angle: s.kind === 'bend' ? round(s.angle * RAD2DEG) : 90,
    inclination: round(s.inclination * RAD2DEG),
    min_clearance: s.min_clearance === null ? null : round(s.min_clearance * MM),
    restrictions: s.restrictions.map((r) => ({
      position: r.position,
      length: round(r.length * MM),
      height: round(r.height * MM),
      label: r.label ?? '',
    })),
  }
}

export function formToSegment(v: SegmentFormValues): Segment {
  const base = {
    id: v.id.trim(),
    label: v.label,
    inclination: v.inclination * DEG2RAD,
    min_clearance: v.min_clearance === null || !Number.isFinite(v.min_clearance) ? null : v.min_clearance / MM,
    restrictions: v.restrictions.map((r) => ({ position: r.position, length: r.length / MM, height: r.height / MM, label: r.label })),
  }
  switch (v.kind) {
    case 'straight':
      return { ...base, kind: 'straight', length: v.length, diameter: v.diameter / MM }
    case 'transition':
      return {
        ...base,
        kind: 'transition',
        length: v.length,
        diameter_start: v.diameter_start / MM,
        diameter_end: v.diameter_end / MM,
        profile: v.profile,
      }
    case 'bend':
      return { ...base, kind: 'bend', bend_radius: v.bend_radius, angle: v.angle * DEG2RAD, diameter: v.diameter / MM }
  }
}

export function segmentLength(s: Segment): number {
  return s.kind === 'bend' ? s.bend_radius * Math.abs(s.angle) : s.length
}

export function segmentEndDiameter(s: Segment): number {
  return s.kind === 'transition' ? s.diameter_end : s.diameter
}

export function newSegmentId(existing: Segment[], kind: SegmentKind): string {
  const prefix = kind === 'bend' ? 'b' : kind === 'transition' ? 't' : 's'
  let i = existing.length + 1
  const ids = new Set(existing.map((s) => s.id))
  while (ids.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

/** Template for a new segment continuing the previous diameter. */
export function makeSegment(kind: SegmentKind | 'narrow' | 'restriction', existing: Segment[], diameter: number): Segment {
  const common = { label: '', inclination: 0, min_clearance: null, restrictions: [] }
  switch (kind) {
    case 'straight':
      return { ...common, id: newSegmentId(existing, 'straight'), kind: 'straight', length: 1, diameter }
    case 'transition':
      return {
        ...common,
        id: newSegmentId(existing, 'transition'),
        label: 'Перехід',
        kind: 'transition',
        length: 0.5,
        diameter_start: diameter,
        diameter_end: Math.max(0.02, Math.round(diameter * 0.8 * 1000) / 1000),
        profile: 'linear',
      }
    case 'bend':
      return {
        ...common,
        id: newSegmentId(existing, 'bend'),
        label: 'Вигин',
        kind: 'bend',
        bend_radius: Math.max(0.5, diameter * 2),
        angle: Math.PI / 2,
        diameter,
      }
    case 'narrow':
      return {
        ...common,
        id: newSegmentId(existing, 'straight'),
        label: 'Вузький прохід',
        kind: 'straight',
        length: 0.5,
        diameter: Math.round(diameter * 0.85 * 1000) / 1000,
      }
    case 'restriction':
      return {
        ...common,
        id: newSegmentId(existing, 'straight'),
        label: 'Прямий зі зварним швом',
        kind: 'straight',
        length: 0.6,
        diameter,
        restrictions: [{ position: 0.3, length: 0.01, height: 0.003, label: 'Зварний шов' }],
      }
  }
}

// ------------------------------------------------------------------ controllers

export const pidGainsSchema = z.object({
  kp: z.number().min(0).max(1e4),
  ki: z.number().min(0).max(1e4),
  kd: z.number().min(0).max(1e4),
  integral_limit: z.number().min(0).max(1e4),
  output_limit: z.number().min(1e-6, 'Має бути > 0').max(1e4),
  derivative_filter: z.number().min(0).max(10),
  anti_windup_gain: z.number().min(0).max(1e4),
}) satisfies z.ZodType<PidGains>

export const kinematicSchema = z.object({
  k_x: z.number().min(0).max(1e3),
  k_y: z.number().min(0).max(1e5),
  k_theta: z.number().min(0).max(1e4),
}) satisfies z.ZodType<KinematicParams>

export const pidTrackingSchema = z.object({
  longitudinal_mode: z.enum(['position', 'velocity']),
  longitudinal: pidGainsSchema,
  lateral: pidGainsSchema,
  lookahead: z.number().min(0).max(5),
}) satisfies z.ZodType<PidTrackingParams>

export const gainScheduledSchema = z
  .object({
    base: pidTrackingSchema,
    margin_reference: z.number().min(1e-4).max(1),
    curvature_length: z.number().min(1e-3).max(100),
    min_multiplier: z.number().min(0.05).max(20),
    max_multiplier: z.number().min(0.05).max(20),
    schedule_time_constant: z.number().min(0).max(10),
  })
  .refine((v) => v.min_multiplier <= v.max_multiplier, { path: ['max_multiplier'], message: 'Має бути ≥ мінімального множника' }) satisfies z.ZodType<GainScheduledParams>

// ------------------------------------------------------------------ simulation settings

export const simSettingsSchema = z
  .object({
    cruise_speed: z.number({ error: 'Введіть число' }).min(0.001).max(10),
    max_acceleration: z.number({ error: 'Введіть число' }).min(0.001).max(20),
    bend_speed_factor: z.number({ error: 'Введіть число' }).min(0.05).max(1),
    reference_offset_mm: z.number({ error: 'Введіть число' }).min(-1000).max(1000),
    initial_offset_mm: z.number({ error: 'Введіть число' }).min(-1000).max(1000),
    initial_heading_deg: z.number({ error: 'Введіть число' }).min(-57).max(57),
    wheel_mismatch_pct: z.number({ error: 'Введіть число' }).min(-20).max(20),
    time_step_ms: z.number({ error: 'Введіть число' }).min(0.5).max(50),
    max_duration: z.number({ error: 'Введіть число' }).min(0.1).max(3600),
    telemetry_interval_ms: z.number({ error: 'Введіть число' }).min(0.5).max(5000),
    safety_margin_mm: z.number({ error: 'Введіть число' }).min(0).max(500),
    stop_on_collision: z.boolean(),
    seed: z.number({ error: 'Введіть число' }).int('Має бути цілим числом').min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .refine((v) => v.telemetry_interval_ms >= v.time_step_ms, { path: ['telemetry_interval_ms'], message: 'Має бути ≥ кроку часу' })
  .refine((v) => v.max_duration / (v.time_step_ms / 1000) <= 2e6, { path: ['max_duration'], message: 'Забагато кроків (≤ 2·10⁶)' })

export type SimSettingsValues = z.infer<typeof simSettingsSchema>

export function settingsToForm(c: SimulationConfig): SimSettingsValues {
  return {
    cruise_speed: c.reference.cruise_speed,
    max_acceleration: c.reference.max_acceleration,
    bend_speed_factor: c.reference.bend_speed_factor,
    reference_offset_mm: round(c.reference.lateral_offset * MM),
    initial_offset_mm: round(c.initial.lateral_offset * MM),
    initial_heading_deg: round(c.initial.heading_error * RAD2DEG),
    wheel_mismatch_pct: round(c.disturbances.wheel_radius_mismatch * 100),
    time_step_ms: round(c.time_step * 1000),
    max_duration: c.max_duration,
    telemetry_interval_ms: round(c.telemetry_interval * 1000),
    safety_margin_mm: round(c.safety_margin * MM),
    stop_on_collision: c.stop_on_collision,
    seed: c.seed,
  }
}

export function applySettings(c: SimulationConfig, v: SimSettingsValues): SimulationConfig {
  return {
    ...c,
    reference: {
      cruise_speed: v.cruise_speed,
      max_acceleration: v.max_acceleration,
      bend_speed_factor: v.bend_speed_factor,
      lateral_offset: v.reference_offset_mm / MM,
    },
    initial: { ...c.initial, lateral_offset: v.initial_offset_mm / MM, heading_error: v.initial_heading_deg * DEG2RAD },
    disturbances: { wheel_radius_mismatch: v.wheel_mismatch_pct / 100 },
    time_step: v.time_step_ms / 1000,
    max_duration: v.max_duration,
    telemetry_interval: v.telemetry_interval_ms / 1000,
    safety_margin: v.safety_margin_mm / MM,
    stop_on_collision: v.stop_on_collision,
    seed: v.seed,
  }
}
