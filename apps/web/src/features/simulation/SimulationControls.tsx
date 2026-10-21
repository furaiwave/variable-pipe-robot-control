import { FastForward, Loader2, Pause, Play, RotateCcw, Square, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge } from '@/components/common'
import { CONTROLLER_NAMES, isTerminal } from '@/lib/violations'
import { CONTROLLER_TYPES } from '@/stores/config-store'
import type { ControllerType, SimulationStatus } from '@/types/api'

export const PLAYBACK_OPTIONS = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]

export interface SimulationControlsProps {
  status: SimulationStatus | null
  busy: boolean
  stale: boolean
  playback: number
  controller: ControllerType
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onReset: () => void
  onRunInstant: () => void
  onPlayback: (v: number) => void
  onController: (t: ControllerType) => void
}

export function SimulationControls(p: SimulationControlsProps) {
  const running = p.status === 'running'
  const paused = p.status === 'paused'
  const canStart = !running && !paused
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex items-center gap-1.5" role="group" aria-label="Simulation controls">
        {canStart ? (
          <Button onClick={p.onStart} disabled={p.busy}>
            {p.busy ? <Loader2 className="animate-spin" /> : <Play />}
            {p.status && isTerminal(p.status) && !p.stale ? 'Restart' : 'Start'}
          </Button>
        ) : null}
        {running ? (
          <Button variant="secondary" onClick={p.onPause} disabled={p.busy}>
            <Pause /> Pause
          </Button>
        ) : null}
        {paused ? (
          <Button onClick={p.onResume} disabled={p.busy || p.stale}>
            <Play /> Resume
          </Button>
        ) : null}
        <Button variant="outline" onClick={p.onStop} disabled={p.busy || !(running || paused || p.status === 'ready')}>
          <Square /> Stop
        </Button>
        <Button variant="outline" onClick={p.onReset} disabled={p.busy || p.status === null}>
          <RotateCcw /> Reset
        </Button>
        <Button variant="outline" onClick={p.onRunInstant} disabled={p.busy || running} title="Run to completion as fast as possible">
          <Zap /> Run instantly
        </Button>
      </div>
      <div className="space-y-1">
        <Label htmlFor="playback" className="flex items-center gap-1 text-xs">
          <FastForward className="size-3" /> Playback speed
        </Label>
        <Select value={String(p.playback)} onValueChange={(v) => p.onPlayback(Number(v))}>
          <SelectTrigger id="playback" size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAYBACK_OPTIONS.map((v) => (
              <SelectItem key={v} value={String(v)}>
                {v}× real time
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="controller" className="text-xs">
          Controller
        </Label>
        <Select value={p.controller} onValueChange={(v) => p.onController(v as ControllerType)} disabled={running || paused}>
          <SelectTrigger id="controller" size="sm" className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTROLLER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {CONTROLLER_NAMES[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="ml-auto">
        <StatusBadge status={p.status} />
      </div>
    </div>
  )
}
