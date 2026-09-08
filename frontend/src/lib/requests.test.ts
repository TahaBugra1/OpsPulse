import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  useAddComment,
  useBulkQueueAction,
  useChangePriority,
  useChangeRequestStatus,
  useClaimRequest,
  useCreateRequest,
  useOpenQueue,
  useRequest,
  useRequestComments,
  useRequests,
  useRequestTypes,
} from './requests'

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

  // AC2: useRequestTypes() calls GET /api/request-types and returns the array
  it('useRequestTypes calls GET /api/request-types and returns the list', async () => {
    const types = [{ id: 'type-1', name: 'Donanım Arızası', department_id: 'dept-1' }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, types))

    const { result } = renderHook(() => useRequestTypes(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(types)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/request-types')
    expect(options?.method).toBe('GET')
  })

  // AC3: useCreateRequest()'s mutate calls POST /api/requests with the given body and resolves with the response
  it('useCreateRequest calls POST /api/requests with the given body and resolves with the response', async () => {
    const created = { id: 'req-1', request_number: 99 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, created))

    const { result } = renderHook(() => useCreateRequest(), { wrapper: wrapper() })

    const body = {
      title: 'Yazıcı bozuldu',
      description: 'Ofis yazıcısı çalışmıyor',
      request_type_id: 'type-1',
      priority: 'HIGH' as const,
    }

    act(() => {
      result.current.mutate(body)
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(created)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(options?.body as string)).toEqual(body)
  })

  // useClaimRequest(id)'s mutate calls POST /api/requests/:id/assign with no body
  it('useClaimRequest calls POST /api/requests/:id/assign with no body', async () => {
    const updated = { id: 'r1', status: 'ASSIGNED' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, updated))

    const { result } = renderHook(() => useClaimRequest('r1'), { wrapper: wrapper() })

    act(() => {
      result.current.mutate()
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests/r1/assign')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBeUndefined()
  })

  // useChangeRequestStatus(id)'s mutate calls PATCH /api/requests/:id/status with the given body
  it('useChangeRequestStatus calls PATCH /api/requests/:id/status with the given body', async () => {
    const updated = { id: 'r1', status: 'COMPLETED' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, updated))

    const { result } = renderHook(() => useChangeRequestStatus('r1'), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ status: 'COMPLETED' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests/r1/status')
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(options?.body as string)).toEqual({ status: 'COMPLETED' })
  })

  // useChangePriority(id)'s mutate calls PATCH /api/requests/:id/priority with the given body
  it('useChangePriority calls PATCH /api/requests/:id/priority with the given body', async () => {
    const updated = { id: 'r1', priority: 'HIGH' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, updated))

    const { result } = renderHook(() => useChangePriority('r1'), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ priority: 'HIGH' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests/r1/priority')
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(options?.body as string)).toEqual({ priority: 'HIGH' })
  })

  // useAddComment(id)'s mutate calls POST /api/requests/:id/comments with the given body
  it('useAddComment calls POST /api/requests/:id/comments with the given body', async () => {
    const created = { id: 'c1', content: 'test' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, created))

    const { result } = renderHook(() => useAddComment('r1'), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ content: 'test' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests/r1/comments')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(options?.body as string)).toEqual({ content: 'test' })
  })

  // AC1 (realtime-queue-claim): useOpenQueue() calls GET /api/requests?status=OPEN
  // and returns the array reversed relative to what fetch returned (FIFO
  // client-side reversal of the backend's DESC order).
  it('useOpenQueue calls GET /api/requests?status=OPEN and returns the list reversed', async () => {
    const newest = { id: 'r3', request_number: 3 }
    const middle = { id: 'r2', request_number: 2 }
    const oldest = { id: 'r1', request_number: 1 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [newest, middle, oldest]))

    const { result } = renderHook(() => useOpenQueue(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual([oldest, middle, newest])
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests?status=OPEN')
    expect(options?.method).toBe('GET')
  })

  // ---------------------------------------------------------------------
  // useBulkQueueAction — queue-bulk-actions task
  // ---------------------------------------------------------------------

  // AC1: a CLAIM run issues exactly one POST /api/requests/:id/assign per id,
  // in the given order. The ordered URL sequence is the observable proof that
  // the loop is sequential (awaited one at a time), not fired in parallel.
  it('useBulkQueueAction CLAIM issues one POST /assign per id, in the given order', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r1', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r2', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r3', status: 'ASSIGNED' }))

    const { result } = renderHook(() => useBulkQueueAction(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ ids: ['r1', 'r2', 'r3'], action: 'CLAIM' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ succeeded: 3, conflicted: 0, failed: 0 })
    expect(fetch).toHaveBeenCalledTimes(3)

    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map(([url]) => String(url).replace(/^.*\/api/, '/api'))).toEqual([
      '/api/requests/r1/assign',
      '/api/requests/r2/assign',
      '/api/requests/r3/assign',
    ])
    calls.forEach(([, options]) => expect(options?.method).toBe('POST'))
  })

  // AC3: a REJECT run issues PATCH /api/requests/:id/status per id, and EVERY
  // call carries the exact same shared note alongside status REJECTED.
  it('useBulkQueueAction REJECT PATCHes /status for every id with the shared note', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r1', status: 'REJECTED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r2', status: 'REJECTED' }))

    const { result } = renderHook(() => useBulkQueueAction(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ ids: ['r1', 'r2'], action: 'REJECT', note: 'Bütçe yok' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ succeeded: 2, conflicted: 0, failed: 0 })
    expect(fetch).toHaveBeenCalledTimes(2)

    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map(([url]) => String(url).replace(/^.*\/api/, '/api'))).toEqual([
      '/api/requests/r1/status',
      '/api/requests/r2/status',
    ])
    calls.forEach(([, options]) => {
      expect(options?.method).toBe('PATCH')
      expect(JSON.parse(options?.body as string)).toEqual({
        status: 'REJECTED',
        note: 'Bütçe yok',
      })
    })
  })

  // AC4: a mixed run never stops at the first failure — all 4 ids are still
  // attempted — and each outcome is bucketed correctly: 409 => conflicted,
  // any other error => failed.
  it('useBulkQueueAction attempts every id on a mixed run and buckets 409 vs other errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r1', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(409, { message: 'Bu talep zaten üstlenildi' }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'Sunucu hatası' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'r4', status: 'ASSIGNED' }))

    const { result } = renderHook(() => useBulkQueueAction(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ ids: ['r1', 'r2', 'r3', 'r4'], action: 'CLAIM' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ succeeded: 2, conflicted: 1, failed: 1 })
    // The loop did not abort at the 409 or the 500: all four were attempted.
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(
      vi.mocked(fetch).mock.calls.map(([url]) => String(url).replace(/^.*\/api/, '/api')),
    ).toEqual([
      '/api/requests/r1/assign',
      '/api/requests/r2/assign',
      '/api/requests/r3/assign',
      '/api/requests/r4/assign',
    ])
  })

  // AC4 (edge): an empty id list is a no-op — a zeroed result, zero requests.
  it('useBulkQueueAction resolves to an all-zero result with no fetch for an empty id list', async () => {
    const { result } = renderHook(() => useBulkQueueAction(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ ids: [], action: 'CLAIM' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ succeeded: 0, conflicted: 0, failed: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })
})
