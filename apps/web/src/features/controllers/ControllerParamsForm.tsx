import { useEffect, useRef } from 'react'
import { type FieldValues, type Path, type Resolver, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField } from '@/components/common'

export interface ParamField {
  path: string
  label: string
  unit?: string
  step?: number
}

export interface ParamGroup {
  title: string
  fields: ParamField[]
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)
}

/** Numeric parameter form; valid edits are committed after a short debounce. */
export function ControllerParamsForm<T extends FieldValues>({
  idPrefix,
  values,
  schema,
  groups,
  onCommit,
  modePath,
}: {
  idPrefix: string
  values: T
  schema: z.ZodType<T>
  groups: ParamGroup[]
  onCommit: (v: T) => void
  /** Optional path of a longitudinal-mode select ("position" | "velocity"). */
  modePath?: string
}) {
  const form = useForm<T>({
    resolver: zodResolver(schema as never) as unknown as Resolver<T>,
    defaultValues: values as never,
    mode: 'onChange',
  })
  const { register, watch, trigger, getValues, formState, setValue, reset } = form
  const commit = useRef(onCommit)
  commit.current = onCommit
  const lastValues = useRef(values)

  useEffect(() => {
    if (values !== lastValues.current) {
      lastValues.current = values
      reset(values as never)
    }
  }, [values, reset])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const sub = watch(() => {
      clearTimeout(t)
      t = setTimeout(async () => {
        if (await trigger()) {
          const v = getValues()
          lastValues.current = v
          commit.current(v)
        }
      }, 300)
    })
    return () => {
      clearTimeout(t)
      sub.unsubscribe()
    }
  }, [watch, trigger, getValues])

  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()} noValidate>
      {modePath ? (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-mode`} className="text-xs">
            Longitudinal loop regulates
          </Label>
          <Select
            value={String(get(watch(), modePath) ?? 'position')}
            onValueChange={(v) => setValue(modePath as Path<T>, v as never, { shouldValidate: true, shouldDirty: true })}
          >
            <SelectTrigger id={`${idPrefix}-mode`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="position">Trajectory (along-track position error e_x)</SelectItem>
              <SelectItem value="velocity">Velocity tracking error (v_r − v)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {groups.map((g) => (
        <fieldset key={g.title} className="space-y-1.5">
          <legend className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.fields.map((f) => {
              const e = get(formState.errors, f.path) as { message?: string } | undefined
              return (
                <NumberField
                  key={f.path}
                  id={`${idPrefix}-${f.path.replace(/\./g, '-')}`}
                  label={f.label}
                  unit={f.unit}
                  step={f.step ?? 'any'}
                  error={e?.message}
                  {...register(f.path as Path<T>, { valueAsNumber: true })}
                />
              )
            })}
          </div>
        </fieldset>
      ))}
    </form>
  )
}

export const pidGainFields = (prefix: string, outUnit: string, errUnit: string): ParamField[] => [
  { path: `${prefix}.kp`, label: 'K_p', unit: `${outUnit}/${errUnit}`, step: 0.1 },
  { path: `${prefix}.ki`, label: 'K_i', unit: `${outUnit}/(${errUnit}·s)`, step: 0.1 },
  { path: `${prefix}.kd`, label: 'K_d', unit: `${outUnit}·s/${errUnit}`, step: 0.05 },
  { path: `${prefix}.output_limit`, label: 'Output limit ±', unit: outUnit, step: 0.01 },
  { path: `${prefix}.integral_limit`, label: 'Integral limit ±', unit: outUnit, step: 0.01 },
  { path: `${prefix}.derivative_filter`, label: 'D filter T_f', unit: 's', step: 0.01 },
  { path: `${prefix}.anti_windup_gain`, label: 'Anti-windup K_t', unit: '1/s', step: 0.1 },
]
