import { Progress } from '@/components/ui/progress'
import { KeyValue } from '@/components/common'
import { fmt } from '@/lib/format'
import type { RobotConfig, StatusResponse, TelemetrySample } from '@/types/api'

/** Live values of the latest telemetry sample. */
export function TelemetryPanel({ snapshot, sample, robot }: { snapshot: StatusResponse | null; sample: TelemetrySample | null; robot: RobotConfig }) {
  const s = sample
  const warnClear = s && s.clearance < s.required_clearance
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Progress</span>
          <span className="tabular font-medium">{fmt.pct(snapshot?.progress ?? 0)}</span>
        </div>
        <Progress value={(snapshot?.progress ?? 0) * 100} aria-label="Simulation progress" />
        <div className="tabular flex justify-between text-[11px] text-muted-foreground">
          <span>t = {fmt.s(snapshot?.time ?? 0)}</span>
          <span>step {snapshot?.step ?? 0}</span>
          <span>
            s = {fmt.m(s?.s ?? snapshot?.station ?? 0, 3)} / {fmt.m(snapshot?.goal_station ?? 0, 2)}
          </span>
        </div>
      </div>
      <KeyValue
        items={[
          ['Position x, y', s ? `${s.x.toFixed(3)}, ${s.y.toFixed(3)} m` : '—'],
          ['Heading θ', fmt.deg(s?.theta)],
          ['Linear velocity v / v_ref', s ? `${fmt.mps(s.v)} / ${s.v_ref.toFixed(3)}` : '—'],
          ['Angular velocity ω', fmt.radps(s?.omega, 3)],
          ['Wheel speed L / R', s ? `${s.wheel_left.toFixed(2)} / ${s.wheel_right.toFixed(2)} rad/s` : '—'],
          ['Wheel cmd L / R', s ? `${s.wheel_left_cmd.toFixed(2)} / ${s.wheel_right_cmd.toFixed(2)} rad/s` : '—'],
          ['Motor torque L / R', s ? `${s.torque_left.toFixed(3)} / ${s.torque_right.toFixed(3)} N·m (max ${robot.max_motor_torque})` : '—'],
          ['Position error', fmt.mm(s?.error_position, 2)],
          ['Cross-track error', fmt.mm(s?.error_lateral, 2)],
          ['Heading error', fmt.deg(s?.error_heading, 2)],
          [
            'Clearance / required',
            <span key="c" className={warnClear ? 'text-destructive' : undefined}>
              {s ? `${fmt.mm(s.clearance)} / ${fmt.mm(s.required_clearance)}` : '—'}
            </span>,
          ],
          ['Local diameter', fmt.mm(s?.diameter, 0)],
          ['Contact angle', s ? `${fmt.deg(s.contact_angle)} / ${fmt.deg(robot.max_contact_angle)}` : '—'],
          ['Pitch / roll', s ? `${fmt.deg(s.pitch, 2)} / ${fmt.deg(s.roll, 2)}` : '—'],
          ['Effective slope', fmt.deg(s?.slope)],
          ['Lateral margin ahead', fmt.mm(s?.lateral_margin)],
          ['Gain multiplier', s ? s.gain_multiplier.toFixed(2) : '—'],
        ]}
      />
    </div>
  )
}
