import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from './Profile'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
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

function errorResponse(status: number, message: string) {
  return jsonResponse(status, { message })
}

const fakeUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: null,
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    name: 'Taha',
    surname: 'Bugra',
    email: 'taha@example.com',
    role: 'EMPLOYEE',
    department_id: null,
    department_name: null,
    has_password: true,
    ...overrides,
  }
}

function seedSession(user: AuthUser = fakeUser, storage: Storage = sessionStorage) {
  storage.setItem('opspulse_token', 'tok-123')
  storage.setItem('opspulse_user', JSON.stringify(user))
}

// AC4: proves updateUser() actually propagates through AuthContext to other
// consumers, without remounting anything.
function AuthProbe() {
  const { user } = useAuth()
  return <div data-testid="probe-name">{user?.name}</div>
}

function renderProfile(user: AuthUser = fakeUser, storage: Storage = sessionStorage) {
  seedSession(user, storage)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <AuthProbe />
          <Profile />
        </MemoryRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('Profile page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    // sonner keeps its toast queue in a module-level store that outlives a
    // component unmount, so a toast raised by one test would otherwise still
    // be present when the next test's <Toaster/> mounts.
    toast.dismiss()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    toast.dismiss()
  })

  // AC2: on render, GET /api/users/me is called; once resolved, the form's Ad/Soyad
  // inputs show the fetched values, and Email/Rol/Departman render read-only as plain text
  it('fetches the profile and renders editable name/surname plus read-only email/role/department', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, makeProfile({ department_name: 'IT' })),
    )

    renderProfile()

    const nameInput = await screen.findByLabelText('Ad')
    expect(nameInput).toHaveValue('Taha')
    expect(screen.getByLabelText('Soyad')).toHaveValue('Bugra')

    expect(screen.getByText('taha@example.com')).toBeInTheDocument()
    expect(screen.getByText('Çalışan')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()

    // read-only fields must not be editable inputs
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rol')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Departman')).not.toBeInTheDocument()

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/users/me')
    expect(options?.method).toBe('GET')
  })

  // AC2 edge case: department_name: null renders as '—'
  it('renders "—" for department when department_name is null', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ department_name: null })))

    renderProfile()

    await screen.findByLabelText('Ad')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  // AC3: submitting a valid name/surname calls PATCH /api/users/me with the right body,
  // and a success toast appears
  it('submits valid changes via PATCH and shows a success toast', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile()

    const nameInput = await screen.findByLabelText('Ad')
    await user.clear(nameInput)
    await user.type(nameInput, 'Yeni Ad')

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, makeProfile({ name: 'Yeni Ad' })),
    )
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const [url, options] = vi.mocked(fetch).mock.calls[1]
    expect(String(url)).toContain('/api/users/me')
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(options?.body as string)).toEqual({ name: 'Yeni Ad', surname: 'Bugra' })

    expect(await screen.findByText('Profiliniz güncellendi')).toBeInTheDocument()
  })

  // AC4: after a successful save, another useAuth() consumer reflects the new name
  // immediately, without remounting
  it('propagates the updated name through AuthContext to other consumers', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile()

    expect(await screen.findByTestId('probe-name')).toHaveTextContent('Taha')

    const nameInput = await screen.findByLabelText('Ad')
    await user.clear(nameInput)
    await user.type(nameInput, 'Güncel Ad')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ name: 'Güncel Ad' })))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(screen.getByTestId('probe-name')).toHaveTextContent('Güncel Ad'))
  })

  // AC5: after a successful save, sessionStorage's stored user contains the new name
  it('persists the updated name into sessionStorage after a successful save', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile(fakeUser, sessionStorage)

    const nameInput = await screen.findByLabelText('Ad')
    await user.clear(nameInput)
    await user.type(nameInput, 'Depolanan Ad')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ name: 'Depolanan Ad' })))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem('opspulse_user') ?? '{}')
      expect(stored.name).toBe('Depolanan Ad')
    })
  })

  // AC5: a rememberMe-style session seeded into localStorage stays in localStorage after update
  it('preserves localStorage (not sessionStorage) as the storage target when the session was seeded there', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile(fakeUser, localStorage)

    const nameInput = await screen.findByLabelText('Ad')
    await user.clear(nameInput)
    await user.type(nameInput, 'Local Ad')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ name: 'Local Ad' })))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('opspulse_user') ?? '{}')
      expect(stored.name).toBe('Local Ad')
    })
    expect(sessionStorage.getItem('opspulse_user')).toBeNull()
  })

  // AC6: submitting an empty name shows a field error and does NOT call fetch for the PATCH
  it('shows a required-field error for an empty name and does not submit', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile()

    const nameInput = await screen.findByLabelText('Ad')
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(await screen.findByText('Ad zorunlu')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1) // only the initial GET, no PATCH
  })

  // AC7: a 400/500 PATCH response shows the backend's message via role="alert" inside the
  // form (not a toast), and the input values remain what the user typed
  it('shows a backend error message inline on a failed PATCH and keeps the typed values', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile()

    const nameInput = await screen.findByLabelText('Ad')
    await user.clear(nameInput)
    await user.type(nameInput, 'Hatalı Deneme')

    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    expect(screen.queryByText('Profiliniz güncellendi')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ad')).toHaveValue('Hatalı Deneme')
  })

  // AC8: loading indicator before GET resolves; GET failure shows backend message +
  // working "Tekrar Dene" button that re-fetches
  it('shows a loading indicator before data resolves, then an error with a working retry button', async () => {
    const user = userEvent.setup()
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderProfile()

    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument()

    resolveFetch(errorResponse(500, 'Profil yüklenemedi'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Profil yüklenemedi')

    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByLabelText('Ad')).toHaveValue('Taha'))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // AC11: submitting with a blank surname sends surname: null in the PATCH body (not '')
  it('sends surname: null when the surname field is cleared', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

    renderProfile()

    const surnameInput = await screen.findByLabelText('Soyad')
    await user.clear(surnameInput)

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ surname: null })))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const [, options] = vi.mocked(fetch).mock.calls[1]
    expect(JSON.parse(options?.body as string)).toEqual({ name: 'Taha', surname: null })
  })

  describe('Şifre Değiştir card', () => {
    async function fillPasswordForm(
      user: ReturnType<typeof userEvent.setup>,
      values: { current: string; next: string; confirm: string },
    ) {
      await user.type(screen.getByLabelText('Mevcut Şifre'), values.current)
      await user.type(screen.getByLabelText('Yeni Şifre'), values.next)
      await user.type(screen.getByLabelText('Yeni Şifre (Tekrar)'), values.confirm)
    }

    // AC9: a Google-only account has no password to change - the card is not rendered at all
    it('does not render the password card when the profile has no password', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ has_password: false })))

      renderProfile()

      await screen.findByLabelText('Ad')
      expect(screen.queryByText('Şifre Değiştir')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Mevcut Şifre')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Şifreyi Değiştir' })).not.toBeInTheDocument()
    })

    // AC9: the card renders for an account that has a password
    it('renders the password card with its three fields when the profile has a password', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile({ has_password: true })))

      renderProfile()

      expect(await screen.findByText('Şifre Değiştir')).toBeInTheDocument()
      expect(screen.getByLabelText('Mevcut Şifre')).toHaveAttribute('type', 'password')
      expect(screen.getByLabelText('Yeni Şifre')).toHaveAttribute('type', 'password')
      expect(screen.getByLabelText('Yeni Şifre (Tekrar)')).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: 'Şifreyi Değiştir' })).toBeInTheDocument()
    })

    // AC7 (client side): a mismatched confirmation never reaches the backend
    it('shows "Şifreler eşleşmiyor" for a mismatched confirmation and sends no PATCH', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

      renderProfile()

      await screen.findByLabelText('Mevcut Şifre')
      await fillPasswordForm(user, { current: 'EskiSifre123', next: 'YeniSifre123', confirm: 'Farkli12345' })
      await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

      expect(await screen.findByText('Şifreler eşleşmiyor')).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledTimes(1) // only the initial GET
    })

    // AC9: a successful change PATCHes only current/new, toasts, and clears the form
    it('PATCHes exactly current_password and new_password, shows a toast and clears the fields on success', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

      renderProfile()

      await screen.findByLabelText('Mevcut Şifre')
      await fillPasswordForm(user, { current: 'EskiSifre123', next: 'YeniSifre123', confirm: 'YeniSifre123' })

      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse(200, { ...fakeUser, department_id: null, must_change_password: false }),
      )
      await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      const [url, options] = vi.mocked(fetch).mock.calls[1]
      expect(String(url)).toMatch(/\/api\/users\/me\/password$/)
      expect(options?.method).toBe('PATCH')
      expect(JSON.parse(options?.body as string)).toEqual({
        current_password: 'EskiSifre123',
        new_password: 'YeniSifre123',
      })

      expect(await screen.findByText('Şifreniz güncellendi')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByLabelText('Mevcut Şifre')).toHaveValue(''))
      expect(screen.getByLabelText('Yeni Şifre')).toHaveValue('')
      expect(screen.getByLabelText('Yeni Şifre (Tekrar)')).toHaveValue('')
    })

    // AC7: a wrong current password is a 400 shown inline, not a logout or a toast
    it('shows a 400 "Mevcut şifre hatalı" inline via role="alert"', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

      renderProfile()

      await screen.findByLabelText('Mevcut Şifre')
      await fillPasswordForm(user, { current: 'YanlisSifre1', next: 'YeniSifre123', confirm: 'YeniSifre123' })

      vi.mocked(fetch).mockResolvedValueOnce(errorResponse(400, 'Mevcut şifre hatalı'))
      await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Mevcut şifre hatalı')
      expect(screen.queryByText('Şifreniz güncellendi')).not.toBeInTheDocument()
    })

    // AC8: a rate-limited attempt shows the dedicated rate-limit message
    it('shows the rate-limit message for a 429', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeProfile()))

      renderProfile()

      await screen.findByLabelText('Mevcut Şifre')
      await fillPasswordForm(user, { current: 'EskiSifre123', next: 'YeniSifre123', confirm: 'YeniSifre123' })

      vi.mocked(fetch).mockResolvedValueOnce(errorResponse(429, 'Too many requests'))
      await user.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin.',
      )
    })
  })
})
