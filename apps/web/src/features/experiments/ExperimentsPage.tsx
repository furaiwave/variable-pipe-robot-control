import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { FlaskConical, GitCompareArrows, Loader2, ScanSearch, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, KeyValue, PageHeader, Section } from '@/components/common'
import { FeasibilityPanel, FeasibilityVerdict } from '@/components/analysis/FeasibilityPanel'
import { ApiError, api } from '@/services/api'
import { fmt } from '@/lib/format'
import { localizePreset } from '@/lib/localize'
import { CONTROLLER_SHORT } from '@/lib/violations'
import { CONTROLLER_TYPES, controllerConfig, useConfigStore } from '@/stores/config-store'
import { useResultsStore } from '@/stores/results-store'
import type { ExperimentPreset, FeasibilityReport } from '@/types/api'

export function ExperimentsPage() {
  const [presets, setPresets] = useState<ExperimentPreset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<{ preset: ExperimentPreset; report: FeasibilityReport } | null>(null)
  const loadScenario = useConfigStore((s) => s.loadScenario)
  const addComparison = useResultsStore((s) => s.addComparison)
  const navigate = useNavigate()

  useEffect(() => {
    api
      .presets()
      .then((ps) => setPresets(ps.map(localizePreset)))
      .catch((e) => setError(e instanceof ApiError ? e.describe() : String(e)))
  }, [])

  const runComparison = async (p: ExperimentPreset) => {
    setRunning(p.id)
    try {
      const resp = await api.compare(p.config, p.controllers)
      addComparison(resp)
      toast.success(`${p.code}: завершено запусків — ${resp.runs.length}`)
      navigate('/results')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.describe() : String(e))
    } finally {
      setRunning(null)
    }
  }

  const analyze = async (p: ExperimentPreset) => {
    setRunning(`${p.id}-a`)
    try {
      setAnalysis({ preset: p, report: await api.feasibility(p.config) })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.describe() : String(e))
    } finally {
      setRunning(null)
    }
  }

  const customCompare = async () => {
    const { config, controllers, enabled } = useConfigStore.getState()
    if (!config || !controllers) return
    setRunning('custom')
    try {
      const resp = await api.compare(
        config,
        CONTROLLER_TYPES.filter((t) => enabled[t]).map((t) => controllerConfig(t, controllers)),
      )
      addComparison(resp)
      navigate('/results')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.describe() : String(e))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Експерименти"
        description="Наперед задані, повністю детерміновані сценарії. Кожен порівнюваний запуск використовує однакові трубопровід, робота, опорну траєкторію, початкові умови, збурення та зерно генератора."
        actions={
          <Button variant="outline" onClick={customCompare} disabled={running !== null}>
            {running === 'custom' ? <Loader2 className="animate-spin" /> : <GitCompareArrows />} Порівняти регулятори на поточному сценарії
          </Button>
        }
      />
      {error ? <EmptyState title="Не вдалося завантажити пресети" icon={<FlaskConical />}>{error}</EmptyState> : null}
      {!presets && !error ? <EmptyState title="Завантаження пресетів…" icon={<Loader2 className="animate-spin" />} /> : null}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {presets?.map((p) => (
          <Section
            key={p.id}
            title={
              <span className="flex items-center gap-2">
                <Badge className="bg-primary/15 font-mono text-primary">{p.code}</Badge>
                {p.title}
              </span>
            }
            description={p.objective}
          >
            <div className="space-y-3">
              <p className="text-xs leading-relaxed">{p.description}</p>
              <KeyValue
                items={[
                  ['Трубопровід', p.config.pipeline.name],
                  ['Сегменти', String(p.config.pipeline.segments.length)],
                  ['Початкове зміщення / курс', `${fmt.mm(p.config.initial.lateral_offset, 0)} / ${fmt.deg(p.config.initial.heading_error)}`],
                  ['Крейсерська швидкість', fmt.mps(p.config.reference.cruise_speed, 2)],
                  ['Похибка радіуса колеса', fmt.pct(p.config.disturbances.wheel_radius_mismatch)],
                  ['Шум сенсорів σ (положення / курс)', `${fmt.mm(p.config.robot.sensor_noise.position_std)} / ${fmt.deg(p.config.robot.sensor_noise.heading_std)}`],
                  ['Зерно / Δt', `${p.config.seed} / ${p.config.time_step * 1000} мс`],
                  ['Регулятори', p.controllers.map((c) => CONTROLLER_SHORT[c.type]).join(', ')],
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void runComparison(p)} disabled={running !== null}>
                  {running === p.id ? <Loader2 className="animate-spin" /> : <GitCompareArrows />}
                  {p.controllers.length > 1 ? 'Запустити порівняння' : 'Запустити'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void analyze(p)} disabled={running !== null}>
                  {running === `${p.id}-a` ? <Loader2 className="animate-spin" /> : <ScanSearch />} Статичний аналіз
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    loadScenario(p.config, p.controllers)
                    toast.success(`Експеримент ${p.code} завантажено в робочу область`)
                    navigate('/simulation')
                  }}
                >
                  <Upload /> Завантажити в робочу область
                </Button>
              </div>
            </div>
          </Section>
        ))}
      </div>
      <Dialog open={analysis !== null} onOpenChange={(o) => !o && setAnalysis(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Статичний аналіз – {analysis?.preset.code} {analysis?.preset.title}
            </DialogTitle>
            <DialogDescription>Відцентрований і вирівняний робот оцінюється вздовж усієї труби до будь-якого моделювання.</DialogDescription>
          </DialogHeader>
          {analysis ? (
            <div className="space-y-3">
              <FeasibilityVerdict report={analysis.report} />
              <FeasibilityPanel report={analysis.report} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
