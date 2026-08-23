import { io, type Socket } from 'socket.io-client';
import { getCurrentAccessToken } from '../api/client';
import type { ClientEvents, ServerEvents } from './socketEvents';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

let socket: Socket<ServerEvents, ClientEvents> | null = null;

/**
 * One connection for the whole app session, created lazily on first use and
 * torn down on logout. `auth` is a callback (not a static value) so every
 * reconnect attempt — not just the first connect — picks up the current
 * access token, matching the mobile app's "never assume the credential used
 * at first connect is still valid later" approach.
 */
export function getSocket(): Socket<ServerEvents, ClientEvents> {
  if (!socket) {
    socket = io(API_BASE_URL, {
      autoConnect: false,
      auth: (cb) => cb({ token: getCurrentAccessToken() }),
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
