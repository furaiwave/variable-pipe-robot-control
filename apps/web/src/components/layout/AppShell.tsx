import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router'
import {
  Bot,
  ChartLine,
  FlaskConical,
  LayoutDashboard,
  Moon,
  Play,
  RefreshCw,
  ServerCrash,
  SlidersHorizontal,
  Sun,
  Waypoints,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { StatusBadge } from '@/components/common'
import { useServerHealth } from '@/hooks/use-server-health'
import { cn } from '@/lib/utils'
import { useConfigStore } from '@/stores/config-store'
import { useSimStore } from '@/stores/sim-store'
import { useThemeStore } from '@/stores/theme-store'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Pipeline editor', icon: Waypoints },
  { to: '/robot', label: 'Robot', icon: Bot },
  { to: '/controllers', label: 'Controllers', icon: SlidersHorizontal },
  { to: '/simulation', label: 'Simulation', icon: Play },
  { to: '/results', label: 'Results', icon: ChartLine },
  { to: '/experiments', label: 'Experiments', icon: FlaskConical },
]

export function AppShell() {
  const health = useServerHealth()
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)
  const status = useSimStore((s) => s.snapshot?.status)
  const loadStatus = useConfigStore((s) => s.loadStatus)
  const loadError = useConfigStore((s) => s.loadError)
  const init = useConfigStore((s) => s.init)

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="border-b bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-svh md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary">
            <Waypoints className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">PipeBot Control</div>
            <div className="text-[10px] text-muted-foreground">variable-section pipeline sim</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                  isActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-4 pt-4 text-[10px] leading-relaxed text-muted-foreground md:block">
          Results are produced by a planar kinematic / quasi-static simulation model. They are not physical measurements.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/90 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                'size-2 rounded-full',
                health.online === null ? 'bg-muted-foreground' : health.online ? 'bg-success' : 'bg-destructive',
              )}
              aria-hidden
            />
            <span className="text-muted-foreground">
              {health.online === null ? 'Connecting to engine…' : health.online ? `Engine online · ${health.version}` : 'Engine offline'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <Button size="icon-sm" variant="ghost" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggle}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 p-4">
          {loadStatus === 'error' ? (
            <Alert variant="destructive">
              <ServerCrash />
              <AlertTitle>Cannot load the configuration from the simulation engine</AlertTitle>
              <AlertDescription>
                <p>{loadError}</p>
                <p className="mt-1">
                  Start the Rust API with <code className="rounded bg-muted px-1">cargo run -p api-server</code> (port 8080) and retry.
                </p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void init(true)}>
                  <RefreshCw /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
