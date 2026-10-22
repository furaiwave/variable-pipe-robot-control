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
import { CONTROLLER_NAMES, STATUS_LABELS, VIOLATION_LABELS } from '@/lib/violations'
import { CONTROLLER_TYPES, controllerConfig, useConfigStore } from '@/stores/config-store'
import { useResultsStore } from '@/stores/results-store'
import type { ControllerType, SimulationResults } from '@/types/api'
import { ControllerParamsForm, pidGainFields } from './ControllerParamsForm'

const Formula = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{children}</pre>
)

const PRINCIPLE: Record<ControllerType, { badge: string; text: ReactNode }> = {
  kinematic: {
    badge: 'Базовий · П-типу',
    text: (
      <>
        <p>
          Нелінійний кінематичний закон стеження Kanayama та ін. (1990). Похибка стеження виражається в системі координат робота; закон поєднує
          пряму подачу опорного сигналу з пропорційним зворотним зв’язком і не має інтегральної складової, тому сталі збурення (наприклад,
          різниця радіусів коліс) залишають усталену похибку.
        </p>
        <Formula>{`v = v_r·cos e_θ + K_x·e_x
ω = ω_r + v_r·(K_y·e_y + K_θ·sin e_θ)`}</Formula>
      </>
    ),
  },
  pid: {
    badge: 'Фіксовані коефіцієнти',
    text: (
      <>
        <p>
          Два дискретні ПІД-контури з фільтрованою похідною, обмеженням виходу та анти-віндапом методом зворотного перерахунку (враховує
          також насичення в каскаді команд коліс). Бічний контур діє на поперечну похибку точки попередження (look-ahead).
        </p>
        <Formula>{`v = v_r·cos e_θ + PID_x(e_x)          (режим траєкторії)
v = v_r + PID_v(v_r − v)              (режим швидкості)
ω = ω_r + PID_c(e_c),  e_c = e_y·cos e_θ + l_a·sin e_θ
I ← clamp(I + Δt·(K_i·e + K_t·(u_sat − u)), ±I_max)`}</Formula>
      </>
    ),
  },
  gain_scheduled: {
    badge: 'Планування коефіцієнтів',
    text: (
      <>
        <p>
          Та сама ПІД-структура, бічні коефіцієнти якої змінюються за явними правилами залежно від відомої геометрії: бічного запасу проходимості
          c_m попереду (за статичним аналізом рушія) та кривини κ попереду. У широких прямих ділянках коефіцієнти знижуються, у вузьких
          проходах і вигинах — підвищуються. Це класичне планування коефіцієнтів (gain scheduling): параметри об’єкта онлайн не оцінюються, тому
          це <em>не</em> адаптивне керування з еталонною моделлю.
        </p>
        <Formula>{`σ  = 1 − clamp(c_m / c_ref, 0, 1),   κ_n = clamp(|κ|·ℓ_κ, 0, 1)
m* = m_min + (m_max − m_min)·max(σ, κ_n),   m ← low-pass(m*, T_s)
K_p = m·K_p0,  K_i = m·K_i0,  K_d = √m·K_d0`}</Formula>
      </>
    ),
  },
}

function MetricsForController({ run }: { run: SimulationResults | undefined }) {
  if (!run) return <p className="text-xs text-muted-foreground">Для поточного сценарію цей регулятор ще не запускався.</p>
  const m = run.metrics
  return (
    <KeyValue
      items={[
        ['Результат', `${STATUS_LABELS[run.status]}${run.failure ? ` – ${VIOLATION_LABELS[run.failure.kind]} @ s=${run.failure.station.toFixed(2)} м` : ''}`],
        ['Похибка положення СКВ / макс.', `${fmt.mm(m.position_error.rmse, 2)} / ${fmt.mm(m.position_error.max, 2)}`],
        ['Поперечна похибка СКВ / макс.', `${fmt.mm(m.lateral_error.rmse, 2)} / ${fmt.mm(m.lateral_error.max, 2)}`],
        ['СКВ похибки курсу', fmt.deg(m.heading_error.rmse, 2)],
        ['Мін. зазор', fmt.mm(m.min_clearance, 2)],
        ['Порушення / зіткнення', `${m.constraint_violation_count} / ${m.collision_count}`],
        ['Насичення коліс (частка кроків)', fmt.pct(m.wheel_saturation_ratio)],
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

  if (!config || !controllers) return <EmptyState title="Завантаження конфігурації…" icon={<Loader2 className="animate-spin" />} />

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
      toast.success(`Порівняно регуляторів за однакових умов: ${resp.runs.length}`)
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
        title="Алгоритми керування"
        description="Налаштуйте реалізовані регулятори стеження за траєкторією. Усі вони відстежують одну й ту саму опорну траєкторію вздовж осі труби."
        actions={
          <Button onClick={compare} disabled={busy || enabledTypes.length === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <GitCompareArrows />} Порівняти увімкнені ({enabledTypes.length}) за однакових умов
          </Button>
        }
      />
      <Section title="Спільний каскад команд коліс і межі насичення" source="config" description="Однаково застосовується до виходу кожного регулятора (межі беруться з конфігурації робота).">
        <div className="grid gap-4 md:grid-cols-2">
          <Formula>{`1. обмеження |v| ≤ v_max, |ω| ≤ ω_max
2. ω_R = (v + ω·L/2)/r,  ω_L = (v − ω·L/2)/r
3. якщо max|ω_w| > ω_w,max: масштабувати обидва (кривина зберігається)
4. |Δω_w| ≤ α_max·Δt (обмеження швидкості зміни) → інерція двигуна τ_m → межі моменту/зчеплення`}</Formula>
          <KeyValue
            items={[
              ['v_max', fmt.mps(r.max_linear_velocity)],
              ['ω_max', fmt.radps(r.max_angular_velocity)],
              ['ω_wheel,max', fmt.radps(r.max_wheel_speed)],
              ['α_wheel,max', `${r.max_wheel_acceleration} рад/с²`],
              ['τ_motor,max', fmt.nm(r.max_motor_torque)],
              ['Стала часу двигуна τ_m', fmt.s(r.motor_time_constant, 3)],
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
                    Брати участь у порівняннях
                  </Label>
                </div>
                <Button size="xs" variant={active === t ? 'default' : 'outline'} onClick={() => setActive(t)} aria-pressed={active === t}>
                  {active === t ? 'Активний для одиночних запусків' : 'Використовувати для одиночних запусків'}
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
                      title: 'Коефіцієнти',
                      fields: [
                        { path: 'k_x', label: 'K_x', unit: '1/с', step: 0.1 },
                        { path: 'k_y', label: 'K_y', unit: '1/м²', step: 1 },
                        { path: 'k_theta', label: 'K_θ', unit: '1/м', step: 0.5 },
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
                    { title: 'Відстань попередження', fields: [{ path: 'lookahead', label: 'l_a', unit: 'м', step: 0.01 }] },
                    { title: 'Бічний контур (корекція ω)', fields: pidGainFields('lateral', 'рад/с', 'м') },
                    { title: 'Поздовжній контур (корекція v)', fields: pidGainFields('longitudinal', 'м/с', 'м') },
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
                      title: 'Правила планування',
                      fields: [
                        { path: 'margin_reference', label: 'c_ref', unit: 'м', step: 0.005 },
                        { path: 'curvature_length', label: 'ℓ_κ', unit: 'м', step: 0.05 },
                        { path: 'min_multiplier', label: 'm_min', step: 0.1 },
                        { path: 'max_multiplier', label: 'm_max', step: 0.1 },
                        { path: 'schedule_time_constant', label: 'T_s', unit: 'с', step: 0.05 },
                      ],
                    },
                    { title: 'Базова відстань попередження', fields: [{ path: 'base.lookahead', label: 'l_a', unit: 'м', step: 0.01 }] },
                    { title: 'Базовий бічний контур', fields: pidGainFields('base.lateral', 'рад/с', 'м') },
                    { title: 'Базовий поздовжній контур', fields: pidGainFields('base.longitudinal', 'м/с', 'м') },
                  ]}
                />
              )}
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-medium">Показники на поточному сценарії (останній запуск, моделювання)</p>
                <MetricsForController run={latest.get(t)} />
              </div>
            </div>
          </Section>
        ))}
      </div>
      {latest.size > 1 ? (
        <Section title="Порівняння (останні запуски поточного сценарію)" source="calc">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Регулятор</TableHead>
                <TableHead>Результат</TableHead>
                <TableHead className="text-right">СКВ положення</TableHead>
                <TableHead className="text-right">СКВ поперечна</TableHead>
                <TableHead className="text-right">Макс. поперечна</TableHead>
                <TableHead className="text-right">Мін. зазор</TableHead>
                <TableHead className="text-right">Енергія</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...latest.entries()].map(([t, run]) => (
                <TableRow key={t}>
                  <TableCell>{CONTROLLER_NAMES[t]}</TableCell>
                  <TableCell>{STATUS_LABELS[run.status]}</TableCell>
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
