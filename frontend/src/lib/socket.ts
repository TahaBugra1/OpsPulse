// Thin Socket.io client wrapper. Only handles connection creation — the
// JWT is passed via the handshake `auth` field (not a header), matching
// the backend's expectation. Attaching listeners for specific events
// (request:updated, request:commented, notification:created, ...)
// belongs to the features that use the socket, not here.

import { type Socket, io } from 'socket.io-client'
import { getStoredToken } from './authStorage'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

/** Creates a new Socket.io connection authenticated with the current JWT. */
export function createSocket(): Socket {
  return io(API_URL, {
    auth: { token: getStoredToken() },
  })
}
