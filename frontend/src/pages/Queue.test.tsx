import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function renderQueue(user?: AuthUser) {
  if (user) seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <Queue />
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
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByText('Kuyrukta talep yok')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // AC6: a failed GET shows role="alert" + retry button; clicking retry re-fetches.
  it('shows an error message and a working retry button on fetch failure', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))

    renderQueue(authorityUser)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // AC7: ADMIN sees multi-department rows, no claim button, no "Aksiyon" header.
  it('shows rows from multiple departments with no claim button or Aksiyon column for ADMIN', async () => {
    const itRequest = makeRequest({ id: 'r1', request_number: 1, department_name: 'IT' })
    const hrRequest = makeRequest({ id: 'r2', request_number: 2, department_name: 'HR' })
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
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [target]))

    renderQueue() // no seedSession -> no token -> SocketProvider creates no socket

    await waitFor(() => expect(screen.getByText('Claim Me')).toBeInTheDocument())
    expect(mockIo).not.toHaveBeenCalled()

    // No canClaim button renders without an authenticated user (user is
    // undefined so canClaim is false), so just verify REST list rendering
    // worked without a crash. Also directly exercise the claim mutation via
    // useOpenQueue's own fetch call assertions is covered elsewhere; here we
    // confirm the initial GET used the right URL/method.
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/requests?status=OPEN')
    expect(options?.method).toBe('GET')
  })

  // AC9: unmounting removes the request:removedFromQueue socket listener.
  it('removes the request:removedFromQueue socket listener on unmount', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeRequest()]))

    const { unmount } = renderQueue(authorityUser)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    unmount()

    const offEventNames = mockSocket.off.mock.calls.map((call) => call[0])
    expect(offEventNames).toContain('request:removedFromQueue')
  })
})
