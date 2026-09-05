import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'

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
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/requests" element={<div>REQUESTS PAGE</div>} />
            <Route path="/queue" element={<div>QUEUE PAGE</div>} />
            <Route path="/admin/users" element={<div>USERS PAGE</div>} />
            <Route path="/profile" element={<div>PROFILE PAGE</div>} />
            <Route path="/boom" element={<Bomb />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
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

  // AC4: DEPARTMENT_AUTHORITY sidebar shows "Kuyruk" then "Talepler", no "Kullanıcılar"
  it('shows "Kuyruk" then "Talepler", and no "Kullanıcılar", for a DEPARTMENT_AUTHORITY user', () => {
    renderShell({ ...fakeUser, role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' })

    const nav = screen.getByRole('navigation')
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Kuyruk', 'Talepler'])
    expect(within(nav).queryByText('Kullanıcılar')).not.toBeInTheDocument()
  })

  // AC4: ADMIN sidebar shows all three, in "Talepler", "Kuyruk", "Kullanıcılar" order
  it('shows "Talepler", "Kuyruk", "Kullanıcılar" in that order for an ADMIN user', () => {
    renderShell({ ...fakeUser, role: 'ADMIN' })

    const nav = screen.getByRole('navigation')
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Talepler', 'Kuyruk', 'Kullanıcılar'])
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
})
