import { render, screen, within } from '@testing-library/react'
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
  it('clears the session when "Çıkış Yap" is clicked', async () => {
    const user = userEvent.setup()
    renderShell({ ...fakeUser, role: 'EMPLOYEE' })

    expect(sessionStorage.getItem('opspulse_token')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Çıkış Yap' }))

    expect(sessionStorage.getItem('opspulse_token')).toBeNull()
    expect(sessionStorage.getItem('opspulse_user')).toBeNull()
  })

  // AC1/AC6: content renders through <Outlet/>
  it('renders the routed page content inside the shell', () => {
    renderShell({ ...fakeUser, role: 'EMPLOYEE' }, '/requests')
    expect(screen.getByText('REQUESTS PAGE')).toBeInTheDocument()
  })

  it('renders ComingSoon-style content for /queue without crashing', () => {
    renderShell({ ...fakeUser, role: 'ADMIN' }, '/queue')
    expect(screen.getByText('QUEUE PAGE')).toBeInTheDocument()
  })

  // AC7: active nav link is visually marked (checked as a standalone class token, since
  // the inactive/base className also contains "hover:bg-accent" as a substring)
  function hasActiveClass(element: HTMLElement) {
    return element.className.split(/\s+/).includes('bg-accent')
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

    it('shows the fallback message while keeping the sidebar rendered', () => {
      renderShell({ ...fakeUser, role: 'ADMIN' }, '/boom')

      expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument()

      const nav = screen.getByRole('navigation')
      expect(within(nav).getByText('Talepler')).toBeInTheDocument()
      expect(within(nav).getByText('Kuyruk')).toBeInTheDocument()
      expect(within(nav).getByText('Kullanıcılar')).toBeInTheDocument()
      expect(screen.getByText(/Taha/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Çıkış Yap' })).toBeInTheDocument()
    })
  })
})
