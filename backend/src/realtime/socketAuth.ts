import type { Socket } from 'socket.io';
import { resolveAuthContext } from '../utils/authContext';
import type {
  AppSocketData,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
} from './types';

export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, AppSocketData>;

/**
 * Reuses the existing Phase 3 auth utility (resolveAuthContext) — no second
 * JWT verification implementation (approved Phase 4 decision 3). The JWT is
 * read from the handshake `auth` object, per ADR-007.
 *
 * Behavior:
 * - no token            -> anonymous connection allowed (socket.data.auth stays undefined)
 * - valid token          -> socket.data.auth set to the resolved, DB-authoritative context
 * - invalid/expired token -> handshake rejected (this is the one case where a
 *   token was actually presented, so silently downgrading to anonymous would
 *   hide a real auth failure from a client that thought it was authenticated)
 * - suspended/inactive staff or organization -> resolveAuthContext already
 *   returns null for this (same DB-authoritative check as REST `authenticate`),
 *   so it is rejected identically to an invalid token.
 */
export async function socketAuthMiddleware(
  socket: AppSocket,
  next: (err?: Error) => void,
): Promise<void> {
  const token = socket.handshake.auth?.token as unknown;

  if (typeof token !== 'string' || token.length === 0) {
    next();
    return;
  }

  const auth = await resolveAuthContext(token);
  if (!auth) {
    next(new Error('UNAUTHENTICATED'));
    return;
  }

  socket.data.auth = auth;
  next();
}
