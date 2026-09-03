import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute() {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
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
