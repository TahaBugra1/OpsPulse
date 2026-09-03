// Thin fetch wrapper. Attaches the bearer token automatically and exposes
// a minimal set of generic helpers. Endpoint-specific functions (login,
// register, getRequests, ...) are intentionally NOT defined here — they
// belong to the features that consume this client.

import { getStoredToken } from './authStorage'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export const AUTH_LOGIN_PATH = '/api/auth/login'
export const AUTH_GOOGLE_PATH = '/api/auth/google'

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getStoredToken()

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    if (response.status === 401 && path !== AUTH_LOGIN_PATH && path !== AUTH_GOOGLE_PATH) {
      unauthorizedHandler?.()
    }

    const message =
      (data && typeof data === 'object' && 'message' in data && String(data.message)) ||
      `İstek başarısız oldu (${response.status})`
    throw new ApiError(response.status, data, message)
  }

  return data as T
}

export const apiGet = <T>(path: string) => apiRequest<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, body)
export const apiPatch = <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, body)
