import { useEffect, useRef } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { NumberField } from '@/components/common'
import {
  SEGMENT_FIELDS,
  type FieldSpec,
  formToSegment,
  segmentFormSchema,
  segmentToForm,
  type SegmentFormValues,
} from '@/lib/schemas'
import type { Segment } from '@/types/api'

export interface SegmentFormProps {
  segment: Segment
  /** IDs of the other segments (for uniqueness). */
  otherIds: string[]
  /** Station of the segment start along the pipeline, m (read-only). */
  station: number | null
  onCommit: (seg: Segment) => void
  /** Debounce before committing valid edits, ms. */
  debounceMs?: number
}

export function SegmentForm({ segment, otherIds, station, onCommit, debounceMs = 250 }: SegmentFormProps) {
  const form = useForm<SegmentFormValues>({
    resolver: zodResolver(segmentFormSchema),
    defaultValues: segmentToForm(segment),
    mode: 'onChange',
  })
  const { register, watch, formState, trigger, getValues, setError, control, setValue } = form
  const restrictions = useFieldArray({ control, name: 'restrictions' })
  const kind = watch('kind')
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const sub = watch(() => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const valid = await trigger()
        if (!valid) return
        const v = getValues()
        if (otherIds.includes(v.id.trim())) {
          setError('id', { message: `Ідентифікатор '${v.id}' уже використано іншим сегментом` })
          return
        }
        commitRef.current(formToSegment(v))
      }, debounceMs)
    })
    return () => {
      clearTimeout(timer)
      sub.unsubscribe()
    }
  }, [watch, trigger, getValues, setError, otherIds, debounceMs])

  const err = (name: string) => {
    const parts = name.split('.')
    let e: unknown = formState.errors
    for (const p of parts) e = (e as Record<string, unknown> | undefined)?.[p]
    return (e as { message?: string } | undefined)?.message
  }

  const numField = (spec: FieldSpec, name: keyof SegmentFormValues) => (
    <NumberField
      id={`seg-${String(name)}`}
      label={spec.label}
      unit={spec.unit}
      step={spec.step}
      error={err(String(name))}
      {...register(name, { valueAsNumber: true })}
    />
  )

  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()} aria-label="Властивості сегмента">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="seg-id" className="text-xs">
            Ідентифікатор сегмента
          </Label>
          <Input id="seg-id" className="h-8" aria-invalid={err('id') ? true : undefined} {...register('id')} />
          {err('id') ? <p role="alert" className="text-xs text-destructive">{err('id')}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="seg-kind" className="text-xs">
            Тип
          </Label>
          <Select value={kind} onValueChange={(v) => setValue('kind', v as SegmentFormValues['kind'], { shouldValidate: true, shouldDirty: true })}>
            <SelectTrigger id="seg-kind" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="straight">Прямий</SelectItem>
              <SelectItem value="transition">Перехід діаметра</SelectItem>
              <SelectItem value="bend">Круговий вигин</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="seg-label" className="text-xs">
          Підпис
        </Label>
        <Input id="seg-label" className="h-8" placeholder="напр. Перехід DN250→DN200" {...register('label')} />
      </div>
      {station !== null ? (
        <p className="text-xs text-muted-foreground">
          Положення вздовж трубопроводу: s = <span className="tabular font-medium text-foreground">{station.toFixed(3)} м</span> (розраховано)
        </p>
      ) : null}
      <Separator />
      <div className="grid grid-cols-2 gap-2">
        {kind !== 'bend' ? numField(SEGMENT_FIELDS.length, 'length') : null}
        {kind === 'straight' || kind === 'bend' ? numField(SEGMENT_FIELDS.diameter, 'diameter') : null}
        {kind === 'transition' ? (
          <>
            {numField(SEGMENT_FIELDS.diameter_start, 'diameter_start')}
            {numField(SEGMENT_FIELDS.diameter_end, 'diameter_end')}
            <div className="space-y-1">
              <Label htmlFor="seg-profile" className="text-xs">
                Профіль переходу
              </Label>
              <Select
                value={watch('profile')}
                onValueChange={(v) => setValue('profile', v as 'linear' | 'smooth', { shouldValidate: true, shouldDirty: true })}
              >
                <SelectTrigger id="seg-profile" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Лінійний (конічний)</SelectItem>
                  <SelectItem value="smooth">Плавний (3t² − 2t³)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
        {kind === 'bend' ? (
          <>
            {numField(SEGMENT_FIELDS.bend_radius, 'bend_radius')}
            {numField(SEGMENT_FIELDS.angle, 'angle')}
          </>
        ) : null}
        {numField(SEGMENT_FIELDS.inclination, 'inclination')}
        <NumberField
          id="seg-min_clearance"
          label="Мін. зазор (необов’язково)"
          unit="мм"
          hint="Замінює глобальний безпечний зазор, якщо більший"
          error={err('min_clearance')}
          {...register('min_clearance', { setValueAs: (v: string) => (v === '' || v === null ? null : Number(v)) })}
        />
      </div>
      <Separator />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Внутрішні звуження / перешкоди</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => restrictions.append({ position: 0, length: 10, height: 3, label: 'Звуження' })}
          >
            <Plus /> Додати
          </Button>
        </div>
        {restrictions.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Немає. Звуження (зварний шов, кільце відкладень, сідло клапана) зменшує внутрішній радіус на свою висоту на своїй довжині.
          </p>
        ) : null}
        {err('restrictions') ? <p role="alert" className="text-xs text-destructive">{err('restrictions')}</p> : null}
        {restrictions.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-md border p-2">
            <NumberField id={`r${i}-pos`} label="Початок" unit="м" error={err(`restrictions.${i}.position`)} {...register(`restrictions.${i}.position`, { valueAsNumber: true })} />
            <NumberField id={`r${i}-len`} label="Довжина" unit="мм" error={err(`restrictions.${i}.length`)} {...register(`restrictions.${i}.length`, { valueAsNumber: true })} />
            <NumberField id={`r${i}-h`} label="Висота" unit="мм" error={err(`restrictions.${i}.height`)} {...register(`restrictions.${i}.height`, { valueAsNumber: true })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Видалити звуження ${i + 1}`} onClick={() => restrictions.remove(i)}>
              <Trash2 />
            </Button>
            <Input className="col-span-4 h-7 text-xs" placeholder="Підпис" aria-label={`Підпис звуження ${i + 1}`} {...register(`restrictions.${i}.label`)} />
          </div>
        ))}
      </div>
    </form>
  )
}
