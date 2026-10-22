import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { NumberField } from '@/components/common'
import { applySettings, settingsToForm, simSettingsSchema, type SimSettingsValues } from '@/lib/schemas'
import type { SimulationConfig } from '@/types/api'

type NumKey = Exclude<keyof SimSettingsValues, 'stop_on_collision'>

const GROUPS: { title: string; fields: { key: NumKey; label: string; unit?: string; step?: number; hint?: string }[] }[] = [
  {
    title: 'Опорна траєкторія (однакова для всіх регуляторів)',
    fields: [
      { key: 'cruise_speed', label: 'Крейсерська швидкість', unit: 'м/с', step: 0.01 },
      { key: 'max_acceleration', label: 'Прискорення опорного руху', unit: 'м/с²', step: 0.05 },
      { key: 'bend_speed_factor', label: 'Коефіцієнт швидкості у вигинах', step: 0.05, hint: 'v ≤ коеф. · ω_max / |κ|' },
      { key: 'reference_offset_mm', label: 'Бічне зміщення траєкторії', unit: 'мм', step: 1 },
    ],
  },
  {
    title: 'Початкові умови та збурення',
    fields: [
      { key: 'initial_offset_mm', label: 'Початкове бічне зміщення', unit: 'мм', step: 1 },
      { key: 'initial_heading_deg', label: 'Початкова похибка курсу', unit: '°', step: 0.5 },
      { key: 'wheel_mismatch_pct', label: 'Похибка радіуса правого колеса', unit: '%', step: 0.5, hint: 'Не враховується регуляторами' },
      { key: 'seed', label: 'Зерно генератора (шум сенсорів)', step: 1 },
    ],
  },
  {
    title: 'Чисельні параметри та обмеження',
    fields: [
      { key: 'time_step_ms', label: 'Фіксований крок Δt', unit: 'мс', step: 0.5 },
      { key: 'telemetry_interval_ms', label: 'Інтервал телеметрії', unit: 'мс', step: 5 },
      { key: 'max_duration', label: 'Макс. модельний час', unit: 'с', step: 5 },
      { key: 'safety_margin_mm', label: 'Необхідний безпечний зазор', unit: 'мм', step: 0.5 },
    ],
  },
]

export function SimSettingsForm({ config, onCommit }: { config: SimulationConfig; onCommit: (c: SimulationConfig) => void }) {
  const form = useForm<SimSettingsValues>({ resolver: zodResolver(simSettingsSchema), defaultValues: settingsToForm(config), mode: 'onChange' })
  const { register, watch, trigger, getValues, formState, setValue } = form
  const latest = useRef({ config, onCommit })
  latest.current = { config, onCommit }

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const sub = watch(() => {
      clearTimeout(t)
      t = setTimeout(async () => {
        if (await trigger()) latest.current.onCommit(applySettings(latest.current.config, getValues()))
      }, 300)
    })
    return () => {
      clearTimeout(t)
      sub.unsubscribe()
    }
  }, [watch, trigger, getValues])

  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()} aria-label="Налаштування моделювання" noValidate>
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="space-y-1.5">
          <legend className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</legend>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {g.fields.map((f) => (
              <NumberField
                key={f.key}
                id={`sim-${f.key}`}
                label={f.label}
                unit={f.unit}
                step={f.step}
                hint={f.hint}
                error={formState.errors[f.key]?.message}
                {...register(f.key, { valueAsNumber: true })}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center gap-2">
        <Switch
          id="sim-stop"
          checked={watch('stop_on_collision')}
          onCheckedChange={(v) => setValue('stop_on_collision', v, { shouldDirty: true, shouldValidate: true })}
        />
        <Label htmlFor="sim-stop" className="text-xs">
          Зупиняти при першому зіткненні (інакше зіткнення підраховуються, а запуск триває)
        </Label>
      </div>
    </form>
  )
}
