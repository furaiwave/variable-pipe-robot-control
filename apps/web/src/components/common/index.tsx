import type { ComponentProps, ReactNode } from 'react'
import { Activity, Calculator, Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/violations'
import type { SimulationStatus } from '@/types/api'

/** Where a displayed value comes from. */
export type DataSource = 'live' | 'config' | 'calc'

const SOURCE: Record<DataSource, { label: string; icon: typeof Activity; cls: string; tip: string }> = {
  live: { label: 'LIVE', icon: Activity, cls: 'text-success border-success/40', tip: 'Live simulation data streamed from the Rust engine' },
  config: { label: 'CONFIG', icon: Settings2, cls: 'text-muted-foreground border-border', tip: 'Configured input parameter' },
  calc: { label: 'CALC', icon: Calculator, cls: 'text-primary border-primary/40', tip: 'Calculated by the engine from the model' },
}

export function SourceBadge({ source, className }: { source: DataSource; className?: string }) {
  const s = SOURCE[source]
  const Icon = s.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('h-4 px-1.5 text-[10px] tracking-wide', s.cls, className)}>
          <Icon /> {s.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{s.tip}</TooltipContent>
    </Tooltip>
  )
}

export function StatCard({
  label,
  value,
  sub,
  source,
  tone,
  icon,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  source: DataSource
  tone?: 'default' | 'warning' | 'danger' | 'success'
  icon?: ReactNode
}) {
  return (
    <Card size="sm" className="gap-1">
      <CardHeader className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </span>
        <SourceBadge source={source} />
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'tabular text-lg leading-tight font-semibold',
            tone === 'warning' && 'text-warning',
            tone === 'danger' && 'text-destructive',
            tone === 'success' && 'text-success',
          )}
        >
          {value}
        </div>
        {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  source,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  source?: DataSource
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            {title}
            {source ? <SourceBadge source={source} /> : null}
          </CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="tabular text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const STATUS_CLS: Record<SimulationStatus, string> = {
  ready: 'bg-secondary text-secondary-foreground',
  running: 'bg-primary/15 text-primary',
  paused: 'bg-warning/15 text-warning',
  completed: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ status }: { status: SimulationStatus | null | undefined }) {
  if (!status) return <Badge variant="outline">No simulation</Badge>
  return (
    <Badge className={cn('font-semibold', STATUS_CLS[status])} data-testid="status-badge">
      {status === 'running' ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {STATUS_LABELS[status]}
    </Badge>
  )
}

/** Labelled numeric input with unit and error message (react-hook-form friendly). */
export function NumberField({
  id,
  label,
  unit,
  error,
  hint,
  className,
  ...input
}: { id: string; label: string; unit?: string; error?: string; hint?: string } & ComponentProps<'input'>) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
        {unit ? <span className="font-normal text-muted-foreground">[{unit}]</span> : null}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="tabular h-8"
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="max-w-md text-xs text-muted-foreground">{children}</div> : null}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
