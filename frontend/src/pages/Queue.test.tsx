import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Queue from './Queue'
import { AuthProvider } from '@/context/AuthContext'
import { SocketProvider } from '@/context/SocketContext'
import type { AuthUser } from '@/lib/authStorage'
import type { RequestListItem } from '@/lib/requests'

// Same socket.io-client mock pattern established in RequestDetail.test.tsx:
// real socket.io-client is mocked so no actual WebSocket connection is
// attempted in jsdom — SocketProvider calls createSocket()/io() for real
// whenever a token is present, and most tests here seed a session.
const { mockSocket, mockIo } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const mockSocket = {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler)
    }),
    disconnect: vi.fn(),
    // Test helper: simulates the server firing an event to every listener
    // currently registered for it.
    __emit: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload))
    },
    __listeners: listeners,
  }
  const mockIo = vi.fn(() => mockSocket)
  return { mockSocket, mockIo }
})

vi.mock('socket.io-client', () => ({ io: mockIo }))

// renderQueue() mounts only <Queue />, never <Toaster />, so a real sonner
// toast never reaches the DOM here. Queue.tsx is the only consumer of sonner
// in this file's render tree, so mocking the module wholesale is safe and lets
// the bulk-summary wording be asserted directly on the call arguments.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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

// Queue.tsx now also calls useRequestTypes() (for the "Talep Tipi" filter
// dropdown), whose fetch to GET /api/request-types fires before the
// useOpenQueue() fetch on every mount (verified: hook call order in the
// component determines fetch order). Tests that don't care about the
// dropdown's contents queue an empty list for it via this helper, called as
// the FIRST mockResolvedValueOnce before the queue-list response.
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

const authorityUser: AuthUser = {
  id: 'authority-1',
  name: 'Ahmet',
  surname: null,
  email: 'ahmet@example.com',
  role: 'DEPARTMENT_AUTHORITY',
  department_id: 'dept-1',
}

const adminUser: AuthUser = {
  id: 'admin-1',
  name: 'Admin',
  surname: null,
  email: 'admin@example.com',
  role: 'ADMIN',
  department_id: null,
}

function seedSession(user: AuthUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

function renderQueue(user?: AuthUser, initialEntries: string[] = ['/queue']) {
  if (user) seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <MemoryRouter initialEntries={initialEntries}>
            <Queue />
          </MemoryRouter>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('Queue page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    mockSocket.emit.mockClear()
    mockSocket.on.mockClear()
    mockSocket.off.mockClear()
    mockSocket.disconnect.mockClear()
    mockSocket.__listeners.clear()
    mockIo.mockClear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: FIFO order actually renders top-to-bottom (backend returns
  // DESC/newest-first, useOpenQueue reverses it, so the oldest row should
  // render first in the table body).
  it('renders open requests in FIFO order (oldest first), reversed from the DESC fetch response', async () => {
    const newest = makeRequest({ id: 'r3', request_number: 3, title: 'Newest' })
    const middle = makeRequest({ id: 'r2', request_number: 2, title: 'Middle' })
    const oldest = makeRequest({ id: 'r1', request_number: 1, title: 'Oldest' })
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [newest, middle, oldest]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const rows = screen.getAllByRole('row').slice(1) // drop header row
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Oldest'),
      expect.stringContaining('Middle'),
      expect.stringContaining('Newest'),
    ])
  })

  // AC2: clicking "Üstlen" calls POST /api/requests/:id/assign for that row's
  // id; on success (invalidate + refetch), the row disappears. No navigation
  // occurs (Queue.tsx renders no router-dependent content).
  it('claims a request via "Üstlen" and removes it from the list on success', async () => {
    const user = userEvent.setup()
    const target = makeRequest({ id: 'target-id', request_number: 5, title: 'Claim Me' })
    const other = makeRequest({ id: 'other-id', request_number: 6, title: 'Other' })

    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [other, target]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByText('Claim Me')).toBeInTheDocument())

    const claimRow = screen.getByText('Claim Me').closest('tr') as HTMLElement
    const claimButton = claimRow.querySelector('button') as HTMLButtonElement

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'target-id', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(200, [other]))

    await user.click(claimButton)

    const assignCall = vi
      .mocked(fetch)
      .mock.calls.find(([u, init]) => String(u).endsWith('/target-id/assign') && init?.method === 'POST')
    expect(assignCall).toBeDefined()

    await waitFor(() => expect(screen.queryByText('Claim Me')).not.toBeInTheDocument())
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  // AC3: a request:removedFromQueue socket event removes exactly that row,
  // with zero extra fetch calls.
  it('removes a row when a request:removedFromQueue socket event fires, with no extra fetch calls', async () => {
    const keep = makeRequest({ id: 'keep-id', request_number: 1, title: 'Keep' })
    const remove = makeRequest({ id: 'remove-id', request_number: 2, title: 'Remove' })
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [remove, keep]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByText('Remove')).toBeInTheDocument())
    expect(screen.getByText('Keep')).toBeInTheDocument()

    const fetchCallsBefore = vi.mocked(fetch).mock.calls.length

    mockSocket.__emit('request:removedFromQueue', { id: 'remove-id' })

    await waitFor(() => expect(screen.queryByText('Remove')).not.toBeInTheDocument())
    expect(screen.getByText('Keep')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore)
  })

  // AC4: a 409 on claim does not crash the page and shows no visible error text.
  it('does not crash or show an error on a 409 claim conflict', async () => {
    const user = userEvent.setup()
    const target = makeRequest({ id: 'target-id', request_number: 5, title: 'Claim Me' })
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [target]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByText('Claim Me')).toBeInTheDocument())
    const claimButton = screen.getByRole('button', { name: 'Üstlen' })

    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(409, 'Bu talep zaten üstlenildi'))
      .mockResolvedValueOnce(jsonResponse(200, []))

    await user.click(claimButton)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // page remains rendered/interactive
    expect(screen.getByText('Kuyruk')).toBeInTheDocument()
  })

  // AC5: empty queue shows the empty state, no table.
  it('shows the empty state and no table when the queue is empty', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByText('Kuyrukta talep yok')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // AC6: a failed GET shows role="alert" + retry button; clicking retry re-fetches.
  it('shows an error message and a working retry button on fetch failure', async () => {
    const user = userEvent.setup()
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))

    renderQueue(authorityUser)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    // 1 request-types call + 2 queue calls (initial failure + retry).
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  // AC7: ADMIN sees multi-department rows, no claim button, no "Aksiyon" header.
  it('shows rows from multiple departments with no claim button or Aksiyon column for ADMIN', async () => {
    const itRequest = makeRequest({ id: 'r1', request_number: 1, department_name: 'IT' })
    const hrRequest = makeRequest({ id: 'r2', request_number: 2, department_name: 'HR' })
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [hrRequest, itRequest]))

    renderQueue(adminUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getByText('HR')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument()
    expect(screen.queryByText('Aksiyon')).not.toBeInTheDocument()
  })

  // AC7: DEPARTMENT_AUTHORITY sees a claim button per row and an Aksiyon header.
  it('shows a claim button per row and an Aksiyon column for DEPARTMENT_AUTHORITY', async () => {
    const r1 = makeRequest({ id: 'r1', request_number: 1, department_name: 'IT' })
    const r2 = makeRequest({ id: 'r2', request_number: 2, department_name: 'IT' })
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [r2, r1]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    expect(screen.getByText('Aksiyon')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Üstlen' }).length).toBe(2)
  })

  // AC8: with no session/socket, REST-driven parts still work fully, and
  // mockIo is never called (mirrors the SocketContext/AppShell no-session pattern).
  it('works fully via REST with no session/socket present', async () => {
    const target = makeRequest({ id: 'target-id', request_number: 5, title: 'Claim Me' })
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [target]))

    renderQueue() // no seedSession -> no token -> SocketProvider creates no socket

    await waitFor(() => expect(screen.getByText('Claim Me')).toBeInTheDocument())
    expect(mockIo).not.toHaveBeenCalled()

    // No canClaim button renders without an authenticated user (user is
    // undefined so canClaim is false), so just verify REST list rendering
    // worked without a crash. Also directly exercise the claim mutation via
    // useOpenQueue's own fetch call assertions is covered elsewhere; here we
    // confirm the queue GET (alongside the request-types GET fired by the
    // filter dropdown) used the right URL/method.
    const queueCall = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => String(u).includes('/api/requests?status=OPEN'))
    expect(queueCall).toBeDefined()
    const [url, options] = queueCall!
    expect(String(url)).toContain('/api/requests?status=OPEN')
    expect(options?.method).toBe('GET')
  })

  // AC9: unmounting removes the request:removedFromQueue socket listener.
  it('removes the request:removedFromQueue socket listener on unmount', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    const { unmount } = renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    unmount()

    const offEventNames = mockSocket.off.mock.calls.map((call) => call[0])
    expect(offEventNames).toContain('request:removedFromQueue')
  })

  // request:addedToQueue AC: a socket event carrying the full enriched row prepends
  // to the raw (newest-first) cache, which - after useOpenQueue's .reverse() for
  // display - renders the new item as the LAST row (FIFO/oldest-first order), with
  // zero extra fetch calls (no refetch/invalidate).
  it('appends a row as the last item when a request:addedToQueue socket event fires, with no extra fetch calls', async () => {
    const existing1 = makeRequest({ id: 'existing-1', request_number: 1, title: 'Existing One' })
    const existing2 = makeRequest({ id: 'existing-2', request_number: 2, title: 'Existing Two' })
    // Raw cache is newest-first (DESC from backend): existing2 then existing1.
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [existing2, existing1]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const fetchCallsBefore = vi.mocked(fetch).mock.calls.length

    const added = makeRequest({ id: 'added-id', request_number: 3, title: 'Brand New' })
    mockSocket.__emit('request:addedToQueue', added)

    await waitFor(() => expect(screen.getByText('Brand New')).toBeInTheDocument())

    const rows = screen.getAllByRole('row').slice(1) // drop header row
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Existing One'),
      expect.stringContaining('Existing Two'),
      expect.stringContaining('Brand New'),
    ])
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore)
  })

  // request:addedToQueue AC: unmounting removes the request:addedToQueue socket
  // listener too (extends the existing unmount test).
  it('removes the request:addedToQueue socket listener on unmount', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    const { unmount } = renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    unmount()

    const offEventNames = mockSocket.off.mock.calls.map((call) => call[0])
    expect(offEventNames).toContain('request:addedToQueue')
  })

  // request:addedToQueue idempotency guard: in a narrow race the initial
  // GET /api/requests?status=OPEN can already contain request X while X's socket
  // event is delivered afterwards. The handler's `old.some(...)` check must leave
  // the cache untouched so X renders as exactly one <tr>, not two rows sharing
  // the same React key, and still without any extra fetch.
  it('ignores a request:addedToQueue event for a request already in the list, rendering it once', async () => {
    const duplicate = makeRequest({ id: 'dupe-id', request_number: 7, title: 'Already Listed' })
    const other = makeRequest({ id: 'other-id', request_number: 8, title: 'Other One' })
    // Raw cache is newest-first (DESC from backend): other then duplicate.
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [other, duplicate]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const rowCountBefore = screen.getAllByRole('row').slice(1).length // drop header row
    expect(rowCountBefore).toBe(2)
    const fetchCallsBefore = vi.mocked(fetch).mock.calls.length

    mockSocket.__emit('request:addedToQueue', duplicate)

    // A duplicate is a no-op: the updater returns the same array identity, so
    // there is no change to wait *for*. This waitFor asserts an already-true
    // condition purely to flush any pending React work before the end-state
    // assertions below — without it a wrongly-added row would render too late
    // to be observed, and this test would pass even with the guard removed.
    await waitFor(() => expect(screen.getByText('Already Listed')).toBeInTheDocument())

    const rowsAfter = screen.getAllByRole('row').slice(1) // drop header row
    expect(rowsAfter.length).toBe(rowCountBefore)
    expect(rowsAfter.filter((row) => row.textContent?.includes('Already Listed')).length).toBe(1)
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore)
  })

  // ---------------------------------------------------------------------
  // Search/filter UI — queue-search-filter task
  // ---------------------------------------------------------------------

  // AC6: typing in the search box debounces — no new fetch on every keystroke,
  // only once after the 300ms debounce settles.
  it('debounces the search input, firing only one filtered fetch after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    renderQueue(authorityUser)

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

  // AC7: selecting a request-type or priority dropdown option triggers an
  // immediate refetch, with no debounce wait needed.
  it('refetches immediately when the priority filter dropdown changes, with no debounce wait', async () => {
    const user = userEvent.setup()
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    const prioritySelect = screen.getByLabelText('Öncelik')
    await user.selectOptions(prioritySelect, 'HIGH')

    await waitFor(() => {
      const lastCall = vi.mocked(fetch).mock.calls.at(-1)
      expect(String(lastCall?.[0])).toContain('priority=HIGH')
    })
  })

  // AC7 (request-type variant): selecting a request-type dropdown option also
  // triggers an immediate refetch.
  it('refetches immediately when the request-type filter dropdown changes', async () => {
    const user = userEvent.setup()
    mockRequestTypesFetch([{ id: 'type-9', name: 'Donanım Arızası', department_id: 'dept-1' }])
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    const typeSelect = screen.getByLabelText('Talep Tipi')
    await user.selectOptions(typeSelect, 'type-9')

    await waitFor(() => {
      const lastCall = vi.mocked(fetch).mock.calls.at(-1)
      expect(String(lastCall?.[0])).toContain('request_type_id=type-9')
    })
  })

  // AC8: an empty FILTERED result shows "Bu filtrelere uyan talep yok" + a
  // Clear button, distinct from the unfiltered "Kuyrukta talep yok" empty
  // state (regression-checked by the pre-existing AC5 test above).
  it('shows the filtered-empty state with a clear button when filters match nothing', async () => {
    const user = userEvent.setup()
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    renderQueue(authorityUser)

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

  // AC9: clicking "Filtreleri Temizle" resets the filters and re-fetches the
  // unfiltered queue.
  it('clicking Filtreleri Temizle resets filters and re-fetches the unfiltered queue', async () => {
    const user = userEvent.setup()
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    renderQueue(authorityUser)

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
    expect(String(lastCall?.[0])).toContain('/api/requests?status=OPEN')
    expect(String(lastCall?.[0])).not.toContain('priority=')
    expect(String(lastCall?.[0])).not.toContain('q=')
    expect(String(lastCall?.[0])).not.toContain('request_type_id=')
    expect(screen.getByLabelText('Öncelik')).toHaveValue('')
  })

  // AC10: mounting with a URL that already has ?priority=HIGH pre-applies
  // that filter on first render — the very first queue GET already includes
  // it, and the priority select is pre-set, with no user interaction.
  it('applies a filter from the initial URL on mount, with no user interaction', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest({ priority: 'HIGH' })]))

    renderQueue(authorityUser, ['/queue?priority=HIGH'])

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const queueCall = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => String(u).includes('/api/requests?status=OPEN'))
    expect(queueCall).toBeDefined()
    expect(String(queueCall![0])).toContain('priority=HIGH')

    expect(screen.getByLabelText('Öncelik')).toHaveValue('HIGH')
  })

  // Department-scoped request-type filter: DEPARTMENT_AUTHORITY only sees
  // request types belonging to their own department in the "Talep Tipi"
  // dropdown; a type from another department must not appear.
  it('scopes the request-type filter dropdown to the DEPARTMENT_AUTHORITY user\'s own department', async () => {
    mockRequestTypesFetch([
      { id: 'type-own', name: 'Kendi Departman Tipi', department_id: 'dept-1' },
      { id: 'type-other', name: 'Diğer Departman Tipi', department_id: 'dept-2' },
    ])
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderQueue(authorityUser)

    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Talep Tipi')).getByRole('option', {
          name: 'Kendi Departman Tipi',
        }),
      ).toBeInTheDocument(),
    )

    const typeSelect = screen.getByLabelText('Talep Tipi')
    expect(within(typeSelect).queryByRole('option', { name: 'Diğer Departman Tipi' })).not.toBeInTheDocument()
  })

  // ADMIN's request-type filter dropdown is NOT department-scoped — it still
  // sees the full, unfiltered list of request types.
  it('does not scope the request-type filter dropdown for ADMIN', async () => {
    mockRequestTypesFetch([
      { id: 'type-own', name: 'Kendi Departman Tipi', department_id: 'dept-1' },
      { id: 'type-other', name: 'Diğer Departman Tipi', department_id: 'dept-2' },
    ])
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderQueue(adminUser)

    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Talep Tipi')).getByRole('option', {
          name: 'Kendi Departman Tipi',
        }),
      ).toBeInTheDocument(),
    )

    const typeSelect = screen.getByLabelText('Talep Tipi')
    expect(within(typeSelect).getByRole('option', { name: 'Diğer Departman Tipi' })).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // Bulk claim/reject — queue-bulk-actions task
  // ---------------------------------------------------------------------

  // Two rows the bulk tests select against. The queue GET is mocked
  // newest-first (DESC), so #1 renders first and #2 second.
  const bulkRow1 = makeRequest({ id: 'bulk-1', request_number: 1, title: 'Birinci' })
  const bulkRow2 = makeRequest({ id: 'bulk-2', request_number: 2, title: 'İkinci' })

  async function renderQueueWithTwoRows() {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [bulkRow2, bulkRow1]))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
  }

  function statusCalls() {
    return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/status'))
  }

  function assignCalls() {
    return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/assign'))
  }

  // AC5: the bulk bar only exists while at least one row is selected.
  it('shows the bulk action bar only once a row is selected', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    expect(screen.queryByRole('button', { name: 'Seçilenleri Üstlen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Seçilenleri Reddet' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '#1 seç' }))

    expect(await screen.findByText('1 talep seçildi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seçilenleri Üstlen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seçilenleri Reddet' })).toBeInTheDocument()
  })

  // AC6 (authorization boundary): ADMIN cannot claim or reject, so no
  // selection affordance renders at all — not the header checkbox, not the row
  // checkboxes, not the bulk buttons — even with rows in the queue.
  it('renders no checkboxes and no bulk buttons for ADMIN', async () => {
    mockRequestTypesFetch()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [bulkRow2, bulkRow1]))

    renderQueue(adminUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Seçilenleri Üstlen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Seçilenleri Reddet' })).not.toBeInTheDocument()
  })

  // AC7: the header checkbox selects every rendered row, and toggling it again
  // clears the selection (which also hides the bulk bar).
  it('selects and clears every row with the header "Tümünü seç" checkbox', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }))

    expect(await screen.findByText('2 talep seçildi')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }))

    await waitFor(() => expect(screen.queryByText('2 talep seçildi')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Seçilenleri Üstlen' })).not.toBeInTheDocument()
  })

  // AC1 (through the UI): "Seçilenleri Üstlen" issues one
  // POST /api/requests/:id/assign per selected id, for exactly those ids.
  it('bulk claims every selected row with one POST /assign per id', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: '#1 seç' }))
    await user.click(screen.getByRole('checkbox', { name: '#2 seç' }))
    expect(await screen.findByText('2 talep seçildi')).toBeInTheDocument()

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-1', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-2', status: 'ASSIGNED' }))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

    await user.click(screen.getByRole('button', { name: 'Seçilenleri Üstlen' }))

    await waitFor(() => expect(assignCalls()).toHaveLength(2))
    expect(assignCalls().map(([url]) => String(url).replace(/^.*\/api/, '/api'))).toEqual([
      '/api/requests/bulk-1/assign',
      '/api/requests/bulk-2/assign',
    ])
    assignCalls().forEach(([, options]) => expect(options?.method).toBe('POST'))
  })

  // AC2: the reject dialog will not submit an empty note — the zod message
  // renders and not a single PATCH /status leaves the client.
  it('blocks the bulk reject dialog on an empty note and sends no PATCH', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: '#1 seç' }))
    await user.click(await screen.findByRole('button', { name: 'Seçilenleri Reddet' }))

    expect(await screen.findByText('Seçilen Talepleri Reddet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reddet' }))

    expect(await screen.findByText('Red sebebi zorunlu')).toBeInTheDocument()
    expect(statusCalls()).toHaveLength(0)
  })

  // AC3 (through the UI): a valid note PATCHes /status once per selected id,
  // every call carrying the same typed note alongside status REJECTED.
  it('bulk rejects every selected row with the shared note', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: '#1 seç' }))
    await user.click(screen.getByRole('checkbox', { name: '#2 seç' }))
    await user.click(await screen.findByRole('button', { name: 'Seçilenleri Reddet' }))

    expect(await screen.findByText('2 talep aynı red sebebiyle reddedilecek.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Red Sebebi'), 'Bütçe yok')

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-1', status: 'REJECTED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-2', status: 'REJECTED' }))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

    await user.click(screen.getByRole('button', { name: 'Reddet' }))

    await waitFor(() => expect(statusCalls()).toHaveLength(2))
    expect(statusCalls().map(([url]) => String(url).replace(/^.*\/api/, '/api'))).toEqual([
      '/api/requests/bulk-1/status',
      '/api/requests/bulk-2/status',
    ])
    statusCalls().forEach(([, options]) => {
      expect(options?.method).toBe('PATCH')
      expect(JSON.parse(options?.body as string)).toEqual({
        status: 'REJECTED',
        note: 'Bütçe yok',
      })
    })
  })

  // AC4: an all-success bulk claim reports through toast.success.
  it('reports an all-success bulk claim with a success toast', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }))
    expect(await screen.findByText('2 talep seçildi')).toBeInTheDocument()

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-1', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-2', status: 'ASSIGNED' }))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

    await user.click(screen.getByRole('button', { name: 'Seçilenleri Üstlen' }))

    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('2 talep üstlenildi')
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
  })

  // AC4: a partially-conflicted bulk claim reports through toast.error, and
  // the summary names both the successes and the rows someone else took first.
  it('reports a partially conflicted bulk claim with an error toast naming both counts', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }))
    expect(await screen.findByText('2 talep seçildi')).toBeInTheDocument()

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-1', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(errorResponse(409, 'Bu talep zaten üstlenildi'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

    await user.click(screen.getByRole('button', { name: 'Seçilenleri Üstlen' }))

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1))
    const message = String(vi.mocked(toast.error).mock.calls[0][0])
    expect(message).toContain('1 talep üstlenildi')
    expect(message).toContain('1 talep başkası tarafından alınmış')
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
  })

  // AC8: the selection is derived against the rendered rows, so a row removed
  // by the shared request:removedFromQueue socket event is silently pruned —
  // no ghost id lingers in the count.
  it('prunes a selected id when its row leaves via request:removedFromQueue', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }))
    expect(await screen.findByText('2 talep seçildi')).toBeInTheDocument()

    mockSocket.__emit('request:removedFromQueue', { id: 'bulk-2' })

    expect(await screen.findByText('1 talep seçildi')).toBeInTheDocument()
    expect(screen.queryByText('İkinci')).not.toBeInTheDocument()
  })

  // AC10: a successful bulk claim clears the selection (bulk bar disappears)
  // and invalidates the queue query, which refetches the list.
  it('clears the selection and refetches the queue after a successful bulk claim', async () => {
    const user = userEvent.setup()
    await renderQueueWithTwoRows()

    await user.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }))
    expect(await screen.findByText('2 talep seçildi')).toBeInTheDocument()

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-1', status: 'ASSIGNED' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'bulk-2', status: 'ASSIGNED' }))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, []))

    await user.click(screen.getByRole('button', { name: 'Seçilenleri Üstlen' }))

    await waitFor(() => expect(screen.queryByText('2 talep seçildi')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Seçilenleri Üstlen' })).not.toBeInTheDocument()
    // The invalidation triggered a fresh queue GET after the two assigns.
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) =>
          String(url).includes('/api/requests?status=OPEN'),
        ).length,
      ).toBeGreaterThan(1),
    )
    expect(await screen.findByText('Kuyrukta talep yok')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // SLA column — sla-visibility task
  // ---------------------------------------------------------------------

  // The boundary/tone logic lives in getSlaDisplay's unit tests; this block
  // only proves the column is wired into the queue table. getSlaDisplay()
  // reads Date.now(), so the row is built as an offset from a frozen NOW
  // rather than makeRequest()'s literal default deadline, whose label would
  // change every day real time advances. The clock is faked (and restored)
  // inside this describe only, so every test above keeps its own timer setup;
  // shouldAdvanceTime keeps waitFor working on the faked clock.
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

    // AC6/AC1/AC9: the queue gets the same SLA column, and it displaces
    // neither the selection checkbox nor the Aksiyon column.
    it('renders an SLA column header and the remaining time for a queued row', async () => {
      mockRequestTypesFetch()
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse(200, [
          makeRequest({
            id: 'sla-1',
            request_number: 11,
            title: 'Kuyruk Talebi',
            created_at: fromNow(-30 * MINUTE),
            sla_due_at: fromNow(3 * HOUR + 30 * MINUTE),
          }),
        ]),
      )

      renderQueue(authorityUser)

      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

      expect(screen.getByRole('columnheader', { name: 'SLA' })).toBeInTheDocument()

      const row = screen.getByText('Kuyruk Talebi').closest('tr') as HTMLElement
      expect(within(row).getByText('3 saat kaldı')).toHaveClass('text-muted-foreground')
      expect(within(row).getByRole('checkbox', { name: '#11 seç' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Üstlen' })).toBeInTheDocument()
    })
  })
})
