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

  if (!config) return <EmptyState title="Завантаження конфігурації…" icon={<Loader2 className="animate-spin" />} />

  const summary = report?.summary
  return (
    <div className="space-y-4">
      <PageHeader
        title="Редактор трубопроводу"
        description="Складіть трубопровід зі з’єднаних сегментів. Геометрію, зазори та проходимість розраховує Rust-рушій."
        actions={<FeasibilityVerdict report={stale ? null : report} loading={loading} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard source="calc" label="Загальна довжина" value={summary ? fmt.m(summary.total_length, 2) : '—'} sub={`сегментів: ${segments.length}`} />
        <StatCard
          source="calc"
          label="Мін. внутрішній діаметр"
          value={summary ? fmt.mm(summary.min_diameter) : '—'}
          sub={summary ? `при s = ${summary.min_diameter_station.toFixed(2)} м` : undefined}
        />
        <StatCard source="calc" label="Вигини" value={summary ? summary.bend_count : '—'} sub={summary ? `сумарно ${(summary.total_turning_angle * RAD2DEG).toFixed(0)}°` : undefined} />
        <StatCard source="calc" label="Перепад висоти" value={summary ? fmt.m(summary.elevation_change, 2) : '—'} sub={summary ? `макс. нахил ${fmt.deg(summary.max_inclination)}` : undefined} />
        <StatCard
          source="calc"
          label="Сходинки діаметра"
          value={report ? report.steps.length : '—'}
          tone={report && report.steps.some((s) => !s.climbable) ? 'danger' : undefined}
          sub={report ? `непрохідних: ${report.steps.filter((s) => !s.climbable).length}` : undefined}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Рушій відхилив цей трубопровід</AlertTitle>
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
        <Section title="Сегменти" description="Клацніть сегмент (у списку чи на схемі), щоб редагувати його.">
          <div className="mb-3 space-y-1">
            <Label htmlFor="pipe-name" className="text-xs">
              Назва трубопроводу
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
          title="План"
          source="calc"
          description="Осьова лінія, ефективні стінки, сходинки (○ прохідна, ✕ ні) та статичні проблеми (червоні/жовті смуги). Робот показаний у стартовому положенні. Колесо миші — масштаб, перетягування — зсув."
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

        <Section title={selected ? `Сегмент ${selectedIdx + 1}: ${selected.label || selected.id}` : 'Властивості сегмента'} source="config">
          {selected ? (
            <SegmentForm
              key={`${revision}-${selectedIdx}`}
              segment={selected}
              otherIds={otherIds}
              station={stations[selectedIdx] ?? null}
              onCommit={(seg) => store().updateSegment(selected.id, seg)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Оберіть сегмент.</p>
          )}
        </Section>
      </div>

      {report ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Section title="Поздовжні профілі" source="calc">
            <ProfileCharts report={report} maxContactAngle={config.robot.max_contact_angle} />
          </Section>
          <Section title="Статичний аналіз проходимості" source="calc" description="Ідеальний робот, відцентрований на осьовій лінії та вирівняний уздовж неї.">
            <FeasibilityPanel report={report} />
          </Section>
        </div>
      ) : null}
    </div>
  )
}
