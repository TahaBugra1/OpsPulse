import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Requests from './Requests'
import { AuthProvider } from '@/context/AuthContext'
import { PageTitleProvider, usePageTitleValue } from '@/context/PageTitleContext'
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

// Requests.tsx now also calls useRequestTypes() (for the "Talep Tipi" filter
// dropdown), whose fetch to GET /api/request-types fires before the
// useRequests() fetch on every mount (hook call order in the component
// determines fetch order). Tests that don't care about the dropdown's
// contents queue an empty list for it via this helper, called as the FIRST
// mockResolvedValueOnce before the requests-list response.
function mockRequestTypesFetch(
  types: Array<{ id: string; name: string; department_id?: string }> = [],
) {
  vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, types))
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

// The page title now flows into PageTitleContext (set from usePageTitle in a
// useEffect) and is rendered by the AppShell header, not by the page. Isolated
// page tests render without the shell, so this probe surfaces the context value.
function TitleProbe() {
  const title = usePageTitleValue()
  return <div data-testid="page-title">{title}</div>
}

// MemoryRouter never touches window.location, so URL-sync assertions read the
// current search string off this hidden probe instead.
function RequestsWithLocationProbe() {
  const location = useLocation()
  return (
    <>
      <Requests />
      <div data-testid="url-probe">{location.search}</div>
    </>
  )
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
        <PageTitleProvider>
          <TitleProbe />
          <MemoryRouter initialEntries={['/requests']}>
            <Routes>
              <Route path="/requests" element={<RequestsWithLocationProbe />} />
              <Route path="/requests/:id" element={<DetailProbe />} />
            </Routes>
          </MemoryRouter>
        </PageTitleProvider>
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
    mockRequestTypesFetch()
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
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, requests))

    renderRequests()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    // Scoped to the table row: STATUS_LABELS/PRIORITY_LABELS values ("İşlemde",
    // "Orta") also render as <option> text in the Durum/Öncelik filter
    // dropdowns added by this task, so an unscoped screen.getByText would match
    // both the row cell and the dropdown option.
    const row = screen.getByText('Klavye arızalı').closest('tr') as HTMLElement
    expect(within(row).getByText('#7')).toBeInTheDocument()
    expect(within(row).getByText('Klavye arızalı')).toBeInTheDocument()
    expect(within(row).getByText('İşlemde')).toBeInTheDocument()
    expect(within(row).getByText('Orta')).toBeInTheDocument()
    expect(within(row).getByText('IT')).toBeInTheDocument()
    expect(
      within(row).getByText(new Date('2026-09-01T08:30:00.000Z').toLocaleString('tr-TR')),
    ).toBeInTheDocument()
  })

  // AC2: empty list -> friendly message, not an empty table
  it('renders "Henüz talep yok" for an empty list, not an empty table', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderRequests()

    await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // AC5: fetch failure -> error message + retry button; clicking retry re-fetches
  it('renders an error message and a working retry button on fetch failure', async () => {
    const user = userEvent.setup()
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))

    renderRequests()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    expect(retryButton).toBeInTheDocument()

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    // 1 request-types call + 2 requests calls (initial error + retry).
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  // AC3: clicking a row navigates using request.id, never request_number
  it('navigates to /requests/:id using the real UUID id, not request_number, when a row is clicked', async () => {
    const user = userEvent.setup()
    const requests = [makeRequest({ id: 'real-uuid-9999', request_number: 42 })]
    mockRequestTypesFetch()
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
    mockRequestTypesFetch()
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

  // AC10: page title is role-aware. The page feeds usePageTitle() (set in a
  // useEffect) instead of rendering an <h1>; the AppShell header renders it.
  // These isolated tests read it back off the PageTitleContext probe.
  it('shows "Taleplerim" as the title for an EMPLOYEE user', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'EMPLOYEE' })
    expect(await screen.findByTestId('page-title')).toHaveTextContent('Taleplerim')
  })

  it('shows "Departman Talepleri" as the title for a DEPARTMENT_AUTHORITY user', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })
    expect(await screen.findByTestId('page-title')).toHaveTextContent('Departman Talepleri')
  })

  it('shows "Tüm Talepler" as the title for an ADMIN user', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'ADMIN' })
    expect(await screen.findByTestId('page-title')).toHaveTextContent('Tüm Talepler')
  })

  // AC1: EMPLOYEE (and DEPARTMENT_AUTHORITY) users see a "Yeni Talep" button
  it('shows a "Yeni Talep" button for an EMPLOYEE user', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    renderRequests({ ...fakeUser, role: 'EMPLOYEE' })
    await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Yeni Talep' })).toBeInTheDocument()
  })

  // AC1: ADMIN users never create requests, so no "Yeni Talep" button for them
  it('does not show a "Yeni Talep" button for an ADMIN user', async () => {
    mockRequestTypesFetch()
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
      mockRequestTypesFetch()
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
      mockRequestTypesFetch()
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

  // ---------------------------------------------------------------------
  // Search/filter UI — requests-search-filter task
  // ---------------------------------------------------------------------

  describe('search and filter', () => {
    // AC1: typing in the search box debounces — no new fetch on every
    // keystroke, only once after the 300ms debounce settles.
    it('debounces the search input, firing only one filtered fetch after typing stops', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
      const fetchCallsBeforeTyping = vi.mocked(fetch).mock.calls.length

      vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

      const searchInput = screen.getByLabelText('Ara')
      await user.type(searchInput, 'yazıcı')

      // Immediately after typing (before the 300ms debounce elapses), no
      // additional fetch has fired yet.
      expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBeforeTyping)

      await vi.advanceTimersByTimeAsync(300)

      await waitFor(() =>
        expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBeforeTyping + 1),
      )
      const [filteredUrl] = vi.mocked(fetch).mock.calls.at(-1)!
      expect(String(filteredUrl)).toContain('q=')

      vi.useRealTimers()
    })

    // AC2: selecting a status dropdown option triggers an immediate refetch,
    // with no debounce wait needed.
    it('refetches immediately when the status filter dropdown changes, with no debounce wait', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const statusSelect = screen.getByLabelText('Durum')
      await user.selectOptions(statusSelect, 'OPEN')

      await waitFor(() => {
        const lastCall = vi.mocked(fetch).mock.calls.at(-1)
        expect(String(lastCall?.[0])).toContain('status=OPEN')
      })
    })

    // AC2 (priority variant): selecting a priority dropdown option also
    // triggers an immediate refetch.
    it('refetches immediately when the priority filter dropdown changes, with no debounce wait', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const prioritySelect = screen.getByLabelText('Öncelik')
      await user.selectOptions(prioritySelect, 'HIGH')

      await waitFor(() => {
        const lastCall = vi.mocked(fetch).mock.calls.at(-1)
        expect(String(lastCall?.[0])).toContain('priority=HIGH')
      })
    })

    // AC2 (request-type variant): selecting a request-type dropdown option
    // also triggers an immediate refetch.
    it('refetches immediately when the request-type filter dropdown changes', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch([{ id: 'type-9', name: 'Donanım Arızası', department_id: 'dept-1' }])
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const typeSelect = screen.getByLabelText('Talep Tipi')
      await user.selectOptions(typeSelect, 'type-9')

      await waitFor(() => {
        const lastCall = vi.mocked(fetch).mock.calls.at(-1)
        expect(String(lastCall?.[0])).toContain('request_type_id=type-9')
      })
    })

    // AC2 (combination): status + request type + priority together AND into
    // one query string.
    it('combines status, request type and priority filters into one ANDed query string', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch([{ id: 'type-9', name: 'Donanım Arızası', department_id: 'dept-1' }])
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

      await user.selectOptions(screen.getByLabelText('Durum'), 'OPEN')
      await waitFor(() => {
        expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain('status=OPEN')
      })

      await user.selectOptions(screen.getByLabelText('Talep Tipi'), 'type-9')
      await waitFor(() => {
        expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain('request_type_id=type-9')
      })

      await user.selectOptions(screen.getByLabelText('Öncelik'), 'HIGH')
      await waitFor(() => {
        const lastCall = String(vi.mocked(fetch).mock.calls.at(-1)?.[0])
        expect(lastCall).toContain('status=OPEN')
        expect(lastCall).toContain('request_type_id=type-9')
        expect(lastCall).toContain('priority=HIGH')
      })
    })

    // AC3: DEPARTMENT_AUTHORITY's Request Type dropdown only lists their own
    // department's types.
    it("scopes the request-type filter dropdown to the DEPARTMENT_AUTHORITY user's own department", async () => {
      mockRequestTypesFetch([
        { id: 'type-own', name: 'Kendi Departman Tipi', department_id: 'dept-1' },
        { id: 'type-other', name: 'Diğer Departman Tipi', department_id: 'dept-2' },
      ])
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      renderRequests({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

      await waitFor(() =>
        expect(
          within(screen.getByLabelText('Talep Tipi')).getByRole('option', {
            name: 'Kendi Departman Tipi',
          }),
        ).toBeInTheDocument(),
      )

      const typeSelect = screen.getByLabelText('Talep Tipi')
      expect(
        within(typeSelect).queryByRole('option', { name: 'Diğer Departman Tipi' }),
      ).not.toBeInTheDocument()
    })

    // AC3: ADMIN's request-type filter dropdown is NOT department-scoped — it
    // still sees the full, unfiltered list of request types.
    it('does not scope the request-type filter dropdown for ADMIN', async () => {
      mockRequestTypesFetch([
        { id: 'type-own', name: 'Kendi Departman Tipi', department_id: 'dept-1' },
        { id: 'type-other', name: 'Diğer Departman Tipi', department_id: 'dept-2' },
      ])
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      renderRequests({ ...fakeUser, role: 'ADMIN' })

      await waitFor(() =>
        expect(
          within(screen.getByLabelText('Talep Tipi')).getByRole('option', {
            name: 'Kendi Departman Tipi',
          }),
        ).toBeInTheDocument(),
      )

      const typeSelect = screen.getByLabelText('Talep Tipi')
      expect(
        within(typeSelect).getByRole('option', { name: 'Diğer Departman Tipi' }),
      ).toBeInTheDocument()
    })

    // AC4: filter state syncs to the URL query string.
    it('syncs the status filter selection to the URL query string', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      await user.selectOptions(screen.getByLabelText('Durum'), 'OPEN')

      await waitFor(() => expect(screen.getByTestId('url-probe')).toHaveTextContent('status=OPEN'))
    })

    // AC5: an empty FILTERED result shows "Bu filtrelere uyan talep yok" + a
    // Clear button, distinct from the unfiltered "Henüz talep yok" empty state
    // (regression-checked by the pre-existing test above).
    it('shows the filtered-empty state with a clear button when filters match nothing', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const prioritySelect = screen.getByLabelText('Öncelik')
      await user.selectOptions(prioritySelect, 'LOW')

      await waitFor(() => expect(screen.getByText('Bu filtrelere uyan talep yok')).toBeInTheDocument())
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      // Two "Filtreleri Temizle" buttons render while filtered-empty: one in
      // the filter bar, one inside the empty state itself.
      expect(screen.getAllByRole('button', { name: 'Filtreleri Temizle' }).length).toBe(2)
    })

    // AC6: a 400 from the backend goes through the same error+retry UI path
    // as any other error (proven elsewhere with a 500).
    it('renders the same error+retry UI for a 400 as for any other error status', async () => {
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(errorResponse(400, 'Geçersiz filtre değeri'))

      renderRequests()

      expect(await screen.findByRole('alert')).toHaveTextContent('Geçersiz filtre değeri')
      expect(screen.getByRole('button', { name: 'Tekrar Dene' })).toBeInTheDocument()
    })

    // AC7: with no filters applied, the request goes to plain /api/requests
    // with no query string at all.
    it('fetches plain /api/requests with no query string when no filters are applied', async () => {
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      renderRequests()

      await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())

      const requestsCall = vi
        .mocked(fetch)
        .mock.calls.find(([u]) => !String(u).includes('/api/request-types'))
      expect(requestsCall).toBeDefined()
      const [url] = requestsCall!
      expect(String(url)).toMatch(/\/api\/requests$/)
      expect(String(url)).not.toContain('?')
    })

    // AC8: clicking "Filtreleri Temizle" resets all filters (including the
    // debounced search box) and re-fetches the unfiltered list.
    it('clicking Filtreleri Temizle resets filters and re-fetches the unfiltered list', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests()

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const prioritySelect = screen.getByLabelText('Öncelik')
      await user.selectOptions(prioritySelect, 'LOW')

      await waitFor(() => expect(screen.getByText('Bu filtrelere uyan talep yok')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      // Two "Filtreleri Temizle" buttons render in the filtered-empty state
      // (filter bar + empty-state); either does the same thing, use the first.
      const [clearButton] = screen.getAllByRole('button', { name: 'Filtreleri Temizle' })
      await user.click(clearButton)

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
      const lastCall = vi.mocked(fetch).mock.calls.at(-1)
      expect(String(lastCall?.[0])).toMatch(/\/api\/requests$/)
      expect(String(lastCall?.[0])).not.toContain('?')
      expect(screen.getByLabelText('Öncelik')).toHaveValue('')
      expect(screen.getByLabelText('Durum')).toHaveValue('')
      expect(screen.getByLabelText('Ara')).toHaveValue('')
    })
  })

  // ---------------------------------------------------------------------
  // "Bana Atananlar" (assigned to me) filter — assigned-to-me-filter task
  // ---------------------------------------------------------------------

  describe('assigned to me', () => {
    // AC6: the checkbox only renders for DEPARTMENT_AUTHORITY.
    it('renders the "Bana Atananlar" checkbox for a DEPARTMENT_AUTHORITY user', async () => {
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      renderRequests({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

      await waitFor(() =>
        expect(screen.getByRole('checkbox', { name: 'Bana Atananlar' })).toBeInTheDocument(),
      )
    })

    // AC6: not for EMPLOYEE.
    it('does not render the "Bana Atananlar" checkbox for an EMPLOYEE user', async () => {
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      renderRequests({ ...fakeUser, role: 'EMPLOYEE' })

      await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
      expect(
        screen.queryByRole('checkbox', { name: 'Bana Atananlar' }),
      ).not.toBeInTheDocument()
    })

    // AC6: not for ADMIN.
    it('does not render the "Bana Atananlar" checkbox for an ADMIN user', async () => {
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      renderRequests({ ...fakeUser, role: 'ADMIN' })

      await waitFor(() => expect(screen.getByText('Henüz talep yok')).toBeInTheDocument())
      expect(
        screen.queryByRole('checkbox', { name: 'Bana Atananlar' }),
      ).not.toBeInTheDocument()
    })

    // AC7: toggling the checkbox on syncs assigned_to_me=true to the URL and
    // fetches with it; toggling it back off removes it from the URL.
    it('toggling the checkbox syncs assigned_to_me=true to the URL, and clears it when toggled back off', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const checkbox = screen.getByRole('checkbox', { name: 'Bana Atananlar' })
      await user.click(checkbox)

      await waitFor(() =>
        expect(screen.getByTestId('url-probe')).toHaveTextContent('assigned_to_me=true'),
      )
      await waitFor(() => {
        const lastCall = vi.mocked(fetch).mock.calls.at(-1)
        expect(String(lastCall?.[0])).toContain('assigned_to_me=true')
      })

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      await user.click(checkbox)

      await waitFor(() =>
        expect(screen.getByTestId('url-probe')).not.toHaveTextContent('assigned_to_me'),
      )
    })

    // AC7: turning the checkbox on removes any existing status from the URL.
    it('turning on "Bana Atananlar" removes an existing status filter from the URL', async () => {
      const user = userEvent.setup()
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

      renderRequests({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      await user.selectOptions(screen.getByLabelText('Durum'), 'OPEN')
      await waitFor(() => expect(screen.getByTestId('url-probe')).toHaveTextContent('status=OPEN'))

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

      const checkbox = screen.getByRole('checkbox', { name: 'Bana Atananlar' })
      await user.click(checkbox)

      await waitFor(() =>
        expect(screen.getByTestId('url-probe')).toHaveTextContent('assigned_to_me=true'),
      )
      expect(screen.getByTestId('url-probe')).not.toHaveTextContent('status=OPEN')

      // AC4 (frontend half): the Durum select is disabled while assigned_to_me
      // is active.
      expect(screen.getByLabelText('Durum')).toBeDisabled()
    })
  })
})
