import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIORITY_LABELS, STATUS_LABELS, useRequest, useRequestComments, useRequests } from './requests'

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

describe('requests lib', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: useRequests() calls GET /api/requests and returns the array
  it('useRequests calls GET /api/requests and returns the list', async () => {
    const list = [{ id: 'r1', request_number: 1 }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, list))

    const { result } = renderHook(() => useRequests(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(list)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests')
    expect(options?.method).toBe('GET')
  })

  // AC4: useRequest(id) calls GET /api/requests/:id with the right id in the URL
  it('useRequest calls GET /api/requests/:id with the given id', async () => {
    const item = { id: 'r1', request_number: 1 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, item))

    const { result } = renderHook(() => useRequest('r1'), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(item)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests/r1')
    expect(String(url)).not.toContain('/api/requests/r1/comments')
  })

  // AC4: useRequestComments(id) calls GET /api/requests/:id/comments with the right id in the URL
  it('useRequestComments calls GET /api/requests/:id/comments with the given id', async () => {
    const comments = [{ id: 'c1', content: 'hello' }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, comments))

    const { result } = renderHook(() => useRequestComments('r1'), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(comments)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests/r1/comments')
  })

  // useRequest/useRequestComments are disabled with an empty id (enabled: !!id)
  it('does not call fetch for useRequest/useRequestComments when id is empty', () => {
    renderHook(() => useRequest(''), { wrapper: wrapper() })
    renderHook(() => useRequestComments(''), { wrapper: wrapper() })

    expect(fetch).not.toHaveBeenCalled()
  })

  // AC1/AC8: exact Turkish label values for every enum member
  it('has the exact expected Turkish STATUS_LABELS for every status', () => {
    expect(STATUS_LABELS).toEqual({
      OPEN: 'Açık',
      ASSIGNED: 'Atandı',
      IN_PROGRESS: 'İşlemde',
      COMPLETED: 'Tamamlandı',
      REJECTED: 'Reddedildi',
    })
  })

  it('has the exact expected Turkish PRIORITY_LABELS for every priority', () => {
    expect(PRIORITY_LABELS).toEqual({
      LOW: 'Düşük',
      MEDIUM: 'Orta',
      HIGH: 'Yüksek',
    })
  })
})
