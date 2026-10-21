import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './api'
import { defaultConfig } from '@/test/fixtures'

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

describe('API client', () => {
  it('sends JSON and parses successful responses', async () => {
    const fetchImpl = mockFetch(201, { id: 'abc', status: 'ready' })
    const api = createApiClient({ baseUrl: 'http://host:1/', fetchImpl })
    const res = await api.createSimulation(defaultConfig(), 5)
    expect(res).toMatchObject({ id: 'abc', status: 'ready' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://host:1/api/simulations?playback_speed=5')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string).robot.wheel_radius).toBe(0.03)
  })

  it('maps structured validation errors (422) to ApiError with details', async () => {
    const api = createApiClient({
      fetchImpl: mockFetch(422, {
        error: {
          code: 'validation_failed',
          message: 'configuration is invalid',
          details: [{ field: 'robot.wheel_radius', message: 'must be greater than 0' }],
        },
      }),
    })
    const err = await api.createSimulation(defaultConfig()).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(422)
    expect(err.code).toBe('validation_failed')
    expect(err.details[0].field).toBe('robot.wheel_radius')
    expect(err.describe()).toContain('robot.wheel_radius: must be greater than 0')
  })

  it('maps invalid state transitions (409)', async () => {
    const api = createApiClient({
      fetchImpl: mockFetch(409, { error: { code: 'invalid_state_transition', message: 'cannot pause a simulation in state Ready', details: [] } }),
    })
    await expect(api.pause('x')).rejects.toMatchObject({ status: 409, code: 'invalid_state_transition' })
  })

  it('reports network failures and non-JSON errors', async () => {
    const offline = createApiClient({ fetchImpl: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) })
    await expect(offline.health()).rejects.toMatchObject({ status: 0, code: 'network_error' })
    const html = createApiClient({ fetchImpl: mockFetch(502, '<html>Bad gateway</html>') })
    await expect(html.health()).rejects.toMatchObject({ status: 502, code: 'invalid_response' })
    const noBody = createApiClient({ fetchImpl: mockFetch(500, '{}') })
    await expect(noBody.health()).rejects.toMatchObject({ status: 500, code: 'http_error' })
  })

  it('returns undefined for 204 responses', async () => {
    const api = createApiClient({ fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) })
    await expect(api.deleteSimulation('x')).resolves.toBeUndefined()
  })
})
