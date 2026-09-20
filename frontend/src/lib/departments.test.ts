import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useActivateDepartment,
  useCreateDepartment,
  useDeactivateDepartment,
  useDepartments,
  useUpdateDepartment,
  type Department,
} from './departments'

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
  { id: 'dept-1', name: 'HR', is_active: true },
  { id: 'dept-2', name: 'IT', is_active: true },
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

  // AC1: useCreateDepartment()'s mutate calls POST /api/departments with the given body
  it('useCreateDepartment calls POST /api/departments with the given body and resolves with the response', async () => {
    const created: Department = { id: 'dept-3', name: 'Legal', is_active: true }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, created))

    const { result } = renderHook(() => useCreateDepartment(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ name: 'Legal' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(created)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/departments')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(options?.body as string)).toEqual({ name: 'Legal' })
  })

  // AC4: useUpdateDepartment(id)'s mutate calls PATCH /api/departments/:id with the given body
  it('useUpdateDepartment calls PATCH /api/departments/:id with the given body and resolves with the response', async () => {
    const updated: Department = { id: 'dept-1', name: 'Renamed', is_active: true }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, updated))

    const { result } = renderHook(() => useUpdateDepartment('dept-1'), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ name: 'Renamed' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(updated)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/departments/dept-1')
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(options?.body as string)).toEqual({ name: 'Renamed' })
  })

  // AC6: useDeactivateDepartment()'s mutate calls PATCH /api/departments/:id/deactivate with NO body
  it('useDeactivateDepartment calls PATCH /api/departments/:id/deactivate for the given id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'dept-1', name: 'HR', is_active: false }))

    const { result } = renderHook(() => useDeactivateDepartment(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate('dept-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/departments/dept-1/deactivate')
    expect(options?.method).toBe('PATCH')
    expect(options?.body).toBeUndefined()
  })

  // AC8: useActivateDepartment()'s mutate calls PATCH /api/departments/:id/activate with NO body
  it('useActivateDepartment calls PATCH /api/departments/:id/activate for the given id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'dept-1', name: 'HR', is_active: true }))

    const { result } = renderHook(() => useActivateDepartment(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate('dept-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/departments/dept-1/activate')
    expect(options?.method).toBe('PATCH')
    expect(options?.body).toBeUndefined()
  })
})
