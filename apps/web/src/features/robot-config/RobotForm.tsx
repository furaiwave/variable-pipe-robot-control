import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField } from '@/components/common'
import { ROBOT_GROUPS, formToRobot, robotFormSchema, robotToForm, type RobotFormValues } from '@/lib/schemas'
import type { RobotConfig, ValidationIssue } from '@/types/api'

export interface RobotFormProps {
  robot: RobotConfig
  /** Apply the edited robot. May return server-side validation issues. */
  onApply: (r: RobotConfig) => Promise<ValidationIssue[] | void> | ValidationIssue[] | void
  /** Called with every valid draft (for live previews). */
  onDraft?: (r: RobotConfig | null) => void
}

export function RobotForm({ robot, onApply, onDraft }: RobotFormProps) {
  const form = useForm<RobotFormValues>({
    resolver: zodResolver(robotFormSchema),
    defaultValues: robotToForm(robot),
    mode: 'onChange',
  })
  const { register, handleSubmit, formState, reset, watch, setValue, setError } = form
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    reset(robotToForm(robot))
  }, [robot, reset])

  useEffect(() => {
    if (!onDraft) return
    const sub = watch((v) => {
      const parsed = robotFormSchema.safeParse(v)
      onDraft(parsed.success ? formToRobot(parsed.data) : null)
    })
    return () => sub.unsubscribe()
  }, [watch, onDraft])

  const submit = handleSubmit(async (v) => {
    const issues = (await onApply(formToRobot(v))) ?? []
    // Map server-side issues (field paths "robot.xxx") back to the form.
    for (const i of issues) {
      const key = i.field.replace(/^robot\./, '').replace('sensor_noise.', 'noise_') as keyof RobotFormValues
      setError(key, { message: i.message })
    }
    if (issues.length === 0) {
      setApplied(true)
      setTimeout(() => setApplied(false), 1500)
    }
  })

  const err = (k: keyof RobotFormValues) => formState.errors[k]?.message

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Robot parameters" noValidate>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div className="space-y-1">
          <Label htmlFor="robot-name" className="text-xs">
            Configuration name
          </Label>
          <Input id="robot-name" className="h-8" aria-invalid={err('name') ? true : undefined} {...register('name')} />
          {err('name') ? <p role="alert" className="text-xs text-destructive">{err('name')}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="robot-wheel_count" className="text-xs">
            Number of wheels
          </Label>
          <Select
            value={String(watch('wheel_count'))}
            onValueChange={(v) => setValue('wheel_count', Number(v) as 4 | 6 | 8, { shouldValidate: true, shouldDirty: true })}
          >
            <SelectTrigger id="robot-wheel_count" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 (2 axles)</SelectItem>
              <SelectItem value="6">6 (3 axles)</SelectItem>
              <SelectItem value="8">8 (4 axles)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {ROBOT_GROUPS.map((g) => (
        <fieldset key={g.title} className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {g.fields.map((f) => (
              <NumberField
                key={f.key}
                id={`robot-${f.key}`}
                label={f.label}
                unit={f.unit}
                step={f.step}
                hint={f.hint}
                error={err(f.key)}
                {...register(f.key, { valueAsNumber: true })}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          <Check /> {applied ? 'Applied' : 'Apply robot parameters'}
        </Button>
        <Button type="button" variant="outline" onClick={() => reset(robotToForm(robot))} disabled={!formState.isDirty}>
          <RotateCcw /> Revert
        </Button>
        {!formState.isValid ? <span className="text-xs text-destructive">Fix the highlighted fields before applying.</span> : null}
      </div>
    </form>
  )
}
