import { ArrowDown, ArrowUp, Copy, CornerUpRight, Minus, Plus, Shrink, Spline, Trash2, Triangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { RAD2DEG } from '@/lib/format'
import { segmentLength } from '@/lib/schemas'
import type { Segment, SegmentKind } from '@/types/api'

const ICON: Record<SegmentKind, typeof Minus> = { straight: Minus, transition: Triangle, bend: CornerUpRight }

function describe(s: Segment): string {
  const mm = (m: number) => `${(m * 1000).toFixed(0)}`
  switch (s.kind) {
    case 'straight':
      return `L ${s.length.toFixed(2)} м · D ${mm(s.diameter)} мм`
    case 'transition':
      return `L ${s.length.toFixed(2)} м · D ${mm(s.diameter_start)}→${mm(s.diameter_end)} мм`
    case 'bend':
      return `R ${s.bend_radius.toFixed(2)} м · ${(s.angle * RAD2DEG).toFixed(0)}° · D ${mm(s.diameter)} мм`
  }
}

export interface SegmentListProps {
  segments: Segment[]
  selectedId: string | null
  stations: number[]
  onSelect: (id: string) => void
  onAdd: (kind: SegmentKind | 'narrow' | 'restriction') => void
  onMove: (id: string, delta: -1 | 1) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
}

export function SegmentList({ segments, selectedId, stations, onSelect, onAdd, onMove, onDuplicate, onRemove }: SegmentListProps) {
  const selectedIdx = segments.findIndex((s) => s.id === selectedId)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <Plus /> Додати сегмент
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Вставити після виділеного</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onAdd('straight')}>
              <Minus /> Прямий
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('transition')}>
              <Triangle /> Плавний перехід діаметра
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('bend')}>
              <Spline /> Круговий вигин
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAdd('narrow')}>
              <Shrink /> Вузький прохід (раптова сходинка)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('restriction')}>
              <Plus /> Прямий зі звуженням
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Перемістити сегмент вище" disabled={selectedIdx <= 0} onClick={() => selectedId && onMove(selectedId, -1)}>
            <ArrowUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Перемістити сегмент нижче"
            disabled={selectedIdx < 0 || selectedIdx >= segments.length - 1}
            onClick={() => selectedId && onMove(selectedId, 1)}
          >
            <ArrowDown />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Дублювати сегмент" disabled={selectedIdx < 0} onClick={() => selectedId && onDuplicate(selectedId)}>
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Видалити сегмент"
            disabled={selectedIdx < 0 || segments.length <= 1}
            onClick={() => selectedId && onRemove(selectedId)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <ol className="max-h-[420px] space-y-1 overflow-y-auto pr-1" aria-label="Сегменти трубопроводу">
        {segments.map((s, i) => {
          const Icon = ICON[s.kind]
          const active = s.id === selectedId
          return (
            <li key={`${s.id}-${i}`}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                  active ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-muted',
                )}
              >
                <span className="tabular mt-0.5 w-5 text-muted-foreground">{i + 1}</span>
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.label || s.id}
                    {s.restrictions.length ? <span className="ml-1 text-warning">· {s.restrictions.length} звуж.</span> : null}
                    {Math.abs(s.inclination) > 1e-9 ? <span className="ml-1 text-muted-foreground">· {(s.inclination * RAD2DEG).toFixed(1)}°</span> : null}
                  </span>
                  <span className="tabular block text-muted-foreground">{describe(s)}</span>
                </span>
                <span className="tabular text-right text-muted-foreground">
                  s={stations[i]?.toFixed(2) ?? '—'}
                  <br />
                  {segmentLength(s).toFixed(2)} м
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
