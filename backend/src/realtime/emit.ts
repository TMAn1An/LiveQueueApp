import type { Counter, Queue } from '@prisma/client';
import { logger } from '../config/logger';
import * as tokenService from '../services/token.service';
import { SOCKET_EVENTS, type SocketEventEnvelope, type SocketEventType } from './events';
import { organizationRoom, queueRoom, tokenRoom } from './rooms';
import { getIO } from './socketServer';

/**
 * Every exported function in this module is guaranteed to never throw —
 * a socket emission failure must never turn an already-successful,
 * already-committed REST operation into an HTTP failure (approved Phase 4
 * decision 6). Controllers call these after already sending the HTTP
 * response, with no try/catch of their own needed.
 */
async function guarded(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, 'Real-time event emission failed');
  }
}

function emitToRoom(room: string, type: SocketEventType, envelope: SocketEventEnvelope): void {
  const io = getIO();
  if (!io) {
    // Socket server not attached — most REST-only tests, and any deployment
    // that hasn't wired up realtime yet. Safe no-op, not an error.
    return;
  }
  io.to(room).emit(type, envelope);
}

// ---------------------------------------------------------------------------
// Queue events — organization room gets full detail; the queue room only
// ever gets queue.status_changed, and only a public-safe subset
// (approved Phase 4 decision 2).
// ---------------------------------------------------------------------------

export function emitQueueCreated(queue: Queue & Record<string, unknown>): Promise<void> {
  return guarded(() => {
    emitToRoom(organizationRoom(queue.organizationId), SOCKET_EVENTS.QUEUE_CREATED, {
      type: SOCKET_EVENTS.QUEUE_CREATED,
      organizationId: queue.organizationId,
      queueId: queue.id,
      data: queue,
    });
  });
}

export function emitQueueUpdated(queue: Queue & Record<string, unknown>): Promise<void> {
  return guarded(() => {
    emitToRoom(organizationRoom(queue.organizationId), SOCKET_EVENTS.QUEUE_UPDATED, {
      type: SOCKET_EVENTS.QUEUE_UPDATED,
      organizationId: queue.organizationId,
      queueId: queue.id,
      data: queue,
    });
  });
}

export function emitQueueStatusChanged(queue: Queue & Record<string, unknown>): Promise<void> {
  return guarded(() => {
    const base = {
      type: SOCKET_EVENTS.QUEUE_STATUS_CHANGED,
      organizationId: queue.organizationId,
      queueId: queue.id,
    } as const;

    emitToRoom(organizationRoom(queue.organizationId), SOCKET_EVENTS.QUEUE_STATUS_CHANGED, {
      ...base,
      data: queue,
    });
    // Queue room: public-safe subset only — never the full record (decision 2).
    emitToRoom(queueRoom(queue.id), SOCKET_EVENTS.QUEUE_STATUS_CHANGED, {
      ...base,
      data: { id: queue.id, status: queue.status },
    });
  });
}

// ---------------------------------------------------------------------------
// Counter events — organization room only. Counter details are staff-only
// and must never reach the public queue room (approved Phase 4 decision 2 /
// the tenant-isolation risk identified in the readiness review).
// ---------------------------------------------------------------------------

function emitCounterEvent(type: SocketEventType, counter: Counter, organizationId: string): Promise<void> {
  return guarded(() => {
    emitToRoom(organizationRoom(organizationId), type, {
      type,
      organizationId,
      queueId: counter.queueId,
      data: counter,
    });
  });
}

export const emitCounterCreated = (counter: Counter, organizationId: string) =>
  emitCounterEvent(SOCKET_EVENTS.COUNTER_CREATED, counter, organizationId);

export const emitCounterUpdated = (counter: Counter, organizationId: string) =>
  emitCounterEvent(SOCKET_EVENTS.COUNTER_UPDATED, counter, organizationId);

export const emitCounterStatusChanged = (counter: Counter, organizationId: string) =>
  emitCounterEvent(SOCKET_EVENTS.COUNTER_STATUS_CHANGED, counter, organizationId);

// ---------------------------------------------------------------------------
// Token events — organization room gets the full staff view; the token's
// own room gets the customer-safe view only, and never for token.created
// (a customer can't have joined a room for an id that didn't exist yet) —
// approved Phase 4 decision 2.
// ---------------------------------------------------------------------------

function emitTokenLifecycleEvent(type: SocketEventType, tokenId: string): Promise<void> {
  return guarded(async () => {
    const io = getIO();
    if (!io) return; // skip the (otherwise wasted) view-building queries too

    const staffView = await tokenService.getTokenStaffView(tokenId);
    const organizationId = staffView.organizationId;
    const queueId = staffView.queueId;

    emitToRoom(organizationRoom(organizationId), type, {
      type,
      organizationId,
      queueId,
      tokenId,
      data: staffView,
    });

    if (type !== SOCKET_EVENTS.TOKEN_CREATED) {
      const customerView = await tokenService.getTokenCustomerView(tokenId);
      emitToRoom(tokenRoom(tokenId), type, {
        type,
        organizationId,
        queueId,
        tokenId,
        data: customerView,
      });
    }
  });
}

export const emitTokenCreated = (tokenId: string) =>
  emitTokenLifecycleEvent(SOCKET_EVENTS.TOKEN_CREATED, tokenId);
export const emitTokenCalled = (tokenId: string) =>
  emitTokenLifecycleEvent(SOCKET_EVENTS.TOKEN_CALLED, tokenId);
export const emitTokenStarted = (tokenId: string) =>
  emitTokenLifecycleEvent(SOCKET_EVENTS.TOKEN_STARTED, tokenId);
export const emitTokenCompleted = (tokenId: string) =>
  emitTokenLifecycleEvent(SOCKET_EVENTS.TOKEN_COMPLETED, tokenId);
export const emitTokenSkipped = (tokenId: string) =>
  emitTokenLifecycleEvent(SOCKET_EVENTS.TOKEN_SKIPPED, tokenId);
/** V2 Checkpoint 7 (ADR-029) — mirrors every other lifecycle emitter exactly
 * (staff-full to the org room, customer-safe to the token room), both of
 * which are already guaranteed OTP-free by toStaffView/toCustomerView. */
export const emitTokenCancelled = (tokenId: string) =>
  emitTokenLifecycleEvent(SOCKET_EVENTS.TOKEN_CANCELLED, tokenId);

/**
 * Recomputes and emits position_changed for every currently-WAITING token
 * in a queue (approved Phase 4 decision 4; broadened in V2 Checkpoint 4 —
 * see ADR-026). Pre-Checkpoint-4, only tokens *behind* a just-removed
 * sequence number needed recomputing, since estimatedWaitMinutes was a
 * pure function of one token's own position. Under the real multi-counter
 * FCFS simulation, every WAITING token's ETA depends on the current state
 * of every active counter — a duration override, a start, or a skip from
 * CALLED/IN_PROGRESS (freeing a counter without removing anyone from
 * WAITING) can shift everyone's ETA, not just those "behind" some point —
 * so this always recomputes and emits to the whole waiting set. Queue
 * sizes in a live queue-management system stay small, so this remains
 * cheap; never broadcast to the public queue room (unchanged).
 */
export function broadcastQueueEtaUpdate(queueId: string): Promise<void> {
  return guarded(async () => {
    const io = getIO();
    if (!io) return; // skip the recompute query entirely when nothing is listening

    const positions = await tokenService.listWaitingTokenPositions(queueId);

    for (const entry of positions) {
      const base = {
        type: SOCKET_EVENTS.TOKEN_POSITION_CHANGED,
        organizationId: entry.organizationId,
        queueId: entry.queueId,
        tokenId: entry.id,
      } as const;
      const data = {
        position: entry.position,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        estimatedReadyAt: entry.estimatedReadyAt,
      };

      emitToRoom(organizationRoom(entry.organizationId), SOCKET_EVENTS.TOKEN_POSITION_CHANGED, {
        ...base,
        data,
      });
      emitToRoom(tokenRoom(entry.id), SOCKET_EVENTS.TOKEN_POSITION_CHANGED, { ...base, data });
    }
  });
}
