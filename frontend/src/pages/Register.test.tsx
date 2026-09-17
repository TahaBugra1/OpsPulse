import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Register from './Register'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import type { Department } from '@/lib/departments'

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
    headers: { get: () => null },
    json: async () => null,
  } as unknown as Response
}

const departments: Department[] = [
  { id: 'dept-finance', name: 'Finance', is_active: true },
  { id: 'dept-hr', name: 'HR', is_active: true },
  { id: 'dept-it', name: 'IT', is_active: true },
]

const createdUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: 'Bugra',
  email: 'taha@gmail.com',
  role: 'EMPLOYEE',
  department_id: 'dept-it',
}

type Responder = () => Response | Promise<Response>

// The page issues two different calls: the public department list on mount and
// the register POST on submit. Routing by URL keeps the tests independent of
// call ordering (react-query may refetch the list).
function routeFetch(handlers: { departments?: Responder; register?: Responder }) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/departments')) {
      return handlers.departments ? handlers.departments() : jsonResponse(200, departments)
    }
    if (url.includes('/api/auth/register')) {
      if (!handlers.register) throw new Error(`unexpected register call: ${url}`)
      return handlers.register()
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function renderRegister() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<div>HOME</div>} />
            <Route path="/login" element={<div>LOGIN FORM</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, departmentId = 'dept-it') {
  await user.type(screen.getByLabelText('Ad'), 'Taha')
  await user.type(screen.getByLabelText('Soyad'), 'Bugra')
  await user.type(screen.getByLabelText('Email'), 'taha@gmail.com')
  await user.type(screen.getByLabelText('Şifre'), 'sifre1234test')
  if (departmentId) {
    await user.selectOptions(screen.getByLabelText('Departman'), departmentId)
  }
}

describe('Register page', () => {
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

  // AC1 (frontend half): the form renders with every field, the department
  // select is populated from GET /api/auth/departments, and "Seçiniz" is first.
  it('renders the form with a department select populated from the public department list', async () => {
    routeFetch({})

    renderRegister()

    expect(await screen.findByLabelText('Departman')).toBeInTheDocument()
    // The card title is a styled <div>, not a heading element, so it is matched
    // by its slot rather than by role (the submit button shares its text).
    expect(
      screen.getByText('Kayıt Ol', { selector: '[data-slot="card-title"]' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Ad')).toBeInTheDocument()
    expect(screen.getByLabelText('Soyad')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Şifre')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kayıt Ol' })).toBeInTheDocument()

    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.textContent)).toEqual(['Seçiniz', 'Finance', 'HR', 'IT'])
    expect(options[0].value).toBe('')

    // Footer link back to login.
    expect(screen.getByRole('link', { name: 'Giriş yap' })).toHaveAttribute('href', '/login')
  })

  // The list is fetched from the PUBLIC endpoint, with no token in play.
  it('loads the department list from the public /api/auth/departments endpoint', async () => {
    routeFetch({})

    renderRegister()

    await screen.findByLabelText('Departman')

    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/auth/departments')
    expect(sessionStorage.getItem('opspulse_token')).toBeNull()
  })

  // AC1 (frontend half): a complete submit posts the whole form object -
  // department_id included - stores the session in sessionStorage and navigates home.
  it('submits the whole form including department_id, stores the session, and navigates to /', async () => {
    const user = userEvent.setup()
    routeFetch({ register: () => jsonResponse(201, { token: 'tok-123', user: createdUser }) })

    renderRegister()
    await screen.findByLabelText('Departman')
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Kayıt Ol' }))

    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())

    const registerCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/api/auth/register'),
    )
    expect(registerCall).toBeDefined()
    expect(registerCall?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(registerCall?.[1]?.body))).toEqual({
      name: 'Taha',
      surname: 'Bugra',
      email: 'taha@gmail.com',
      password: 'sifre1234test',
      department_id: 'dept-it',
    })

    // login(token, user, false) -> sessionStorage, never localStorage.
    expect(sessionStorage.getItem('opspulse_token')).toBe('tok-123')
    expect(JSON.parse(String(sessionStorage.getItem('opspulse_user'))).department_id).toBe('dept-it')
    expect(localStorage.getItem('opspulse_token')).toBeNull()
  })

  // AC2 (frontend half): no department chosen -> client-side validation blocks
  // the submit entirely, so the register endpoint is never called.
  it('blocks submission and shows a validation error when no department is chosen', async () => {
    const user = userEvent.setup()
    routeFetch({})

    renderRegister()
    await screen.findByLabelText('Departman')
    await fillForm(user, '')
    await user.click(screen.getByRole('button', { name: 'Kayıt Ol' }))

    expect(await screen.findByText('Departman seçilmeli')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/auth/register')),
    ).toBe(false)
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  // AC6 (frontend half): zero active departments -> a clear controlled message
  // and NO form at all, so nobody can submit a registration that must fail.
  it('shows the blocked message and renders no form when the department list is empty', async () => {
    routeFetch({ departments: () => jsonResponse(200, []) })

    renderRegister()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Aktif departman bulunmadığı için şu anda kayıt olunamıyor. Lütfen yöneticinizle iletişime geçin.',
    )
    expect(screen.queryByRole('button', { name: 'Kayıt Ol' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Departman')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  // Loading state: nothing but "Yükleniyor..." until the list resolves.
  it('shows the loading state while the department list is pending', async () => {
    routeFetch({ departments: () => new Promise<Response>(() => {}) })

    renderRegister()

    expect(await screen.findByText('Yükleniyor...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kayıt Ol' })).not.toBeInTheDocument()
  })

  // Error state: an alert plus a working "Tekrar Dene" retry.
  it('shows an alert with a Tekrar Dene retry when the department list fails, and recovers on retry', async () => {
    const user = userEvent.setup()
    let failNext = true
    routeFetch({
      departments: () =>
        failNext
          ? jsonResponse(500, { message: 'Departmanlar getirilemedi, lütfen tekrar deneyin' })
          : jsonResponse(200, departments),
    })

    renderRegister()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Departmanlar getirilemedi, lütfen tekrar deneyin',
    )
    expect(screen.queryByRole('button', { name: 'Kayıt Ol' })).not.toBeInTheDocument()

    failNext = false
    await user.click(screen.getByRole('button', { name: 'Tekrar Dene' }))

    expect(await screen.findByLabelText('Departman')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kayıt Ol' })).toBeInTheDocument()
  })

  // Error handling mirrors Login: 429 -> the hardcoded rate-limit message.
  it('shows the hardcoded rate-limit message on a 429 from the register endpoint', async () => {
    const user = userEvent.setup()
    routeFetch({ register: () => nonJsonResponse(429) })

    renderRegister()
    await screen.findByLabelText('Departman')
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Kayıt Ol' }))

    expect(
      await screen.findByText('Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  })

  // Any other ApiError surfaces the server's own message (e.g. the backend's
  // 400 'Geçersiz departman' or 409 'Bu email zaten kayıtlı').
  it('shows the server message for a non-429 API error and does not navigate away', async () => {
    const user = userEvent.setup()
    routeFetch({ register: () => jsonResponse(409, { message: 'Bu email zaten kayıtlı' }) })

    renderRegister()
    await screen.findByLabelText('Departman')
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Kayıt Ol' }))

    expect(await screen.findByText('Bu email zaten kayıtlı')).toBeInTheDocument()
    expect(screen.queryByText('HOME')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('opspulse_token')).toBeNull()
  })

  // A network failure is not an ApiError -> the generic connection message.
  it('shows the generic connection error on a network failure without crashing', async () => {
    const user = userEvent.setup()
    routeFetch({
      register: () => {
        throw new TypeError('Failed to fetch')
      },
    })

    renderRegister()
    await screen.findByLabelText('Departman')
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Kayıt Ol' }))

    expect(
      await screen.findByText('Sunucuya bağlanılamadı, lütfen tekrar deneyin.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kayıt Ol' })).toBeInTheDocument()
  })
})
