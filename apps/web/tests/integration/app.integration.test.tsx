/**
 * End-to-end smoke test in jsdom: the real React application renders every
 * page with data served by the real Rust API.
 */
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { configureApi } from '@/services/api'
import { useConfigStore } from '@/stores/config-store'

beforeAll(() => {
  configureApi({ baseUrl: inject('apiUrl') })
  localStorage.clear()
})

async function visit(path: string) {
  window.history.pushState({}, '', path)
  const { default: App } = await import('@/App')
  return render(<App />)
}

describe('application pages against the real engine', () => {
  it('loads the default configuration from the engine', async () => {
    await act(() => useConfigStore.getState().init(true))
    expect(useConfigStore.getState().loadStatus).toBe('ready')
    expect(useConfigStore.getState().controllers?.gain_scheduled).toBeDefined()
  })

  const pages: [string, RegExp][] = [
    ['/', /Overview/],
    ['/pipeline', /Pipeline editor/],
    ['/robot', /Robot configuration/],
    ['/controllers', /Control algorithms/],
    ['/simulation', /Simulation workspace/],
    ['/results', /Results and analysis/],
    ['/experiments', /Experiments/],
  ]

  for (const [path, heading] of pages) {
    it(`renders ${path}`, async () => {
      const view = await visit(path)
      expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 10_000 })).toBeInTheDocument()
      view.unmount()
    })
  }

  it('shows engine-computed pipeline geometry in the editor', async () => {
    const view = await visit('/pipeline')
    await waitFor(() => expect(screen.getAllByText(/4\.43 m/).length).toBeGreaterThan(0), { timeout: 10_000 })
    expect(screen.getByText(/Passable/)).toBeInTheDocument()
    view.unmount()
  })

  it('lists the predefined experiments', async () => {
    const view = await visit('/experiments')
    expect(await screen.findByText('Controller comparison', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('Narrow passage near the feasibility limit')).toBeInTheDocument()
    view.unmount()
  })
})
