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

  if (!config) return <EmptyState title="Loading configuration…" icon={<Loader2 className="animate-spin" />} />
  const preview = draft ?? config.robot

  const apply = async (robot: RobotConfig) => {
    try {
      const res = await api.validateConfig({ ...config, robot })
      const robotIssues = res.issues.filter((i) => i.field.startsWith('robot.'))
      if (robotIssues.length) {
        toast.error('The engine rejected the robot parameters')
        return robotIssues
      }
      setRobot(robot)
      toast.success('Robot parameters applied')
      if (!res.valid) toast.warning(`Scenario has other issues: ${res.issues[0]?.field}: ${res.issues[0]?.message}`)
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
      <PageHeader title="Robot configuration" description="Mechanical and motion parameters of the wheeled (skid-steer) inspection robot." />
      <Alert>
        <Info />
        <AlertTitle>Illustrative parameters</AlertTitle>
        <AlertDescription>
          The default values describe a hypothetical small inspection robot for 200–300 mm pipes. They are modelling assumptions, not measured
          specifications of real hardware.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Section title="Parameters" source="config" description="All values are validated here and again by the Rust engine before they are applied.">
          <RobotForm robot={config.robot} onApply={apply} onDraft={onDraft} />
        </Section>
        <div className="space-y-4">
          <Section title="Schematic (top view)" source="config" description={draft ? 'Preview of the unapplied draft' : 'Applied configuration'}>
            <RobotSchematic robot={r} />
          </Section>
          <Section title="Derived properties" source="calc">
            <KeyValue
              items={[
                ['Envelope L × W × H', `${fmt.mm(Math.max(r.body_length, r.wheelbase + 2 * r.wheel_radius), 0)} × ${fmt.mm(Math.max(r.body_width, r.track_width + r.wheel_width), 0)} × ${fmt.mm(Math.max(r.chassis_clearance + r.body_height, 2 * r.wheel_radius), 0)}`],
                ['Axles / spacing', `${n} / ${fmt.mm(r.wheelbase / Math.max(1, n - 1), 0)}`],
                ['Wheel contact half-span (outer tread edge)', fmt.mm((r.track_width + r.wheel_width) / 2)],
                ['Max. speed from wheel limit (r·ω_max)', fmt.mps(r.wheel_radius * r.max_wheel_speed)],
                ['Total drive force limit (n·τ/r)', `${((r.wheel_count * r.max_motor_torque) / r.wheel_radius).toFixed(2)} N`],
                ['Weight', `${(r.mass * 9.80665).toFixed(2)} N`],
                ...(report && !draft
                  ? ([
                      ['Max. climbable step (front axle)', fmt.mm(report.max_step_height)],
                      ['Max. climbable slope', fmt.deg(report.slope_limit.max_slope)],
                      ['Geometric min. pipe diameter', report.min_feasible_diameter ? fmt.mm(report.min_feasible_diameter.geometric) : '—'],
                      ['Recommended min. pipe diameter', report.min_feasible_diameter ? fmt.mm(report.min_feasible_diameter.recommended) : '—'],
                    ] as [string, string][])
                  : []),
              ]}
            />
          </Section>
        </div>
      </div>
      <Section
        title="Cross-section in a circular pipe"
        source="calc"
        description="Quasi-3D placement used by the clearance checks: wheels rest on the wall, the chassis plane is fitted through the contacts (rigid body, no suspension)."
      >
        <CrossSection robot={preview} safetyMargin={config.safety_margin} />
      </Section>
    </div>
  )
}
