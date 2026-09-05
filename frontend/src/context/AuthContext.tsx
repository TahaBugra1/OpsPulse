import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import {
  type AuthUser,
  clearStoredSession,
  getStoredToken,
  getStoredUser,
  setStoredSession,
  setStoredUser,
} from '@/lib/authStorage'

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser, rememberMe: boolean) => void
  updateUser: (user: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())
  const [token, setToken] = useState<string | null>(() => getStoredToken())

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      login: (nextToken, nextUser, rememberMe) => {
        setStoredSession(nextToken, nextUser, rememberMe)
        setToken(nextToken)
        setUser(nextUser)
      },
      updateUser: (nextUser) => {
        setStoredUser(nextUser)
        setUser(nextUser)
      },
      logout: () => {
        clearStoredSession()
        setToken(null)
        setUser(null)
      },
    }),
    [user, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
