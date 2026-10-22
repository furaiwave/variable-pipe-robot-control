import type { RobotConfig } from '@/types/api'

/** Top-view schematic with dimension lines (body frame: x forward = right). */
export function RobotSchematic({ robot }: { robot: RobotConfig }) {
  const L = Math.max(robot.body_length, robot.wheelbase + 2 * robot.wheel_radius)
  const W = Math.max(robot.body_width, robot.track_width + robot.wheel_width)
  const pad = 0.35 * Math.max(L, W)
  const vbW = L + 2 * pad
  const vbH = W + 2 * pad
  const n = robot.wheel_count / 2
  const axles = Array.from({ length: n }, (_, k) => -robot.wheelbase / 2 + (robot.wheelbase * k) / Math.max(1, n - 1))
  const fs = Math.max(L, W) * 0.055
  const sw = Math.max(L, W) * 0.006
  const mm = (m: number) => `${(m * 1000).toFixed(0)}`

  const dimH = (x0: number, x1: number, y: number, label: string) => (
    <g>
      <line x1={x0} y1={y} x2={x1} y2={y} stroke="currentColor" strokeWidth={sw} markerStart="url(#arr)" markerEnd="url(#arr)" />
      <text x={(x0 + x1) / 2} y={y - fs * 0.4} fontSize={fs} textAnchor="middle" fill="currentColor">
        {label}
      </text>
    </g>
  )
  const dimV = (y0: number, y1: number, x: number, label: string) => (
    <g>
      <line x1={x} y1={y0} x2={x} y2={y1} stroke="currentColor" strokeWidth={sw} markerStart="url(#arr)" markerEnd="url(#arr)" />
      <text x={x + fs * 0.4} y={(y0 + y1) / 2} fontSize={fs} dominantBaseline="middle" fill="currentColor">
        {label}
      </text>
    </g>
  )

  return (
    <svg
      viewBox={`${-L / 2 - pad} ${-W / 2 - pad} ${vbW} ${vbH}`}
      className="h-64 w-full text-muted-foreground"
      role="img"
      aria-label={`Робот, вид зверху: корпус ${mm(robot.body_length)} на ${mm(robot.body_width)} мм, колісна база ${mm(robot.wheelbase)} мм, колія ${mm(robot.track_width)} мм`}
    >
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>
      {axles.map((x, i) =>
        [1, -1].map((side) => (
          <rect
            key={`${i}-${side}`}
            x={x - robot.wheel_radius}
            y={side * (robot.track_width / 2) - robot.wheel_width / 2}
            width={2 * robot.wheel_radius}
            height={robot.wheel_width}
            rx={robot.wheel_width * 0.2}
            className="fill-foreground/70"
          />
        )),
      )}
      <rect
        x={-robot.body_length / 2}
        y={-robot.body_width / 2}
        width={robot.body_length}
        height={robot.body_width}
        rx={robot.body_width * 0.08}
        className="fill-primary/25 stroke-primary"
        strokeWidth={sw}
      />
      <circle cx={robot.com_offset_x} cy={0} r={fs * 0.35} className="fill-chart-2" />
      <text x={robot.com_offset_x + fs * 0.5} y={-fs * 0.5} fontSize={fs * 0.85} fill="currentColor">
        ЦМ
      </text>
      <line x1={0} y1={0} x2={robot.body_length * 0.35} y2={0} stroke="currentColor" strokeWidth={sw * 1.5} markerEnd="url(#arr)" />
      {dimH(-robot.body_length / 2, robot.body_length / 2, -W / 2 - pad * 0.45, `корпус ${mm(robot.body_length)} мм`)}
      {dimH(axles[0]!, axles[axles.length - 1]!, W / 2 + pad * 0.5, `база ${mm(robot.wheelbase)} мм`)}
      {dimV(-robot.track_width / 2, robot.track_width / 2, L / 2 + pad * 0.15, `L ${mm(robot.track_width)}`)}
      {dimV(-robot.body_width / 2, robot.body_width / 2, -L / 2 - pad * 0.8, `${mm(robot.body_width)}`)}
      <text x={axles[axles.length - 1]!} y={-robot.track_width / 2 - robot.wheel_width} fontSize={fs * 0.85} textAnchor="middle" fill="currentColor">
        r {mm(robot.wheel_radius)}
      </text>
    </svg>
  )
}
