import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RUN_COLORS, SeriesChart } from '@/components/charts/SeriesChart'
import { Markdown } from '@/components/common/Markdown'
import { Section } from '@/components/common'
import { PipeCanvas } from '@/components/pipe-view/PipeCanvas'
import { useFeasibility } from '@/hooks/use-feasibility'
import { decimate } from '@/lib/decimate'
import { scenarioKey } from '@/lib/scenario'
import type { StoredRun } from '@/stores/results-store'
import { METRIC_ROWS } from './MetricsTable'

/** Merge several runs' series onto a common x grid for overlay plots. */
function overlay(runs: StoredRun[], x: 't' | 's', y: (s: StoredRun['results']['telemetry'][number]) => number) {
  const rows: Record<string, number>[] = []
  runs.forEach((r, i) => {
    for (const s of decimate(r.results.telemetry, 500)) rows.push({ [x]: s[x], [`r${i}`]: y(s) })
  })
  rows.sort((a, b) => a[x]! - b[x]!)
  return rows
}

export function ComparisonView({ runs, report }: { runs: StoredRun[]; report?: string }) {
  const keys = new Set(runs.map((r) => scenarioKey(r.results.config)))
  const sameScenario = keys.size === 1
  const { report: feas } = useFeasibility(runs[0]?.results.config ?? null)
  const labels = runs.map((r, i) => `${r.results.controller_name}${runs.filter((o) => o.results.controller === r.results.controller).length > 1 ? ` #${i + 1}` : ''}`)
  const series = runs.map((_, i) => ({ key: `r${i}`, label: labels[i]!, color: RUN_COLORS[i % RUN_COLORS.length]! }))

  const lat = useMemo(() => overlay(runs, 's', (s) => s.error_lateral * 1000), [runs])
  const pos = useMemo(() => overlay(runs, 't', (s) => s.error_position * 1000), [runs])
  const clr = useMemo(() => overlay(runs, 's', (s) => s.clearance * 1000), [runs])
  const vel = useMemo(() => overlay(runs, 't', (s) => s.v), [runs])
  const tracks = useMemo(
    () => runs.map((r, i) => ({ label: labels[i]!, color: RUN_COLORS[i % RUN_COLORS.length]!, points: decimate(r.results.telemetry, 2500).map((s) => ({ x: s.x, y: s.y })) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs],
  )

  return (
    <div className="space-y-4">
      {!sameScenario ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Runs use different scenarios</AlertTitle>
          <AlertDescription>
            Pipeline, robot, reference, initial conditions, disturbances or seed differ between the selected runs, so the comparison is not under identical conditions.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-xs text-muted-foreground">
          All {runs.length} runs share the same scenario (hash <code>{runs[0]?.results.scenario_hash}</code>); only the controller differs.
        </p>
      )}
      <Section title="Metrics comparison" source="calc">
        <div className="overflow-x-auto">
          <Table aria-label="Metrics comparison">
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                {runs.map((r, i) => (
                  <TableHead key={r.key} className="text-right" style={{ color: RUN_COLORS[i % RUN_COLORS.length] }}>
                    {labels[i]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-xs">Outcome</TableCell>
                {runs.map((r) => (
                  <TableCell key={r.key} className="text-right text-xs">
                    {r.results.status}
                    {r.results.failure ? ` (${r.results.failure.kind.replace(/_/g, ' ')} @ ${r.results.failure.station.toFixed(2)} m)` : ''}
                  </TableCell>
                ))}
              </TableRow>
              {METRIC_ROWS.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="text-xs">{row.label}</TableCell>
                  {runs.map((r) => (
                    <TableCell key={r.key} className="tabular text-right text-xs">
                      {row.value(r.results.metrics, r.results.config.robot)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Trajectories" source="calc">
          <PipeCanvas className="h-[300px]" geometry={feas?.geometry ?? []} tracks={tracks} steps={feas?.steps} />
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {labels.map((l, i) => (
              <span key={l} className="flex items-center gap-1">
                <span className="h-0.5 w-4" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />
                {l}
              </span>
            ))}
          </div>
        </Section>
        <Section title="Cross-track error along the pipe" source="calc">
          <SeriesChart data={lat} x="s" xLabel="s [m]" yLabel="e_lat [mm]" digits={1} series={series} />
        </Section>
        <Section title="Position error over time" source="calc">
          <SeriesChart data={pos} x="t" xLabel="t [s]" yLabel="|e| [mm]" digits={1} series={series} />
        </Section>
        <Section title="Minimum clearance along the pipe" source="calc">
          <SeriesChart data={clr} x="s" xLabel="s [m]" yLabel="clearance [mm]" digits={1} series={series} />
        </Section>
        <Section title="Linear velocity" source="calc">
          <SeriesChart data={vel} x="t" xLabel="t [s]" yLabel="v [m/s]" series={series} />
        </Section>
      </div>
      {report ? (
        <Section title="Automatically generated comparison report" source="calc">
          <Markdown text={report} />
        </Section>
      ) : null}
    </div>
  )
}
