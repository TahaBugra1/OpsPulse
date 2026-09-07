import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDepartments, type Department } from './departments'

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

function errorResponse(status: number, message: string) {
  return jsonResponse(status, { message })
}

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const fakeDepartments: Department[] = [
  { id: 'dept-1', name: 'HR' },
  { id: 'dept-2', name: 'IT' },
]

describe('departments lib', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // useDepartments() calls GET /api/departments and returns the list
  it('useDepartments calls GET /api/departments and returns the list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))

    const { result } = renderHook(() => useDepartments(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(fakeDepartments)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/departments')
    expect(options?.method).toBe('GET')
  })

  // useDepartments() surfaces a fetch failure via isError/error
  it('useDepartments surfaces a backend error via isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(403, 'Bu işlem için yetkiniz yok'))

    const { result } = renderHook(() => useDepartments(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('Bu işlem için yetkiniz yok')
  })
})
