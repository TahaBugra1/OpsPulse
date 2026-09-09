import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Requests from './Requests'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
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

function renderRequests(user: AuthUser = fakeUser) {
  seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/requests']}>
          <Routes>
            <Route path="/requests" element={<Requests />} />
            <Route path="/requests/:id" element={<DetailProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
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

  // AC10: page title is role-aware
  it('shows "Taleplerim" as the title for an EMPLOYEE user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'EMPLOYEE' })
    await waitFor(() => expect(screen.getByText('Taleplerim')).toBeInTheDocument())
  })

  it('shows "Departman Talepleri" as the title for a DEPARTMENT_AUTHORITY user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })
    await waitFor(() => expect(screen.getByText('Departman Talepleri')).toBeInTheDocument())
  })

  it('shows "Tüm Talepler" as the title for an ADMIN user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'ADMIN' })
    await waitFor(() => expect(screen.getByText('Tüm Talepler')).toBeInTheDocument())
  })

  // Round-2 structure: the title is a real <h1> above the card, not a CardTitle div inside it
  it('renders the page title as a real heading element', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'EMPLOYEE' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Taleplerim' })).toBeInTheDocument(),
    )
  })

  // AC1: EMPLOYEE (and DEPARTMENT_AUTHORITY) users see a "Yeni Talep" button
  it('shows a "Yeni Talep" button for an EMPLOYEE user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'EMPLOYEE' })
    await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Yeni Talep' })).toBeInTheDocument()
  })

  // AC1: ADMIN users never create requests, so no "Yeni Talep" button for them
  it('does not show a "Yeni Talep" button for an ADMIN user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'ADMIN' })
    await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Yeni Talep' })).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // SLA column — sla-visibility task
  // ---------------------------------------------------------------------

  // getSlaDisplay() reads Date.now(), so these rows are built as offsets from
  // a frozen NOW instead of makeRequest()'s literal default deadline, whose
  // label would otherwise change every day real time advances. The clock is
  // faked (and restored) inside this describe only, so every test above keeps
  // running on real timers; shouldAdvanceTime keeps waitFor working on the
  // faked clock, so each offset is kept well clear of a unit boundary.
  describe('SLA column', () => {
    const NOW = new Date('2026-09-10T12:00:00.000Z')
    const MINUTE = 60_000
    const HOUR = 60 * MINUTE

    function fromNow(offsetMs: number) {
      return new Date(NOW.getTime() + offsetMs).toISOString()
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(NOW)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    // AC6/AC9: the SLA column sits right after Öncelik, and no pre-existing
    // column was dropped or displaced to make room for it.
    it('renders an SLA column header between Öncelik and Departman', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
        'No',
        'Başlık',
        'Durum',
        'Öncelik',
        'SLA',
        'Departman',
        'Oluşturulma Tarihi',
      ])
    })

    // AC1/AC2/AC3/AC9: one row per outcome — remaining time, overdue time and
    // the "-" of a terminal status — plus the untouched "Gecikmiş" badge.
    it('shows remaining time, overdue time and "-" in each row SLA cell', async () => {
      const requests = [
        makeRequest({
          id: 'uuid-active',
          request_number: 1,
          title: 'Aktif Talep',
          status: 'OPEN',
          is_overdue: false,
          created_at: fromNow(-30 * MINUTE),
          sla_due_at: fromNow(3 * HOUR + 30 * MINUTE),
        }),
        makeRequest({
          id: 'uuid-overdue',
          request_number: 2,
          title: 'Geciken Talep',
          status: 'ASSIGNED',
          is_overdue: true,
          created_at: fromNow(-10 * HOUR),
          sla_due_at: fromNow(-6 * HOUR - 30 * MINUTE),
        }),
        makeRequest({
          id: 'uuid-done',
          request_number: 3,
          title: 'Biten Talep',
          status: 'COMPLETED',
          is_overdue: false,
          created_at: fromNow(-30 * MINUTE),
          sla_due_at: fromNow(3 * HOUR + 30 * MINUTE),
        }),
      ]
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, requests))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      const activeRow = screen.getByText('Aktif Talep').closest('tr') as HTMLElement
      const overdueRow = screen.getByText('Geciken Talep').closest('tr') as HTMLElement
      const doneRow = screen.getByText('Biten Talep').closest('tr') as HTMLElement

      expect(within(activeRow).getByText('3 saat kaldı')).toHaveClass('text-muted-foreground')
      expect(within(overdueRow).getByText('6 saat gecikti')).toHaveClass('text-destructive')
      expect(within(doneRow).getByText('-')).toBeInTheDocument()
      expect(within(doneRow).queryByText(/kaldı|gecikti/)).not.toBeInTheDocument()

      // AC9: the SLA cell is purely additive — the overdue badge still renders
      // for the overdue row and still stays off the others.
      expect(within(overdueRow).getByText('Gecikmiş')).toBeInTheDocument()
      expect(within(activeRow).queryByText('Gecikmiş')).not.toBeInTheDocument()
    })
  })
})
