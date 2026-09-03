import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import Login from '@/pages/Login'

vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  GoogleLogin: ({
    onSuccess,
    onError,
  }: {
    onSuccess: (res: { credential: string }) => void
    onError?: () => void
  }) => (
    <div>
      <button type="button" onClick={() => onSuccess({ credential: 'fake-google-credential' })}>
        MockGoogleSuccess
      </button>
      <button type="button" onClick={() => onError && onError()}>
        MockGoogleError
      </button>
    </div>
  ),
}))

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
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

function nonJsonResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null,
    },
    json: async () => null,
  } as unknown as Response
}

const fakeUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE' as const,
  department_id: null,
}

describe('Login page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC 1: valid email/password login -> redirect to "/" and session persisted
  it('logs in successfully with valid credentials, redirects to home, and stores the session', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { token: 'tok-123', user: fakeUser }),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/auth/login')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({
      email: 'taha@example.com',
      password: 'secret123',
      rememberMe: false,
    })
  })

  // AC 2: 401 -> inline error shown, no redirect
  it('shows an inline error on 401 and does not navigate away', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(401, { message: 'Email veya şifre hatalı' }),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'wrongpass')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    expect(await screen.findByText('Email veya şifre hatalı')).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  // AC 3: 429 -> hardcoded Turkish rate-limit message, not the raw backend body
  it('shows the hardcoded rate-limit message on 429, ignoring the raw response body', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(nonJsonResponse(429))

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    expect(
      await screen.findByText('Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin.'),
    ).toBeInTheDocument()
  })

  // AC 4: Google login success -> same login+redirect flow
  it('logs in via Google success callback and redirects to home', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { token: 'tok-google', user: fakeUser }),
    )

    renderLogin()

    await user.click(screen.getByRole('button', { name: 'MockGoogleSuccess' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/auth/google')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({
      id_token: 'fake-google-credential',
      rememberMe: false,
    })
  })

  // AC 5: Google backend rejection -> inline error, no redirect
  it('shows an inline error when the backend rejects the Google login', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(401, { message: 'Google hesabı doğrulanamadı' }),
    )

    renderLogin()

    await user.click(screen.getByRole('button', { name: 'MockGoogleSuccess' }))

    expect(await screen.findByText('Google hesabı doğrulanamadı')).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  // AC 6: Google SDK onError -> hardcoded message
  it('shows the hardcoded message when the Google SDK itself errors', async () => {
    const user = userEvent.setup()

    renderLogin()

    await user.click(screen.getByRole('button', { name: 'MockGoogleError' }))

    expect(
      await screen.findByText('Google ile giriş başarısız oldu, lütfen tekrar deneyin.'),
    ).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  // AC 7: network error -> generic message, no crash
  it('shows a generic connection error on network failure without crashing', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    expect(
      await screen.findByText('Sunucuya bağlanılamadı, lütfen tekrar deneyin.'),
    ).toBeInTheDocument()
    // component still rendered, no crash
    expect(screen.getByRole('button', { name: 'Giriş Yap' })).toBeInTheDocument()
  })

  // AC 8: empty submit -> client-side validation blocks, no network request
  it('blocks submission with client-side validation errors when fields are empty', async () => {
    const user = userEvent.setup()

    renderLogin()

    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    expect(await screen.findByText('Geçerli bir email adresi girin')).toBeInTheDocument()
    expect(await screen.findByText('Şifre zorunlu')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  // AC 9: invalid email format -> zod message, no network request
  it('shows an email-format validation error for an invalid email and does not call the network', async () => {
    const user = userEvent.setup()

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    expect(await screen.findByText('Geçerli bir email adresi girin')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  // AC 10: rememberMe=false (default) -> sessionStorage populated, localStorage untouched
  it('stores the session in sessionStorage only when rememberMe is left unchecked', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { token: 'tok-session', user: fakeUser }),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    expect(sessionStorage.getItem('opspulse_token')).toBe('tok-session')
    expect(localStorage.getItem('opspulse_token')).toBeNull()
  })

  // AC 11: rememberMe=true -> localStorage populated, sessionStorage untouched
  it('stores the session in localStorage only when rememberMe is checked', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { token: 'tok-local', user: fakeUser }),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('checkbox', { name: 'Beni hatırla' }))
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    expect(localStorage.getItem('opspulse_token')).toBe('tok-local')
    expect(sessionStorage.getItem('opspulse_token')).toBeNull()
  })

  // AC 12: while a request is in flight, submit button and inputs are disabled
  it('disables the submit button and inputs while a login request is in flight', async () => {
    const user = userEvent.setup()
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'taha@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    expect(screen.getByRole('button', { name: 'Giriş Yap' })).toBeDisabled()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(screen.getByLabelText('Şifre')).toBeDisabled()

    resolveFetch(jsonResponse(200, { token: 'tok', user: fakeUser }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })
})
