import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAnalyticsSla,
  useAnalyticsSummary,
  useAnalyticsWorkload,
} from './analytics'

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
})
