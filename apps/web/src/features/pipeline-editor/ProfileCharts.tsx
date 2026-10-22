import { useMemo } from 'react'
import { SeriesChart, chartColors } from '@/components/charts/SeriesChart'
import { decimate } from '@/lib/decimate'
import { RAD2DEG } from '@/lib/format'
import type { FeasibilityReport } from '@/types/api'

/** Longitudinal profiles computed by the engine for an ideally centred robot. */
export function ProfileCharts({ report, maxContactAngle }: { report: FeasibilityReport; maxContactAngle: number }) {
  const diameter = useMemo(
    () =>
      decimate(report.geometry, 800).map((g) => ({
        s: g.s,
        d: g.diameter * 1000,
        base: g.base_diameter * 1000,
        z: g.elevation * 1000,
      })),
    [report.geometry],
  )
  const clearance = useMemo(
    () =>
      decimate(report.profile, 800, (p) => p.clearance).map((p) => ({
        s: p.s,
        clearance: p.clearance * 1000,
        required: p.required * 1000,
        margin: p.lateral_margin * 1000,
        angle: p.contact_angle * RAD2DEG,
      })),
    [report.profile],
  )
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Внутрішній діаметр уздовж труби</p>
        <SeriesChart
          data={diameter}
          x="s"
          xLabel="s [м]"
          yLabel="D [мм]"
          digits={0}
          series={[
            { key: 'd', label: 'Ефективний (зі звуженнями)', color: chartColors.c1 },
            { key: 'base', label: 'Номінальний', color: chartColors.muted, dashed: true },
          ]}
        />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Зазор і бічний запас проходимості (робот по центру)</p>
        <SeriesChart
          data={clearance}
          x="s"
          xLabel="s [м]"
          yLabel="[мм]"
          digits={1}
          refLines={[{ y: 0, label: '0', color: chartColors.danger }]}
          series={[
            { key: 'clearance', label: 'Мін. радіальний зазор', color: chartColors.c3 },
            { key: 'required', label: 'Необхідний', color: chartColors.warning, dashed: true },
            { key: 'margin', label: 'Бічний запас', color: chartColors.c4 },
          ]}
        />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Кут контакту колесо–стінка (робот по центру)</p>
        <SeriesChart
          data={clearance}
          x="s"
          xLabel="s [м]"
          yLabel="β [°]"
          digits={1}
          height={180}
          refLines={[{ y: maxContactAngle * RAD2DEG, label: 'межа', color: chartColors.warning }]}
          series={[{ key: 'angle', label: 'Кут контакту', color: chartColors.c2 }]}
        />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Профіль висоти (за нахилами сегментів)</p>
        <SeriesChart data={diameter} x="s" xLabel="s [м]" yLabel="z [мм]" digits={0} height={180} series={[{ key: 'z', label: 'Висота', color: chartColors.c5 }]} />
      </div>
    </div>
  )
}
