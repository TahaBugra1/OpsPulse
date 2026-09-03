import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiPost, ApiError, setUnauthorizedHandler } from './api'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
  } as unknown as Response
}

describe('api', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    setUnauthorizedHandler(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC5: a 401 from any endpoint OTHER than login/google triggers the global unauthorized handler
  it('calls the unauthorized handler exactly once on a 401 from a generic endpoint', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    await expect(apiGet('/api/requests')).rejects.toBeInstanceOf(ApiError)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  // AC5: the thrown error still carries the right status/message even when the handler fires
  it('still throws an ApiError with the correct status for a generic 401', async () => {
    setUnauthorizedHandler(vi.fn())
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Oturum süresi doldu' }))

    const error = await apiGet('/api/requests').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
    expect((error as ApiError).message).toBe('Oturum süresi doldu')
  })

  // AC4: 401 from POST /api/auth/login must NOT trigger the interceptor
  it('does not call the unauthorized handler for a 401 from /api/auth/login', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Email veya şifre hatalı' }))

    await expect(apiPost('/api/auth/login', { email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      ApiError,
    )

    expect(handler).not.toHaveBeenCalled()
  })

  // AC4: 401 from POST /api/auth/google must NOT trigger the interceptor
  it('does not call the unauthorized handler for a 401 from /api/auth/google', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(401, { message: 'Google hesabı doğrulanamadı' }),
    )

    await expect(apiPost('/api/auth/google', { id_token: 'x' })).rejects.toBeInstanceOf(ApiError)

    expect(handler).not.toHaveBeenCalled()
  })

  // Sanity: when no handler is registered, a generic 401 must not throw from the (missing) handler call
  it('does not blow up when a generic 401 occurs with no handler registered', async () => {
    setUnauthorizedHandler(null)
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    await expect(apiGet('/api/requests')).rejects.toBeInstanceOf(ApiError)
  })

  // Regression guard for the afterEach reset pattern: a handler set in one test must not leak into the next
  it('does not retain a handler registered by a previous test', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    // No handler registered in this test (afterEach in the previous test cleared it).
    await expect(apiGet('/api/requests')).rejects.toBeInstanceOf(ApiError)
    // If a stale handler from a previous test were still registered and threw, this test would fail
    // with an unhandled exception instead of the expected ApiError above.
  })
})
