import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewRequest from './NewRequest'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import { useRequests, type RequestType } from '@/lib/requests'

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

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

function makeRequestType(overrides: Partial<RequestType> = {}): RequestType {
  return {
    id: 'type-1',
    name: 'Donanım Arızası',
    department_id: 'dept-1',
    ...overrides,
  }
}

const fakeUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: null,
}

function seedSession(user: AuthUser = fakeUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

function renderNewRequest(user: AuthUser = fakeUser, extraChildren?: ReactNode, queryClient?: QueryClient) {
  seedSession(user)
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/requests/new']}>
          {extraChildren}
          <NewRequest />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...result, queryClient: client }
}

describe('NewRequest page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: form renders with Başlık/Açıklama/Talep Tipi/Öncelik, priority defaulting to Orta (MEDIUM)
  it('renders the form with all 4 fields once request types have loaded, priority defaulting to Orta', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequestType()]))

    renderNewRequest()

    expect(await screen.findByLabelText('Başlık')).toHaveValue('')
    expect(screen.getByLabelText('Açıklama')).toHaveValue('')
    expect(screen.getByLabelText('Talep Tipi')).toHaveValue('')
    expect(screen.getByLabelText('Öncelik')).toHaveValue('MEDIUM')
    expect(screen.getByRole('option', { name: 'Orta', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Oluştur' })).toBeInTheDocument()
  })

  // AC2: GET /api/request-types is called on mount, dropdown fills with the returned types
  it('calls GET /api/request-types on mount and fills the dropdown with the returned types', async () => {
    const types = [
      makeRequestType({ id: 'type-1', name: 'Donanım Arızası' }),
      makeRequestType({ id: 'type-2', name: 'Yazılım Sorunu' }),
    ]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, types))

    renderNewRequest()

    await screen.findByLabelText('Başlık')

    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/request-types')
    expect(options?.method).toBe('GET')

    expect(screen.getByRole('option', { name: 'Donanım Arızası' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Yazılım Sorunu' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Seçiniz' })).toBeInTheDocument()
  })

  // AC3: valid submit calls POST /api/requests with the right body, then navigates to /requests/:id
  // using the real id from the response
  it('submits valid input via POST and navigates to /requests/:id using the real id', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequestType()]))

    renderNewRequest()

    await user.type(await screen.findByLabelText('Başlık'), 'Yazıcı bozuldu')
    await user.type(screen.getByLabelText('Açıklama'), 'Ofis yazıcısı çalışmıyor')
    await user.selectOptions(screen.getByLabelText('Talep Tipi'), 'type-1')

    const created = { id: 'real-uuid-created', request_number: 55 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, created))

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const [url, options] = vi.mocked(fetch).mock.calls[1]
    expect(String(url)).toContain('/api/requests')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(options?.body as string)).toEqual({
      title: 'Yazıcı bozuldu',
      description: 'Ofis yazıcısı çalışmıyor',
      request_type_id: 'type-1',
      priority: 'MEDIUM',
    })

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/requests/real-uuid-created'))
  })

  // AC4: invalid input blocks submit and shows zod field errors, with no POST call made
  it('blocks submit and shows field errors for empty title/description/request type, without calling POST', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequestType()]))

    renderNewRequest()
    await screen.findByLabelText('Başlık')

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    expect(await screen.findByText('Başlık en az 3 karakter olmalı')).toBeInTheDocument()
    expect(screen.getByText('Açıklama zorunlu')).toBeInTheDocument()
    expect(screen.getByText('Talep türü seçilmeli')).toBeInTheDocument()

    // only the initial GET /api/request-types call, no POST
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  // AC5: a 400/500 POST response shows the backend's message via role="alert" inside the form,
  // keeps the typed values, and shows no success/toast message
  it('shows a backend error message inline on a failed POST and keeps the typed values', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequestType()]))

    renderNewRequest()

    await user.type(await screen.findByLabelText('Başlık'), 'Klavye arızalı')
    await user.type(screen.getByLabelText('Açıklama'), 'Tuşlar çalışmıyor')
    await user.selectOptions(screen.getByLabelText('Talep Tipi'), 'type-1')

    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))
    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    expect(screen.getByLabelText('Başlık')).toHaveValue('Klavye arızalı')
    expect(screen.getByLabelText('Açıklama')).toHaveValue('Tuşlar çalışmıyor')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  // AC6: loading indicator shown before GET /api/request-types resolves; the form is not
  // rendered during loading
  it('shows a loading indicator before request types resolve, and does not render the form', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderNewRequest()

    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument()
    expect(screen.queryByLabelText('Başlık')).not.toBeInTheDocument()

    resolveFetch(jsonResponse(200, [makeRequestType()]))
    await screen.findByLabelText('Başlık')
  })

  // AC6: GET /api/request-types failure shows the backend message + a working "Tekrar Dene"
  // button that re-fetches; the form is not rendered during the error state
  it('shows an error message and a working retry button when request types fail to load', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Talep türleri yüklenemedi'))

    renderNewRequest()

    expect(await screen.findByRole('alert')).toHaveTextContent('Talep türleri yüklenemedi')
    expect(screen.queryByLabelText('Başlık')).not.toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequestType()]))
    await user.click(retryButton)

    await screen.findByLabelText('Başlık')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // AC9: after a successful creation, the /requests list's TanStack Query cache is invalidated,
  // triggering a refetch for an active ['requests'] observer
  it('invalidates the requests list query cache after a successful creation', async () => {
    const user = userEvent.setup()

    function RequestsProbe() {
      useRequests()
      return null
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    // 1) probe's GET /api/requests, 2) NewRequest's GET /api/request-types
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequestType()]))

    renderNewRequest(fakeUser, <RequestsProbe />, queryClient)

    await screen.findByLabelText('Başlık')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    await user.type(screen.getByLabelText('Başlık'), 'Monitör arızalı')
    await user.type(screen.getByLabelText('Açıklama'), 'Ekran açılmıyor')
    await user.selectOptions(screen.getByLabelText('Talep Tipi'), 'type-1')

    const created = { id: 'created-id', request_number: 7 }
    // 3) POST /api/requests, 4) refetch of GET /api/requests triggered by invalidation
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, created))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [created]))

    await user.click(screen.getByRole('button', { name: 'Oluştur' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    const [url, options] = vi.mocked(fetch).mock.calls[3]
    expect(String(url)).toContain('/api/requests')
    expect(options?.method).toBe('GET')
  })
})
