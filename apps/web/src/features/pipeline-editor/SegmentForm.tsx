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
          setError('id', { message: `ID '${v.id}' is already used by another segment` })
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
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()} aria-label="Segment properties">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="seg-id" className="text-xs">
            Segment ID
          </Label>
          <Input id="seg-id" className="h-8" aria-invalid={err('id') ? true : undefined} {...register('id')} />
          {err('id') ? <p role="alert" className="text-xs text-destructive">{err('id')}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="seg-kind" className="text-xs">
            Type
          </Label>
          <Select value={kind} onValueChange={(v) => setValue('kind', v as SegmentFormValues['kind'], { shouldValidate: true, shouldDirty: true })}>
            <SelectTrigger id="seg-kind" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="straight">Straight</SelectItem>
              <SelectItem value="transition">Diameter transition</SelectItem>
              <SelectItem value="bend">Circular bend</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="seg-label" className="text-xs">
          Label
        </Label>
        <Input id="seg-label" className="h-8" placeholder="e.g. Reducer DN250→DN200" {...register('label')} />
      </div>
      {station !== null ? (
        <p className="text-xs text-muted-foreground">
          Position along the pipeline: s = <span className="tabular font-medium text-foreground">{station.toFixed(3)} m</span> (computed)
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
                Transition profile
              </Label>
              <Select
                value={watch('profile')}
                onValueChange={(v) => setValue('profile', v as 'linear' | 'smooth', { shouldValidate: true, shouldDirty: true })}
              >
                <SelectTrigger id="seg-profile" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linear (conical)</SelectItem>
                  <SelectItem value="smooth">Smooth (3t² − 2t³)</SelectItem>
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
          label="Min. clearance (optional)"
          unit="mm"
          hint="Overrides the global safety clearance if larger"
          error={err('min_clearance')}
          {...register('min_clearance', { setValueAs: (v: string) => (v === '' || v === null ? null : Number(v)) })}
        />
      </div>
      <Separator />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Internal restrictions / obstacles</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => restrictions.append({ position: 0, length: 10, height: 3, label: 'Restriction' })}
          >
            <Plus /> Add
          </Button>
        </div>
        {restrictions.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None. A restriction (weld bead, deposit ring, valve seat) reduces the internal radius by its height over its length.
          </p>
        ) : null}
        {err('restrictions') ? <p role="alert" className="text-xs text-destructive">{err('restrictions')}</p> : null}
        {restrictions.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-md border p-2">
            <NumberField id={`r${i}-pos`} label="Start" unit="m" error={err(`restrictions.${i}.position`)} {...register(`restrictions.${i}.position`, { valueAsNumber: true })} />
            <NumberField id={`r${i}-len`} label="Length" unit="mm" error={err(`restrictions.${i}.length`)} {...register(`restrictions.${i}.length`, { valueAsNumber: true })} />
            <NumberField id={`r${i}-h`} label="Height" unit="mm" error={err(`restrictions.${i}.height`)} {...register(`restrictions.${i}.height`, { valueAsNumber: true })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove restriction ${i + 1}`} onClick={() => restrictions.remove(i)}>
              <Trash2 />
            </Button>
            <Input className="col-span-4 h-7 text-xs" placeholder="Label" aria-label={`Restriction ${i + 1} label`} {...register(`restrictions.${i}.label`)} />
          </div>
        ))}
      </div>
    </form>
  )
}
