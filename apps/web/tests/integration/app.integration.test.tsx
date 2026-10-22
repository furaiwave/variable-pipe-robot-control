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
    ['/', /Огляд/],
    ['/pipeline', /Редактор трубопроводу/],
    ['/robot', /Конфігурація робота/],
    ['/controllers', /Алгоритми керування/],
    ['/simulation', /Робоча область моделювання/],
    ['/results', /Результати та аналіз/],
    ['/experiments', /Експерименти/],
  ]

  for (const [path, heading] of pages) {
    it(`renders ${path}`, async () => {
      const view = await visit(path)
      expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 25_000 })).toBeInTheDocument()
      view.unmount()
    })
  }

  it('shows engine-computed pipeline geometry in the editor', async () => {
    const view = await visit('/pipeline')
    await waitFor(() => expect(screen.getAllByText(/4\.43 м/).length).toBeGreaterThan(0), { timeout: 10_000 })
    expect(screen.getByText(/Прохідний/)).toBeInTheDocument()
    view.unmount()
  })

  it('lists the predefined experiments', async () => {
    const view = await visit('/experiments')
    expect(await screen.findByText('Порівняння регуляторів', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('Вузький прохід поблизу межі проходимості')).toBeInTheDocument()
    view.unmount()
  })
})
