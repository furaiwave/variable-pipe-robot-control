import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmt } from '@/lib/format'
import type { PerformanceMetrics, RobotConfig } from '@/types/api'

export interface MetricRow {
  group: string
  label: string
  value: (m: PerformanceMetrics, r: RobotConfig) => string
}

export const METRIC_ROWS: MetricRow[] = [
  { group: 'Стеження', label: 'СКВ похибки положення', value: (m) => fmt.mm(m.position_error.rmse, 2) },
  { group: 'Стеження', label: 'Середня абсолютна похибка положення', value: (m) => fmt.mm(m.position_error.mae, 2) },
  { group: 'Стеження', label: 'Макс. похибка положення |e|', value: (m) => fmt.mm(m.position_error.max, 2) },
  { group: 'Стеження', label: 'Кінцева похибка положення', value: (m) => fmt.mm(m.position_error.final_value, 2) },
  { group: 'Стеження', label: 'Поперечна похибка: СКВ / макс.', value: (m) => `${fmt.mm(m.lateral_error.rmse, 2)} / ${fmt.mm(m.lateral_error.max, 2)}` },
  { group: 'Стеження', label: 'Похибка курсу: СКВ / макс.', value: (m) => `${fmt.deg(m.heading_error.rmse, 2)} / ${fmt.deg(m.heading_error.max, 2)}` },
  { group: 'Рух', label: 'Середня лінійна швидкість', value: (m) => fmt.mps(m.average_linear_velocity) },
  { group: 'Рух', label: 'Макс. швидкість колеса', value: (m, r) => `${fmt.radps(m.max_wheel_speed)} (межа ${r.max_wheel_speed})` },
  { group: 'Рух', label: 'Загальна пройдена відстань', value: (m) => fmt.m(m.total_distance) },
  { group: 'Рух', label: 'Просування вздовж труби', value: (m) => `${fmt.m(m.progress)} (${fmt.pct(m.progress_ratio)})` },
  { group: 'Рух', label: 'Тривалість моделювання', value: (m) => fmt.s(m.simulated_duration) },
  { group: 'Рух', label: 'Час обчислення (рушій)', value: (m) => `${fmt.ms(m.execution_time_ms)} на ${m.steps} кроків` },
  { group: 'Привід', label: 'Макс. момент двигуна (фактичний / потрібний)', value: (m, r) => `${fmt.nm(m.max_motor_torque)} / ${fmt.nm(m.max_torque_demand)} (межа ${r.max_motor_torque})` },
  { group: 'Привід', label: 'Механічна енергія', value: (m) => fmt.j(m.mechanical_energy) },
  { group: 'Привід', label: 'Частка кроків з обмеженням коліс / моменту / зчеплення', value: (m) => `${fmt.pct(m.wheel_saturation_ratio)} / ${fmt.pct(m.torque_saturation_ratio)} / ${fmt.pct(m.traction_limit_ratio)}` },
  { group: 'Проходимість', label: 'Мін. зазор', value: (m) => `${fmt.mm(m.min_clearance, 2)} @ s = ${Number.isFinite(m.min_clearance_station) ? m.min_clearance_station.toFixed(3) : '—'} м` },
  { group: 'Проходимість', label: 'Макс. кут контакту зі стінкою', value: (m, r) => `${fmt.deg(m.max_contact_angle)} (межа ${fmt.deg(r.max_contact_angle)})` },
  { group: 'Проходимість', label: 'Зіткнення', value: (m) => String(m.collision_count) },
  { group: 'Проходимість', label: 'Невдалі перевірки проходимості', value: (m) => String(m.feasibility_violation_count) },
  { group: 'Проходимість', label: 'Усі епізоди порушення обмежень', value: (m) => String(m.constraint_violation_count) },
  { group: 'Проходимість', label: 'Ціль досягнуто', value: (m) => (m.goal_reached ? 'так' : 'ні') },
]

export function MetricsTable({ metrics, robot }: { metrics: PerformanceMetrics; robot: RobotConfig }) {
  return (
    <Table aria-label="Показники якості">
      <TableHeader>
        <TableRow>
          <TableHead>Показник</TableHead>
          <TableHead className="text-right">Значення</TableHead>
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
