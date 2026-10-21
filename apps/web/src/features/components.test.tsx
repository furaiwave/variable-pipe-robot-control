import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/common'
import { Markdown } from '@/components/common/Markdown'
import { RobotForm } from '@/features/robot-config/RobotForm'
import { SegmentForm } from '@/features/pipeline-editor/SegmentForm'
import { SimulationControls } from '@/features/simulation/SimulationControls'
import { ViolationsPanel } from '@/features/simulation/ViolationsPanel'
import { MetricsTable } from '@/features/results/MetricsTable'
import { defaultConfig, metrics } from '@/test/fixtures'
import type { RobotConfig, Segment } from '@/types/api'

const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe('RobotForm', () => {
  it('edits a parameter and applies it in SI units', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn<(r: RobotConfig) => []>(() => [])
    wrap(<RobotForm robot={defaultConfig().robot} onApply={onApply} />)
    const radius = screen.getByLabelText(/Wheel radius r/)
    await user.clear(radius)
    await user.type(radius, '35')
    await user.click(screen.getByRole('button', { name: /Apply robot parameters/ }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply.mock.calls[0]![0].wheel_radius).toBeCloseTo(0.035, 12)
  })

  it('shows validation errors and blocks invalid values', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn(() => [])
    wrap(<RobotForm robot={defaultConfig().robot} onApply={onApply} />)
    const mass = screen.getByLabelText(/^Mass/)
    await user.clear(mass)
    await user.type(mass, '-3')
    await user.click(screen.getByRole('button', { name: /Apply robot parameters/ }))
    expect(await screen.findByText(/Must be ≥ 0.05/)).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('maps server-side validation issues back to fields', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn(async () => [{ field: 'robot.wheelbase', message: 'rejected by engine' }])
    wrap(<RobotForm robot={defaultConfig().robot} onApply={onApply} />)
    await user.click(screen.getByRole('button', { name: /Apply robot parameters/ }))
    expect(await screen.findByText('rejected by engine')).toBeInTheDocument()
  })
})

describe('SegmentForm', () => {
  const seg: Segment = { id: 's2', label: 'Narrow', kind: 'straight', length: 0.6, diameter: 0.2, inclination: 0, min_clearance: null, restrictions: [] }

  it('commits valid edits (debounced) converted to SI', async () => {
    const onCommit = vi.fn()
    wrap(<SegmentForm segment={seg} otherIds={['s1']} station={1.3} onCommit={onCommit} debounceMs={5} />)
    expect(screen.getByText('1.300 m')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Internal diameter/), { target: { value: '180' } })
    await waitFor(() => expect(onCommit).toHaveBeenCalled())
    const committed = onCommit.mock.calls.at(-1)![0] as Segment
    expect(committed.kind === 'straight' && committed.diameter).toBeCloseTo(0.18, 12)
  })

  it('does not commit invalid values and reports duplicate IDs', async () => {
    const onCommit = vi.fn()
    wrap(<SegmentForm segment={seg} otherIds={['s1']} station={null} onCommit={onCommit} debounceMs={5} />)
    fireEvent.change(screen.getByLabelText(/Internal diameter/), { target: { value: '5' } })
    expect(await screen.findByText(/Must be ≥ 20/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Internal diameter/), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Segment ID'), { target: { value: 's1' } })
    expect(await screen.findByText(/already used/)).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('adds a restriction', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    wrap(<SegmentForm segment={seg} otherIds={[]} station={null} onCommit={onCommit} debounceMs={5} />)
    await user.click(screen.getByRole('button', { name: /Add/ }))
    await waitFor(() => expect(onCommit).toHaveBeenCalled())
    const committed = onCommit.mock.calls.at(-1)![0] as Segment
    expect(committed.restrictions).toHaveLength(1)
    expect(committed.restrictions[0]!.height).toBeCloseTo(0.003, 12)
  })
})

describe('simulation state display', () => {
  const noop = () => undefined
  const controls = (status: Parameters<typeof SimulationControls>[0]['status']) =>
    wrap(
      <SimulationControls
        status={status}
        busy={false}
        stale={false}
        playback={1}
        controller="pid"
        onStart={noop}
        onPause={noop}
        onResume={noop}
        onStop={noop}
        onReset={noop}
        onRunInstant={noop}
        onPlayback={noop}
        onController={noop}
      />,
    )

  it('shows the right buttons for each state', () => {
    controls('running')
    expect(screen.getByRole('button', { name: /Pause/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Running')
  })

  it('offers resume when paused and restart when finished', () => {
    const { unmount } = controls('paused')
    expect(screen.getByRole('button', { name: /Resume/ })).toBeEnabled()
    unmount()
    controls('completed')
    expect(screen.getByRole('button', { name: /Restart/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Stop/ })).toBeDisabled()
  })

  it('StatusBadge handles a missing simulation', () => {
    render(<StatusBadge status={null} />)
    expect(screen.getByText('No simulation')).toBeInTheDocument()
  })

  it('reports the failure reason, position and events', () => {
    wrap(
      <ViolationsPanel
        status="failed"
        failure={{ kind: 'step_not_climbable', message: 'Impassable step at s = 1.500 m', time: 9.04, station: 1.419, x: 1.4, y: 0, value: 0.032, limit: 0.016 }}
        events={[
          { kind: 'safety_clearance', severity: 'warning', t_start: 1, t_end: 2, s_start: 0.3, s_end: 0.45, x: 0, y: 0, peak_value: 0.003, limit: 0.005, unit: 'm', message: 'Clearance below required 5.0 mm' },
        ]}
      />,
    )
    const alert = screen.getByTestId('failure-alert')
    expect(within(alert).getByText(/Step \/ ramp not climbable/)).toBeInTheDocument()
    expect(within(alert).getByText(/s = 1.419 m/)).toBeInTheDocument()
    expect(screen.getByText(/Safety clearance violated/)).toBeInTheDocument()
  })
})

describe('results rendering', () => {
  it('renders all required metrics', () => {
    render(<MetricsTable metrics={metrics({ collision_count: 2 })} robot={defaultConfig().robot} />)
    const table = screen.getByRole('table', { name: 'Performance metrics' })
    for (const label of ['Position error RMSE', 'Position error MAE', 'Position error max |e|', 'Final position error', 'Average linear velocity', 'Max. wheel speed', 'Total simulated distance', 'Collisions', 'Simulated duration']) {
      expect(within(table).getByText(label)).toBeInTheDocument()
    }
    expect(within(table).getByText('2.10 mm')).toBeInTheDocument()
    const row = within(table).getByText('Collisions').closest('tr')!
    expect(within(row).getByText('2')).toBeInTheDocument()
  })

  it('renders engine Markdown reports safely', () => {
    render(<Markdown text={'## Report\n\n- **Outcome**: done\n\n| A | B |\n|---|---|\n| 1 | <b>x</b> |'} />)
    expect(screen.getByRole('heading', { name: 'Report' })).toBeInTheDocument()
    expect(screen.getByText('Outcome')).toContainHTML('strong')
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument() // rendered as text, not HTML
  })
})
