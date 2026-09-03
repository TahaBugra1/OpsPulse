import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Requests from './Requests'
import type { RequestListItem } from '@/lib/requests'

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

function makeRequest(overrides: Partial<RequestListItem> = {}): RequestListItem {
  return {
    id: 'uuid-1111-2222',
    request_number: 42,
    title: 'Yazıcı bozuldu',
    description: 'Ofis yazıcısı çalışmıyor',
    request_type_id: 'type-1',
    department_id: 'dept-1',
    created_by: 'user-1',
    assigned_to: null,
    priority: 'HIGH',
    status: 'OPEN',
    sla_due_at: '2026-09-04T00:00:00.000Z',
    created_at: '2026-09-03T10:00:00.000Z',
    updated_at: '2026-09-03T10:00:00.000Z',
    is_overdue: false,
    request_type_name: 'Donanım Arızası',
    department_name: 'IT',
    created_by_name: 'Taha',
    assigned_to_name: null,
    ...overrides,
  }
}

function DetailProbe() {
  const { id } = useParams<{ id: string }>()
  return <div>DETAIL PAGE for id={id}</div>
}

function renderRequests() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/requests']}>
        <Routes>
          <Route path="/requests" element={<Requests />} />
          <Route path="/requests/:id" element={<DetailProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Requests page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC7: loading state shown before data/error/empty resolves
  it('shows a loading indicator before data resolves', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderRequests()

    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument()
    expect(screen.queryByText('Henüz talep yok')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    resolveFetch(jsonResponse(200, []))
    await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
  })

  // AC1: populated list renders correct columns/values
  it('renders the table with correct columns and values for a populated list', async () => {
    const requests = [
      makeRequest({
        id: 'uuid-a',
        request_number: 7,
        title: 'Klavye arızalı',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        department_name: 'IT',
        created_at: '2026-09-01T08:30:00.000Z',
      }),
    ]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, requests))

    renderRequests()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    expect(screen.getByText('#7')).toBeInTheDocument()
    expect(screen.getByText('Klavye arızalı')).toBeInTheDocument()
    expect(screen.getByText('İşlemde')).toBeInTheDocument()
    expect(screen.getByText('Orta')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText(new Date('2026-09-01T08:30:00.000Z').toLocaleString('tr-TR'))).toBeInTheDocument()
  })

  // AC2: empty list -> friendly message, not an empty table
  it('renders "Henüz talep yok" for an empty list, not an empty table', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderRequests()

    await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // AC5: fetch failure -> error message + retry button; clicking retry re-fetches
  it('renders an error message and a working retry button on fetch failure', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))

    renderRequests()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    expect(retryButton).toBeInTheDocument()

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // AC3: clicking a row navigates using request.id, never request_number
  it('navigates to /requests/:id using the real UUID id, not request_number, when a row is clicked', async () => {
    const user = userEvent.setup()
    const requests = [makeRequest({ id: 'real-uuid-9999', request_number: 42 })]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, requests))

    renderRequests()

    const row = await screen.findByText('#42')
    await user.click(row)

    await waitFor(() =>
      expect(screen.getByText('DETAIL PAGE for id=real-uuid-9999')).toBeInTheDocument(),
    )
  })

  // AC8: "Gecikmiş" badge shown only for overdue rows
  it('shows the "Gecikmiş" badge only for rows where is_overdue is true', async () => {
    const requests = [
      makeRequest({ id: 'uuid-overdue', request_number: 1, title: 'Overdue Request', is_overdue: true }),
      makeRequest({ id: 'uuid-ontime', request_number: 2, title: 'On Time Request', is_overdue: false }),
    ]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, requests))

    renderRequests()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const overdueRow = screen.getByText('Overdue Request').closest('tr')
    const onTimeRow = screen.getByText('On Time Request').closest('tr')
    expect(overdueRow).not.toBeNull()
    expect(onTimeRow).not.toBeNull()

    expect(within(overdueRow as HTMLElement).getByText('Gecikmiş')).toBeInTheDocument()
    expect(within(onTimeRow as HTMLElement).queryByText('Gecikmiş')).not.toBeInTheDocument()
  })
})
