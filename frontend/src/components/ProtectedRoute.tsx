import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { type AuthUser } from '@/lib/authStorage'

// Google-created EMPLOYEE accounts start with no department; they must pass
// the completion screen before any other page. Falsy check, not `=== null`,
// so a user object missing the field entirely is caught too.
function needsDepartment(user: AuthUser): boolean {
  return user.role === 'EMPLOYEE' && !user.department_id
}

// Admin-provisioned/reset accounts must replace their temporary password
// first. Strict check: a missing field means false.
function needsPasswordChange(user: AuthUser): boolean {
  return user.must_change_password === true
}

export function ProtectedRoute() {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
  }
  // Before the department check: the backend blocks the department
  // endpoint while the password flag is on.
  if (needsPasswordChange(user)) {
    return <Navigate to="/change-password" replace />
  }
  if (needsDepartment(user)) {
    return <Navigate to="/complete-profile" replace />
  }
  return <Outlet />
}

export function IncompleteProfileRoute() {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
  }
  if (needsPasswordChange(user)) {
    return <Navigate to="/change-password" replace />
  }
  if (!needsDepartment(user)) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

export function PasswordChangeRoute() {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
  }
  if (!needsPasswordChange(user)) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

export function GuestOnlyRoute() {
  const { user } = useAuth()
  if (user) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}
