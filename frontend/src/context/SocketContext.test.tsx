import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { SocketProvider, useSocket } from './SocketContext'
import type { AuthUser } from '@/lib/authStorage'

// Real socket.io-client is mocked so no actual WebSocket connection is
// attempted in jsdom — SocketProvider calls createSocket()/io() for real
// whenever a token is present.
const { mockSocket, mockIo } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const mockSocket = {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler)
    }),
    disconnect: vi.fn(),
    __emit: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload))
    },
    __listeners: listeners,
  }
  const mockIo = vi.fn(() => mockSocket)
  return { mockSocket, mockIo }
})

vi.mock('socket.io-client', () => ({ io: mockIo }))

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

function Probe() {
  const socket = useSocket()
  return <div>{socket ? 'connected' : 'no-socket'}</div>
}

function LogoutButton() {
  const { logout } = useAuth()
  return (
    <button type="button" onClick={logout}>
      logout
    </button>
  )
}

describe('SocketContext', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    mockSocket.emit.mockClear()
    mockSocket.on.mockClear()
    mockSocket.off.mockClear()
    mockSocket.disconnect.mockClear()
    mockSocket.__listeners.clear()
    mockIo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // AC1: no socket is created when there's no session
  it('does not create a socket when there is no session', () => {
    render(
      <AuthProvider>
        <SocketProvider>
          <Probe />
        </SocketProvider>
      </AuthProvider>,
    )

    expect(screen.getByText('no-socket')).toBeInTheDocument()
    expect(mockIo).not.toHaveBeenCalled()
  })

  // AC1: a socket is created while a session exists
  it('creates a socket when a session exists', () => {
    seedSession(fakeUser)

    render(
      <AuthProvider>
        <SocketProvider>
          <Probe />
        </SocketProvider>
      </AuthProvider>,
    )

    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(mockIo).toHaveBeenCalled()
  })

  // AC1: logging out tears the socket connection down
  it('disconnects the socket on logout', async () => {
    const user = userEvent.setup()
    seedSession(fakeUser)

    render(
      <AuthProvider>
        <SocketProvider>
          <Probe />
          <LogoutButton />
        </SocketProvider>
      </AuthProvider>,
    )

    expect(screen.getByText('connected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'logout' }))

    expect(mockSocket.disconnect).toHaveBeenCalled()
    expect(screen.getByText('no-socket')).toBeInTheDocument()
  })

  // useSocket must be used within a SocketProvider
  describe('when used outside a SocketProvider', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('throws', () => {
      expect(() =>
        render(
          <AuthProvider>
            <Probe />
          </AuthProvider>,
        ),
      ).toThrow('useSocket must be used within a SocketProvider')
    })
  })
})
