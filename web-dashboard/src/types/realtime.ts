/** Mirrors backend/src/realtime/events.ts (approved Phase 4 decision 1). */
export const SOCKET_EVENTS = [
  'queue.created',
  'queue.updated',
  'queue.status_changed',
  'token.created',
  'token.called',
  'token.started',
  'token.completed',
  'token.skipped',
  'token.cancelled',
  'token.position_changed',
  'counter.created',
  'counter.updated',
  'counter.status_changed',
] as const;

export type SocketEventType = (typeof SOCKET_EVENTS)[number];

export interface SocketEventEnvelope<T = unknown> {
  type: SocketEventType;
  organizationId: string;
  queueId?: string;
  tokenId?: string;
  data: T;
}

export interface JoinAck {
  success: boolean;
  error?: { code: string; message: string };
}
