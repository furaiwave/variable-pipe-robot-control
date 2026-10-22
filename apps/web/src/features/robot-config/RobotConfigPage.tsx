import { useCallback, useState } from 'react'
import { Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState, KeyValue, PageHeader, Section } from '@/components/common'
import { useFeasibility } from '@/hooks/use-feasibility'
import { ApiError, api } from '@/services/api'
import { fmt } from '@/lib/format'
import { useConfigStore } from '@/stores/config-store'
import type { RobotConfig } from '@/types/api'
import { CrossSection } from './CrossSection'
import { RobotForm } from './RobotForm'
import { RobotSchematic } from './RobotSchematic'

export function RobotConfigPage() {
  const config = useConfigStore((s) => s.config)
  const setRobot = useConfigStore((s) => s.setRobot)
  const [draft, setDraft] = useState<RobotConfig | null>(null)
  const onDraft = useCallback((r: RobotConfig | null) => setDraft(r), [])
  const { report } = useFeasibility(config)

  if (!config) return <EmptyState title="Завантаження конфігурації…" icon={<Loader2 className="animate-spin" />} />
  const preview = draft ?? config.robot

  const apply = async (robot: RobotConfig) => {
    try {
      const res = await api.validateConfig({ ...config, robot })
      const robotIssues = res.issues.filter((i) => i.field.startsWith('robot.'))
      if (robotIssues.length) {
        toast.error('Рушій відхилив параметри робота')
        return robotIssues
      }
      setRobot(robot)
      toast.success('Параметри робота застосовано')
      if (!res.valid) toast.warning(`Сценарій має інші проблеми: ${res.issues[0]?.field}: ${res.issues[0]?.message}`)
      return []
    } catch (e) {
      toast.error(e instanceof ApiError ? e.describe() : String(e))
      return []
    }
  }

  const r = preview
  const n = r.wheel_count / 2
  return (
    <div className="space-y-4">
      <PageHeader title="Конфігурація робота" description="Механічні параметри та параметри руху колісного інспекційного робота з бортовим керуванням." />
      <Alert>
        <Info />
        <AlertTitle>Ілюстративні параметри</AlertTitle>
        <AlertDescription>
          Типові значення описують гіпотетичного малого інспекційного робота для труб 200–300 мм. Це припущення моделі, а не виміряні
          характеристики реального обладнання.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Section title="Параметри" source="config" description="Усі значення перевіряються тут і повторно Rust-рушієм перед застосуванням.">
          <RobotForm robot={config.robot} onApply={apply} onDraft={onDraft} />
        </Section>
        <div className="space-y-4">
          <Section title="Схема (вид зверху)" source="config" description={draft ? 'Попередній перегляд незастосованої чернетки' : 'Застосована конфігурація'}>
            <RobotSchematic robot={r} />
          </Section>
          <Section title="Похідні характеристики" source="calc">
            <KeyValue
              items={[
                ['Габарит Д × Ш × В', `${fmt.mm(Math.max(r.body_length, r.wheelbase + 2 * r.wheel_radius), 0)} × ${fmt.mm(Math.max(r.body_width, r.track_width + r.wheel_width), 0)} × ${fmt.mm(Math.max(r.chassis_clearance + r.body_height, 2 * r.wheel_radius), 0)}`],
                ['Осі / відстань між ними', `${n} / ${fmt.mm(r.wheelbase / Math.max(1, n - 1), 0)}`],
                ['Напівширина зони контакту коліс (зовн. край протектора)', fmt.mm((r.track_width + r.wheel_width) / 2)],
                ['Макс. швидкість за обмеженням колеса (r·ω_max)', fmt.mps(r.wheel_radius * r.max_wheel_speed)],
                ['Сумарна межа тягової сили (n·τ/r)', `${((r.wheel_count * r.max_motor_torque) / r.wheel_radius).toFixed(2)} Н`],
                ['Вага', `${(r.mass * 9.80665).toFixed(2)} Н`],
                ...(report && !draft
                  ? ([
                      ['Макс. висота сходинки (передня вісь)', fmt.mm(report.max_step_height)],
                      ['Макс. нахил, що долається', fmt.deg(report.slope_limit.max_slope)],
                      ['Геометричний мін. діаметр труби', report.min_feasible_diameter ? fmt.mm(report.min_feasible_diameter.geometric) : '—'],
                      ['Рекомендований мін. діаметр труби', report.min_feasible_diameter ? fmt.mm(report.min_feasible_diameter.recommended) : '—'],
                    ] as [string, string][])
                  : []),
              ]}
            />
          </Section>
        </div>
      </div>
      <Section
        title="Поперечний переріз у круглій трубі"
        source="calc"
        description="Квазі-3D розміщення, що використовується для перевірки зазорів: колеса спираються на стінку, площина шасі проводиться через точки контакту (жорстке тіло без підвіски)."
      >
        <CrossSection robot={preview} safetyMargin={config.safety_margin} />
      </Section>
    </div>
  )
}
