import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { AuthProvider } from '@/context/AuthContext'
import { SocketProvider } from '@/context/SocketContext'
import type { AuthUser } from '@/lib/authStorage'
import type { AppNotification } from '@/lib/notifications'

// Real socket.io-client is mocked so no actual WebSocket connection is
// attempted in jsdom — SocketProvider calls createSocket()/io() for real
// whenever a token is present. Same shape as RequestDetail.test.tsx.
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
    // Test helper: simulates the server (or the socket itself, for 'connect')
    // firing an event to every listener currently registered for it.
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

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    user_id: 'user-1',
    request_id: 'req-1',
    type: 'REQUEST_ASSIGNED',
    message: 'Talebiniz üstlenildi',
    read_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
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

function seedSession(user: AuthUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

function Bomb(): never {
  throw new Error('boom')
}

// Investigated directly (see PR/task notes): userEvent.click() DOES open this
// Base UI (@base-ui/react/menu) dropdown correctly and quickly — aria-expanded
// flips to "true" within ~100ms of the click, confirmed with a scratch repro
// that logged pointerdown/mousedown/click events and aria-expanded on every
// tick. The PointerEvent polyfill in src/test/setup.ts is not the problem;
// pointerType/isPrimary/button/buttons all arrive correctly (userEvent
// overwrites them explicitly via its own event-init logic regardless of the
// polyfill's constructor defaults).
//
// The real, measured cost lives entirely *after* the menu opens, in Base UI's
// popup-open machinery (FloatingFocusManager / focus-guard / tabbable-scan
// setup that mounts once `open` becomes true) running under jsdom. This
// reproduces identically with zero user interaction at all — rendering the
// same menu with `defaultOpen` (no click, fireEvent or userEvent) shows the
// same multi-ten-second stall before the popup's contents become queryable,
// even though a plain synchronous `document.querySelector`/`queryByRole`
// call finds the already-rendered menu item in single-digit milliseconds.
// So this is not about which synthetic event opens the trigger; it is a
// jsdom performance/settling issue in Base UI's open-popup mount path itself.
//
// Measured via `npx vitest run src/components/AppShell.test.tsx --reporter=verbose`
// on this machine (the three tests below that open this menu, in one run):
// 58.3s, 67.1s, 71.0s. `openUserMenu` below waits (with a real, budgeted
// timeout, not an unexplained huge one) for `aria-expanded` to flip on the
// trigger —
// once that happens the popup content is already in the DOM, so the menu
// item itself can be queried synchronously with `getByRole` immediately
// after, with no further waiting needed.
const MENU_SETTLE_TIMEOUT_MS = 90_000

async function openUserMenu(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger)
  await waitFor(
    () => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    },
    { timeout: MENU_SETTLE_TIMEOUT_MS },
  )
}

function renderShell(user: AuthUser, initialPath = '/requests') {
  seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/requests" element={<div>REQUESTS PAGE</div>} />
                <Route path="/requests/:id" element={<div>REQUEST DETAIL PAGE</div>} />
                <Route path="/queue" element={<div>QUEUE PAGE</div>} />
                <Route path="/admin/users" element={<div>USERS PAGE</div>} />
                <Route path="/profile" element={<div>PROFILE PAGE</div>} />
                <Route path="/boom" element={<Bomb />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    // Default: every pre-existing test only relies on the unread-count query
    // (the notification list is fetched only once the bell dropdown opens,
    // which none of the pre-existing tests do) - a single resolved
    // { count: 0 } response is enough to keep AppShell from hanging.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })))
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

  // AC3: EMPLOYEE sidebar shows only "Talepler"
  it('shows only "Talepler" in the nav for an EMPLOYEE user', () => {
    renderShell({ ...fakeUser, role: 'EMPLOYEE' })

    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Talepler')).toBeInTheDocument()
    expect(within(nav).queryByText('Kuyruk')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Kullanıcılar')).not.toBeInTheDocument()
  })

  // AC7: "Genel Bakış" (analytics) is never shown to an EMPLOYEE
  it('does not show "Genel Bakış" in the nav for an EMPLOYEE user', () => {
    renderShell({ ...fakeUser, role: 'EMPLOYEE' })

    const nav = screen.getByRole('navigation')
    expect(within(nav).queryByText('Genel Bakış')).not.toBeInTheDocument()
  })

  // AC4: DEPARTMENT_AUTHORITY sidebar shows "Kuyruk", "Talepler", then "Genel Bakış", no "Kullanıcılar"
  it('shows "Kuyruk" then "Talepler", and no "Kullanıcılar", for a DEPARTMENT_AUTHORITY user', () => {
    renderShell({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

    const nav = screen.getByRole('navigation')
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Kuyruk', 'Talepler', 'Genel Bakış'])
    expect(within(nav).queryByText('Kullanıcılar')).not.toBeInTheDocument()
  })

  // AC4: ADMIN sidebar shows all four, in "Genel Bakış", "Talepler", "Kuyruk", "Kullanıcılar" order
  it('shows "Talepler", "Kuyruk", "Kullanıcılar" in that order for an ADMIN user', () => {
    renderShell({ ...fakeUser, role: 'ADMIN' })

    const nav = screen.getByRole('navigation')
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Genel Bakış', 'Talepler', 'Kuyruk', 'Kullanıcılar'])
  })

  // AC5: clicking "Çıkış Yap" calls logout (observed via cleared session storage)
  //
  // See openUserMenu above for why this uses a real userEvent.click() (which
  // opens the menu correctly and quickly) plus a budgeted, measured wait for
  // the popup to settle under jsdom, rather than a shortcut event type.
  it(
    'clears the session when "Çıkış Yap" is clicked',
    async () => {
      const user = userEvent.setup()
      renderShell({ ...fakeUser, role: 'EMPLOYEE' })

      expect(sessionStorage.getItem('opspulse_token')).not.toBeNull()

      await openUserMenu(user, screen.getByRole('button', { name: /Taha/ }))
      await user.click(screen.getByRole('menuitem', { name: 'Çıkış Yap' }))

      expect(sessionStorage.getItem('opspulse_token')).toBeNull()
      expect(sessionStorage.getItem('opspulse_user')).toBeNull()
    },
    MENU_SETTLE_TIMEOUT_MS + 10_000,
  )

  // AC1/AC6: content renders through <Outlet/>
  it('renders the routed page content inside the shell', () => {
    renderShell({ ...fakeUser, role: 'EMPLOYEE' }, '/requests')
    expect(screen.getByText('REQUESTS PAGE')).toBeInTheDocument()
  })

  it('renders ComingSoon-style content for /queue without crashing', () => {
    renderShell({ ...fakeUser, role: 'ADMIN' }, '/queue')
    expect(screen.getByText('QUEUE PAGE')).toBeInTheDocument()
  })

  // AC1 (revised): the sidebar's user block is a menu trigger; "Profilim" in that
  // menu navigates to /profile — clicking the block itself no longer navigates directly
  it(
    'opens a menu when the user block is clicked, and "Profilim" navigates to /profile',
    async () => {
      const user = userEvent.setup()
      renderShell({ ...fakeUser, role: 'EMPLOYEE' }, '/requests')

      await openUserMenu(user, screen.getByRole('button', { name: /Taha/ }))
      await user.click(screen.getByRole('menuitem', { name: 'Profilim' }))

      expect(screen.getByText('PROFILE PAGE')).toBeInTheDocument()
    },
    MENU_SETTLE_TIMEOUT_MS + 10_000,
  )

  it('does not show the "Profilim"/"Çıkış Yap" menu items until the user block is clicked', () => {
    renderShell({ ...fakeUser, role: 'EMPLOYEE' })

    expect(screen.queryByRole('menuitem', { name: 'Profilim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Çıkış Yap' })).not.toBeInTheDocument()
  })

  // AC7: active nav link is visually marked (checked as a standalone class token, since
  // the inactive/base className also contains "hover:bg-sidebar-accent" as a substring)
  function hasActiveClass(element: HTMLElement) {
    return element.className.split(/\s+/).includes('bg-sidebar-primary')
  }

  it('marks the current route\'s nav link active and leaves others inactive', () => {
    renderShell({ ...fakeUser, role: 'ADMIN' }, '/requests')

    const nav = screen.getByRole('navigation')
    const talepler = within(nav).getByText('Talepler')
    const kuyruk = within(nav).getByText('Kuyruk')

    expect(hasActiveClass(talepler)).toBe(true)
    expect(hasActiveClass(kuyruk)).toBe(false)
  })

  it('marks "Kuyruk" active instead of "Talepler" when on /queue', () => {
    renderShell({ ...fakeUser, role: 'ADMIN' }, '/queue')

    const nav = screen.getByRole('navigation')
    const talepler = within(nav).getByText('Talepler')
    const kuyruk = within(nav).getByText('Kuyruk')

    expect(hasActiveClass(kuyruk)).toBe(true)
    expect(hasActiveClass(talepler)).toBe(false)
  })

  // AC8: an error thrown by the routed content is caught by ErrorBoundary; the sidebar stays usable
  describe('when the routed content throws', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it(
      'shows the fallback message while keeping the sidebar rendered',
      async () => {
        const user = userEvent.setup()
        renderShell({ ...fakeUser, role: 'ADMIN' }, '/boom')

        expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument()

        const nav = screen.getByRole('navigation')
        expect(within(nav).getByText('Talepler')).toBeInTheDocument()
        expect(within(nav).getByText('Kuyruk')).toBeInTheDocument()
        expect(within(nav).getByText('Kullanıcılar')).toBeInTheDocument()
        expect(screen.getByText(/Taha/)).toBeInTheDocument()

        await openUserMenu(user, screen.getByRole('button', { name: /Taha/ }))
        expect(screen.getByRole('menuitem', { name: 'Çıkış Yap' })).toBeInTheDocument()
      },
      MENU_SETTLE_TIMEOUT_MS + 10_000,
    )
  })

  // AC10: the sidebar user block shows a Turkish role label, never the raw enum
  describe('role label in the sidebar', () => {
    it('shows "Çalışan" instead of the raw "EMPLOYEE" enum', () => {
      renderShell({ ...fakeUser, role: 'EMPLOYEE' })

      expect(screen.getByText('Çalışan')).toBeInTheDocument()
      expect(screen.queryByText('EMPLOYEE')).not.toBeInTheDocument()
    })

    it('shows "Departman Yetkilisi" instead of the raw "DEPARTMENT_AUTHORITY" enum', () => {
      renderShell({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

      expect(screen.getByText('Departman Yetkilisi')).toBeInTheDocument()
      expect(screen.queryByText('DEPARTMENT_AUTHORITY')).not.toBeInTheDocument()
    })

    it('shows "Yönetici" instead of the raw "ADMIN" enum', () => {
      renderShell({ ...fakeUser, role: 'ADMIN' })

      expect(screen.getByText('Yönetici')).toBeInTheDocument()
      expect(screen.queryByText('ADMIN')).not.toBeInTheDocument()
    })
  })

  // AC11: the sidebar user block shows an initials avatar derived from name/surname
  describe('initials avatar in the sidebar', () => {
    it('renders both initials for a user with a name and a surname', () => {
      renderShell({
        ...fakeUser,
        name: 'IT',
        surname: 'Yetkilisi',
        role: 'DEPARTMENT_AUTHORITY',
        department_id: 'dept-1',
      })

      expect(screen.getByText('IY')).toBeInTheDocument()
    })

    it('renders only the first initial for a user with no surname', () => {
      renderShell({ ...fakeUser, role: 'EMPLOYEE' })

      expect(screen.getByText('T')).toBeInTheDocument()
    })
  })

  // ── Real-Time 3B: notification bell ─────────────────────────────────────

  describe('notification bell (Real-Time 3B)', () => {
    // Routes fetch calls by URL/method the same way RequestDetail.test.tsx's
    // stateful mocks do, so several endpoints can coexist in one test.
    function notificationFetchMock({
      unreadCount = 0,
      list = [] as AppNotification[],
    }: { unreadCount?: number; list?: AppNotification[] } = {}) {
      return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url)
        const method = (init?.method as string | undefined) ?? 'GET'
        if (method === 'GET' && u.endsWith('/api/notifications/unread-count')) {
          return jsonResponse(200, { count: unreadCount })
        }
        if (method === 'GET' && u.endsWith('/api/notifications')) {
          return jsonResponse(200, list)
        }
        if (method === 'PATCH' && u.endsWith('/read-all')) {
          return jsonResponse(200, { status: 'ok' })
        }
        if (method === 'PATCH' && /\/api\/notifications\/[^/]+\/read$/.test(u)) {
          return jsonResponse(200, { id: u.split('/').at(-2), read_at: '2026-01-01T00:00:00.000Z' })
        }
        return jsonResponse(404, { message: `unexpected call: ${method} ${u}` })
      })
    }

    async function openBell(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
      await user.click(trigger)
      await waitFor(
        () => {
          expect(trigger).toHaveAttribute('aria-expanded', 'true')
        },
        { timeout: MENU_SETTLE_TIMEOUT_MS },
      )
    }

    // AC1: no badge shown when the unread count is 0
    it('shows no badge on the bell when the unread count is 0', async () => {
      vi.stubGlobal('fetch', notificationFetchMock({ unreadCount: 0 }))

      const { container } = renderShell(fakeUser)

      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(container.querySelector('.bg-destructive')).not.toBeInTheDocument()
    })

    // AC1: the badge shows the number when the unread count is > 0
    it('shows the unread count on the bell badge when it is greater than 0', async () => {
      vi.stubGlobal('fetch', notificationFetchMock({ unreadCount: 5 }))

      renderShell(fakeUser)

      await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
    })

    // AC2: notification:created increments the badge by exactly 1 with no extra fetch
    it('increments the badge by 1 on a notification:created socket event without an extra fetch', async () => {
      vi.stubGlobal('fetch', notificationFetchMock({ unreadCount: 2 }))

      renderShell(fakeUser)

      await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
      const fetchCallsBefore = vi.mocked(fetch).mock.calls.length

      mockSocket.__emit('notification:created', makeNotification())

      await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
      expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore)
    })

    // AC3: opening the bell dropdown triggers GET /api/notifications only while open,
    // and renders the returned notifications' message text
    it(
      'fetches and renders notifications only once the bell dropdown is opened',
      async () => {
        const user = userEvent.setup()
        vi.stubGlobal(
          'fetch',
          notificationFetchMock({
            unreadCount: 1,
            list: [makeNotification({ id: 'n1', message: 'Talebiniz üstlenildi' })],
          }),
        )

        renderShell(fakeUser)

        await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
        expect(
          vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/api/notifications')),
        ).toBe(false)

        const bellTrigger = screen.getByRole('button', { name: /Bildirimler/ })
        await openBell(user, bellTrigger)

        await waitFor(() => expect(screen.getByText('Talebiniz üstlenildi')).toBeInTheDocument())
        expect(
          vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/api/notifications')),
        ).toBe(true)
      },
      MENU_SETTLE_TIMEOUT_MS + 10_000,
    )

    // AC4: clicking a notification marks it read, closes the dropdown, and navigates
    // to the request when request_id is non-null
    it(
      'clicking a notification marks it read, closes the dropdown, and navigates to its request',
      async () => {
        const user = userEvent.setup()
        vi.stubGlobal(
          'fetch',
          notificationFetchMock({
            unreadCount: 1,
            list: [makeNotification({ id: 'n1', request_id: 'req-9', message: 'Talebiniz üstlenildi' })],
          }),
        )

        renderShell(fakeUser)

        const bellTrigger = await screen.findByRole('button', { name: /Bildirimler/ })
        await openBell(user, bellTrigger)

        const item = await screen.findByText('Talebiniz üstlenildi')
        await user.click(item)

        await waitFor(() =>
          expect(
            vi.mocked(fetch).mock.calls.some(
              ([u, init]) => String(u).endsWith('/api/notifications/n1/read') && init?.method === 'PATCH',
            ),
          ).toBe(true),
        )

        await waitFor(() => expect(screen.queryByText('Talebiniz üstlenildi')).not.toBeInTheDocument())
        await waitFor(() => expect(screen.getByText('REQUEST DETAIL PAGE')).toBeInTheDocument())
      },
      MENU_SETTLE_TIMEOUT_MS + 10_000,
    )

    // AC4 edge case: a notification with request_id === null marks read but does not navigate
    it(
      'clicking a notification with a null request_id marks it read but does not navigate',
      async () => {
        const user = userEvent.setup()
        vi.stubGlobal(
          'fetch',
          notificationFetchMock({
            unreadCount: 1,
            list: [makeNotification({ id: 'n1', request_id: null, message: 'Genel bildirim' })],
          }),
        )

        renderShell(fakeUser)

        const bellTrigger = await screen.findByRole('button', { name: /Bildirimler/ })
        await openBell(user, bellTrigger)

        const item = await screen.findByText('Genel bildirim')
        await user.click(item)

        await waitFor(() =>
          expect(
            vi.mocked(fetch).mock.calls.some(
              ([u, init]) => String(u).endsWith('/api/notifications/n1/read') && init?.method === 'PATCH',
            ),
          ).toBe(true),
        )

        expect(screen.getByText('REQUESTS PAGE')).toBeInTheDocument()
        expect(screen.queryByText('REQUEST DETAIL PAGE')).not.toBeInTheDocument()
      },
      MENU_SETTLE_TIMEOUT_MS + 10_000,
    )

    // AC5: "Tümünü Okundu İşaretle" calls PATCH /api/notifications/read-all
    it(
      'clicking "Tümünü Okundu İşaretle" calls PATCH /api/notifications/read-all',
      async () => {
        const user = userEvent.setup()
        vi.stubGlobal(
          'fetch',
          notificationFetchMock({
            unreadCount: 2,
            list: [makeNotification({ id: 'n1' }), makeNotification({ id: 'n2' })],
          }),
        )

        renderShell(fakeUser)

        const bellTrigger = await screen.findByRole('button', { name: /Bildirimler/ })
        await openBell(user, bellTrigger)

        const markAllButton = await screen.findByRole('button', { name: 'Tümünü Okundu İşaretle' })
        await user.click(markAllButton)

        await waitFor(() =>
          expect(
            vi.mocked(fetch).mock.calls.some(
              ([u, init]) => String(u).endsWith('/api/notifications/read-all') && init?.method === 'PATCH',
            ),
          ).toBe(true),
        )
      },
      MENU_SETTLE_TIMEOUT_MS + 10_000,
    )

    // AC11: with no SocketProvider connection (useSocket() returns null, e.g. no
    // session), the REST-driven parts of the bell still work with no crash.
    // Mirrors SocketContext.test.tsx's own proof that no session -> no socket.
    it(
      'still fetches the unread count, opens the dropdown, and marks notifications read when there is no socket connection',
      async () => {
        const user = userEvent.setup()
        vi.stubGlobal(
          'fetch',
          notificationFetchMock({
            unreadCount: 1,
            list: [makeNotification({ id: 'n1', request_id: null, message: 'Bağlantısız bildirim' })],
          }),
        )

        // Deliberately no seedSession(): AuthProvider has no token, so
        // SocketProvider never creates a socket and useSocket() returns null.
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <SocketProvider>
                <MemoryRouter initialEntries={['/requests']}>
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/requests" element={<div>REQUESTS PAGE</div>} />
                    </Route>
                  </Routes>
                </MemoryRouter>
              </SocketProvider>
            </AuthProvider>
          </QueryClientProvider>,
        )

        expect(mockIo).not.toHaveBeenCalled()

        await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())

        const bellTrigger = screen.getByRole('button', { name: /Bildirimler/ })
        await openBell(user, bellTrigger)

        const item = await screen.findByText('Bağlantısız bildirim')
        await user.click(item)

        await waitFor(() =>
          expect(
            vi.mocked(fetch).mock.calls.some(
              ([u, init]) => String(u).endsWith('/api/notifications/n1/read') && init?.method === 'PATCH',
            ),
          ).toBe(true),
        )
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      },
      MENU_SETTLE_TIMEOUT_MS + 10_000,
    )
  })
})
