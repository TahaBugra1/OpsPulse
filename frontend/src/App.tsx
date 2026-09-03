import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { GuestOnlyRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { setUnauthorizedHandler } from '@/lib/api'
import Home from '@/pages/Home'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'

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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
        <AuthProvider>
          <AuthWiring />
          <BrowserRouter>
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Home />} />
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
