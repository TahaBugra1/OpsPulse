import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CompleteProfile from './CompleteProfile'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import type { Department } from '@/lib/departments'
import type { UserProfile } from '@/lib/users'

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

const departments: Department[] = [
  { id: 'dept-finance', name: 'Finance', is_active: true },
  { id: 'dept-hr', name: 'HR', is_active: true },
  { id: 'dept-it', name: 'IT', is_active: true },
]

// What a first-time Google account looks like: EMPLOYEE, department_id null.
const googleUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@gmail.com',
  role: 'EMPLOYEE',
  department_id: null,
}

const completedProfile: UserProfile = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@gmail.com',
  role: 'EMPLOYEE',
  department_id: 'dept-it',
  department_name: 'IT',
  has_password: false,
}

type Responder = () => Response | Promise<Response>

function routeFetch(handlers: { departments?: Responder; complete?: Responder }) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/departments')) {
      return handlers.departments ? handlers.departments() : jsonResponse(200, departments)
    }
    if (url.includes('/api/users/me/department')) {
      if (!handlers.complete) throw new Error(`unexpected completion call: ${url}`)
      return handlers.complete()
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function seedSession(user: AuthUser = googleUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

// Proves updateUser() really propagates through AuthContext, which is what makes
// ProtectedRoute stop diverting the user back to the completion screen.
function AuthProbe() {
  const { user } = useAuth()
  return <div data-testid="probe-department">{String(user?.department_id)}</div>
}

function renderCompleteProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/complete-profile']}>
          <AuthProbe />
          <Routes>
            <Route path="/complete-profile" element={<CompleteProfile />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('CompleteProfile page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  // AC3 (frontend half): the forced completion screen explains itself and offers
  // exactly one choice, populated from the public department list.
  it('renders the completion prompt with a department select populated from the department list', async () => {
    seedSession()
    routeFetch({})

    renderCompleteProfile()

    expect(await screen.findByLabelText('Departman')).toBeInTheDocument()
    // The card title is a styled <div>, not a heading element.
    expect(screen.getByText('Departmanınızı Seçin')).toBeInTheDocument()
    expect(
      screen.getByText('Devam edebilmek için çalıştığınız departmanı seçmeniz gerekiyor.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Devam Et' })).toBeInTheDocument()

    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.textContent)).toEqual(['Seçiniz', 'Finance', 'HR', 'IT'])
    expect(options[0].value).toBe('')
  })

  // AC4: choosing a valid department PATCHes /api/users/me/department, updates the
  // stored user so it is no longer "incomplete", and sends the user on to /.
  it('saves the chosen department, updates the auth user, and navigates to /', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ complete: () => jsonResponse(200, completedProfile) })

    renderCompleteProfile()
    await screen.findByLabelText('Departman')
    expect(screen.getByTestId('probe-department')).toHaveTextContent('null')

    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-it')
    await user.click(screen.getByRole('button', { name: 'Devam Et' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    const patchCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/api/users/me/department'),
    )
    expect(patchCall).toBeDefined()
    expect(patchCall?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ department_id: 'dept-it' })

    // AC5: the in-memory user is no longer departmentless, so ProtectedRoute
    // will stop diverting here on the next render.
    expect(screen.getByTestId('probe-department')).toHaveTextContent('dept-it')
    const stored = JSON.parse(String(sessionStorage.getItem('opspulse_user')))
    expect(stored.department_id).toBe('dept-it')
    expect(stored.role).toBe('EMPLOYEE')
  })

  // AC4: nothing chosen -> client-side validation blocks, no PATCH is sent.
  it('blocks submission and shows a validation error when no department is chosen', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({})

    renderCompleteProfile()
    await screen.findByLabelText('Departman')
    await user.click(screen.getByRole('button', { name: 'Devam Et' }))

    expect(await screen.findByText('Departman seçilmeli')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/users/me/department')),
    ).toBe(false)
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  // AC6 (frontend half): zero active departments -> a clear controlled message
  // and NO form at all, so the user is never asked to pick from nothing.
  it('shows the blocked message and renders no form when the department list is empty', async () => {
    seedSession()
    routeFetch({ departments: () => jsonResponse(200, []) })

    renderCompleteProfile()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Aktif departman bulunmadığı için devam edilemiyor. Lütfen yöneticinizle iletişime geçin.',
    )
    expect(screen.queryByRole('button', { name: 'Devam Et' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Departman')).not.toBeInTheDocument()
  })

  // Loading state.
  it('shows the loading state while the department list is pending', async () => {
    seedSession()
    routeFetch({ departments: () => new Promise<Response>(() => {}) })

    renderCompleteProfile()

    expect(await screen.findByText('Yükleniyor...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Devam Et' })).not.toBeInTheDocument()
  })

  // Error state with a working "Tekrar Dene" retry.
  it('shows an alert with a Tekrar Dene retry when the department list fails, and recovers on retry', async () => {
    const user = userEvent.setup()
    seedSession()
    let failNext = true
    routeFetch({
      departments: () =>
        failNext
          ? jsonResponse(500, { message: 'Departmanlar getirilemedi, lütfen tekrar deneyin' })
          : jsonResponse(200, departments),
    })

    renderCompleteProfile()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Departmanlar getirilemedi, lütfen tekrar deneyin',
    )
    expect(screen.queryByRole('button', { name: 'Devam Et' })).not.toBeInTheDocument()

    failNext = false
    await user.click(screen.getByRole('button', { name: 'Tekrar Dene' }))

    expect(await screen.findByLabelText('Departman')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Devam Et' })).toBeInTheDocument()
  })

  // AC6: a rejected save surfaces the backend's controlled message inline and
  // keeps the user on the completion screen - it never navigates on failure.
  it('shows the server message when the save is rejected and stays on the completion screen', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ complete: () => jsonResponse(400, { message: 'Geçersiz departman' }) })

    renderCompleteProfile()
    await screen.findByLabelText('Departman')
    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-it')
    await user.click(screen.getByRole('button', { name: 'Devam Et' }))

    expect(await screen.findByText('Geçersiz departman')).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
    expect(screen.getByTestId('probe-department')).toHaveTextContent('null')
    expect(JSON.parse(String(sessionStorage.getItem('opspulse_user'))).department_id).toBeNull()
  })
})
