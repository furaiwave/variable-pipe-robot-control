import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

export function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', t === 'dark')
  document.documentElement.style.colorScheme = t
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggle: () => {
        const t = get().theme === 'dark' ? 'light' : 'dark'
        applyTheme(t)
        set({ theme: t })
      },
      setTheme: (t) => {
        applyTheme(t)
        set({ theme: t })
      },
    }),
    { name: 'vprc-theme', onRehydrateStorage: () => (s) => applyTheme(s?.theme ?? 'dark') },
  ),
)
