import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import { GuestOnlyRoute, ProtectedRoute } from './ProtectedRoute'

const fakeUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: null,
}

function seedSession(token = 'tok-123', user: AuthUser = fakeUser) {
  sessionStorage.setItem('opspulse_token', token)
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

function renderProtected(initialPath = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>HOME CONTENT</div>} />
          </Route>
          <Route path="/login" element={<div>LOGIN FORM</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

function renderGuestOnly(initialPath = '/login') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<GuestOnlyRoute />}>
            <Route path="/login" element={<div>LOGIN FORM</div>} />
          </Route>
          <Route path="/" element={<div>HOME CONTENT</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  // AC1 / AC6: unauthenticated (no user for any reason) -> redirected to /login, real content never rendered
  it('redirects an unauthenticated user away from a protected route to /login', () => {
    renderProtected('/')

    expect(screen.getByText('LOGIN FORM')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })

  // AC2: authenticated user -> protected content renders normally
  it('renders the protected content for an authenticated user', () => {
    seedSession()

    renderProtected('/')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('LOGIN FORM')).not.toBeInTheDocument()
  })

  // AC7: presence of a truthy `user` alone is sufficient, regardless of whether the token is actually
  // still valid server-side -- ProtectedRoute does not decode/inspect the token.
  it('renders protected content based solely on a stored user, without validating the token', () => {
    seedSession('an-expired-or-otherwise-stale-token', fakeUser)

    renderProtected('/')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
  })
})

describe('GuestOnlyRoute', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  // AC3: authenticated user visiting /login -> auto-redirected to /, login form never rendered
  it('redirects an authenticated user away from a guest-only route to /', () => {
    seedSession()

    renderGuestOnly('/login')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('LOGIN FORM')).not.toBeInTheDocument()
  })

  // Complementary case: unauthenticated user visiting /login -> renders the login form
  it('renders the guest-only content for an unauthenticated user', () => {
    renderGuestOnly('/login')

    expect(screen.getByText('LOGIN FORM')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })
})
