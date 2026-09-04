import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { apiGet } from '@/lib/api'
import type { AuthUser } from '@/lib/authStorage'

vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  GoogleLogin: () => <div>MockGoogleLogin</div>,
}))

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

function setPath(path: string) {
  window.history.pushState({}, '', path)
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
  } as unknown as Response
}

describe('App routing', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setPath('/')
  })

  // AC1: unauthenticated user hitting "/" is redirected to /login, real "/" content never rendered
  it('redirects an unauthenticated visitor to /login instead of rendering the home page', async () => {
    setPath('/')

    render(<App />)

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(screen.queryByText(/Hoş geldin/)).not.toBeInTheDocument()
  })

  // AC2: authenticated user hitting "/" sees the app shell and is redirected to /requests
  it('renders the app shell and redirects to /requests for an authenticated visitor', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    seedSession()
    setPath('/')

    render(<App />)

    await waitFor(() => expect(screen.getByText('Taleplerim')).toBeInTheDocument())
    // Logout now lives inside the sidebar user menu (trigger button), not as
    // standalone visible text — assert the trigger renders instead.
    expect(screen.getByRole('button', { name: /Taha/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  // AC3: authenticated user hitting /login is redirected to /requests, login form never rendered
  it('redirects an authenticated visitor away from /login to /requests', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    seedSession()
    setPath('/login')

    render(<App />)

    await waitFor(() => expect(screen.getByText('Taleplerim')).toBeInTheDocument())
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  // AC5 / AC8: a 401 from any non-auth API call logs the user out (session storage cleared),
  // clears the TanStack Query cache, and the user ends up redirected to /login.
  it('logs out, clears the query cache, and redirects to /login on a generic 401', async () => {
    const clearSpy = vi.spyOn(QueryClient.prototype, 'clear')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    seedSession()
    setPath('/')

    render(<App />)

    await waitFor(() => expect(screen.getByText('Taleplerim')).toBeInTheDocument())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
    await expect(apiGet('/api/requests')).rejects.toThrow()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(sessionStorage.getItem('opspulse_token')).toBeNull()
    expect(sessionStorage.getItem('opspulse_user')).toBeNull()
    expect(clearSpy).toHaveBeenCalled()
  })

  // AC4 (integration-level): a 401 from the login endpoint itself must not trigger the global
  // logout/redirect wiring -- the visitor should stay on /login (already there for an unauthenticated user).
  it('does not trigger the logout wiring for a 401 from the login endpoint', async () => {
    setPath('/login')

    render(<App />)

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { message: 'Email veya şifre hatalı' }))
    await expect(apiGet('/api/auth/login')).rejects.toThrow()

    // still on the login form, nothing crashed or navigated away
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })
})
