import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsers from './AdminUsers'
import { Toaster } from '@/components/ui/sonner'
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
    has_password: true,
    ...overrides,
  }
}

// A <Toaster /> is mounted (as in Profile.test.tsx) so toast text can be asserted
// from the DOM; the page itself only calls sonner's toast().
function renderAdminUsers(user: AuthUser = adminUser) {
  seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <AdminUsers />
        </MemoryRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

const TEMP_PASSWORD = 'AbCdEfGh2345'

async function fillCreateForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; surname?: string; email?: string; role?: string; department?: string },
) {
  if (values.name) await user.type(screen.getByLabelText('Ad'), values.name)
  if (values.surname) await user.type(screen.getByLabelText('Soyad'), values.surname)
  if (values.email) await user.type(screen.getByLabelText('Email'), values.email)
  if (values.role) await user.selectOptions(screen.getByLabelText('Rol'), values.role)
  if (values.department) await user.selectOptions(screen.getByLabelText('Departman'), values.department)
}

describe('AdminUsers page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    // sonner's toast queue is module-level and outlives an unmount.
    toast.dismiss()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    toast.dismiss()
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

    // The Rol select has its own "Seçiniz" placeholder too, so scope to Departman.
    const departmentSelect = screen.getByLabelText('Departman')
    expect(within(departmentSelect).getByRole('option', { name: 'HR' })).toBeInTheDocument()
    expect(within(departmentSelect).getByRole('option', { name: 'IT' })).toBeInTheDocument()
    expect(within(departmentSelect).getByRole('option', { name: 'Seçiniz' })).toBeInTheDocument()

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

    await fillCreateForm(user, {
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni.yetkili@example.com',
      role: 'DEPARTMENT_AUTHORITY',
      department: 'dept-2',
    })

    const createdRow = makeUserRow({
      id: 'user-2',
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni.yetkili@example.com',
      role: 'DEPARTMENT_AUTHORITY',
      department_id: 'dept-2',
      department_name: 'IT',
    })
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, {
        id: 'user-2',
        name: 'Yeni',
        surname: 'Yetkili',
        email: 'yeni.yetkili@example.com',
        role: 'DEPARTMENT_AUTHORITY',
        department_id: 'dept-2',
        temporary_password: TEMP_PASSWORD,
      }),
    )
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
      role: 'DEPARTMENT_AUTHORITY',
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
    expect(screen.getByLabelText('Rol')).toHaveValue('')
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

    await fillCreateForm(user, {
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'dup@example.com',
      role: 'EMPLOYEE',
      department: 'dept-1',
    })

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

    await fillCreateForm(user, {
      surname: 'Yetkili',
      email: 'yeni@example.com',
      role: 'EMPLOYEE',
      department: 'dept-1',
    })

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    expect(await screen.findByText('Ad zorunlu')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2) // only the initial GET departments + GET users
  })

  // Client-side zod validation: no role chosen blocks submission (the backend
  // would reject it too, but the form never sends it).
  it('shows a field-level error when no role is chosen and does not call POST /api/users', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    await screen.findByLabelText('Departman')

    await fillCreateForm(user, {
      name: 'Yeni',
      surname: 'Yetkili',
      email: 'yeni@example.com',
      department: 'dept-1',
    })

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    expect(await screen.findByText('Rol seçilmeli')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // AC1 / AC2 (frontend half): the admin picks between exactly the two
  // provisionable roles and never types a password.
  it('offers exactly Seçiniz / Çalışan / Departman Yetkilisi as roles and has no password input', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    const { container } = renderAdminUsers()

    const roleSelect = await screen.findByLabelText('Rol')
    const options = within(roleSelect).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.textContent)).toEqual(['Seçiniz', 'Çalışan', 'Departman Yetkilisi'])
    expect(options.map((o) => o.value)).toEqual(['', 'EMPLOYEE', 'DEPARTMENT_AUTHORITY'])

    expect(screen.getByText('Yeni Kullanıcı')).toBeInTheDocument()
    expect(screen.queryByLabelText('Şifre')).not.toBeInTheDocument()
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  // AC1: a successful create shows the one-time temporary password in a dialog;
  // "Tamam" closes it and the password is gone from the page.
  it('shows the returned temporary password in a dialog after create, and Tamam removes it', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderAdminUsers()

    await screen.findByLabelText('Departman')
    await fillCreateForm(user, {
      name: 'Yeni',
      surname: 'Calisan',
      email: 'yeni.calisan@example.com',
      role: 'EMPLOYEE',
      department: 'dept-1',
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, {
        id: 'user-3',
        name: 'Yeni',
        surname: 'Calisan',
        email: 'yeni.calisan@example.com',
        role: 'EMPLOYEE',
        department_id: 'dept-1',
        temporary_password: TEMP_PASSWORD,
      }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeUserRow({ id: 'user-3' })]))

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    const dialog = await screen.findByRole('dialog')
    const postBody = JSON.parse(vi.mocked(fetch).mock.calls[2][1]?.body as string)
    expect(postBody).toMatchObject({ role: 'EMPLOYEE' })
    expect(postBody).not.toHaveProperty('password')

    expect(within(dialog).getByText('Geçici Şifre')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Bu şifre bir daha gösterilmeyecek. Kullanıcıya iletin; ilk girişinde şifresini değiştirmesi istenecek.',
      ),
    ).toBeInTheDocument()
    const code = within(dialog).getByText(TEMP_PASSWORD)
    expect(code.tagName).toBe('CODE')

    await user.click(within(dialog).getByRole('button', { name: 'Tamam' }))

    await waitFor(() => expect(screen.queryByText(TEMP_PASSWORD)).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // AC1: "Kopyala" copies the password to the clipboard and confirms with a toast.
  it('copies the temporary password with Kopyala and shows "Şifre kopyalandı"', async () => {
    const user = userEvent.setup()
    // Spy AFTER userEvent.setup(): it installs its own clipboard stub on navigator.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra' })]))

    renderAdminUsers()

    const row = (await screen.findByText('Taha Bugra')).closest('tr') as HTMLElement
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { temporary_password: TEMP_PASSWORD }))
    await user.click(within(row).getByRole('button', { name: 'Şifre Sıfırla' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Kopyala' }))

    expect(writeText).toHaveBeenCalledWith(TEMP_PASSWORD)
    expect(await screen.findByText('Şifre kopyalandı')).toBeInTheDocument()
  })

  // AC5 / AC6 (frontend half): "Şifre Sıfırla" appears only for an active,
  // non-ADMIN, password-holding user other than the current admin.
  it('renders "Şifre Sıfırla" only for active non-ADMIN users with a password who are not the current user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [
        makeUserRow({ id: 'user-emp', name: 'Emp', surname: 'Active', role: 'EMPLOYEE' }),
        makeUserRow({ id: 'user-da', name: 'Da', surname: 'Active', role: 'DEPARTMENT_AUTHORITY' }),
        makeUserRow({ id: 'admin-2', name: 'Other', surname: 'Admin', role: 'ADMIN' }),
        // The current user's own row. Its role is deliberately NOT ADMIN, so only
        // the "not the current user" condition can be what hides the button.
        makeUserRow({ id: adminUser.id, name: 'Self', surname: 'Row', role: 'EMPLOYEE' }),
        makeUserRow({ id: 'user-inactive', name: 'Inactive', surname: 'User', is_active: false }),
        makeUserRow({ id: 'user-google', name: 'Google', surname: 'Only', has_password: false }),
      ]),
    )

    renderAdminUsers()

    const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr') as HTMLElement
    const resetIn = async (text: string) => within(await rowOf(text)).queryByRole('button', { name: 'Şifre Sıfırla' })

    expect(await resetIn('Emp Active')).toBeInTheDocument()
    expect(await resetIn('Da Active')).toBeInTheDocument()
    expect(await resetIn('Other Admin')).not.toBeInTheDocument()
    expect(await resetIn('Self Row')).not.toBeInTheDocument()
    expect(await resetIn('Inactive User')).not.toBeInTheDocument()
    expect(await resetIn('Google Only')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Şifre Sıfırla' })).toHaveLength(2)
  })

  // AC6: clicking "Şifre Sıfırla" POSTs the reset and shows the new temp password.
  it('POSTs /api/users/:id/reset-password on "Şifre Sıfırla" and opens the dialog with the returned password', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra' })]))

    renderAdminUsers()

    const row = (await screen.findByText('Taha Bugra')).closest('tr') as HTMLElement
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { temporary_password: 'ZyXwVuTs9876' }))
    await user.click(within(row).getByRole('button', { name: 'Şifre Sıfırla' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const [resetUrl, resetOptions] = vi.mocked(fetch).mock.calls[2]
    expect(String(resetUrl)).toMatch(/\/api\/users\/user-1\/reset-password$/)
    expect(resetOptions?.method).toBe('POST')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Geçici Şifre')).toBeInTheDocument()
    expect(within(dialog).getByText('ZyXwVuTs9876').tagName).toBe('CODE')
  })

  // A failed reset surfaces the backend's message as a toast and opens no dialog.
  it('shows the backend error message as a toast when a reset fails', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, fakeDepartments))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeUserRow({ id: 'user-1', name: 'Taha', surname: 'Bugra' })]))

    renderAdminUsers()

    const row = (await screen.findByText('Taha Bugra')).closest('tr') as HTMLElement
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(400, 'Pasif kullanıcının şifresi sıfırlanamaz'))
    await user.click(within(row).getByRole('button', { name: 'Şifre Sıfırla' }))

    expect(await screen.findByText('Pasif kullanıcının şifresi sıfırlanamaz')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
