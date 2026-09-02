/**
 * The 12 events defined by the specification (section 8), plus token.cancelled
 * (V2 Checkpoint 7, ADR-029) — CANCELLED is a new real token lifecycle state
 * the specification predates, so the minimal matching lifecycle event is
 * added here rather than overloading an existing event type.
 */
export const SOCKET_EVENTS = {
  QUEUE_CREATED: 'queue.created',
  QUEUE_UPDATED: 'queue.updated',
  QUEUE_STATUS_CHANGED: 'queue.status_changed',
  TOKEN_CREATED: 'token.created',
  TOKEN_CALLED: 'token.called',
  TOKEN_STARTED: 'token.started',
  TOKEN_COMPLETED: 'token.completed',
  TOKEN_SKIPPED: 'token.skipped',
  TOKEN_CANCELLED: 'token.cancelled',
  TOKEN_POSITION_CHANGED: 'token.position_changed',
  COUNTER_CREATED: 'counter.created',
  COUNTER_UPDATED: 'counter.updated',
  COUNTER_STATUS_CHANGED: 'counter.status_changed',
} as const;

export type SocketEventType = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/**
 * One consistent envelope (approved Phase 4 decision 5). Only identifiers
 * relevant to the event are populated; `data` is shaped per the receiving
 * room's security tier (organization = full staff detail, queue/token =
 * public-safe subsets) by the emit layer, not by this type.
 */
export interface SocketEventEnvelope<T = unknown> {
  type: SocketEventType;
  organizationId: string;
  queueId?: string;
  tokenId?: string;
  data: T;
}
