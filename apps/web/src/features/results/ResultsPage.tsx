import { useRef } from 'react'
import { ChartLine, FileJson, FileSpreadsheet, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Section, StatusBadge } from '@/components/common'
import { Markdown } from '@/components/common/Markdown'
import { exportResultsCsv as exportCsv, exportResultsJson as exportJson, parseExperimentJson } from '@/lib/export'
import { cn } from '@/lib/utils'
import { CONTROLLER_NAMES, CONTROLLER_SHORT } from '@/lib/violations'
import { type RunSource, type StoredRun, useResultsStore } from '@/stores/results-store'

const SOURCE_LABELS: Record<RunSource, string> = { live: 'наживо', instant: 'миттєво', comparison: 'порівняння', import: 'імпорт' }
import { ViolationsPanel } from '@/features/simulation/ViolationsPanel'
import type { SimulationResults } from '@/types/api'
import { ComparisonView } from './ComparisonView'
import { MetricsTable } from './MetricsTable'
import { ResultCharts } from './ResultCharts'

function RunList({ runs, selected, onToggle, onRemove }: { runs: StoredRun[]; selected: string[]; onToggle: (k: string) => void; onRemove: (k: string) => void }) {
  return (
    <ul className="max-h-[560px] space-y-1 overflow-y-auto pr-1" aria-label="Запуски моделювання">
      {runs.map((r) => {
        const on = selected.includes(r.key)
        return (
          <li key={r.key} className={cn('flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs', on ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-muted')}>
            <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" checked={on} onChange={() => onToggle(r.key)} aria-label={`Вибрати запуск ${r.results.name} (${CONTROLLER_SHORT[r.results.controller]})`} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onToggle(r.key)}>
              <div className="truncate font-medium">{r.results.name}</div>
              <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                <span>{CONTROLLER_SHORT[r.results.controller]}</span>·<span>{SOURCE_LABELS[r.source]}</span>·<span className="tabular">{r.results.metrics.simulated_duration.toFixed(1)} с</span>
              </div>
            </button>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={r.results.status} />
              <Button size="icon-xs" variant="ghost" aria-label="Видалити запуск" onClick={() => onRemove(r.key)}>
                <Trash2 />
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function RunDetail({ results }: { results: SimulationResults }) {
  return (
    <div className="space-y-4">
      <Section
        title={
          <span className="flex flex-wrap items-center gap-2">
            {results.name} <Badge variant="outline">{CONTROLLER_NAMES[results.controller]}</Badge>
          </span>
        }
        description={`Рушій ${results.engine_version} · сценарій ${results.scenario_hash} · зерно ${results.config.seed}`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => exportCsv(results)}>
              <FileSpreadsheet /> Телеметрія CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportJson(results)}>
              <FileJson /> Експеримент JSON
            </Button>
          </>
        }
      >
        <ViolationsPanel status={results.status} failure={results.failure} events={results.events} maxItems={50} />
      </Section>
      <div className="grid gap-4 2xl:grid-cols-[1fr_460px]">
        <Section title="Графіки" source="calc">
          <ResultCharts results={results} />
        </Section>
        <Section title="Показники якості" source="calc">
          <MetricsTable metrics={results.metrics} robot={results.config.robot} />
        </Section>
      </div>
      <Section title="Автоматично згенерований звіт" source="calc">
        <Markdown text={results.report} />
      </Section>
    </div>
  )
}

export function ResultsPage() {
  const runs = useResultsStore((s) => s.runs)
  const selected = useResultsStore((s) => s.selected)
  const comparisons = useResultsStore((s) => s.comparisons)
  const { toggleSelected, removeRun, addRun, setSelected, clear } = useResultsStore.getState()
  const fileRef = useRef<HTMLInputElement>(null)

  const chosen = selected.map((k) => runs.find((r) => r.key === k)).filter((r): r is StoredRun => Boolean(r))
  const cmp = comparisons.find((c) => c.runKeys.length === chosen.length && c.runKeys.every((k) => selected.includes(k)))

  const onImport = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        const r = parseExperimentJson(await f.text())
        addRun(r, 'import')
        toast.success(`Імпортовано ${f.name}`)
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Результати та аналіз"
        description="Оберіть один запуск для детального аналізу або кілька запусків одного сценарію для порівняння."
        actions={
          <>
            <input ref={fileRef} type="file" accept="application/json,.json" multiple hidden onChange={(e) => void onImport(e.target.files)} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload /> Імпорт JSON
            </Button>
            {runs.length ? (
              <Button size="sm" variant="ghost" onClick={clear}>
                <Trash2 /> Очистити все
              </Button>
            ) : null}
          </>
        }
      />
      {runs.length === 0 ? (
        <EmptyState icon={<ChartLine />} title="Результатів поки немає">
          Запустіть моделювання в робочій області, порівняння в експериментах або імпортуйте експортований JSON. Результати зберігаються в пам’яті лише протягом цієї сесії браузера — експортуйте їх, щоб зберегти.
        </EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <Section
            title="Запуски"
            description={`у пам’яті: ${runs.length}`}
            actions={
              chosen.length > 1 ? (
                <Button size="xs" variant="ghost" onClick={() => setSelected([])}>
                  Зняти виділення
                </Button>
              ) : null
            }
          >
            <RunList runs={runs} selected={selected} onToggle={toggleSelected} onRemove={removeRun} />
            {comparisons.length ? (
              <div className="mt-3 space-y-1 border-t pt-2">
                <p className="text-xs font-medium">Порівняння</p>
                {comparisons.map((c) => (
                  <button key={c.key} type="button" className="block w-full truncate rounded px-1 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => setSelected(c.runKeys)}>
                    {c.name} (запусків: {c.runKeys.length})
                  </button>
                ))}
              </div>
            ) : null}
          </Section>
          <div className="min-w-0">
            {chosen.length === 0 ? (
              <EmptyState title="Оберіть запуск" />
            ) : chosen.length === 1 ? (
              <RunDetail results={chosen[0]!.results} />
            ) : (
              <ComparisonView runs={chosen} report={cmp?.report} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
