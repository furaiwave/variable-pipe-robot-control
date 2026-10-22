import { CircleAlert, CircleCheck, CircleX, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { KeyValue } from '@/components/common'
import { fmt } from '@/lib/format'
import { VIOLATION_LABELS, bindingLabel } from '@/lib/violations'
import type { FeasibilityReport } from '@/types/api'

export function FeasibilityVerdict({ report, loading }: { report: FeasibilityReport | null; loading?: boolean }) {
  if (!report) {
    return (
      <Badge variant="outline">
        {loading ? <Loader2 className="animate-spin" /> : null} {loading ? 'Аналіз…' : 'Аналіз відсутній'}
      </Badge>
    )
  }
  if (!report.feasible)
    return (
      <Badge className="bg-destructive/15 text-destructive">
        <CircleX /> Непрохідний (статичний аналіз)
      </Badge>
    )
  if (report.has_warnings)
    return (
      <Badge className="bg-warning/15 text-warning">
        <CircleAlert /> Прохідний із попередженнями
      </Badge>
    )
  return (
    <Badge className="bg-success/15 text-success">
      <CircleCheck /> Прохідний (статичний аналіз)
    </Badge>
  )
}

/** Summary of the engine's static feasibility analysis for a centred, aligned robot. */
export function FeasibilityPanel({ report, compact = false }: { report: FeasibilityReport; compact?: boolean }) {
  const md = report.min_feasible_diameter
  return (
    <div className="space-y-3">
      <KeyValue
        items={[
          ['Мін. зазор (по центру)', `${fmt.mm(report.min_clearance)} @ s = ${report.min_clearance_station.toFixed(2)} м`],
          ['Мін. бічний запас', `${fmt.mm(report.min_lateral_margin)} @ s = ${report.min_lateral_margin_station.toFixed(2)} м`],
          ['Макс. кут контакту зі стінкою', fmt.deg(report.max_contact_angle)],
          ['Геометричний мін. діаметр', md ? `${fmt.mm(md.geometric)} (${bindingLabel(md.geometric_binding)})` : '—'],
          ['Рекомендований мін. діаметр', md ? `${fmt.mm(md.recommended)} (${bindingLabel(md.recommended_binding)})` : '—'],
          ['Макс. висота сходинки', `${fmt.mm(report.max_step_height)} (β ≤ ${fmt.deg(report.max_climb_angle)})`],
          ['Макс. нахил, що долається', `${fmt.deg(report.slope_limit.max_slope)} (зчеплення ${fmt.deg(report.slope_limit.traction_limit)}, момент ${fmt.deg(report.slope_limit.torque_limit)})`],
          ...(compact ? [] : ([['Сходинки діаметра', `${report.steps.length} (непрохідних: ${report.steps.filter((s) => !s.climbable).length})`]] as [string, string][])),
        ]}
      />
      {report.issues.length > 0 ? (
        <ul className="space-y-1" aria-label="Проблеми проходимості">
          {report.issues.slice(0, compact ? 3 : 20).map((i, k) => {
            const soft = i.kind === 'safety_clearance' || i.kind === 'contact_angle'
            return (
              <li key={k} className={`rounded-md border px-2 py-1 text-xs ${soft ? 'border-warning/40 text-warning' : 'border-destructive/40 text-destructive'}`}>
                <span className="font-medium">{VIOLATION_LABELS[i.kind]}:</span> <span className="text-foreground/90">{i.message}</span>
              </li>
            )
          })}
          {compact && report.issues.length > 3 ? <li className="text-xs text-muted-foreground">… ще {report.issues.length - 3}</li> : null}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Ідеально відцентрований робот не порушує жодного статичного обмеження. Похибки стеження все ж можуть спричинити порушення під час моделювання.</p>
      )}
    </div>
  )
}
