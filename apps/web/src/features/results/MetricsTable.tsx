import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmt } from '@/lib/format'
import type { PerformanceMetrics, RobotConfig } from '@/types/api'

export interface MetricRow {
  group: string
  label: string
  value: (m: PerformanceMetrics, r: RobotConfig) => string
}

export const METRIC_ROWS: MetricRow[] = [
  { group: 'Tracking', label: 'Position error RMSE', value: (m) => fmt.mm(m.position_error.rmse, 2) },
  { group: 'Tracking', label: 'Position error MAE', value: (m) => fmt.mm(m.position_error.mae, 2) },
  { group: 'Tracking', label: 'Position error max |e|', value: (m) => fmt.mm(m.position_error.max, 2) },
  { group: 'Tracking', label: 'Final position error', value: (m) => fmt.mm(m.position_error.final_value, 2) },
  { group: 'Tracking', label: 'Cross-track RMSE / max', value: (m) => `${fmt.mm(m.lateral_error.rmse, 2)} / ${fmt.mm(m.lateral_error.max, 2)}` },
  { group: 'Tracking', label: 'Heading error RMSE / max', value: (m) => `${fmt.deg(m.heading_error.rmse, 2)} / ${fmt.deg(m.heading_error.max, 2)}` },
  { group: 'Motion', label: 'Average linear velocity', value: (m) => fmt.mps(m.average_linear_velocity) },
  { group: 'Motion', label: 'Max. wheel speed', value: (m, r) => `${fmt.radps(m.max_wheel_speed)} (limit ${r.max_wheel_speed})` },
  { group: 'Motion', label: 'Total simulated distance', value: (m) => fmt.m(m.total_distance) },
  { group: 'Motion', label: 'Progress along the pipe', value: (m) => `${fmt.m(m.progress)} (${fmt.pct(m.progress_ratio)})` },
  { group: 'Motion', label: 'Simulated duration', value: (m) => fmt.s(m.simulated_duration) },
  { group: 'Motion', label: 'Execution time (engine)', value: (m) => `${fmt.ms(m.execution_time_ms)} for ${m.steps} steps` },
  { group: 'Actuation', label: 'Max. motor torque (delivered / demand)', value: (m, r) => `${fmt.nm(m.max_motor_torque)} / ${fmt.nm(m.max_torque_demand)} (limit ${r.max_motor_torque})` },
  { group: 'Actuation', label: 'Mechanical energy', value: (m) => fmt.j(m.mechanical_energy) },
  { group: 'Actuation', label: 'Steps with wheel / torque / traction limit', value: (m) => `${fmt.pct(m.wheel_saturation_ratio)} / ${fmt.pct(m.torque_saturation_ratio)} / ${fmt.pct(m.traction_limit_ratio)}` },
  { group: 'Feasibility', label: 'Min. clearance', value: (m) => `${fmt.mm(m.min_clearance, 2)} @ s = ${Number.isFinite(m.min_clearance_station) ? m.min_clearance_station.toFixed(3) : '—'} m` },
  { group: 'Feasibility', label: 'Max. wall contact angle', value: (m, r) => `${fmt.deg(m.max_contact_angle)} (limit ${fmt.deg(r.max_contact_angle)})` },
  { group: 'Feasibility', label: 'Collisions', value: (m) => String(m.collision_count) },
  { group: 'Feasibility', label: 'Failed feasibility checks', value: (m) => String(m.feasibility_violation_count) },
  { group: 'Feasibility', label: 'All constraint-violation episodes', value: (m) => String(m.constraint_violation_count) },
  { group: 'Feasibility', label: 'Goal reached', value: (m) => (m.goal_reached ? 'yes' : 'no') },
]

export function MetricsTable({ metrics, robot }: { metrics: PerformanceMetrics; robot: RobotConfig }) {
  return (
    <Table aria-label="Performance metrics">
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {METRIC_ROWS.map((r) => (
          <TableRow key={r.label}>
            <TableCell className="text-xs whitespace-normal">{r.label}</TableCell>
            <TableCell className="tabular text-right text-xs font-medium whitespace-normal">{r.value(metrics, robot)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
