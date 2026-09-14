import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { type AuthUser } from '@/lib/authStorage'

// Google-created EMPLOYEE accounts start with no department; they must pass
// the completion screen before any other page. Falsy check, not `=== null`,
// so a user object missing the field entirely is caught too.
function needsDepartment(user: AuthUser): boolean {
  return user.role === 'EMPLOYEE' && !user.department_id
}

export function ProtectedRoute() {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
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
  if (!needsDepartment(user)) {
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
