import { CircleAlert, CircleCheck, CircleX, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { KeyValue } from '@/components/common'
import { fmt } from '@/lib/format'
import { VIOLATION_LABELS } from '@/lib/violations'
import type { FeasibilityReport } from '@/types/api'

export function FeasibilityVerdict({ report, loading }: { report: FeasibilityReport | null; loading?: boolean }) {
  if (!report) {
    return (
      <Badge variant="outline">
        {loading ? <Loader2 className="animate-spin" /> : null} {loading ? 'Analysing…' : 'No analysis'}
      </Badge>
    )
  }
  if (!report.feasible)
    return (
      <Badge className="bg-destructive/15 text-destructive">
        <CircleX /> Infeasible (static analysis)
      </Badge>
    )
  if (report.has_warnings)
    return (
      <Badge className="bg-warning/15 text-warning">
        <CircleAlert /> Passable with warnings
      </Badge>
    )
  return (
    <Badge className="bg-success/15 text-success">
      <CircleCheck /> Passable (static analysis)
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
          ['Min. clearance (centred)', `${fmt.mm(report.min_clearance)} @ s = ${report.min_clearance_station.toFixed(2)} m`],
          ['Min. lateral margin', `${fmt.mm(report.min_lateral_margin)} @ s = ${report.min_lateral_margin_station.toFixed(2)} m`],
          ['Max. wall contact angle', fmt.deg(report.max_contact_angle)],
          ['Geometric min. diameter', md ? `${fmt.mm(md.geometric)} (${md.geometric_binding})` : '—'],
          ['Recommended min. diameter', md ? `${fmt.mm(md.recommended)} (${md.recommended_binding})` : '—'],
          ['Max. climbable step', `${fmt.mm(report.max_step_height)} (β ≤ ${fmt.deg(report.max_climb_angle)})`],
          ['Max. climbable slope', `${fmt.deg(report.slope_limit.max_slope)} (traction ${fmt.deg(report.slope_limit.traction_limit)}, torque ${fmt.deg(report.slope_limit.torque_limit)})`],
          ...(compact ? [] : ([['Diameter steps', `${report.steps.length} (${report.steps.filter((s) => !s.climbable).length} not climbable)`]] as [string, string][])),
        ]}
      />
      {report.issues.length > 0 ? (
        <ul className="space-y-1" aria-label="Feasibility issues">
          {report.issues.slice(0, compact ? 3 : 20).map((i, k) => {
            const soft = i.kind === 'safety_clearance' || i.kind === 'contact_angle'
            return (
              <li key={k} className={`rounded-md border px-2 py-1 text-xs ${soft ? 'border-warning/40 text-warning' : 'border-destructive/40 text-destructive'}`}>
                <span className="font-medium">{VIOLATION_LABELS[i.kind]}:</span> <span className="text-foreground/90">{i.message}</span>
              </li>
            )
          })}
          {compact && report.issues.length > 3 ? <li className="text-xs text-muted-foreground">… {report.issues.length - 3} more</li> : null}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No static constraint is violated by an ideally centred robot. Tracking errors can still cause violations during simulation.</p>
      )}
    </div>
  )
}
