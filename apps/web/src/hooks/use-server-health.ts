import { useEffect, useState } from 'react'
import { api } from '@/services/api'

export interface ServerHealth {
  online: boolean | null
  version: string | null
}

/** Poll the API health endpoint. */
export function useServerHealth(intervalMs = 10_000): ServerHealth {
  const [state, setState] = useState<ServerHealth>({ online: null, version: null })
  useEffect(() => {
    let alive = true
    const check = () =>
      api
        .health()
        .then((h) => alive && setState({ online: true, version: h.engine_version }))
        .catch(() => alive && setState((s) => ({ ...s, online: false })))
    void check()
    const id = setInterval(check, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [intervalMs])
  return state
}
