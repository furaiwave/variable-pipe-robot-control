import { useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SeriesChart, chartColors } from '@/components/charts/SeriesChart'
import { PipeCanvas } from '@/components/pipe-view/PipeCanvas'
import { useFeasibility } from '@/hooks/use-feasibility'
import { decimate } from '@/lib/decimate'
import { RAD2DEG } from '@/lib/format'
import type { SimulationResults } from '@/types/api'

/** All result plots are generated from the run's recorded telemetry. */
export function ResultCharts({ results }: { results: SimulationResults }) {
  const { report } = useFeasibility(results.config)
  const robot = results.config.robot
  const data = useMemo(
    () =>
      decimate(results.telemetry, 900, (s) => s.error_lateral).map((s) => ({
        t: s.t,
        s: s.s,
        d: s.d * 1000,
        dref: results.config.reference.lateral_offset * 1000,
        epos: s.error_position * 1000,
        elat: s.error_lateral * 1000,
        ealong: s.error_along * 1000,
        ehead: s.error_heading * RAD2DEG,
        v: s.v,
        vref: s.v_ref,
        vcmd: s.v_cmd,
        w: s.omega,
        wref: s.omega_ref,
        wcmd: s.omega_cmd,
        wl: s.wheel_left,
        wr: s.wheel_right,
        wlc: s.wheel_left_cmd,
        wrc: s.wheel_right_cmd,
        tl: s.torque_left,
        tr: s.torque_right,
        tdl: s.torque_demand_left,
        tdr: s.torque_demand_right,
        clr: s.clearance * 1000,
        req: s.required_clearance * 1000,
        ca: s.contact_angle * RAD2DEG,
        dia: s.diameter * 1000,
        margin: s.lateral_margin * 1000,
        gain: s.gain_multiplier,
        slope: s.slope * RAD2DEG,
      })),
    [results],
  )
  const tracks = useMemo(
    () => [
      {
        label: 'опорна',
        color: 'var(--chart-1)',
        dashed: true,
        points: decimate(results.telemetry, 3000).map((s) => ({ x: s.x_ref, y: s.y_ref })),
      },
      { label: 'фактична', color: 'var(--chart-2)', points: decimate(results.telemetry, 3000).map((s) => ({ x: s.x, y: s.y })) },
    ],
    [results],
  )
  const last = results.telemetry[results.telemetry.length - 1]

  return (
    <Tabs defaultValue="trajectory">
      <TabsList className="flex-wrap">
        <TabsTrigger value="trajectory">Траєкторія</TabsTrigger>
        <TabsTrigger value="errors">Похибки</TabsTrigger>
        <TabsTrigger value="velocity">Швидкості</TabsTrigger>
        <TabsTrigger value="wheels">Колеса й момент</TabsTrigger>
        <TabsTrigger value="clearance">Зазор</TabsTrigger>
        <TabsTrigger value="control">Керувальні впливи</TabsTrigger>
      </TabsList>
      <TabsContent value="trajectory" className="space-y-3">
        <PipeCanvas
          className="h-[380px]"
          geometry={report?.geometry ?? []}
          robot={robot}
          pose={last ? { x: last.x, y: last.y, theta: last.theta } : null}
          tracks={tracks}
          steps={report?.steps}
          ariaLabel="Бажана (пунктир) і фактична (суцільна) траєкторії"
        />
        <SeriesChart
          data={data}
          x="s"
          xLabel="s [м]"
          yLabel="бічне зміщення [мм]"
          digits={1}
          series={[
            { key: 'd', label: 'Фактичне зміщення від осі', color: chartColors.c2 },
            { key: 'dref', label: 'Бажане', color: chartColors.c1, dashed: true },
          ]}
        />
      </TabsContent>
      <TabsContent value="errors" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [с]"
          yLabel="похибка [мм]"
          digits={1}
          syncId="res"
          series={[
            { key: 'epos', label: 'Положення |p − p_ref|', color: chartColors.c2 },
            { key: 'elat', label: 'Поперечна', color: chartColors.c1 },
            { key: 'ealong', label: 'Поздовжнє відставання', color: chartColors.c3 },
          ]}
        />
        <SeriesChart data={data} x="t" xLabel="t [с]" yLabel="e_θ [°]" digits={2} syncId="res" series={[{ key: 'ehead', label: 'Похибка орієнтації', color: chartColors.c4 }]} />
      </TabsContent>
      <TabsContent value="velocity" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [с]"
          yLabel="v [м/с]"
          syncId="res"
          refLines={[{ y: robot.max_linear_velocity, label: 'v_max', color: chartColors.warning }]}
          series={[
            { key: 'v', label: 'Фактична', color: chartColors.c2 },
            { key: 'vref', label: 'Опорна', color: chartColors.c1, dashed: true },
            { key: 'vcmd', label: 'Команда', color: chartColors.c3, width: 1 },
          ]}
        />
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [с]"
          yLabel="ω [рад/с]"
          syncId="res"
          series={[
            { key: 'w', label: 'Фактична', color: chartColors.c2 },
            { key: 'wref', label: 'Опорна', color: chartColors.c1, dashed: true },
            { key: 'wcmd', label: 'Команда', color: chartColors.c3, width: 1 },
          ]}
        />
      </TabsContent>
      <TabsContent value="wheels" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [с]"
          yLabel="ω_wheel [рад/с]"
          digits={2}
          syncId="res"
          refLines={[{ y: robot.max_wheel_speed, label: 'межа', color: chartColors.warning }]}
          series={[
            { key: 'wl', label: 'Ліве', color: chartColors.c1 },
            { key: 'wr', label: 'Праве', color: chartColors.c2 },
            { key: 'wlc', label: 'Ліве, команда', color: chartColors.c1, dashed: true, width: 1 },
            { key: 'wrc', label: 'Праве, команда', color: chartColors.c2, dashed: true, width: 1 },
          ]}
        />
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [с]"
          yLabel="τ на двигун [Н·м]"
          digits={3}
          syncId="res"
          refLines={[
            { y: robot.max_motor_torque, label: '+τ_max', color: chartColors.danger },
            { y: -robot.max_motor_torque, label: '−τ_max', color: chartColors.danger },
          ]}
          series={[
            { key: 'tl', label: 'Лівий (фактичний)', color: chartColors.c1 },
            { key: 'tr', label: 'Правий (фактичний)', color: chartColors.c2 },
            { key: 'tdl', label: 'Лівий (потрібний)', color: chartColors.c1, dashed: true, width: 1 },
            { key: 'tdr', label: 'Правий (потрібний)', color: chartColors.c2, dashed: true, width: 1 },
          ]}
        />
      </TabsContent>
      <TabsContent value="clearance" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="s"
          xLabel="s [м]"
          yLabel="[мм]"
          digits={1}
          refLines={[{ y: 0, label: 'стінка', color: chartColors.danger }]}
          series={[
            { key: 'clr', label: 'Мін. зазор робот–труба', color: chartColors.c3 },
            { key: 'req', label: 'Необхідний', color: chartColors.warning, dashed: true },
            { key: 'margin', label: 'Статичний бічний запас попереду', color: chartColors.c4, width: 1 },
          ]}
        />
        <SeriesChart
          data={data}
          x="s"
          xLabel="s [м]"
          yLabel="β [°]"
          digits={1}
          refLines={[{ y: robot.max_contact_angle * RAD2DEG, label: 'межа', color: chartColors.warning }]}
          series={[{ key: 'ca', label: 'Кут контакту зі стінкою', color: chartColors.c2 }]}
        />
        <SeriesChart data={data} x="s" xLabel="s [м]" yLabel="D [мм]" digits={0} height={180} series={[{ key: 'dia', label: 'Локальний діаметр', color: chartColors.c1 }]} />
        <SeriesChart data={data} x="s" xLabel="s [м]" yLabel="нахил [°]" digits={1} height={180} series={[{ key: 'slope', label: 'Ефективний нахил', color: chartColors.c5 }]} />
      </TabsContent>
      <TabsContent value="control" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [с]"
          yLabel="команда"
          syncId="res"
          series={[
            { key: 'vcmd', label: 'v_cmd [м/с]', color: chartColors.c3 },
            { key: 'wcmd', label: 'ω_cmd [рад/с]', color: chartColors.c4 },
          ]}
        />
        <SeriesChart data={data} x="t" xLabel="t [с]" yLabel="множник коефіцієнтів" digits={2} syncId="res" series={[{ key: 'gain', label: 'm (множник планування)', color: chartColors.c1 }]} />
      </TabsContent>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Графіки побудовано за записаною телеметрією ({results.telemetry.length} відліків, проріджено для відображення зі збереженням піків). Показники рушій обчислює на кожному кроці інтегрування.
      </p>
    </Tabs>
  )
}
