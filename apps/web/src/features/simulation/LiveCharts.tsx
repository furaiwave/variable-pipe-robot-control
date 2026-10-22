import { useMemo } from 'react'
import { SeriesChart, chartColors } from '@/components/charts/SeriesChart'
import { useLiveSeries } from '@/hooks/use-live-telemetry'

/** Rolling charts of the live run (last 30 s of simulated time). */
export function LiveCharts() {
  const series = useLiveSeries(500, 30)
  const data = useMemo(
    () =>
      series.map((s) => ({
        t: s.t,
        lat: s.error_lateral * 1000,
        pos: s.error_position * 1000,
        v: s.v,
        vref: s.v_ref,
        clr: s.clearance * 1000,
        req: s.required_clearance * 1000,
      })),
    [series],
  )
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <SeriesChart
        data={data}
        x="t"
        xLabel="t [с]"
        yLabel="похибка [мм]"
        height={180}
        digits={1}
        syncId="live"
        series={[
          { key: 'lat', label: 'Поперечна', color: chartColors.c1 },
          { key: 'pos', label: 'Положення', color: chartColors.c2 },
        ]}
      />
      <SeriesChart
        data={data}
        x="t"
        xLabel="t [с]"
        yLabel="v [м/с]"
        height={180}
        syncId="live"
        series={[
          { key: 'v', label: 'Фактична', color: chartColors.c3 },
          { key: 'vref', label: 'Опорна', color: chartColors.muted, dashed: true },
        ]}
      />
      <SeriesChart
        data={data}
        x="t"
        xLabel="t [с]"
        yLabel="зазор [мм]"
        height={180}
        digits={1}
        syncId="live"
        series={[
          { key: 'clr', label: 'Мін. зазор', color: chartColors.c4 },
          { key: 'req', label: 'Необхідний', color: chartColors.warning, dashed: true },
        ]}
      />
    </div>
  )
}
