import { memo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface Series {
  key: string
  label: string
  color: string
  dashed?: boolean
  width?: number
}

export interface SeriesChartProps {
  data: Record<string, number>[]
  x: string
  xLabel: string
  yLabel: string
  series: Series[]
  height?: number
  /** Horizontal reference lines, e.g. limits. */
  refLines?: { y: number; label: string; color: string }[]
  yDomain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax']
  digits?: number
  syncId?: string
}

export const chartColors = {
  c1: 'var(--chart-1)',
  c2: 'var(--chart-2)',
  c3: 'var(--chart-3)',
  c4: 'var(--chart-4)',
  c5: 'var(--chart-5)',
  danger: 'var(--destructive)',
  warning: 'var(--warning)',
  muted: 'var(--muted-foreground)',
}

export const RUN_COLORS = [chartColors.c1, chartColors.c2, chartColors.c3, chartColors.c4, chartColors.c5]

const fmtTick = (digits: number) => (v: number) => (Number.isFinite(v) ? Number(v.toFixed(digits)).toString() : '')

/** Line chart with consistent styling. Callers pass already-decimated data. */
export const SeriesChart = memo(function SeriesChart({
  data,
  x,
  xLabel,
  yLabel,
  series,
  height = 220,
  refLines,
  yDomain = ['auto', 'auto'],
  digits = 3,
  syncId,
}: SeriesChartProps) {
  return (
    <div style={{ height }} className="w-full text-xs" role="img" aria-label={`${yLabel} versus ${xLabel}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 16, left: 4 }} syncId={syncId}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey={x}
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={fmtTick(2)}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10 }}
            label={{ value: xLabel, position: 'insideBottom', offset: -8, fill: 'var(--muted-foreground)', fontSize: 10 }}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={fmtTick(digits)}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10 }}
            width={56}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--muted-foreground)', fontSize: 10, dy: 40 }}
          />
          <Tooltip
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
            labelFormatter={(v) => `${xLabel}: ${Number(v).toFixed(3)}`}
            formatter={(v, name) => [typeof v === 'number' ? v.toFixed(digits + 1) : String(v), name]}
          />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={20} /> : null}
          {refLines?.map((r) => (
            <ReferenceLine key={r.label} y={r.y} stroke={r.color} strokeDasharray="4 3" label={{ value: r.label, fill: r.color, fontSize: 10, position: 'insideTopRight' }} />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.width ?? 1.5}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})
