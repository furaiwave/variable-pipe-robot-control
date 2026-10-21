import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

const isDom = typeof window !== 'undefined'

afterEach(() => {
  if (isDom) cleanup()
})

// jsdom lacks these browser APIs used by Recharts, Radix UI and the canvas view.
if (isDom) installDomPolyfills()

function installDomPolyfills() {
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext']
Element.prototype.scrollIntoView ??= vi.fn()
Element.prototype.hasPointerCapture ??= vi.fn(() => false)
Element.prototype.releasePointerCapture ??= vi.fn()
Element.prototype.setPointerCapture ??= vi.fn()
URL.createObjectURL ??= vi.fn(() => 'blob:mock')
URL.revokeObjectURL ??= vi.fn()
if (!window.matchMedia) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}
}
