import type { AuthContext } from '../utils/authContext';
import type { SocketEventEnvelope } from './events';

/** Per-connection state, set by socketAuth.ts. Undefined = anonymous (ADR-007). */
export interface AppSocketData {
  auth?: AuthContext;
}

export interface JoinAck {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Client-initiated room joins. Organization-room membership is never taken
 * from client input alone — the handler always verifies the requested id
 * against the socket's own database-authoritative auth context
 * (CLAUDE.md Rule 4 / approved Phase 4 decision 2).
 */
export interface ClientToServerEvents {
  'join:organization': (payload: { organizationId?: string }, ack: (res: JoinAck) => void) => void;
  'join:queue': (payload: { queueId?: string }, ack: (res: JoinAck) => void) => void;
  'join:token': (payload: { tokenId?: string }, ack: (res: JoinAck) => void) => void;
}

export interface ServerToClientEvents {
  'queue.created': (envelope: SocketEventEnvelope) => void;
  'queue.updated': (envelope: SocketEventEnvelope) => void;
  'queue.status_changed': (envelope: SocketEventEnvelope) => void;
  'token.created': (envelope: SocketEventEnvelope) => void;
  'token.called': (envelope: SocketEventEnvelope) => void;
  'token.started': (envelope: SocketEventEnvelope) => void;
  'token.completed': (envelope: SocketEventEnvelope) => void;
  'token.skipped': (envelope: SocketEventEnvelope) => void;
  'token.cancelled': (envelope: SocketEventEnvelope) => void;
  'token.position_changed': (envelope: SocketEventEnvelope) => void;
  'counter.created': (envelope: SocketEventEnvelope) => void;
  'counter.updated': (envelope: SocketEventEnvelope) => void;
  'counter.status_changed': (envelope: SocketEventEnvelope) => void;
}

export type InterServerEvents = Record<string, never>;
