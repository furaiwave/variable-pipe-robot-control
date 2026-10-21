import type {
  ApiErrorBody,
  CompareResponse,
  ControllerConfig,
  CrossSectionView,
  ExperimentPreset,
  FeasibilityReport,
  RobotConfig,
  SimulationConfig,
  SimulationResults,
  SimulationSummary,
  StatusResponse,
  TelemetryPage,
  ValidationIssue,
  WsMessage,
} from '@/types/api'

/** Error raised for any failed API call (HTTP error, network error, bad payload). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ValidationIssue[]

  constructor(status: number, code: string, message: string, details: ValidationIssue[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Human-readable summary including the first field errors. */
  describe(): string {
    if (this.details.length === 0) return this.message
    const head = this.details
      .slice(0, 3)
      .map((d) => `${d.field}: ${d.message}`)
      .join('; ')
    return this.details.length > 3 ? `${head}; … (${this.details.length - 3} more)` : head
  }
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return typeof v === 'object' && v !== null && 'error' in v && typeof (v as ApiErrorBody).error?.message === 'string'
}

export interface ApiClientOptions {
  /** Base URL of the server, e.g. `http://127.0.0.1:8080`. Empty = same origin. */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export function createApiClient({ baseUrl = '', fetchImpl }: ApiClientOptions = {}) {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const root = baseUrl.replace(/\/$/, '')

  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let resp: Response
    try {
      resp = await doFetch(`${root}/api${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw new ApiError(0, 'network_error', `Cannot reach the simulation server (${e instanceof Error ? e.message : String(e)}). Is the Rust API running?`)
    }
    if (resp.status === 204) return undefined as T
    const text = await resp.text()
    let data: unknown = undefined
    if (text.length > 0) {
      try {
        data = JSON.parse(text)
      } catch {
        if (resp.ok) return text as T
        throw new ApiError(resp.status, 'invalid_response', `Unexpected response (${resp.status}): ${text.slice(0, 200)}`)
      }
    }
    if (!resp.ok) {
      if (isErrorBody(data)) {
        throw new ApiError(resp.status, data.error.code, data.error.message, data.error.details ?? [])
      }
      throw new ApiError(resp.status, 'http_error', `Request failed with status ${resp.status}`)
    }
    return data as T
  }

  const sim = (id: string) => `/simulations/${encodeURIComponent(id)}`

  return {
    baseUrl: root,
    health: () => request<{ status: string; engine_version: string; uptime_s: number; simulations: number }>('GET', '/health'),
    defaultConfig: () => request<SimulationConfig>('GET', '/config/default'),
    validateConfig: (c: SimulationConfig) => request<{ valid: boolean; issues: ValidationIssue[] }>('POST', '/config/validate', c),
    feasibility: (c: SimulationConfig, signal?: AbortSignal) => request<FeasibilityReport>('POST', '/analysis/feasibility', c, signal),
    crossSection: (robot: RobotConfig, diameter: number, lateralOffset = 0, safetyMargin = 0.005, signal?: AbortSignal) =>
      request<CrossSectionView>(
        'POST',
        '/analysis/cross-section',
        { robot, diameter, lateral_offset: lateralOffset, safety_margin: safetyMargin },
        signal,
      ),
    presets: () => request<ExperimentPreset[]>('GET', '/experiments/presets'),
    compare: (config: SimulationConfig, controllers: ControllerConfig[]) =>
      request<CompareResponse>('POST', '/experiments/compare', { config, controllers }),
    listSimulations: () => request<SimulationSummary[]>('GET', '/simulations'),
    createSimulation: (c: SimulationConfig, playbackSpeed = 1) =>
      request<StatusResponse>('POST', `/simulations?playback_speed=${encodeURIComponent(playbackSpeed)}`, c),
    start: (id: string, playbackSpeed?: number) =>
      request<StatusResponse>('POST', `${sim(id)}/start`, playbackSpeed === undefined ? undefined : { playback_speed: playbackSpeed }),
    pause: (id: string) => request<StatusResponse>('POST', `${sim(id)}/pause`),
    resume: (id: string, playbackSpeed?: number) =>
      request<StatusResponse>('POST', `${sim(id)}/resume`, playbackSpeed === undefined ? undefined : { playback_speed: playbackSpeed }),
    stop: (id: string) => request<StatusResponse>('POST', `${sim(id)}/stop`),
    reset: (id: string) => request<StatusResponse>('POST', `${sim(id)}/reset`),
    runToCompletion: (id: string) => request<SimulationResults>('POST', `${sim(id)}/run`),
    setPlayback: (id: string, playbackSpeed: number) =>
      request<StatusResponse>('PUT', `${sim(id)}/playback`, { playback_speed: playbackSpeed }),
    status: (id: string) => request<StatusResponse>('GET', `${sim(id)}/status`),
    telemetry: (id: string, from = 0, stride = 1) => request<TelemetryPage>('GET', `${sim(id)}/telemetry?from=${from}&stride=${stride}`),
    results: (id: string) => request<SimulationResults>('GET', `${sim(id)}/results`),
    deleteSimulation: (id: string) => request<void>('DELETE', sim(id)),

    /** Open the telemetry WebSocket. Returns a function that closes it. */
    openStream(
      id: string,
      handlers: { onMessage: (m: WsMessage) => void; onOpen?: () => void; onClose?: (ev: CloseEvent) => void; onError?: () => void },
      WebSocketImpl: typeof WebSocket = WebSocket,
    ): () => void {
      const http = root || (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8080')
      const url = `${http.replace(/^http/, 'ws')}/api${sim(id)}/ws`
      const ws = new WebSocketImpl(url)
      ws.onopen = () => handlers.onOpen?.()
      ws.onerror = () => handlers.onError?.()
      ws.onclose = (ev) => handlers.onClose?.(ev)
      ws.onmessage = (ev) => {
        try {
          handlers.onMessage(JSON.parse(typeof ev.data === 'string' ? ev.data : '') as WsMessage)
        } catch {
          /* ignore malformed frames */
        }
      }
      return () => {
        ws.onclose = null
        ws.onmessage = null
        ws.close()
      }
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

/** Shared client. Same origin by default (Vite proxies /api to the Rust server in development). */
export let api: ApiClient = createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' })

/** Point the shared client at another server (used by integration tests). */
export function configureApi(options: ApiClientOptions): void {
  api = createApiClient(options)
}
