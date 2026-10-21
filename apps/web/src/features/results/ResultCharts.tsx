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
        label: 'reference',
        color: 'var(--chart-1)',
        dashed: true,
        points: decimate(results.telemetry, 3000).map((s) => ({ x: s.x_ref, y: s.y_ref })),
      },
      { label: 'actual', color: 'var(--chart-2)', points: decimate(results.telemetry, 3000).map((s) => ({ x: s.x, y: s.y })) },
    ],
    [results],
  )
  const last = results.telemetry[results.telemetry.length - 1]

  return (
    <Tabs defaultValue="trajectory">
      <TabsList className="flex-wrap">
        <TabsTrigger value="trajectory">Trajectory</TabsTrigger>
        <TabsTrigger value="errors">Errors</TabsTrigger>
        <TabsTrigger value="velocity">Velocities</TabsTrigger>
        <TabsTrigger value="wheels">Wheels & torque</TabsTrigger>
        <TabsTrigger value="clearance">Clearance</TabsTrigger>
        <TabsTrigger value="control">Control inputs</TabsTrigger>
      </TabsList>
      <TabsContent value="trajectory" className="space-y-3">
        <PipeCanvas
          className="h-[380px]"
          geometry={report?.geometry ?? []}
          robot={robot}
          pose={last ? { x: last.x, y: last.y, theta: last.theta } : null}
          tracks={tracks}
          steps={report?.steps}
          ariaLabel="Desired (dashed) and actual (solid) trajectories"
        />
        <SeriesChart
          data={data}
          x="s"
          xLabel="s [m]"
          yLabel="lateral offset [mm]"
          digits={1}
          series={[
            { key: 'd', label: 'Actual offset from centreline', color: chartColors.c2 },
            { key: 'dref', label: 'Desired', color: chartColors.c1, dashed: true },
          ]}
        />
      </TabsContent>
      <TabsContent value="errors" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [s]"
          yLabel="error [mm]"
          digits={1}
          syncId="res"
          series={[
            { key: 'epos', label: 'Position |p − p_ref|', color: chartColors.c2 },
            { key: 'elat', label: 'Cross-track', color: chartColors.c1 },
            { key: 'ealong', label: 'Along-track lag', color: chartColors.c3 },
          ]}
        />
        <SeriesChart data={data} x="t" xLabel="t [s]" yLabel="e_θ [°]" digits={2} syncId="res" series={[{ key: 'ehead', label: 'Orientation error', color: chartColors.c4 }]} />
      </TabsContent>
      <TabsContent value="velocity" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [s]"
          yLabel="v [m/s]"
          syncId="res"
          refLines={[{ y: robot.max_linear_velocity, label: 'v_max', color: chartColors.warning }]}
          series={[
            { key: 'v', label: 'Actual', color: chartColors.c2 },
            { key: 'vref', label: 'Reference', color: chartColors.c1, dashed: true },
            { key: 'vcmd', label: 'Command', color: chartColors.c3, width: 1 },
          ]}
        />
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [s]"
          yLabel="ω [rad/s]"
          syncId="res"
          series={[
            { key: 'w', label: 'Actual', color: chartColors.c2 },
            { key: 'wref', label: 'Reference', color: chartColors.c1, dashed: true },
            { key: 'wcmd', label: 'Command', color: chartColors.c3, width: 1 },
          ]}
        />
      </TabsContent>
      <TabsContent value="wheels" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [s]"
          yLabel="ω_wheel [rad/s]"
          digits={2}
          syncId="res"
          refLines={[{ y: robot.max_wheel_speed, label: 'limit', color: chartColors.warning }]}
          series={[
            { key: 'wl', label: 'Left', color: chartColors.c1 },
            { key: 'wr', label: 'Right', color: chartColors.c2 },
            { key: 'wlc', label: 'Left cmd', color: chartColors.c1, dashed: true, width: 1 },
            { key: 'wrc', label: 'Right cmd', color: chartColors.c2, dashed: true, width: 1 },
          ]}
        />
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [s]"
          yLabel="τ per motor [N·m]"
          digits={3}
          syncId="res"
          refLines={[
            { y: robot.max_motor_torque, label: '+τ_max', color: chartColors.danger },
            { y: -robot.max_motor_torque, label: '−τ_max', color: chartColors.danger },
          ]}
          series={[
            { key: 'tl', label: 'Left (delivered)', color: chartColors.c1 },
            { key: 'tr', label: 'Right (delivered)', color: chartColors.c2 },
            { key: 'tdl', label: 'Left demand', color: chartColors.c1, dashed: true, width: 1 },
            { key: 'tdr', label: 'Right demand', color: chartColors.c2, dashed: true, width: 1 },
          ]}
        />
      </TabsContent>
      <TabsContent value="clearance" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="s"
          xLabel="s [m]"
          yLabel="[mm]"
          digits={1}
          refLines={[{ y: 0, label: 'wall', color: chartColors.danger }]}
          series={[
            { key: 'clr', label: 'Min. robot-to-pipe clearance', color: chartColors.c3 },
            { key: 'req', label: 'Required', color: chartColors.warning, dashed: true },
            { key: 'margin', label: 'Static lateral margin ahead', color: chartColors.c4, width: 1 },
          ]}
        />
        <SeriesChart
          data={data}
          x="s"
          xLabel="s [m]"
          yLabel="β [°]"
          digits={1}
          refLines={[{ y: robot.max_contact_angle * RAD2DEG, label: 'limit', color: chartColors.warning }]}
          series={[{ key: 'ca', label: 'Wall contact angle', color: chartColors.c2 }]}
        />
        <SeriesChart data={data} x="s" xLabel="s [m]" yLabel="D [mm]" digits={0} height={180} series={[{ key: 'dia', label: 'Local diameter', color: chartColors.c1 }]} />
        <SeriesChart data={data} x="s" xLabel="s [m]" yLabel="slope [°]" digits={1} height={180} series={[{ key: 'slope', label: 'Effective slope', color: chartColors.c5 }]} />
      </TabsContent>
      <TabsContent value="control" className="grid gap-3 lg:grid-cols-2">
        <SeriesChart
          data={data}
          x="t"
          xLabel="t [s]"
          yLabel="command"
          syncId="res"
          series={[
            { key: 'vcmd', label: 'v_cmd [m/s]', color: chartColors.c3 },
            { key: 'wcmd', label: 'ω_cmd [rad/s]', color: chartColors.c4 },
          ]}
        />
        <SeriesChart data={data} x="t" xLabel="t [s]" yLabel="gain multiplier" digits={2} syncId="res" series={[{ key: 'gain', label: 'm (scheduled gain factor)', color: chartColors.c1 }]} />
      </TabsContent>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Plots show the recorded telemetry ({results.telemetry.length} samples, decimated for display with peak preservation). Metrics are computed by the engine at every integration step.
      </p>
    </Tabs>
  )
}
