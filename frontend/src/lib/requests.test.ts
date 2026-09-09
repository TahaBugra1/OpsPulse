import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSlaDisplay,
  PRIORITY_LABELS,
  type RequestListItem,
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

  // AC7 (requests-search-filter task): useRequests() with no args still hits
  // plain /api/requests, with no query string at all — the hook-level
  // counterpart to Requests.tsx never adding empty filter params.
  it('useRequests with no args calls GET /api/requests with no query string', async () => {
    const list = [{ id: 'r1', request_number: 1 }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, list))

    const { result } = renderHook(() => useRequests(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/api\/requests$/)
    expect(String(url)).not.toContain('?')
  })

  // requests-search-filter task: a `q` filter produces a `?q=` query param.
  it('useRequests({ q }) produces a ?q= query string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    const { result } = renderHook(() => useRequests({ q: 'yazıcı' }), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('q=')
  })

  // requests-search-filter task: status + request_type_id + priority combine
  // into one ANDed query string, all three params present together.
  it('useRequests combines status, request_type_id and priority into one query string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    const { result } = renderHook(
      () => useRequests({ status: 'OPEN', request_type_id: 'type-1', priority: 'HIGH' }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('status=OPEN')
    expect(String(url)).toContain('request_type_id=type-1')
    expect(String(url)).toContain('priority=HIGH')
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

// -----------------------------------------------------------------------
// getSlaDisplay — sla-visibility task
// -----------------------------------------------------------------------

// getSlaDisplay() reads Date.now(), so every fixture below is built as an
// offset from a single frozen NOW rather than from a literal date — a literal
// would silently drift into a different label every day real time advances.
const NOW = new Date('2026-09-10T12:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function fromNow(offsetMs: number) {
  return new Date(NOW.getTime() + offsetMs).toISOString()
}

// Default fixture: an OPEN request with an 8h window (created 4h ago, due in
// 4h), i.e. comfortably outside the last-quarter warning band.
function makeRequest(overrides: Partial<RequestListItem> = {}): RequestListItem {
  return {
    id: 'uuid-1111-2222',
    request_number: 42,
    title: 'Yazıcı bozuldu',
    description: 'Ofis yazıcısı çalışmıyor',
    request_type_id: 'type-1',
    department_id: 'dept-1',
    created_by: 'user-1',
    assigned_to: null,
    priority: 'HIGH',
    status: 'OPEN',
    sla_due_at: fromNow(4 * HOUR),
    created_at: fromNow(-4 * HOUR),
    updated_at: fromNow(-4 * HOUR),
    is_overdue: false,
    request_type_name: 'Donanım Arızası',
    department_name: 'IT',
    created_by_name: 'Taha',
    assigned_to_name: null,
    ...overrides,
  }
}

// Fake timers are installed and torn down inside this describe only: the
// hook tests above drive TanStack Query through waitFor and need real timers.
describe('getSlaDisplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // AC1: every non-terminal status gets a remaining-time label.
  it('returns a remaining-time label for every active status', () => {
    for (const status of ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] as const) {
      expect(getSlaDisplay(makeRequest({ status }))).toEqual({
        label: '4 saat kaldı',
        tone: 'normal',
      })
    }
  })

  // AC1: the label uses days, hours or minutes — whichever is the single
  // largest meaningful unit for that amount.
  it('renders the remaining time in days, hours or minutes', () => {
    expect(
      getSlaDisplay(makeRequest({ sla_due_at: fromNow(2 * DAY), created_at: fromNow(-4 * DAY) }))
        ?.label,
    ).toBe('2 gün kaldı')
    expect(
      getSlaDisplay(makeRequest({ sla_due_at: fromNow(3 * HOUR), created_at: fromNow(-3 * HOUR) }))
        ?.label,
    ).toBe('3 saat kaldı')
    expect(
      getSlaDisplay(
        makeRequest({ sla_due_at: fromNow(45 * MINUTE), created_at: fromNow(-45 * MINUTE) }),
      )?.label,
    ).toBe('45 dakika kaldı')
  })

  // AC1: the unit switches exactly at 1 day / 1 hour / 1 minute, and only ever
  // one unit is shown — 3h30m is "3 saat", never "3 saat 30 dakika".
  it('switches units at the exact day/hour/minute boundaries and never combines two units', () => {
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(DAY) }))?.label).toBe('1 gün kaldı')
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(DAY - 1) }))?.label).toBe('23 saat kaldı')
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(HOUR) }))?.label).toBe('1 saat kaldı')
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(HOUR - 1) }))?.label).toBe(
      '59 dakika kaldı',
    )
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(MINUTE) }))?.label).toBe(
      '1 dakika kaldı',
    )
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(3 * HOUR + 30 * MINUTE) }))?.label).toBe(
      '3 saat kaldı',
    )
  })

  // AC8: under a minute the label is a phrase, never a rounded-down "0 dakika"
  // and never a negative number at the exact deadline.
  it('renders "1 dakikadan az kaldı" with under a minute left, including at the deadline itself', () => {
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(59 * 1000) }))?.label).toBe(
      '1 dakikadan az kaldı',
    )
    expect(getSlaDisplay(makeRequest({ sla_due_at: fromNow(0) }))?.label).toBe(
      '1 dakikadan az kaldı',
    )
  })

  // AC4: on a LOW-priority 72h window the warning band starts at 18h left.
  it('marks the last quarter of a 72h window as warning and the rest as normal', () => {
    // 20h left of 72h — still normal.
    expect(
      getSlaDisplay(makeRequest({ sla_due_at: fromNow(20 * HOUR), created_at: fromNow(-52 * HOUR) })),
    ).toEqual({ label: '20 saat kaldı', tone: 'normal' })
    // Exactly 18h left of 72h — the boundary itself is already warning.
    expect(
      getSlaDisplay(makeRequest({ sla_due_at: fromNow(18 * HOUR), created_at: fromNow(-54 * HOUR) })),
    ).toEqual({ label: '18 saat kaldı', tone: 'warning' })
    // 17h left of 72h — inside the band.
    expect(
      getSlaDisplay(makeRequest({ sla_due_at: fromNow(17 * HOUR), created_at: fromNow(-55 * HOUR) })),
    ).toEqual({ label: '17 saat kaldı', tone: 'warning' })
  })

  // AC4: on a HIGH-priority 4h window the same quarter rule lands at 1h left.
  it('marks the last quarter of a 4h window as warning and the rest as normal', () => {
    expect(
      getSlaDisplay(
        makeRequest({ sla_due_at: fromNow(90 * MINUTE), created_at: fromNow(-150 * MINUTE) }),
      ),
    ).toEqual({ label: '1 saat kaldı', tone: 'normal' })
    // Exactly 60m left of 4h — the boundary itself is already warning.
    expect(
      getSlaDisplay(makeRequest({ sla_due_at: fromNow(HOUR), created_at: fromNow(-3 * HOUR) })),
    ).toEqual({ label: '1 saat kaldı', tone: 'warning' })
    expect(
      getSlaDisplay(
        makeRequest({ sla_due_at: fromNow(45 * MINUTE), created_at: fromNow(-195 * MINUTE) }),
      ),
    ).toEqual({ label: '45 dakika kaldı', tone: 'warning' })
  })

  // AC4: the threshold is a share of each request's OWN window, not a fixed
  // hour count — 17h left is already warning on a 72h window while 90m left is
  // still normal on a 4h one.
  it('measures the warning band against each request own window, not a fixed hour count', () => {
    const longWindow = getSlaDisplay(
      makeRequest({ sla_due_at: fromNow(17 * HOUR), created_at: fromNow(-55 * HOUR) }),
    )
    const shortWindow = getSlaDisplay(
      makeRequest({ sla_due_at: fromNow(90 * MINUTE), created_at: fromNow(-150 * MINUTE) }),
    )

    expect(longWindow?.tone).toBe('warning')
    expect(shortWindow?.tone).toBe('normal')
  })

  // AC2: an overdue request reports how far past the deadline it is.
  it('reports how far overdue a request is with the overdue tone', () => {
    expect(
      getSlaDisplay(
        makeRequest({
          is_overdue: true,
          sla_due_at: fromNow(-6 * HOUR),
          created_at: fromNow(-10 * HOUR),
        }),
      ),
    ).toEqual({ label: '6 saat gecikti', tone: 'overdue' })
  })

  // AC5: the server is the authority on lateness. is_overdue wins even when
  // the client clock still shows time left (skewed/slow client clock).
  it('renders as overdue when the server says so even though the deadline is still in the future locally', () => {
    expect(
      getSlaDisplay(
        makeRequest({
          is_overdue: true,
          sla_due_at: fromNow(3 * HOUR),
          created_at: fromNow(-1 * HOUR),
        }),
      ),
    ).toEqual({ label: '3 saat gecikti', tone: 'overdue' })
  })

  // AC5 (other direction): with is_overdue false the wording is never
  // "gecikti", even when the client clock is already past the deadline.
  it('never says "gecikti" when the server says the request is not overdue, even past the local deadline', () => {
    const sla = getSlaDisplay(
      makeRequest({
        is_overdue: false,
        sla_due_at: fromNow(-5 * HOUR),
        created_at: fromNow(-9 * HOUR),
      }),
    )

    expect(sla?.label).not.toContain('gecikti')
    expect(sla).toEqual({ label: '5 saat kaldı', tone: 'warning' })
  })

  // AC3: terminal statuses have no deadline left to meet.
  it('returns null for COMPLETED and REJECTED requests', () => {
    expect(getSlaDisplay(makeRequest({ status: 'COMPLETED' }))).toBeNull()
    expect(getSlaDisplay(makeRequest({ status: 'REJECTED' }))).toBeNull()
  })

  // AC3: status wins over the clock — a completed request that was finished
  // late still shows nothing, not an overdue label.
  it('returns null for a terminal status even when the deadline passed and the server flagged it overdue', () => {
    expect(
      getSlaDisplay(
        makeRequest({ status: 'COMPLETED', is_overdue: true, sla_due_at: fromNow(-6 * HOUR) }),
      ),
    ).toBeNull()
    expect(
      getSlaDisplay(
        makeRequest({ status: 'REJECTED', is_overdue: true, sla_due_at: fromNow(-6 * HOUR) }),
      ),
    ).toBeNull()
  })

  // AC7: an empty or unparseable deadline degrades to "no SLA to show"
  // (rendered as "-") instead of throwing or printing "Invalid Date".
  it('returns null without throwing for a missing or unparseable sla_due_at', () => {
    expect(getSlaDisplay(makeRequest({ sla_due_at: '' }))).toBeNull()
    expect(() => getSlaDisplay(makeRequest({ sla_due_at: 'not-a-date' }))).not.toThrow()
    expect(getSlaDisplay(makeRequest({ sla_due_at: 'not-a-date' }))).toBeNull()
  })
})
