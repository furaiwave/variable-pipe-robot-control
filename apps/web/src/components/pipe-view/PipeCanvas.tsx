import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { violationFlag } from '@/lib/violations'
import type { FeasibilityIssue, GeometrySample, RobotConfig, StepCheck, TelemetrySample } from '@/types/api'

export interface Track {
  label: string
  color: string
  points: { x: number; y: number }[]
  dashed?: boolean
}

export interface PipeCanvasProps {
  geometry: GeometrySample[]
  robot?: RobotConfig | null
  /** Static robot pose drawn when no telemetry is available (e.g. start pose). */
  pose?: { x: number; y: number; theta: number } | null
  /** Live telemetry source, polled every animation frame. */
  getTelemetry?: () => readonly TelemetrySample[]
  /** Additional static trajectories (results comparison). */
  tracks?: Track[]
  issues?: FeasibilityIssue[]
  steps?: StepCheck[]
  selectedSegment?: number | null
  onSelectSegment?: (index: number) => void
  showReference?: boolean
  follow?: boolean
  className?: string
  ariaLabel?: string
}

interface View {
  cx: number
  cy: number
  scale: number // px per metre
}

const css = (name: string, fallback: string) => {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function bounds(geometry: GeometrySample[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const g of geometry) {
    const r = g.base_diameter / 2
    minX = Math.min(minX, g.x - r)
    maxX = Math.max(maxX, g.x + r)
    minY = Math.min(minY, g.y - r)
    maxY = Math.max(maxY, g.y + r)
  }
  return { minX, minY, maxX, maxY }
}

/** Interpolated centreline position at station s. */
function atStation(geometry: GeometrySample[], s: number) {
  let lo = 0
  let hi = geometry.length - 1
  if (hi < 0) return null
  if (s <= geometry[0]!.s) return geometry[0]!
  if (s >= geometry[hi]!.s) return geometry[hi]!
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (geometry[mid]!.s <= s) lo = mid
    else hi = mid
  }
  const a = geometry[lo]!
  const b = geometry[hi]!
  const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0
  return { ...a, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: a.heading, s }
}

export function PipeCanvas({
  geometry,
  robot,
  pose,
  getTelemetry,
  tracks,
  issues,
  steps,
  selectedSegment,
  onSelectSegment,
  showReference = true,
  follow = false,
  className,
  ariaLabel = 'Pipeline plan view',
}: PipeCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 600, h: 300 })
  const [view, setView] = useState<View | null>(null)
  const dirty = useRef(true)
  const drag = useRef<{ x: number; y: number; moved: boolean; view: View } | null>(null)

  const fitView = useCallback((): View | null => {
    if (geometry.length === 0) return null
    const b = bounds(geometry)
    const pad = 24
    const w = Math.max(1, size.w - 2 * pad)
    const h = Math.max(1, size.h - 2 * pad)
    const scale = Math.min(w / Math.max(1e-6, b.maxX - b.minX), h / Math.max(1e-6, b.maxY - b.minY))
    return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale }
  }, [geometry, size])

  // Refit when geometry changes size substantially (new pipeline) or on first data.
  const geomKey = useMemo(() => {
    const b = geometry.length ? bounds(geometry) : null
    return b ? `${b.minX.toFixed(2)}:${b.minY.toFixed(2)}:${b.maxX.toFixed(2)}:${b.maxY.toFixed(2)}` : ''
  }, [geometry])
  useEffect(() => {
    setView(fitView())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geomKey, size.w, size.h])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    dirty.current = true
  }, [view, geometry, robot, pose, tracks, issues, steps, selectedSegment, showReference, size, follow])

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, v: View, telemetry: readonly TelemetrySample[]) => {
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
      const latest = telemetry[telemetry.length - 1]
      let { cx, cy } = v
      if (follow && latest) {
        cx = latest.x
        cy = latest.y
      }
      const sx = (x: number) => (x - cx) * v.scale + size.w / 2
      const sy = (y: number) => size.h / 2 - (y - cy) * v.scale

      const colWall = css('--pipe-wall', '#999')
      const colFill = css('--pipe-fill', '#223')
      const colPrimary = css('--primary', '#4cc')
      const colMuted = css('--muted-foreground', '#888')
      const colDestructive = css('--destructive', '#e44')
      const colWarning = css('--warning', '#eb4')
      const colChart1 = css('--chart-1', '#6cf')
      const colChart2 = css('--chart-2', '#fa4')
      const colFg = css('--foreground', '#eee')

      if (geometry.length < 2) return
      const wall = (side: 1 | -1, useBase = false) =>
        geometry.map((g) => {
          const r = (useBase ? g.base_diameter : g.diameter) / 2
          const nx = -Math.sin(g.heading)
          const ny = Math.cos(g.heading)
          return [sx(g.x + side * nx * r), sy(g.y + side * ny * r)] as const
        })

      // Pipe interior
      const left = wall(1)
      const right = wall(-1)
      ctx.beginPath()
      left.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1])
      ctx.closePath()
      ctx.fillStyle = colFill
      ctx.fill()

      // Selected segment highlight
      if (selectedSegment !== null && selectedSegment !== undefined) {
        const idx = geometry.map((g, i) => (g.segment === selectedSegment ? i : -1)).filter((i) => i >= 0)
        if (idx.length > 1) {
          ctx.beginPath()
          idx.forEach((i, k) => (k === 0 ? ctx.moveTo(left[i]![0], left[i]![1]) : ctx.lineTo(left[i]![0], left[i]![1])))
          for (let k = idx.length - 1; k >= 0; k--) ctx.lineTo(right[idx[k]!]![0], right[idx[k]!]![1])
          ctx.closePath()
          ctx.globalAlpha = 0.18
          ctx.fillStyle = colPrimary
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }

      // Walls (effective, including restrictions)
      ctx.strokeStyle = colWall
      ctx.lineWidth = 1.5
      for (const w of [left, right]) {
        ctx.beginPath()
        w.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.stroke()
      }

      // Centreline
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = colMuted
      ctx.lineWidth = 1
      ctx.beginPath()
      geometry.forEach((g, i) => (i === 0 ? ctx.moveTo(sx(g.x), sy(g.y)) : ctx.lineTo(sx(g.x), sy(g.y))))
      ctx.stroke()
      ctx.setLineDash([])

      // Segment boundaries
      ctx.strokeStyle = colMuted
      ctx.globalAlpha = 0.5
      for (let i = 1; i < geometry.length; i++) {
        if (geometry[i]!.segment !== geometry[i - 1]!.segment) {
          ctx.beginPath()
          ctx.moveTo(left[i]![0], left[i]![1])
          ctx.lineTo(right[i]![0], right[i]![1])
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1

      // Static feasibility issues: band along the centreline
      for (const issue of issues ?? []) {
        const hard = issue.kind !== 'safety_clearance' && issue.kind !== 'contact_angle'
        ctx.strokeStyle = hard ? colDestructive : colWarning
        ctx.globalAlpha = 0.55
        ctx.lineWidth = Math.max(4, 0.25 * (geometry[0]!.diameter * v.scale))
        ctx.lineCap = 'round'
        ctx.beginPath()
        const s0 = issue.s_start
        const s1 = Math.max(issue.s_end, issue.s_start + 1e-3)
        const n = 12
        for (let k = 0; k <= n; k++) {
          const p = atStation(geometry, s0 + ((s1 - s0) * k) / n)
          if (!p) continue
          if (k === 0) ctx.moveTo(sx(p.x), sy(p.y))
          else ctx.lineTo(sx(p.x), sy(p.y))
        }
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.lineCap = 'butt'
      }

      // Steps
      for (const st of steps ?? []) {
        const p = atStation(geometry, st.s)
        if (!p) continue
        const x = sx(p.x)
        const y = sy(p.y)
        ctx.strokeStyle = st.climbable ? colWarning : colDestructive
        ctx.lineWidth = 2
        const r = 5
        ctx.beginPath()
        if (st.climbable) {
          ctx.arc(x, y, r, 0, Math.PI * 2)
        } else {
          ctx.moveTo(x - r, y - r)
          ctx.lineTo(x + r, y + r)
          ctx.moveTo(x + r, y - r)
          ctx.lineTo(x - r, y + r)
        }
        ctx.stroke()
      }

      // Static tracks (results)
      for (const t of tracks ?? []) {
        if (t.points.length < 2) continue
        ctx.strokeStyle = t.color
        ctx.lineWidth = 1.6
        ctx.setLineDash(t.dashed ? [5, 4] : [])
        ctx.beginPath()
        t.points.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))))
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Live telemetry: reference and actual trajectories
      if (telemetry.length > 1) {
        const stride = Math.max(1, Math.floor(telemetry.length / 4000))
        if (showReference) {
          ctx.strokeStyle = colChart1
          ctx.lineWidth = 1.2
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          for (let i = 0; i < telemetry.length; i += stride) {
            const s = telemetry[i]!
            if (i === 0) ctx.moveTo(sx(s.x_ref), sy(s.y_ref))
            else ctx.lineTo(sx(s.x_ref), sy(s.y_ref))
          }
          ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.strokeStyle = colChart2
        ctx.lineWidth = 1.8
        ctx.beginPath()
        for (let i = 0; i < telemetry.length; i += stride) {
          const s = telemetry[i]!
          if (i === 0) ctx.moveTo(sx(s.x), sy(s.y))
          else ctx.lineTo(sx(s.x), sy(s.y))
        }
        const last = telemetry[telemetry.length - 1]!
        ctx.lineTo(sx(last.x), sy(last.y))
        ctx.stroke()
        // Violation markers
        const bad = violationFlag('collision') | violationFlag('safety_clearance') | violationFlag('contact_angle')
        ctx.fillStyle = colDestructive
        for (let i = 0; i < telemetry.length; i += stride) {
          const s = telemetry[i]!
          if (s.flags & bad) {
            ctx.beginPath()
            ctx.arc(sx(s.x), sy(s.y), 2.2, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }

      // Robot footprint
      const rp = latest ? { x: latest.x, y: latest.y, theta: latest.theta } : pose
      if (robot && rp) {
        ctx.save()
        ctx.translate(sx(rp.x), sy(rp.y))
        ctx.rotate(-rp.theta)
        const k = v.scale
        const n = robot.wheel_count / 2
        ctx.fillStyle = colFg
        ctx.globalAlpha = 0.85
        for (let a = 0; a < n; a++) {
          const xa = -robot.wheelbase / 2 + (robot.wheelbase * a) / Math.max(1, n - 1)
          for (const side of [1, -1]) {
            const yc = (side * robot.track_width) / 2
            ctx.fillRect((xa - robot.wheel_radius) * k, -(yc + robot.wheel_width / 2) * k, 2 * robot.wheel_radius * k, robot.wheel_width * k)
          }
        }
        ctx.globalAlpha = 1
        ctx.fillStyle = colPrimary
        ctx.globalAlpha = 0.8
        ctx.fillRect((-robot.body_length / 2) * k, (-robot.body_width / 2) * k, robot.body_length * k, robot.body_width * k)
        ctx.globalAlpha = 1
        ctx.strokeStyle = colFg
        ctx.lineWidth = 1
        ctx.strokeRect((-robot.body_length / 2) * k, (-robot.body_width / 2) * k, robot.body_length * k, robot.body_width * k)
        // heading arrow
        const L = Math.max(14, robot.body_length * 0.8 * k)
        ctx.strokeStyle = colFg
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(L, 0)
        ctx.lineTo(L - 5, -4)
        ctx.moveTo(L, 0)
        ctx.lineTo(L - 5, 4)
        ctx.stroke()
        ctx.restore()
      }

      // Direction of travel at the inlet
      const g0 = geometry[0]!
      ctx.fillStyle = colMuted
      ctx.font = '11px ui-sans-serif, system-ui'
      ctx.fillText('inlet', sx(g0.x) - 10, sy(g0.y) - (g0.diameter / 2) * v.scale - 6)
      const gN = geometry[geometry.length - 1]!
      ctx.fillText('outlet', sx(gN.x) - 14, sy(gN.y) - (gN.diameter / 2) * v.scale - 6)

      // Scale bar
      const target = 120 / v.scale
      const pow = Math.pow(10, Math.floor(Math.log10(target)))
      const nice = [1, 2, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
      const px = nice * v.scale
      ctx.strokeStyle = colFg
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(12, size.h - 14)
      ctx.lineTo(12 + px, size.h - 14)
      ctx.moveTo(12, size.h - 18)
      ctx.lineTo(12, size.h - 10)
      ctx.moveTo(12 + px, size.h - 18)
      ctx.lineTo(12 + px, size.h - 10)
      ctx.stroke()
      ctx.fillStyle = colFg
      ctx.fillText(nice >= 1 ? `${nice} m` : `${Math.round(nice * 1000)} mm`, 16 + px, size.h - 10)
    },
    [geometry, robot, pose, tracks, issues, steps, selectedSegment, showReference, size, follow],
  )

  // Render loop: redraw when inputs change or new telemetry arrives.
  useEffect(() => {
    let raf = 0
    let lastLen = -1
    const loop = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx && view) {
        const tel = getTelemetry?.() ?? []
        if (dirty.current || tel.length !== lastLen) {
          dirty.current = false
          lastLen = tel.length
          draw(ctx, view, tel)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw, view, getTelemetry])

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const v = view!
    return {
      x: (clientX - rect.left - size.w / 2) / v.scale + v.cx,
      y: (size.h / 2 - (clientY - rect.top)) / v.scale + v.cy,
    }
  }

  const zoom = (factor: number, at?: { x: number; y: number }) =>
    setView((v) => {
      if (!v) return v
      const scale = Math.min(1e5, Math.max(1, v.scale * factor))
      if (!at) return { ...v, scale }
      return { scale, cx: at.x - (at.x - v.cx) * (v.scale / scale), cy: at.y - (at.y - v.cy) * (v.scale / scale) }
    })

  return (
    <div ref={wrapRef} className={cn('relative h-72 w-full overflow-hidden rounded-md border bg-background', className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        width={size.w * dpr}
        height={size.h * dpr}
        style={{ width: size.w, height: size.h, cursor: onSelectSegment ? 'pointer' : 'grab', touchAction: 'none' }}
        onWheel={(e) => {
          if (!view) return
          zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, toWorld(e.clientX, e.clientY))
        }}
        onPointerDown={(e) => {
          if (!view) return
          drag.current = { x: e.clientX, y: e.clientY, moved: false, view }
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (d.moved) setView({ ...d.view, cx: d.view.cx - dx / d.view.scale, cy: d.view.cy + dy / d.view.scale })
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (!d || d.moved || !onSelectSegment || !view) return
          const w = toWorld(e.clientX, e.clientY)
          let best = -1
          let bestDist = Infinity
          for (const g of geometry) {
            const dist = Math.hypot(g.x - w.x, g.y - w.y)
            if (dist < bestDist && dist <= g.base_diameter / 2 + 6 / view.scale) {
              bestDist = dist
              best = g.segment
            }
          }
          if (best >= 0) onSelectSegment(best)
        }}
        onDoubleClick={() => setView(fitView())}
      />
      <div className="absolute top-2 right-2 flex gap-1">
        <Button size="icon-sm" variant="secondary" aria-label="Zoom in" onClick={() => zoom(1.3)}>
          <Plus />
        </Button>
        <Button size="icon-sm" variant="secondary" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}>
          <Minus />
        </Button>
        <Button size="icon-sm" variant="secondary" aria-label="Fit to view" onClick={() => setView(fitView())}>
          <Maximize2 />
        </Button>
        {follow ? (
          <span className="flex items-center gap-1 rounded bg-secondary px-2 text-xs text-secondary-foreground">
            <Crosshair className="size-3" /> following
          </span>
        ) : null}
      </div>
    </div>
  )
}
