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
import { CONTROLLER_NAMES } from '@/lib/violations'
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

  if (!config) return <EmptyState title="Loading configuration…" icon={<Loader2 className="animate-spin" />} />
  const r = config.robot
  const summary = report?.summary
  const violations = events.length
  const collisions = snapshot?.collision_count ?? 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        description="Live state of the current simulation, the configured scenario and the latest results."
        actions={
          <Button asChild size="sm">
            <Link to="/simulation">
              Open simulation workspace <ArrowRight />
            </Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <StatCard source="live" label="Simulation status" icon={<Activity className="size-3.5" />} value={<StatusBadge status={snapshot?.status} />} sub={snapshot ? `t = ${fmt.s(snapshot.time)}` : 'not started'} />
        <StatCard source="live" label="Position s / (x, y)" icon={<MapPin className="size-3.5" />} value={sample ? fmt.m(sample.s) : '—'} sub={sample ? `(${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}) m` : undefined} />
        <StatCard source="live" label="Linear velocity" icon={<Gauge className="size-3.5" />} value={fmt.mps(sample?.v)} sub={sample ? `ref ${sample.v_ref.toFixed(3)} m/s` : undefined} />
        <StatCard source="live" label="Wheel speeds L / R" value={sample ? `${sample.wheel_left.toFixed(2)} / ${sample.wheel_right.toFixed(2)}` : '—'} sub="rad/s" />
        <StatCard source="live" label="Tracking error" value={fmt.mm(sample?.error_position, 2)} sub={sample ? `cross-track ${fmt.mm(sample.error_lateral, 2)}` : undefined} />
        <StatCard
          source="live"
          label="Clearance (now)"
          icon={<Ruler className="size-3.5" />}
          value={fmt.mm(sample?.clearance)}
          tone={sample && sample.clearance < sample.required_clearance ? 'danger' : undefined}
          sub={report ? `static min ${fmt.mm(report.min_clearance)}` : undefined}
        />
        <StatCard
          source="live"
          label="Violations / collisions"
          icon={<ShieldAlert className="size-3.5" />}
          value={`${violations} / ${collisions}`}
          tone={collisions > 0 || snapshot?.failure ? 'danger' : violations > 0 ? 'warning' : undefined}
          sub={snapshot?.failure ? snapshot.failure.kind.replace(/_/g, ' ') : 'episodes in current run'}
        />
        <StatCard source="live" label="Progress" icon={<Timer className="size-3.5" />} value={fmt.pct(snapshot?.progress ?? 0, 0)} sub={<Progress className="mt-1" value={(snapshot?.progress ?? 0) * 100} aria-label="Progress" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Section title="Pipeline and robot" source="live" actions={<FeasibilityVerdict report={report} loading={loading} />}>
          <PipeCanvas className="h-[340px]" geometry={report?.geometry ?? []} robot={r} getTelemetry={getTelemetry} issues={report?.issues} steps={report?.steps} />
        </Section>
        <div className="space-y-4">
          <Section title="Robot" source="config">
            <KeyValue
              items={[
                ['Name', r.name],
                ['Body L × W × H', `${fmt.mm(r.body_length, 0)} × ${fmt.mm(r.body_width, 0)} × ${fmt.mm(r.body_height, 0)}`],
                ['Wheels / radius', `${r.wheel_count} / ${fmt.mm(r.wheel_radius, 0)}`],
                ['Track / wheelbase', `${fmt.mm(r.track_width, 0)} / ${fmt.mm(r.wheelbase, 0)}`],
                ['Mass', `${r.mass} kg`],
                ['Controller (single runs)', CONTROLLER_NAMES[active]],
              ]}
            />
          </Section>
          <Section title="Pipeline" source="calc">
            <KeyValue
              items={[
                ['Name', config.pipeline.name],
                ['Length', summary ? fmt.m(summary.total_length, 2) : '—'],
                ['Min. internal diameter', summary ? `${fmt.mm(summary.min_diameter)} @ ${summary.min_diameter_station.toFixed(2)} m` : '—'],
                ['Bends / steps', summary ? `${summary.bend_count} / ${summary.step_count}` : '—'],
                ['Min. lateral margin (centred)', report ? fmt.mm(report.min_lateral_margin) : '—'],
              ]}
            />
          </Section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Cross-track error (live run)" source="live">
          {chart.length > 1 ? (
            <SeriesChart data={chart} x="t" xLabel="t [s]" yLabel="e_lat [mm]" digits={1} height={200} series={[{ key: 'lat', label: 'Cross-track', color: chartColors.c1 }]} />
          ) : (
            <p className="text-xs text-muted-foreground">Start a simulation to see live data.</p>
          )}
        </Section>
        <Section title="Clearance along the pipe (live run)" source="live">
          {chart.length > 1 ? (
            <SeriesChart
              data={chart}
              x="s"
              xLabel="s [m]"
              yLabel="[mm]"
              digits={1}
              height={200}
              series={[
                { key: 'clr', label: 'Clearance', color: chartColors.c3 },
                { key: 'req', label: 'Required', color: chartColors.warning, dashed: true },
              ]}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No telemetry yet.</p>
          )}
        </Section>
      </div>

      <Section
        title="Last experiment results"
        source="calc"
        actions={
          lastRun ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/results">All results</Link>
            </Button>
          ) : null
        }
      >
        {lastRun ? (
          <Markdown text={lastRun.results.report.split('\n### Motion')[0] ?? lastRun.results.report} />
        ) : (
          <p className="text-xs text-muted-foreground">No completed run in this session yet.</p>
        )}
      </Section>
    </div>
  )
}
