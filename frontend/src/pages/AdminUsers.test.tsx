import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsers from './AdminUsers'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import type { Department } from '@/lib/departments'
import type { AdminUserListItem } from '@/lib/users'

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

const adminUser: AuthUser = {
  id: 'admin-1',
  name: 'Ada',
  surname: 'Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  department_id: null,
}

function seedSession(user: AuthUser = adminUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

const fakeDepartments: Department[] = [
  { id: 'dept-1', name: 'HR' },
  { id: 'dept-2', name: 'IT' },
]

function makeUserRow(overrides: Partial<AdminUserListItem> = {}): AdminUserListItem {
  return {
    id: 'user-1',
    name: 'Taha',
    surname: 'Bugra',
    email: 'taha@example.com',
    role: 'EMPLOYEE',
    department_id: null,
    department_name: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderAdminUsers(user: AuthUser = adminUser) {
  seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <AdminUsers />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('AdminUsers page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // Page fetches GET /api/departments then GET /api/users on mount; the
  // department dropdown gets its options from the departments response and
  // the user table gets its rows from the users response.
  it('fetches departments then users on mount and renders both from their responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra' })]),
    )

    renderAdminUsers()

    await screen.findByLabelText('Departman')

    const [firstUrl, firstOptions] = vi.mocked(fetch).mock.calls[0]
    expect(String(firstUrl)).toContain('/api/departments')
    expect(firstOptions?.method).toBe('GET')

    const [secondUrl, secondOptions] = vi.mocked(fetch).mock.calls[1]
    expect(String(secondUrl)).toContain('/api/users')
    expect(secondOptions?.method).toBe('GET')

    expect(screen.getByRole('option', { name: 'HR' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'IT' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Seçiniz' })).toBeInTheDocument()

    expect(await screen.findByText('Taha Bugra')).toBeInTheDocument()
  })

  // AC10: an empty GET /api/users response renders the empty state, not a broken table.
  it('renders the "Henüz kullanıcı yok" empty state for an empty user list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    expect(await screen.findByText('Henüz kullanıcı yok')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // Submitting the creation form with valid values calls POST /api/users with
  // the exact form body, invalidates/refetches the user list, and resets the
  // form fields to empty.
  it('submits valid form values via POST, refetches the user list, and resets the form', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    await screen.findByLabelText('Departman')

    await user.type(screen.getByLabelText('Ad'), 'Yeni')
    await user.type(screen.getByLabelText('Soyad'), 'Yetkili')
    await user.type(screen.getByLabelText('Email'), 'yeni.yetkili@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'sifre1234')
    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-2')

    const createdRow = makeUserRow({
      id: 'user-2',
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni.yetkili@example.com',
      role: 'DEPARTMENT_AUTHORITY',
      department_id: 'dept-2',
      department_name: 'IT',
    })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, createdRow))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [createdRow]))

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    const [postUrl, postOptions] = vi.mocked(fetch).mock.calls[2]
    expect(String(postUrl)).toContain('/api/users')
    expect(postOptions?.method).toBe('POST')
    expect(JSON.parse(postOptions?.body as string)).toEqual({
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni.yetkili@example.com',
      password: 'sifre1234',
      department_id: 'dept-2',
    })

    // The user list was refetched (4th fetch call = GET /api/users again).
    const [refetchUrl, refetchOptions] = vi.mocked(fetch).mock.calls[3]
    expect(String(refetchUrl)).toContain('/api/users')
    expect(refetchOptions?.method).toBe('GET')

    // Form fields reset to empty.
    await waitFor(() => expect(screen.getByLabelText('Ad')).toHaveValue(''))
    expect(screen.getByLabelText('Soyad')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('')
    expect(screen.getByLabelText('Şifre')).toHaveValue('')
    expect(screen.getByLabelText('Departman')).toHaveValue('')
  })

  // A validation error from the backend (e.g. 409 duplicate email) surfaces
  // via a role="alert" element inside the form, not a browser-native error.
  it('shows a backend error message inline via role="alert" on a failed POST', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    await screen.findByLabelText('Departman')

    await user.type(screen.getByLabelText('Ad'), 'Yeni')
    await user.type(screen.getByLabelText('Soyad'), 'Yetkili')
    await user.type(screen.getByLabelText('Email'), 'dup@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'sifre1234')
    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-1')

    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(409, 'Bu email zaten kayıtlı'))

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Bu email zaten kayıtlı')

    // Values remain in the form (no destructive reset on failure).
    expect(screen.getByLabelText('Email')).toHaveValue('dup@example.com')
  })

  // Client-side zod validation: an empty "Ad" blocks submission entirely.
  it('shows a field-level error for an empty Ad and does not call POST /api/users', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    await screen.findByLabelText('Departman')

    await user.type(screen.getByLabelText('Soyad'), 'Yetkili')
    await user.type(screen.getByLabelText('Email'), 'yeni@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'sifre1234')
    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-1')

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    expect(await screen.findByText('Ad zorunlu')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2) // only the initial GET departments + GET users
  })

  // Client-side zod validation: a password under 8 characters blocks submission.
  it('shows a field-level error for a short password and does not call POST /api/users', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    await screen.findByLabelText('Departman')

    await user.type(screen.getByLabelText('Ad'), 'Yeni')
    await user.type(screen.getByLabelText('Soyad'), 'Yetkili')
    await user.type(screen.getByLabelText('Email'), 'yeni@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'short1')
    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-1')

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    expect(await screen.findByText('Şifre en az 8 karakter olmalı')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // "Pasife Al" is not rendered for the currently logged-in ADMIN's own row,
  // but is rendered on other active users' rows; clicking it calls PATCH.
  it('hides "Pasife Al" on the current admin\'s own row, shows it on others, and PATCHes on click', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [
        makeUserRow({ id: 'admin-1', name: 'Ada', surname: 'Admin', role: 'ADMIN' }),
        makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra' }),
      ]),
    )

    renderAdminUsers()

    await screen.findByText('Ada Admin')
    const rows = screen.getAllByRole('row')
    // rows[0] is the header row.
    const adminRow = rows[1]
    const otherRow = rows[2]

    expect(within(adminRow).queryByRole('button', { name: 'Pasife Al' })).not.toBeInTheDocument()
    const deactivateButton = within(otherRow).getByRole('button', { name: 'Pasife Al' })

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'user-1', is_active: false }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [
        makeUserRow({ id: 'admin-1', name: 'Ada', surname: 'Admin', role: 'ADMIN' }),
        makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra', is_active: false }),
      ]),
    )

    await user.click(deactivateButton)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    const [patchUrl, patchOptions] = vi.mocked(fetch).mock.calls[2]
    expect(String(patchUrl)).toContain('/api/users/user-1/deactivate')
    expect(patchOptions?.method).toBe('PATCH')
  })

  // "Pasife Al" is not rendered for a row that is already is_active: false.
  it('does not render "Pasife Al" for an already-inactive row', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra', is_active: false })]),
    )

    renderAdminUsers()

    await screen.findByText('Taha Bugra')
    expect(screen.queryByRole('button', { name: 'Pasife Al' })).not.toBeInTheDocument()
    expect(screen.getByText('Pasif')).toBeInTheDocument()
  })

  // A GET /api/departments failure shows a role="alert" error with a working
  // "Tekrar Dene" retry button, independent of the users section.
  it('shows a departments error with a working retry, without blocking the users table', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Departmanlar yüklenemedi, lütfen tekrar deneyin'))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeUserRow()]))

    renderAdminUsers()

    expect(await screen.findByRole('alert')).toHaveTextContent('Departmanlar yüklenemedi, lütfen tekrar deneyin')
    // The users table still renders successfully despite the departments error.
    expect(await screen.findByText('Taha Bugra')).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByLabelText('Departman')).toBeInTheDocument())
  })

  // A GET /api/users failure shows a role="alert" error with a working
  // "Tekrar Dene" retry button, independent of the departments section.
  it('shows a users error with a working retry, without blocking the creation form', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Kullanıcılar yüklenemedi, lütfen tekrar deneyin'))

    renderAdminUsers()

    expect(await screen.findByRole('alert')).toHaveTextContent('Kullanıcılar yüklenemedi, lütfen tekrar deneyin')
    // The creation form still renders successfully despite the users error.
    expect(screen.getByLabelText('Departman')).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeUserRow()]))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByText('Taha Bugra')).toBeInTheDocument())
  })
})
