import type { SocketEventEnvelope, JoinAck } from '../types/realtime';

/** Mirrors backend/src/realtime/types.ts's ClientToServerEvents/ServerToClientEvents. */
export interface ClientEvents {
  'join:organization': (payload: { organizationId: string }, ack: (res: JoinAck) => void) => void;
}

export interface ServerEvents {
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
