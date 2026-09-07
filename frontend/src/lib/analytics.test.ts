import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAnalyticsBottlenecks,
  useAnalyticsDistribution,
  useAnalyticsSla,
  useAnalyticsSummary,
  useAnalyticsWorkload,
} from './analytics'
import type { BottlenecksData, DistributionData } from './analytics'

function makeDistribution(overrides: Partial<DistributionData> = {}): DistributionData {
  return {
    status: [
      { status: 'OPEN', count: 3 },
      { status: 'ASSIGNED', count: 2 },
    ],
    priority: [
      { priority: 'HIGH', count: 1 },
      { priority: 'LOW', count: 4 },
    ],
    department: [{ department: 'IT', count: 5 }],
    requestType: [{ requestType: 'Donanım Arızası', count: 5 }],
    volumeOverTime: [
      { date: '2026-09-01', count: 2 },
      { date: '2026-09-02', count: 3 },
    ],
    ...overrides,
  }
}

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

describe('analytics lib', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // useAnalyticsSummary() calls GET /api/analytics/summary and returns the exact object shape
  it('useAnalyticsSummary calls GET /api/analytics/summary and returns the data', async () => {
    const summary = {
      total_open: 3,
      total_assigned: 2,
      total_in_progress: 1,
      total_completed: 5,
      total_rejected: 1,
      total_overdue: 2,
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, summary))

    const { result } = renderHook(() => useAnalyticsSummary(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(summary)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/analytics/summary')
    expect(options?.method).toBe('GET')
  })

  // useAnalyticsSla() calls GET /api/analytics/sla and returns the exact object shape,
  // with a non-null avg_resolution_hours to prove the hook doesn't transform the value
  it('useAnalyticsSla calls GET /api/analytics/sla and returns the data untransformed', async () => {
    const sla = { compliance_rate: 87, avg_resolution_hours: 5.5 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, sla))

    const { result } = renderHook(() => useAnalyticsSla(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(sla)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/analytics/sla')
  })

  // useAnalyticsWorkload() calls GET /api/analytics/workload and returns the array as-is
  it('useAnalyticsWorkload calls GET /api/analytics/workload and returns the list', async () => {
    const workload = [
      { department_name: 'IT', open: 1, assigned: 2, in_progress: 3, completed: 4, rejected: 0 },
      { department_name: 'HR', open: 0, assigned: 1, in_progress: 0, completed: 2, rejected: 1 },
    ]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, workload))

    const { result } = renderHook(() => useAnalyticsWorkload(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(workload)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/analytics/workload')
  })

  describe('useAnalyticsDistribution', () => {
    // AC1/AC3: calls GET /api/analytics/distribution with the given `days` value
    // and returns the data untransformed
    it('calls GET /api/analytics/distribution with the days param and returns the data', async () => {
      const distribution = makeDistribution()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, distribution))

      const { result } = renderHook(() => useAnalyticsDistribution(30), { wrapper: wrapper() })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data).toEqual(distribution)
      const [url, options] = vi.mocked(fetch).mock.calls[0]
      expect(String(url)).toContain('/api/analytics/distribution')
      expect(String(url)).toContain('days=30')
      expect(options?.method).toBe('GET')
    })

    // AC3: changing `days` changes the query key, triggering a new fetch with
    // the new value in the URL (no manual refetch() call needed)
    it('refetches with the new days value when the days argument changes', async () => {
      const initial = makeDistribution()
      const updated = makeDistribution({ department: [{ department: 'İK', count: 9 }] })
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, initial))
        .mockResolvedValueOnce(jsonResponse(200, updated))

      const { result, rerender } = renderHook(({ days }) => useAnalyticsDistribution(days), {
        wrapper: wrapper(),
        initialProps: { days: 30 },
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(initial)

      rerender({ days: 7 })

      await waitFor(() => expect(result.current.data).toEqual(updated))

      expect(vi.mocked(fetch).mock.calls).toHaveLength(2)
      const [firstUrl] = vi.mocked(fetch).mock.calls[0]
      const [secondUrl] = vi.mocked(fetch).mock.calls[1]
      expect(String(firstUrl)).toContain('days=30')
      expect(String(secondUrl)).toContain('days=7')
    })
  })

  describe('useAnalyticsBottlenecks', () => {
    function makeBottlenecks(overrides: Partial<BottlenecksData> = {}): BottlenecksData {
      return {
        slaBreachByDepartment: [{ department: 'IT', count: 3 }],
        slaBreachByRequestType: [{ requestType: 'Donanım Arızası', count: 3 }],
        stageDurations: [
          { stage: 'OPEN_TO_ASSIGNED', avg_hours: 2 },
          { stage: 'ASSIGNED_TO_IN_PROGRESS', avg_hours: 5 },
          { stage: 'IN_PROGRESS_TO_COMPLETED', avg_hours: null },
        ],
        authorityWorkload: [
          { authority_name: 'Ali Veli', department_name: 'IT', active_count: 4 },
        ],
        ...overrides,
      }
    }

    // AC1: calls GET /api/analytics/bottlenecks and returns data whose
    // stageDurations come back sorted descending by avg_hours, with the
    // null-valued entry last (proving the hook's own `select` sort, not a
    // pre-sorted mock, is what produces this order)
    it('calls GET /api/analytics/bottlenecks and returns stageDurations sorted descending with nulls last', async () => {
      const bottlenecks = makeBottlenecks({
        stageDurations: [
          { stage: 'ASSIGNED_TO_IN_PROGRESS', avg_hours: 5 },
          { stage: 'IN_PROGRESS_TO_COMPLETED', avg_hours: null },
          { stage: 'OPEN_TO_ASSIGNED', avg_hours: 2 },
        ],
      })
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, bottlenecks))

      const { result } = renderHook(() => useAnalyticsBottlenecks(), { wrapper: wrapper() })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data?.stageDurations).toEqual([
        { stage: 'ASSIGNED_TO_IN_PROGRESS', avg_hours: 5 },
        { stage: 'OPEN_TO_ASSIGNED', avg_hours: 2 },
        { stage: 'IN_PROGRESS_TO_COMPLETED', avg_hours: null },
      ])
      const [url, options] = vi.mocked(fetch).mock.calls[0]
      expect(String(url)).toContain('/api/analytics/bottlenecks')
      expect(options?.method).toBe('GET')
    })

    // AC1: slaBreachByDepartment, slaBreachByRequestType, and authorityWorkload
    // pass through untransformed
    it('returns slaBreachByDepartment, slaBreachByRequestType, and authorityWorkload untransformed', async () => {
      const bottlenecks = makeBottlenecks()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, bottlenecks))

      const { result } = renderHook(() => useAnalyticsBottlenecks(), { wrapper: wrapper() })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data?.slaBreachByDepartment).toEqual(bottlenecks.slaBreachByDepartment)
      expect(result.current.data?.slaBreachByRequestType).toEqual(
        bottlenecks.slaBreachByRequestType,
      )
      expect(result.current.data?.authorityWorkload).toEqual(bottlenecks.authorityWorkload)
    })
  })
})
