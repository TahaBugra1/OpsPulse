// Single source of truth for reading/writing the persisted auth session.
//
// Convention (locked): a token lives in exactly one of sessionStorage
// (rememberMe = false, 1h token) or localStorage (rememberMe = true, 7d
// token). Both api.ts (attaching the Authorization header) and
// AuthContext.tsx (restoring the session on mount) read through here so
// there is only one place that knows the storage keys and precedence rule.

export interface AuthUser {
  id: string
  name: string
  surname: string | null
  email: string
  role: 'EMPLOYEE' | 'DEPARTMENT_AUTHORITY' | 'ADMIN'
  department_id: string | null
}

const TOKEN_KEY = 'opspulse_token'
const USER_KEY = 'opspulse_user'

/** Reads the current token. sessionStorage takes precedence over localStorage. */
export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
}

/** Reads the current user. sessionStorage takes precedence over localStorage. */
export function getStoredUser(): AuthUser | null {
  const raw = sessionStorage.getItem(USER_KEY) ?? localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

/** Persists the token/user in the correct storage for the given rememberMe choice. */
export function setStoredSession(token: string, user: AuthUser, rememberMe: boolean): void {
  const target = rememberMe ? localStorage : sessionStorage
  const other = rememberMe ? sessionStorage : localStorage
  target.setItem(TOKEN_KEY, token)
  target.setItem(USER_KEY, JSON.stringify(user))
  other.removeItem(TOKEN_KEY)
  other.removeItem(USER_KEY)
}

/** Clears the session from both storages. */
export function clearStoredSession(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
