import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import { GuestOnlyRoute, IncompleteProfileRoute, PasswordChangeRoute, ProtectedRoute } from './ProtectedRoute'

// A COMPLETE user: an EMPLOYEE whose department_id is set. department_id must be
// non-null here, because a departmentless EMPLOYEE is exactly the new
// "forced completion screen" condition, not the ordinary authenticated case.
const fakeUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: 'dept-1',
}

// What a first-time Google account looks like before the completion screen:
// EMPLOYEE with department_id still null (POST /api/auth/google inserts NULL).
const departmentlessEmployee: AuthUser = { ...fakeUser, department_id: null }

const departmentAuthority: AuthUser = {
  ...fakeUser,
  role: 'DEPARTMENT_AUTHORITY',
  department_id: 'dept-1',
}

// ADMINs legitimately have no department at all - they must never be diverted.
const admin: AuthUser = { ...fakeUser, role: 'ADMIN', department_id: null }

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
          <Route path="/complete-profile" element={<div>COMPLETE PROFILE</div>} />
          <Route path="/change-password" element={<div>CHANGE PASSWORD</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

function renderIncompleteProfile(initialPath = '/complete-profile') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<IncompleteProfileRoute />}>
            <Route path="/complete-profile" element={<div>COMPLETE PROFILE</div>} />
          </Route>
          <Route path="/" element={<div>HOME CONTENT</div>} />
          <Route path="/login" element={<div>LOGIN FORM</div>} />
          <Route path="/change-password" element={<div>CHANGE PASSWORD</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

function renderPasswordChange(initialPath = '/change-password') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<PasswordChangeRoute />}>
            <Route path="/change-password" element={<div>CHANGE PASSWORD</div>} />
          </Route>
          <Route path="/" element={<div>HOME CONTENT</div>} />
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

  // AC3 (frontend half): a first-time Google user has role EMPLOYEE and no
  // department, so every protected route diverts to the completion screen.
  it('redirects an EMPLOYEE with no department to /complete-profile, never to the protected content', () => {
    seedSession('tok-123', departmentlessEmployee)

    renderProtected('/')

    expect(screen.getByText('COMPLETE PROFILE')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
    expect(screen.queryByText('LOGIN FORM')).not.toBeInTheDocument()
  })

  // AC5: an EMPLOYEE who already has a department is never diverted.
  it('does not redirect an EMPLOYEE who already has a department', () => {
    seedSession('tok-123', fakeUser)

    renderProtected('/')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
  })

  // AC5: a DEPARTMENT_AUTHORITY always has a department (DB CHECK) - never diverted.
  it('does not redirect a DEPARTMENT_AUTHORITY', () => {
    seedSession('tok-123', departmentAuthority)

    renderProtected('/')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
  })

  // AC5: an ADMIN legitimately has department_id = null and must NOT be treated
  // as an incomplete profile - the check is role-aware, not a bare null check.
  it('does not redirect an ADMIN even though their department_id is null', () => {
    seedSession('tok-123', admin)

    renderProtected('/')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
  })

  // AC3: the password flag wins over the department check - the backend blocks
  // PATCH /api/users/me/department while the flag is on, so /complete-profile
  // would be a dead end.
  it('redirects a flagged EMPLOYEE with no department to /change-password, not /complete-profile', () => {
    seedSession('tok-123', { ...departmentlessEmployee, must_change_password: true })

    renderProtected('/')

    expect(screen.getByText('CHANGE PASSWORD')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })

  // AC3: every role is diverted while flagged.
  it('redirects a flagged DEPARTMENT_AUTHORITY and a flagged ADMIN to /change-password', () => {
    seedSession('tok-123', { ...departmentAuthority, must_change_password: true })
    const authorityView = renderProtected('/')
    expect(screen.getByText('CHANGE PASSWORD')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
    authorityView.unmount()

    sessionStorage.clear()
    seedSession('tok-123', { ...admin, must_change_password: true })
    renderProtected('/')
    expect(screen.getByText('CHANGE PASSWORD')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })

  // Sessions persisted before the field existed lack it entirely: missing = false.
  it('renders protected content for a stored user without a must_change_password field', () => {
    const legacyUser = { ...fakeUser }
    expect('must_change_password' in legacyUser).toBe(false)
    seedSession('tok-123', legacyUser)

    renderProtected('/')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('CHANGE PASSWORD')).not.toBeInTheDocument()
  })
})

describe('IncompleteProfileRoute', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  // AC3: the completion screen is reachable exactly for a departmentless EMPLOYEE.
  it('renders the completion screen for an EMPLOYEE with no department', () => {
    seedSession('tok-123', departmentlessEmployee)

    renderIncompleteProfile('/complete-profile')

    expect(screen.getByText('COMPLETE PROFILE')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })

  // AC5: visiting /complete-profile directly bounces an already-complete user away.
  it('bounces an already-complete EMPLOYEE away from /complete-profile to /', () => {
    seedSession('tok-123', fakeUser)

    renderIncompleteProfile('/complete-profile')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
  })

  // AC5: the same bounce for the other two roles, including the ADMIN whose
  // department_id is legitimately null.
  it('bounces a DEPARTMENT_AUTHORITY and an ADMIN away from /complete-profile to /', () => {
    seedSession('tok-123', departmentAuthority)
    const authorityView = renderIncompleteProfile('/complete-profile')
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
    authorityView.unmount()

    sessionStorage.clear()
    seedSession('tok-123', admin)
    renderIncompleteProfile('/complete-profile')
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
  })

  // AC3: the completion screen sits OUTSIDE ProtectedRoute, so it has to run its
  // own unauthenticated check - otherwise it would be publicly reachable.
  it('bounces an unauthenticated visitor from /complete-profile to /login', () => {
    renderIncompleteProfile('/complete-profile')

    expect(screen.getByText('LOGIN FORM')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })

  // AC3: a flagged departmentless EMPLOYEE is sent on to the password screen first.
  it('redirects a flagged EMPLOYEE with no department from /complete-profile to /change-password', () => {
    seedSession('tok-123', { ...departmentlessEmployee, must_change_password: true })

    renderIncompleteProfile('/complete-profile')

    expect(screen.getByText('CHANGE PASSWORD')).toBeInTheDocument()
    expect(screen.queryByText('COMPLETE PROFILE')).not.toBeInTheDocument()
  })
})

describe('PasswordChangeRoute', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  // The forced screen sits outside ProtectedRoute, so it runs its own auth check.
  it('bounces an unauthenticated visitor from /change-password to /login', () => {
    renderPasswordChange('/change-password')

    expect(screen.getByText('LOGIN FORM')).toBeInTheDocument()
    expect(screen.queryByText('CHANGE PASSWORD')).not.toBeInTheDocument()
  })

  // An unflagged user has nothing to change here.
  it('bounces an unflagged user from /change-password to /', () => {
    seedSession('tok-123', { ...fakeUser, must_change_password: false })

    renderPasswordChange('/change-password')

    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('CHANGE PASSWORD')).not.toBeInTheDocument()
  })

  // AC3: a flagged user reaches the forced screen.
  it('renders the outlet for a flagged user', () => {
    seedSession('tok-123', { ...fakeUser, must_change_password: true })

    renderPasswordChange('/change-password')

    expect(screen.getByText('CHANGE PASSWORD')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
    expect(screen.queryByText('LOGIN FORM')).not.toBeInTheDocument()
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
