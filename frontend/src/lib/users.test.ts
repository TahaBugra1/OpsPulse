import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ROLE_LABELS,
  useChangeMyPassword,
  useCreateUser,
  useDeactivateUser,
  useProfile,
  useResetUserPassword,
  useUpdateProfile,
  useUsers,
  type AdminUserListItem,
  type UserProfile,
} from './users'

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

const fakeProfile: UserProfile = {
  id: 'user-1',
  name: 'Taha',
  surname: 'Bugra',
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: null,
  department_name: null,
  has_password: true,
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

  // useProfile() calls GET /api/users/me and returns the 8-field UserProfile
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

  const fakeUserList: AdminUserListItem[] = [
    {
      id: 'user-1',
      name: 'Taha',
      surname: 'Bugra',
      email: 'taha@example.com',
      role: 'EMPLOYEE',
      department_id: null,
      department_name: null,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      has_password: true,
    },
  ]

  // useUsers() calls GET /api/users and returns the admin user list
  it('useUsers calls GET /api/users and returns the list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeUserList))

    const { result } = renderHook(() => useUsers(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(fakeUserList)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/users')
    expect(options?.method).toBe('GET')
  })

  // useUsers() surfaces a fetch failure via isError/error
  it('useUsers surfaces a backend error via isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Kullanıcılar getirilemedi, lütfen tekrar deneyin'))

    const { result } = renderHook(() => useUsers(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('Kullanıcılar getirilemedi, lütfen tekrar deneyin')
  })

  // useCreateUser()'s mutate calls POST /api/users with the given body (role, no
  // password) and resolves with the one-time temporary password
  it('useCreateUser calls POST /api/users with role and no password, and resolves with the temporary password', async () => {
    const created = {
      id: 'user-2',
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni@example.com',
      role: 'DEPARTMENT_AUTHORITY',
      department_id: 'dept-1',
      temporary_password: 'AbCdEfGh2345',
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, created))

    const { result } = renderHook(() => useCreateUser(), { wrapper: wrapper() })

    const body = {
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni@example.com',
      role: 'DEPARTMENT_AUTHORITY',
      department_id: 'dept-1',
    }

    act(() => {
      result.current.mutate(body)
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.temporary_password).toBe('AbCdEfGh2345')
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/users')
    expect(options?.method).toBe('POST')
    const sent = JSON.parse(options?.body as string)
    expect(sent).toEqual(body)
    expect(sent).not.toHaveProperty('password')
  })

  // useCreateUser() rejects with the backend's error message on failure
  it('useCreateUser rejects with the backend error message on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(409, 'Bu email zaten kayıtlı'))

    const { result } = renderHook(() => useCreateUser(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({
        name: 'Yeni',
        surname: 'Yetkili',
        email: 'dup@example.com',
        role: 'EMPLOYEE',
        department_id: 'dept-1',
      })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('Bu email zaten kayıtlı')
  })

  // useResetUserPassword()'s mutate POSTs to /api/users/:id/reset-password
  it('useResetUserPassword calls POST /api/users/:id/reset-password and resolves with the temporary password', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { temporary_password: 'ZyXwVuTs9876' }))

    const { result } = renderHook(() => useResetUserPassword(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate('user-2')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ temporary_password: 'ZyXwVuTs9876' })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/api\/users\/user-2\/reset-password$/)
    expect(options?.method).toBe('POST')
  })

  // useChangeMyPassword()'s mutate PATCHes /api/users/me/password with exactly
  // { current_password, new_password }
  it('useChangeMyPassword calls PATCH /api/users/me/password with exactly current_password and new_password', async () => {
    const updatedUser = {
      id: 'user-1',
      name: 'Taha',
      surname: 'Bugra',
      email: 'taha@example.com',
      role: 'EMPLOYEE',
      department_id: 'dept-1',
      must_change_password: false,
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, updatedUser))

    const { result } = renderHook(() => useChangeMyPassword(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate({ current_password: 'GeciciSifre1', new_password: 'YeniSifre123' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(updatedUser)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/api\/users\/me\/password$/)
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(options?.body as string)).toEqual({
      current_password: 'GeciciSifre1',
      new_password: 'YeniSifre123',
    })
  })

  // useDeactivateUser()'s mutate calls PATCH /api/users/:id/deactivate
  it('useDeactivateUser calls PATCH /api/users/:id/deactivate for the given id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'user-2', is_active: false }))

    const { result } = renderHook(() => useDeactivateUser(), { wrapper: wrapper() })

    act(() => {
      result.current.mutate('user-2')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/users/user-2/deactivate')
    expect(options?.method).toBe('PATCH')
  })
})
