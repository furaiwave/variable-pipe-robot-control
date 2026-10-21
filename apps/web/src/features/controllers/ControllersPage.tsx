import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { GitCompareArrows, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, KeyValue, PageHeader, Section } from '@/components/common'
import { ApiError, api } from '@/services/api'
import { fmt } from '@/lib/format'
import { gainScheduledSchema, kinematicSchema, pidTrackingSchema } from '@/lib/schemas'
import { scenarioKey } from '@/lib/scenario'
import { CONTROLLER_NAMES } from '@/lib/violations'
import { CONTROLLER_TYPES, controllerConfig, useConfigStore } from '@/stores/config-store'
import { useResultsStore } from '@/stores/results-store'
import type { ControllerType, SimulationResults } from '@/types/api'
import { ControllerParamsForm, pidGainFields } from './ControllerParamsForm'

const Formula = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{children}</pre>
)

const PRINCIPLE: Record<ControllerType, { badge: string; text: ReactNode }> = {
  kinematic: {
    badge: 'Baseline · P-type',
    text: (
      <>
        <p>
          Nonlinear kinematic tracking law of Kanayama et al. (1990). The tracking error is expressed in the robot frame; the law combines
          reference feed-forward with proportional feedback and has no integral action, so constant disturbances (e.g. a wheel-radius mismatch)
          leave a steady-state offset.
        </p>
        <Formula>{`v = v_r·cos e_θ + K_x·e_x
ω = ω_r + v_r·(K_y·e_y + K_θ·sin e_θ)`}</Formula>
      </>
    ),
  },
  pid: {
    badge: 'Fixed gains',
    text: (
      <>
        <p>
          Two discrete PID loops with filtered derivative, output clamping and back-calculation anti-windup (also driven by saturation in
          the downstream wheel-command stage). The lateral loop acts on the cross-track error of a look-ahead point.
        </p>
        <Formula>{`v = v_r·cos e_θ + PID_x(e_x)          (trajectory mode)
v = v_r + PID_v(v_r − v)              (velocity mode)
ω = ω_r + PID_c(e_c),  e_c = e_y·cos e_θ + l_a·sin e_θ
I ← clamp(I + Δt·(K_i·e + K_t·(u_sat − u)), ±I_max)`}</Formula>
      </>
    ),
  },
  gain_scheduled: {
    badge: 'Gain scheduling',
    text: (
      <>
        <p>
          The PID structure above with lateral gains scheduled by explicit rules on known geometry: the lateral feasibility margin c_m ahead
          (from the engine's static analysis) and the look-ahead curvature κ. Gains are lowered in wide straight sections and raised in narrow
          passages and bends. This is classical gain scheduling — no plant parameters are estimated on-line, so it is <em>not</em> model-reference
          adaptive control.
        </p>
        <Formula>{`σ  = 1 − clamp(c_m / c_ref, 0, 1),   κ_n = clamp(|κ|·ℓ_κ, 0, 1)
m* = m_min + (m_max − m_min)·max(σ, κ_n),   m ← low-pass(m*, T_s)
K_p = m·K_p0,  K_i = m·K_i0,  K_d = √m·K_d0`}</Formula>
      </>
    ),
  },
}

function MetricsForController({ run }: { run: SimulationResults | undefined }) {
  if (!run) return <p className="text-xs text-muted-foreground">No run of this controller for the current scenario yet.</p>
  const m = run.metrics
  return (
    <KeyValue
      items={[
        ['Outcome', run.status === 'completed' ? 'completed' : `${run.status}${run.failure ? ` – ${run.failure.kind.replace(/_/g, ' ')} @ s=${run.failure.station.toFixed(2)} m` : ''}`],
        ['Position error RMSE / max', `${fmt.mm(m.position_error.rmse, 2)} / ${fmt.mm(m.position_error.max, 2)}`],
        ['Cross-track RMSE / max', `${fmt.mm(m.lateral_error.rmse, 2)} / ${fmt.mm(m.lateral_error.max, 2)}`],
        ['Heading RMSE', fmt.deg(m.heading_error.rmse, 2)],
        ['Min. clearance', fmt.mm(m.min_clearance, 2)],
        ['Violations / collisions', `${m.constraint_violation_count} / ${m.collision_count}`],
        ['Wheel saturation (steps)', fmt.pct(m.wheel_saturation_ratio)],
      ]}
    />
  )
}

export function ControllersPage() {
  const config = useConfigStore((s) => s.config)
  const controllers = useConfigStore((s) => s.controllers)
  const enabled = useConfigStore((s) => s.enabled)
  const active = useConfigStore((s) => s.active)
  const revision = useConfigStore((s) => s.revision)
  const { setControllerParams, setEnabled, setActive } = useConfigStore.getState()
  const runs = useResultsStore((s) => s.runs)
  const addComparison = useResultsStore((s) => s.addComparison)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  if (!config || !controllers) return <EmptyState title="Loading configuration…" icon={<Loader2 className="animate-spin" />} />

  const key = scenarioKey(config)
  const latest = new Map<ControllerType, SimulationResults>()
  for (const r of runs) {
    if (scenarioKey(r.results.config) !== key) continue
    if (r.results.status === 'running' || r.results.status === 'paused' || r.results.status === 'ready') continue
    if (!latest.has(r.results.controller)) latest.set(r.results.controller, r.results)
  }
  const enabledTypes = CONTROLLER_TYPES.filter((t) => enabled[t])

  const compare = async () => {
    setBusy(true)
    try {
      const resp = await api.compare(
        config,
        enabledTypes.map((t) => controllerConfig(t, controllers)),
      )
      addComparison(resp)
      toast.success(`Compared ${resp.runs.length} controllers under identical conditions`)
      navigate('/results')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.describe() : String(e))
    } finally {
      setBusy(false)
    }
  }

  const r = config.robot
  return (
    <div className="space-y-4">
      <PageHeader
        title="Control algorithms"
        description="Configure the implemented trajectory-tracking controllers. All of them track the same reference along the pipe centreline."
        actions={
          <Button onClick={compare} disabled={busy || enabledTypes.length === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <GitCompareArrows />} Compare enabled ({enabledTypes.length}) under identical conditions
          </Button>
        }
      />
      <Section title="Common wheel-command stage and saturation limits" source="config" description="Applied identically to every controller output (limits come from the robot configuration).">
        <div className="grid gap-4 md:grid-cols-2">
          <Formula>{`1. clamp |v| ≤ v_max, |ω| ≤ ω_max
2. ω_R = (v + ω·L/2)/r,  ω_L = (v − ω·L/2)/r
3. if max|ω_w| > ω_w,max: scale both (curvature preserved)
4. |Δω_w| ≤ α_max·Δt (rate limit) → motor lag τ_m → torque/traction limits`}</Formula>
          <KeyValue
            items={[
              ['v_max', fmt.mps(r.max_linear_velocity)],
              ['ω_max', fmt.radps(r.max_angular_velocity)],
              ['ω_wheel,max', fmt.radps(r.max_wheel_speed)],
              ['α_wheel,max', `${r.max_wheel_acceleration} rad/s²`],
              ['τ_motor,max', fmt.nm(r.max_motor_torque)],
              ['Motor time constant τ_m', fmt.s(r.motor_time_constant, 3)],
            ]}
          />
        </div>
      </Section>
      <div className="grid gap-4 xl:grid-cols-3">
        {CONTROLLER_TYPES.map((t) => (
          <Section
            key={t}
            title={
              <span className="flex items-center gap-2">
                {CONTROLLER_NAMES[t]}
                <Badge variant="outline" className="text-[10px]">
                  {PRINCIPLE[t].badge}
                </Badge>
              </span>
            }
            className={active === t ? 'ring-primary/50' : undefined}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch id={`en-${t}`} checked={enabled[t]} onCheckedChange={(v) => setEnabled(t, v)} />
                  <Label htmlFor={`en-${t}`} className="text-xs">
                    Include in comparisons
                  </Label>
                </div>
                <Button size="xs" variant={active === t ? 'default' : 'outline'} onClick={() => setActive(t)} aria-pressed={active === t}>
                  {active === t ? 'Active for single runs' : 'Use for single runs'}
                </Button>
              </div>
              <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">{PRINCIPLE[t].text}</div>
              {t === 'kinematic' ? (
                <ControllerParamsForm
                  key={`${revision}-k`}
                  idPrefix="kin"
                  values={controllers.kinematic}
                  schema={kinematicSchema}
                  onCommit={(v) => setControllerParams('kinematic', v)}
                  groups={[
                    {
                      title: 'Gains',
                      fields: [
                        { path: 'k_x', label: 'K_x', unit: '1/s', step: 0.1 },
                        { path: 'k_y', label: 'K_y', unit: '1/m²', step: 1 },
                        { path: 'k_theta', label: 'K_θ', unit: '1/m', step: 0.5 },
                      ],
                    },
                  ]}
                />
              ) : t === 'pid' ? (
                <ControllerParamsForm
                  key={`${revision}-p`}
                  idPrefix="pid"
                  values={controllers.pid}
                  schema={pidTrackingSchema}
                  modePath="longitudinal_mode"
                  onCommit={(v) => setControllerParams('pid', v)}
                  groups={[
                    { title: 'Look-ahead', fields: [{ path: 'lookahead', label: 'l_a', unit: 'm', step: 0.01 }] },
                    { title: 'Lateral loop (ω correction)', fields: pidGainFields('lateral', 'rad/s', 'm') },
                    { title: 'Longitudinal loop (v correction)', fields: pidGainFields('longitudinal', 'm/s', 'm') },
                  ]}
                />
              ) : (
                <ControllerParamsForm
                  key={`${revision}-g`}
                  idPrefix="gs"
                  values={controllers.gain_scheduled}
                  schema={gainScheduledSchema}
                  modePath="base.longitudinal_mode"
                  onCommit={(v) => setControllerParams('gain_scheduled', v)}
                  groups={[
                    {
                      title: 'Scheduling rules',
                      fields: [
                        { path: 'margin_reference', label: 'c_ref', unit: 'm', step: 0.005 },
                        { path: 'curvature_length', label: 'ℓ_κ', unit: 'm', step: 0.05 },
                        { path: 'min_multiplier', label: 'm_min', step: 0.1 },
                        { path: 'max_multiplier', label: 'm_max', step: 0.1 },
                        { path: 'schedule_time_constant', label: 'T_s', unit: 's', step: 0.05 },
                      ],
                    },
                    { title: 'Base look-ahead', fields: [{ path: 'base.lookahead', label: 'l_a', unit: 'm', step: 0.01 }] },
                    { title: 'Base lateral loop', fields: pidGainFields('base.lateral', 'rad/s', 'm') },
                    { title: 'Base longitudinal loop', fields: pidGainFields('base.longitudinal', 'm/s', 'm') },
                  ]}
                />
              )}
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-medium">Performance on the current scenario (latest run, simulated)</p>
                <MetricsForController run={latest.get(t)} />
              </div>
            </div>
          </Section>
        ))}
      </div>
      {latest.size > 1 ? (
        <Section title="Side-by-side (latest runs of the current scenario)" source="calc">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Controller</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Pos. RMSE</TableHead>
                <TableHead className="text-right">Cross-track RMSE</TableHead>
                <TableHead className="text-right">Cross-track max</TableHead>
                <TableHead className="text-right">Min. clearance</TableHead>
                <TableHead className="text-right">Energy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...latest.entries()].map(([t, run]) => (
                <TableRow key={t}>
                  <TableCell>{CONTROLLER_NAMES[t]}</TableCell>
                  <TableCell>{run.status}</TableCell>
                  <TableCell className="tabular text-right">{fmt.mm(run.metrics.position_error.rmse, 2)}</TableCell>
                  <TableCell className="tabular text-right">{fmt.mm(run.metrics.lateral_error.rmse, 2)}</TableCell>
                  <TableCell className="tabular text-right">{fmt.mm(run.metrics.lateral_error.max, 2)}</TableCell>
                  <TableCell className="tabular text-right">{fmt.mm(run.metrics.min_clearance, 2)}</TableCell>
                  <TableCell className="tabular text-right">{fmt.j(run.metrics.mechanical_energy)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  )
}
