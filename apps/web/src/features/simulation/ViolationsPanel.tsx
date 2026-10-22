import { CircleCheck, OctagonX, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { fmt } from '@/lib/format'
import { VIOLATION_LABELS } from '@/lib/violations'
import type { FailureInfo, SimulationStatus, ViolationEvent } from '@/types/api'

const UNIT_UK: Record<string, string> = { 'rad/s': 'рад/с', 'N·m': 'Н·м', '-': '' }

function value(e: ViolationEvent): string {
  if (e.unit === 'm') return `${fmt.mm(e.peak_value, 2)} (межа ${fmt.mm(e.limit, 2)})`
  if (e.unit === 'rad') return `${fmt.deg(e.peak_value)} (межа ${fmt.deg(e.limit)})`
  return `${e.peak_value.toFixed(3)} ${UNIT_UK[e.unit] ?? e.unit} (межа ${e.limit.toFixed(3)})`
}

/** Failure reason (if any) and constraint-violation episodes. */
export function ViolationsPanel({ status, failure, events, maxItems = 30 }: { status: SimulationStatus | null; failure: FailureInfo | null; events: ViolationEvent[]; maxItems?: number }) {
  return (
    <div className="space-y-2">
      {failure ? (
        <Alert variant="destructive" data-testid="failure-alert">
          <OctagonX />
          <AlertTitle>Запуск завершився збоєм: {VIOLATION_LABELS[failure.kind]}</AlertTitle>
          <AlertDescription>
            <p>{failure.message}</p>
            <p className="tabular mt-1 text-xs">
              t = {failure.time.toFixed(2)} с · s = {failure.station.toFixed(3)} м · (x, y) = ({failure.x.toFixed(3)}, {failure.y.toFixed(3)}) м
            </p>
          </AlertDescription>
        </Alert>
      ) : status === 'completed' ? (
        <Alert>
          <CircleCheck className="text-success" />
          <AlertTitle>Ціль досягнуто</AlertTitle>
          <AlertDescription>Робот пройшов трубопровід у моделюванні. Нефатальні порушення (якщо були) наведено нижче.</AlertDescription>
        </Alert>
      ) : null}
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Порушень обмежень не зафіксовано.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" aria-label="Порушення обмежень">
          {events
            .slice(-maxItems)
            .reverse()
            .map((e, i) => (
              <li key={`${e.kind}-${e.t_start}-${i}`} className="flex gap-2 rounded-md border px-2 py-1 text-xs">
                <TriangleAlert className={`mt-0.5 size-3.5 shrink-0 ${e.severity === 'fatal' ? 'text-destructive' : 'text-warning'}`} />
                <div className="min-w-0">
                  <div className="font-medium">
                    {VIOLATION_LABELS[e.kind]} <span className="text-muted-foreground">({e.severity === 'fatal' ? 'фатальне' : 'попередження'})</span>
                  </div>
                  <div className="text-muted-foreground">{e.message}</div>
                  <div className="tabular text-[11px] text-muted-foreground">
                    t {e.t_start.toFixed(2)}–{e.t_end.toFixed(2)} с · s {e.s_start.toFixed(3)}–{e.s_end.toFixed(3)} м · пік {value(e)}
                  </div>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
