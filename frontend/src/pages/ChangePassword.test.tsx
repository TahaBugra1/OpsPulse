import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChangePassword from './ChangePassword'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'

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

// What an ADMIN-provisioned account looks like on first login.
const forcedUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: 'dept-it',
  must_change_password: true,
}

const changedUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: 'dept-it',
  must_change_password: false,
}

type Responder = () => Response | Promise<Response>

function routeFetch(handlers: { changePassword?: Responder }) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/users/me/password')) {
      if (!handlers.changePassword) throw new Error(`unexpected password-change call: ${url}`)
      return handlers.changePassword()
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function seedSession(user: AuthUser = forcedUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

// Proves updateUser() really propagates through AuthContext, which is what
// makes ProtectedRoute stop forcing the user back onto this screen.
function AuthProbe() {
  const { user } = useAuth()
  return <div data-testid="probe-must-change">{String(user?.must_change_password)}</div>
}

function renderChangePassword() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/change-password']}>
          <AuthProbe />
          <Routes>
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { current?: string; next?: string; confirm?: string },
) {
  if (values.current !== undefined) {
    await user.type(screen.getByLabelText('Mevcut Şifre'), values.current)
  }
  if (values.next !== undefined) {
    await user.type(screen.getByLabelText('Yeni Şifre'), values.next)
  }
  if (values.confirm !== undefined) {
    await user.type(screen.getByLabelText('Yeni Şifre (Tekrar)'), values.confirm)
  }
}

describe('ChangePassword page', () => {
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

  it('renders the forced password-change screen with all fields and no chrome', async () => {
    seedSession()
    routeFetch({})

    renderChangePassword()

    expect(screen.getByText('Şifrenizi Değiştirin')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Devam edebilmek için size verilen geçici şifreyi kendi belirleyeceğiniz yeni bir şifreyle değiştirmeniz gerekiyor.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Mevcut Şifre')).toBeInTheDocument()
    expect(screen.getByLabelText('Yeni Şifre')).toBeInTheDocument()
    expect(screen.getByLabelText('Yeni Şifre (Tekrar)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Şifreyi Değiştir' })).toBeInTheDocument()

    // No AppShell chrome (sidebar/nav) — this page renders standalone.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('shows a mismatch error when the confirm field differs from the new password, without calling the API', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({})

    renderChangePassword()
    await fillForm(user, { current: 'temp-pass-1', next: 'newpassword1', confirm: 'somethingelse' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    expect(await screen.findByText('Şifreler eşleşmiyor')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/users/me/password')),
    ).toBe(false)
  })

  it('shows a length error when the new password is under 8 characters, without calling the API', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({})

    renderChangePassword()
    await fillForm(user, { current: 'temp-pass-1', next: 'short1', confirm: 'short1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    expect(await screen.findByText('Şifre en az 8 karakter olmalı')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/users/me/password')),
    ).toBe(false)
  })

  it('shows a required error when the current password is left blank, without calling the API', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({})

    renderChangePassword()
    await fillForm(user, { next: 'newpassword1', confirm: 'newpassword1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    expect(await screen.findByText('Mevcut şifre zorunlu')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/users/me/password')),
    ).toBe(false)
  })

  it('sends exactly { current_password, new_password } on submit, without the confirm field', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ changePassword: () => jsonResponse(200, changedUser) })

    renderChangePassword()
    await fillForm(user, { current: 'temp-pass-1', next: 'newpassword1', confirm: 'newpassword1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('/api/users/me/password'))
    expect(patchCall).toBeDefined()
    expect(patchCall?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      current_password: 'temp-pass-1',
      new_password: 'newpassword1',
    })
  })

  it('updates the auth user and navigates to / on a successful change', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ changePassword: () => jsonResponse(200, changedUser) })

    renderChangePassword()
    expect(screen.getByTestId('probe-must-change')).toHaveTextContent('true')

    await fillForm(user, { current: 'temp-pass-1', next: 'newpassword1', confirm: 'newpassword1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(screen.getByTestId('probe-must-change')).toHaveTextContent('false')
    const stored = JSON.parse(String(sessionStorage.getItem('opspulse_user')))
    expect(stored.must_change_password).toBe(false)
  })

  it('shows the server message when the current password is wrong, and does not navigate', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ changePassword: () => jsonResponse(400, { message: 'Mevcut şifre hatalı' }) })

    renderChangePassword()
    await fillForm(user, { current: 'wrong-pass', next: 'newpassword1', confirm: 'newpassword1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Mevcut şifre hatalı')
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
    expect(screen.getByTestId('probe-must-change')).toHaveTextContent('true')
  })

  it('shows the Turkish rate-limit message on a 429 response, regardless of the server body', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ changePassword: () => jsonResponse(429, { message: 'Too Many Requests' }) })

    renderChangePassword()
    await fillForm(user, { current: 'temp-pass-1', next: 'newpassword1', confirm: 'newpassword1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin.')
    expect(alert).not.toHaveTextContent('Too Many Requests')
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  it('disables the submit button and all inputs while the mutation is pending', async () => {
    const user = userEvent.setup()
    seedSession()
    routeFetch({ changePassword: () => new Promise<Response>(() => {}) })

    renderChangePassword()
    await fillForm(user, { current: 'temp-pass-1', next: 'newpassword1', confirm: 'newpassword1' })
    await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Şifreyi Değiştir' })).toBeDisabled())
    expect(screen.getByLabelText('Mevcut Şifre')).toBeDisabled()
    expect(screen.getByLabelText('Yeni Şifre')).toBeDisabled()
    expect(screen.getByLabelText('Yeni Şifre (Tekrar)')).toBeDisabled()
  })
})
