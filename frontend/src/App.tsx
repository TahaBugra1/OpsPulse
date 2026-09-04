import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AppShell, getLandingPath } from '@/components/AppShell'
import { GuestOnlyRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { setUnauthorizedHandler } from '@/lib/api'
import ComingSoon from '@/pages/ComingSoon'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import Profile from '@/pages/Profile'
import RequestDetail from '@/pages/RequestDetail'
import Requests from '@/pages/Requests'

const queryClient = new QueryClient()

function AuthWiring() {
  const { logout } = useAuth()

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout()
      queryClient.clear()
    })
    return () => setUnauthorizedHandler(null)
  }, [logout])

  return null
}

function RootRedirect() {
  const { user } = useAuth()
  return <Navigate to={getLandingPath(user!.role)} replace />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
        <AuthProvider>
          <AuthWiring />
          <BrowserRouter>
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route index element={<RootRedirect />} />
                  <Route path="/requests" element={<Requests />} />
                  <Route path="/requests/:id" element={<RequestDetail />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/queue" element={<ComingSoon title="Kuyruk" />} />
                  <Route path="/admin/users" element={<ComingSoon title="Kullanıcılar" />} />
                </Route>
              </Route>
              <Route element={<GuestOnlyRoute />}>
                <Route path="/login" element={<Login />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          <Toaster />
        </AuthProvider>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  )
}

export default App
