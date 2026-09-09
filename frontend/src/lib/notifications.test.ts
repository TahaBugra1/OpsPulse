import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AppNotification,
  useMarkAllAsRead,
  useMarkAsRead,
  useNotifications,
  useUnreadCount,
} from './notifications'

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

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('notifications lib', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: useUnreadCount calls GET /api/notifications/unread-count and returns the count shape
  it('useUnreadCount calls GET /api/notifications/unread-count and returns the count', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { count: 3 }))

    const { result } = renderHook(() => useUnreadCount(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ count: 3 })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/notifications/unread-count')
    expect(options?.method).toBe('GET')
  })

  // AC3: useNotifications(false) does not fetch at all - the `enabled` gate is real
  it('useNotifications does not fetch when enabled is false', () => {
    const { result } = renderHook(() => useNotifications(false), { wrapper: wrapper() })

    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  // AC3: useNotifications(true) calls GET /api/notifications and returns the list as-is
  it('useNotifications calls GET /api/notifications and returns the list when enabled is true', async () => {
    const list: AppNotification[] = [
      {
        id: 'n1',
        user_id: 'u1',
        request_id: 'r1',
        type: 'REQUEST_ASSIGNED',
        message: 'Talebiniz üstlenildi',
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, list))

    const { result } = renderHook(() => useNotifications(true), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(list)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/notifications')
    expect(String(url)).not.toContain('unread-count')
    expect(options?.method).toBe('GET')
  })

  // AC4: useMarkAsRead's mutationFn calls PATCH /api/notifications/:id/read
  it('useMarkAsRead calls PATCH /api/notifications/:id/read with the given id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'n1', read_at: '2026-01-01T00:00:00.000Z' }))

    const { result } = renderHook(() => useMarkAsRead(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync('n1')
    })

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/notifications/n1/read')
    expect(options?.method).toBe('PATCH')
  })

  // AC5: useMarkAllAsRead's mutationFn calls PATCH /api/notifications/read-all
  it('useMarkAllAsRead calls PATCH /api/notifications/read-all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }))

    const { result } = renderHook(() => useMarkAllAsRead(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync()
    })

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/notifications/read-all')
    expect(options?.method).toBe('PATCH')
  })
})
