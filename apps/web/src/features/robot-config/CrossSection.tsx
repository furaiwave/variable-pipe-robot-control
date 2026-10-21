import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { KeyValue } from '@/components/common'
import { ApiError, api } from '@/services/api'
import { fmt } from '@/lib/format'
import type { CrossSectionView, RobotConfig } from '@/types/api'

/**
 * Robot cross-section resting in a circular pipe, computed by the engine's
 * clearance model (wheel contacts on the wall, plane fit, envelope points).
 */
export function CrossSection({ robot, safetyMargin, initialDiameter = 0.25 }: { robot: RobotConfig; safetyMargin: number; initialDiameter?: number }) {
  const [diameter, setDiameter] = useState(initialDiameter)
  const [offset, setOffset] = useState(0)
  const [view, setView] = useState<CrossSectionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      api
        .crossSection(robot, diameter, offset, safetyMargin, ctrl.signal)
        .then((v) => {
          setView(v)
          setError(null)
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(e instanceof ApiError ? e.describe() : String(e))
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false))
    }, 120)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [robot, diameter, offset, safetyMargin])

  const R = diameter / 2
  const pad = R * 0.15
  const poly = (pts: [number, number][]) => pts.map(([x, z]) => `${x},${-z}`).join(' ')

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">
            Pipe diameter: <span className="tabular font-medium">{(diameter * 1000).toFixed(0)} mm</span>
          </Label>
          <Slider aria-label="Pipe diameter" min={60} max={600} step={1} value={[diameter * 1000]} onValueChange={(v) => setDiameter((v[0] ?? 250) / 1000)} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">
            Lateral offset: <span className="tabular font-medium">{(offset * 1000).toFixed(0)} mm</span>
          </Label>
          <Slider aria-label="Lateral offset" min={-40} max={40} step={1} value={[offset * 1000]} onValueChange={(v) => setOffset((v[0] ?? 0) / 1000)} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <svg viewBox={`${-R - pad} ${-R - pad} ${2 * (R + pad)} ${2 * (R + pad)}`} className="h-64 w-full" role="img" aria-label="Robot cross-section in the pipe">
          <circle cx={0} cy={0} r={R} className="fill-[var(--pipe-fill)] stroke-[var(--pipe-wall)]" strokeWidth={R * 0.02} />
          <circle cx={0} cy={0} r={Math.max(0, R - safetyMargin)} fill="none" className="stroke-warning/60" strokeWidth={R * 0.006} strokeDasharray={`${R * 0.03} ${R * 0.03}`} />
          <line x1={-R} y1={0} x2={R} y2={0} className="stroke-muted-foreground/40" strokeWidth={R * 0.004} />
          {view ? (
            <>
              {view.wheels.map((w, i) => (
                <polygon key={i} points={poly(w)} className="fill-foreground/70" />
              ))}
              <polygon points={poly(view.body)} className={view.admissible ? 'fill-primary/40 stroke-primary' : 'fill-destructive/40 stroke-destructive'} strokeWidth={R * 0.008} />
              {view.contacts.map(([x, z], i) => (
                <circle key={i} cx={x} cy={-z} r={R * 0.025} className="fill-chart-2" />
              ))}
              {view.critical ? <circle cx={view.critical[0]} cy={-view.critical[1]} r={R * 0.03} className="fill-destructive" /> : null}
            </>
          ) : null}
        </svg>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            {view ? (
              <Badge className={view.admissible ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}>{view.admissible ? 'Admissible' : 'Not admissible'}</Badge>
            ) : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {view ? (
            <KeyValue
              items={[
                ['Min. clearance', fmt.mm(view.clearance)],
                ['Required', fmt.mm(view.required)],
                ['Wall contact angle', `${fmt.deg(view.contact_angle)} / ${fmt.deg(view.max_contact_angle)}`],
                ['Roll', fmt.deg(view.roll, 2)],
                ['Binding constraint', view.binding],
              ]}
            />
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Orange dots: wheel–wall contacts (outer tread edge). Red dot: critical envelope point. Dashed circle: required safety clearance.
          </p>
        </div>
      </div>
    </div>
  )
}
