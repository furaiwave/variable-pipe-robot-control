import { useMemo } from 'react'
import { Link } from 'react-router'
import { Activity, ArrowRight, Gauge, Loader2, MapPin, Ruler, ShieldAlert, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { EmptyState, KeyValue, PageHeader, Section, StatCard, StatusBadge } from '@/components/common'
import { FeasibilityVerdict } from '@/components/analysis/FeasibilityPanel'
import { SeriesChart, chartColors } from '@/components/charts/SeriesChart'
import { Markdown } from '@/components/common/Markdown'
import { PipeCanvas } from '@/components/pipe-view/PipeCanvas'
import { useFeasibility } from '@/hooks/use-feasibility'
import { useLatestSample, useLiveSeries } from '@/hooks/use-live-telemetry'
import { fmt } from '@/lib/format'
import { CONTROLLER_NAMES, VIOLATION_LABELS } from '@/lib/violations'
import { useConfigStore } from '@/stores/config-store'
import { useResultsStore } from '@/stores/results-store'
import { getTelemetry, useSimStore } from '@/stores/sim-store'

export function DashboardPage() {
  const config = useConfigStore((s) => s.config)
  const active = useConfigStore((s) => s.active)
  const snapshot = useSimStore((s) => s.snapshot)
  const events = useSimStore((s) => s.events)
  const sample = useLatestSample()
  const series = useLiveSeries(400)
  const lastRun = useResultsStore((s) => s.runs[0])
  const { report, loading } = useFeasibility(config)

  const chart = useMemo(
    () => series.map((s) => ({ t: s.t, s: s.s, lat: s.error_lateral * 1000, clr: s.clearance * 1000, req: s.required_clearance * 1000 })),
    [series],
  )

  if (!config) return <EmptyState title="Завантаження конфігурації…" icon={<Loader2 className="animate-spin" />} />
  const r = config.robot
  const summary = report?.summary
  const violations = events.length
  const collisions = snapshot?.collision_count ?? 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Огляд"
        description="Поточний стан моделювання, налаштований сценарій та останні результати."
        actions={
          <Button asChild size="sm">
            <Link to="/simulation">
              Відкрити робочу область моделювання <ArrowRight />
            </Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <StatCard source="live" label="Стан моделювання" icon={<Activity className="size-3.5" />} value={<StatusBadge status={snapshot?.status} />} sub={snapshot ? `t = ${fmt.s(snapshot.time)}` : 'не запущено'} />
        <StatCard source="live" label="Положення s / (x, y)" icon={<MapPin className="size-3.5" />} value={sample ? fmt.m(sample.s) : '—'} sub={sample ? `(${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}) м` : undefined} />
        <StatCard source="live" label="Лінійна швидкість" icon={<Gauge className="size-3.5" />} value={fmt.mps(sample?.v)} sub={sample ? `опорна ${sample.v_ref.toFixed(3)} м/с` : undefined} />
        <StatCard source="live" label="Швидкості коліс Л / П" value={sample ? `${sample.wheel_left.toFixed(2)} / ${sample.wheel_right.toFixed(2)}` : '—'} sub="рад/с" />
        <StatCard source="live" label="Похибка стеження" value={fmt.mm(sample?.error_position, 2)} sub={sample ? `поперечна ${fmt.mm(sample.error_lateral, 2)}` : undefined} />
        <StatCard
          source="live"
          label="Зазор (зараз)"
          icon={<Ruler className="size-3.5" />}
          value={fmt.mm(sample?.clearance)}
          tone={sample && sample.clearance < sample.required_clearance ? 'danger' : undefined}
          sub={report ? `статичний мін. ${fmt.mm(report.min_clearance)}` : undefined}
        />
        <StatCard
          source="live"
          label="Порушення / зіткнення"
          icon={<ShieldAlert className="size-3.5" />}
          value={`${violations} / ${collisions}`}
          tone={collisions > 0 || snapshot?.failure ? 'danger' : violations > 0 ? 'warning' : undefined}
          sub={snapshot?.failure ? VIOLATION_LABELS[snapshot.failure.kind] : 'епізодів у поточному запуску'}
        />
        <StatCard source="live" label="Прогрес" icon={<Timer className="size-3.5" />} value={fmt.pct(snapshot?.progress ?? 0, 0)} sub={<Progress className="mt-1" value={(snapshot?.progress ?? 0) * 100} aria-label="Прогрес" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Section title="Трубопровід і робот" source="live" actions={<FeasibilityVerdict report={report} loading={loading} />}>
          <PipeCanvas className="h-[340px]" geometry={report?.geometry ?? []} robot={r} getTelemetry={getTelemetry} issues={report?.issues} steps={report?.steps} />
        </Section>
        <div className="space-y-4">
          <Section title="Робот" source="config">
            <KeyValue
              items={[
                ['Назва', r.name],
                ['Корпус Д × Ш × В', `${fmt.mm(r.body_length, 0)} × ${fmt.mm(r.body_width, 0)} × ${fmt.mm(r.body_height, 0)}`],
                ['Колеса / радіус', `${r.wheel_count} / ${fmt.mm(r.wheel_radius, 0)}`],
                ['Колія / база', `${fmt.mm(r.track_width, 0)} / ${fmt.mm(r.wheelbase, 0)}`],
                ['Маса', `${r.mass} кг`],
                ['Регулятор (одиночні запуски)', CONTROLLER_NAMES[active]],
              ]}
            />
          </Section>
          <Section title="Трубопровід" source="calc">
            <KeyValue
              items={[
                ['Назва', config.pipeline.name],
                ['Довжина', summary ? fmt.m(summary.total_length, 2) : '—'],
                ['Мін. внутрішній діаметр', summary ? `${fmt.mm(summary.min_diameter)} @ ${summary.min_diameter_station.toFixed(2)} м` : '—'],
                ['Вигини / сходинки', summary ? `${summary.bend_count} / ${summary.step_count}` : '—'],
                ['Мін. бічний запас (по центру)', report ? fmt.mm(report.min_lateral_margin) : '—'],
              ]}
            />
          </Section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Поперечна похибка (поточний запуск)" source="live">
          {chart.length > 1 ? (
            <SeriesChart data={chart} x="t" xLabel="t [с]" yLabel="e_lat [мм]" digits={1} height={200} series={[{ key: 'lat', label: 'Поперечна', color: chartColors.c1 }]} />
          ) : (
            <p className="text-xs text-muted-foreground">Запустіть моделювання, щоб побачити дані в реальному часі.</p>
          )}
        </Section>
        <Section title="Зазор уздовж труби (поточний запуск)" source="live">
          {chart.length > 1 ? (
            <SeriesChart
              data={chart}
              x="s"
              xLabel="s [м]"
              yLabel="[мм]"
              digits={1}
              height={200}
              series={[
                { key: 'clr', label: 'Зазор', color: chartColors.c3 },
                { key: 'req', label: 'Необхідний', color: chartColors.warning, dashed: true },
              ]}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Телеметрії поки немає.</p>
          )}
        </Section>
      </div>

      <Section
        title="Результати останнього експерименту"
        source="calc"
        actions={
          lastRun ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/results">Усі результати</Link>
            </Button>
          ) : null
        }
      >
        {lastRun ? (
          <Markdown text={lastRun.results.report.split('\n### Motion')[0] ?? lastRun.results.report} />
        ) : (
          <p className="text-xs text-muted-foreground">У цій сесії ще немає завершених запусків.</p>
        )}
      </Section>
    </div>
  )
}
