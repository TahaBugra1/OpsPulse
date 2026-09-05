import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROLE_LABELS, useProfile, useUpdateProfile, type UserProfile } from './users'

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

const fakeProfile: UserProfile = {
  id: 'user-1',
  name: 'Taha',
  surname: 'Bugra',
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: null,
  department_name: null,
}

describe('users lib', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // useProfile() calls GET /api/users/me and returns the 7-field UserProfile
  it('useProfile calls GET /api/users/me and returns the profile', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeProfile))

    const { result } = renderHook(() => useProfile(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(fakeProfile)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/users/me')
    expect(options?.method).toBe('GET')
  })

  // useUpdateProfile()'s mutate calls PATCH /api/users/me with the given body and resolves with the response
  it('useUpdateProfile calls PATCH /api/users/me with the given body and resolves with the response', async () => {
    const updated = { ...fakeProfile, name: 'Yeni', surname: null }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, updated))

    const { result } = renderHook(() => useUpdateProfile(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ name: 'Yeni', surname: null })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(updated)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/users/me')
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(options?.body as string)).toEqual({ name: 'Yeni', surname: null })
  })

  // ROLE_LABELS has the exact 3 expected Turkish values
  it('has the exact expected Turkish ROLE_LABELS for every role', () => {
    expect(ROLE_LABELS).toEqual({
      EMPLOYEE: 'Çalışan',
      DEPARTMENT_AUTHORITY: 'Departman Yetkilisi',
      ADMIN: 'Yönetici',
    })
  })
})
