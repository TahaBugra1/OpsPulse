// App-level socket connection lifecycle. One connection is created while a
// token is present (login) and torn down when it's gone (logout) — pages
// that need live updates consume it via `useSocket()` and attach their own
// listeners; this provider only owns the connection itself.

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { useAuth } from './AuthContext'
import { createSocket } from '@/lib/socket'

const SocketContext = createContext<Socket | null | undefined>(undefined)

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => {
    if (!token) {
      setSocket(null)
      return
    }
    const s = createSocket()
    setSocket(s)
    return () => {
      s.disconnect()
    }
  }, [token])

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
}

/**
 * Returns the current app-wide socket connection, or `null` if there isn't
 * one yet (no token / not connected). `null` is a normal state — callers
 * should treat it the same as "no live updates available" and keep working
 * off REST, not surface it as an error.
 */
export function useSocket(): Socket | null {
  const context = useContext(SocketContext)
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}
