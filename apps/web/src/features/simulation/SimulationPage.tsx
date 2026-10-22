import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChartLine, Info, Loader2, Settings2, TriangleAlert, X } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { EmptyState, PageHeader, Section } from '@/components/common'
import { FeasibilityPanel, FeasibilityVerdict } from '@/components/analysis/FeasibilityPanel'
import { PipeCanvas } from '@/components/pipe-view/PipeCanvas'
import { useFeasibility } from '@/hooks/use-feasibility'
import { useLatestSample } from '@/hooks/use-live-telemetry'
import { fullKey } from '@/lib/scenario'
import { isTerminal } from '@/lib/violations'
import { controllerConfig, useConfigStore } from '@/stores/config-store'
import { getTelemetry, useSimStore } from '@/stores/sim-store'
import { LiveCharts } from './LiveCharts'
import { SimSettingsForm } from './SimSettingsForm'
import { SimulationControls } from './SimulationControls'
import { TelemetryPanel } from './TelemetryPanel'
import { ViolationsPanel } from './ViolationsPanel'

export function SimulationPage() {
  const config = useConfigStore((s) => s.config)
  const controllers = useConfigStore((s) => s.controllers)
  const active = useConfigStore((s) => s.active)
  const revision = useConfigStore((s) => s.revision)
  const { setActive, setConfig } = useConfigStore.getState()
  const sim = useSimStore()
  const sample = useLatestSample()
  const { report, loading } = useFeasibility(config)
  const [follow, setFollow] = useState(false)
  const [showRef, setShowRef] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const navigate = useNavigate()

  const effective = useMemo(
    () => (config && controllers ? { ...config, controller: controllerConfig(active, controllers) } : null),
    [config, controllers, active],
  )
  const stale = Boolean(sim.simId && effective && sim.simKey !== fullKey(effective))

  if (!config || !effective) return <EmptyState title="Завантаження конфігурації…" icon={<Loader2 className="animate-spin" />} />

  const status = stale ? null : (sim.snapshot?.status ?? null)
  const startPose = report?.geometry.length
    ? (() => {
        const g = report.geometry.find((x) => x.s >= report.start_station) ?? report.geometry[0]!
        return { x: g.x, y: g.y, theta: g.heading }
      })()
    : null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Робоча область моделювання"
        description="Rust-рушій інтегрує модель із фіксованим кроком; швидкість відтворення змінює лише темп, з яким модельний час іде на екрані."
        actions={
          <>
            <FeasibilityVerdict report={report} loading={loading} />
            <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
              <Settings2 /> Налаштування запуску
            </Button>
          </>
        }
      />

      <Section title="Керування" source="live">
        <SimulationControls
          status={status}
          busy={sim.busy}
          stale={stale}
          playback={sim.playback}
          controller={active}
          onStart={() => void sim.start(effective)}
          onPause={() => void sim.pause()}
          onResume={() => void sim.resume()}
          onStop={() => void sim.stop()}
          onReset={() => void sim.reset(effective)}
          onRunInstant={() => void sim.runInstant(effective)}
          onPlayback={(v) => void sim.setPlayback(v)}
          onController={setActive}
        />
        {stale ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-warning">
            <Info className="size-3.5" /> Конфігурація змінилася після створення цього моделювання. Старт або скидання створить нове моделювання.
          </p>
        ) : null}
      </Section>

      {sim.error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Помилка запиту</AlertTitle>
          <AlertDescription>{sim.error}</AlertDescription>
          <AlertAction>
            <Button size="icon-xs" variant="ghost" aria-label="Закрити" onClick={sim.clearError}>
              <X />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {showSettings ? (
        <Section title="Налаштування запуску" source="config" description="Зміни створять нове моделювання під час наступного старту чи скидання.">
          <SimSettingsForm key={revision} config={config} onCommit={setConfig} />
        </Section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Section
          title="Трубопровід і робот"
          source="live"
          description="Пунктир: опорна траєкторія. Суцільна: фактична траєкторія. Червоні точки: відліки з порушенням зазору чи кута контакту."
          actions={
            <>
              <div className="flex items-center gap-1.5">
                <Switch id="follow" checked={follow} onCheckedChange={setFollow} />
                <Label htmlFor="follow" className="text-xs">
                  Стежити за роботом
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch id="showref" checked={showRef} onCheckedChange={setShowRef} />
                <Label htmlFor="showref" className="text-xs">
                  Опорна траєкторія
                </Label>
              </div>
            </>
          }
        >
          <PipeCanvas
            className="h-[480px]"
            geometry={report?.geometry ?? []}
            robot={config.robot}
            pose={stale || !sim.simId ? startPose : null}
            getTelemetry={stale ? undefined : getTelemetry}
            issues={report?.issues}
            steps={report?.steps}
            follow={follow}
            showReference={showRef}
            ariaLabel="Трубопровід у реальному часі з положенням робота та траєкторіями"
          />
        </Section>
        <div className="space-y-4">
          <Section title="Телеметрія" source="live">
            <TelemetryPanel snapshot={stale ? null : sim.snapshot} sample={stale ? null : sample} robot={config.robot} />
          </Section>
        </div>
      </div>

      <Section title="Сигнали в реальному часі" source="live">
        <LiveCharts />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Попередження про зіткнення та проходимість"
          source="live"
          actions={
            status && isTerminal(status) ? (
              <Button size="sm" variant="outline" onClick={() => navigate('/results')}>
                <ChartLine /> Відкрити результати
              </Button>
            ) : null
          }
        >
          <ViolationsPanel status={status} failure={stale ? null : (sim.snapshot?.failure ?? null)} events={stale ? [] : sim.events} />
        </Section>
        <Section title="Статичний аналіз перед запуском" source="calc" description="Прогнозує проходимість для ідеально відцентрованого робота до запуску.">
          {report ? <FeasibilityPanel report={report} compact /> : <p className="text-xs text-muted-foreground">Аналіз…</p>}
        </Section>
      </div>
    </div>
  )
}
