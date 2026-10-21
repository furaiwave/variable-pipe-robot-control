import { useMemo } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, PageHeader, Section, StatCard } from '@/components/common'
import { FeasibilityPanel, FeasibilityVerdict } from '@/components/analysis/FeasibilityPanel'
import { PipeCanvas } from '@/components/pipe-view/PipeCanvas'
import { useFeasibility } from '@/hooks/use-feasibility'
import { fmt, RAD2DEG } from '@/lib/format'
import { segmentLength } from '@/lib/schemas'
import { useConfigStore } from '@/stores/config-store'
import { ProfileCharts } from './ProfileCharts'
import { SegmentForm } from './SegmentForm'
import { SegmentList } from './SegmentList'

export function PipelineEditorPage() {
  const config = useConfigStore((s) => s.config)
  const selectedId = useConfigStore((s) => s.selectedSegmentId)
  const revision = useConfigStore((s) => s.revision)
  const store = useConfigStore.getState
  const { report, error, loading, stale } = useFeasibility(config)

  const segments = useMemo(() => config?.pipeline.segments ?? [], [config])
  const stations = useMemo(
    () => segments.reduce<number[]>((acc, _seg, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + segmentLength(segments[i - 1]!)], []),
    [segments],
  )
  const selectedIdx = segments.findIndex((s) => s.id === selectedId)
  const selected = selectedIdx >= 0 ? segments[selectedIdx] : undefined
  const otherIds = useMemo(() => segments.filter((s) => s.id !== selectedId).map((s) => s.id), [segments, selectedId])

  if (!config) return <EmptyState title="Loading configuration…" icon={<Loader2 className="animate-spin" />} />

  const summary = report?.summary
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline editor"
        description="Compose the pipeline from connected segments. Geometry, clearance and feasibility are computed by the Rust engine."
        actions={<FeasibilityVerdict report={stale ? null : report} loading={loading} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard source="calc" label="Total length" value={summary ? fmt.m(summary.total_length, 2) : '—'} sub={`${segments.length} segments`} />
        <StatCard
          source="calc"
          label="Min. internal diameter"
          value={summary ? fmt.mm(summary.min_diameter) : '—'}
          sub={summary ? `at s = ${summary.min_diameter_station.toFixed(2)} m` : undefined}
        />
        <StatCard source="calc" label="Bends" value={summary ? summary.bend_count : '—'} sub={summary ? `total ${(summary.total_turning_angle * RAD2DEG).toFixed(0)}°` : undefined} />
        <StatCard source="calc" label="Elevation change" value={summary ? fmt.m(summary.elevation_change, 2) : '—'} sub={summary ? `max slope ${fmt.deg(summary.max_inclination)}` : undefined} />
        <StatCard
          source="calc"
          label="Diameter steps"
          value={report ? report.steps.length : '—'}
          tone={report && report.steps.some((s) => !s.climbable) ? 'danger' : undefined}
          sub={report ? `${report.steps.filter((s) => !s.climbable).length} not climbable` : undefined}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The engine rejected this pipeline</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {(error.details.length ? error.details.map((d) => `${d.field}: ${d.message}`) : [error.message]).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_340px]">
        <Section title="Segments" description="Click a segment (list or drawing) to edit it.">
          <div className="mb-3 space-y-1">
            <Label htmlFor="pipe-name" className="text-xs">
              Pipeline name
            </Label>
            <Input
              id="pipe-name"
              className="h-8"
              value={config.pipeline.name}
              onChange={(e) => store().setPipeline({ ...config.pipeline, name: e.target.value })}
            />
          </div>
          <SegmentList
            segments={segments}
            selectedId={selectedId}
            stations={stations}
            onSelect={(id) => store().selectSegment(id)}
            onAdd={(k) => store().addSegment(k, selectedId)}
            onMove={(id, d) => store().moveSegment(id, d)}
            onDuplicate={(id) => store().duplicateSegment(id)}
            onRemove={(id) => store().removeSegment(id)}
          />
        </Section>

        <Section
          title="Plan view"
          source="calc"
          description="Centreline, effective walls, steps (○ climbable, ✕ not) and static issues (red/amber bands). Robot shown at its start pose. Scroll to zoom, drag to pan."
        >
          <PipeCanvas
            className="h-[460px]"
            geometry={report?.geometry ?? []}
            robot={config.robot}
            pose={
              report?.geometry.length
                ? (() => {
                    const g = report.geometry
                    const s0 = report.start_station
                    const p = g.find((x) => x.s >= s0) ?? g[0]!
                    return { x: p.x, y: p.y, theta: p.heading }
                  })()
                : null
            }
            issues={report?.issues}
            steps={report?.steps}
            selectedSegment={selectedIdx >= 0 ? selectedIdx : null}
            onSelectSegment={(i) => segments[i] && store().selectSegment(segments[i]!.id)}
          />
        </Section>

        <Section title={selected ? `Segment ${selectedIdx + 1}: ${selected.label || selected.id}` : 'Segment properties'} source="config">
          {selected ? (
            <SegmentForm
              key={`${revision}-${selectedIdx}`}
              segment={selected}
              otherIds={otherIds}
              station={stations[selectedIdx] ?? null}
              onCommit={(seg) => store().updateSegment(selected.id, seg)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Select a segment.</p>
          )}
        </Section>
      </div>

      {report ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Section title="Longitudinal profiles" source="calc">
            <ProfileCharts report={report} maxContactAngle={config.robot.max_contact_angle} />
          </Section>
          <Section title="Static feasibility analysis" source="calc" description="Ideal robot centred on the centreline and aligned with it.">
            <FeasibilityPanel report={report} />
          </Section>
        </div>
      ) : null}
    </div>
  )
}
