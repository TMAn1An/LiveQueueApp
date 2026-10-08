import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, disconnectSocket } from '../services/socket.service';
import { invalidationSchedulerFor } from '../services/queryInvalidation';
import type { ApiResult } from '../api/client';
import type { LiveQueueTokenRow } from '../types/dashboard';
import type { SocketEventEnvelope, SocketEventType } from '../types/realtime';

const EVENT_TYPES: SocketEventType[] = [
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
];

/**
 * One socket connection for the whole dashboard session (mounted once by
 * AppLayout), joining the staff-only organization:{id} room and invalidating
 * the TanStack Query caches the event affects — Socket.io tells the UI
 * *what changed*, PostgreSQL (via a refetch) remains the source of truth for
 * *what the new state actually is* (CLAUDE.md section 5 / ADR-002).
 *
 * The organization room is (re-)joined on every 'connect' event, not just
 * the first — including after a reconnect, since the server keeps no
 * cross-disconnect room membership (Phase 4 ADR-017 decision 7). Each
 * (re)connect also invalidates every relevant query as a resync, matching
 * the mobile app's "never assume a missed event will be replayed" approach
 * (ADR-018 decision 1).
 *
 * ADR-074: event-driven invalidations go through the shared coalescing
 * scheduler, so a burst — one `token.position_changed` per waiting person
 * after every queue change — refetches each affected view once, not once
 * per person. `token.position_changed` also patches the position and wait
 * shown on any cached live-table row straight away.
 */
export function useOrganizationSocket(organizationId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!organizationId) return;

    const socket = getSocket();

    function resyncAll() {
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['counters'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }

    function handleConnect() {
      socket.emit('join:organization', { organizationId: organizationId! }, () => {
        // Join failure (e.g. a stale/expired token at reconnect time) isn't
        // independently actionable here — the next successful reconnect
        // (or a manual page refresh) retries the join. Never surfaced as an
        // HTTP-style error since there's no request to fail.
      });
      resyncAll();
    }

    const scheduler = invalidationSchedulerFor(queryClient);

    function handleEvent(envelope: SocketEventEnvelope) {
      switch (envelope.type) {
        case 'queue.created':
        case 'queue.updated':
        case 'queue.status_changed':
          scheduler.schedule(['queues']);
          if (envelope.queueId) {
            scheduler.schedule(['queue', envelope.queueId]);
          }
          scheduler.schedule(['dashboard', 'stats']);
          break;
        case 'counter.created':
        case 'counter.updated':
        case 'counter.status_changed':
          if (envelope.queueId) {
            scheduler.schedule(['counters', envelope.queueId]);
            // ADR-064: an assignment change is a counter update — the
            // signed-in person's own counter may have just changed.
            scheduler.schedule(['counters', 'mine']);
          }
          scheduler.schedule(['dashboard', 'stats']);
          break;
        case 'token.position_changed':
          patchLiveRowPosition(envelope);
          scheduleTokenViews(envelope);
          break;
        default:
          scheduleTokenViews(envelope);
          break;
      }
    }

    // All token.* events affect the live dashboard table and stats, and the
    // waiting counts shown on queue headers and the list.
    function scheduleTokenViews(envelope: SocketEventEnvelope) {
      scheduler.schedule(['dashboard']);
      scheduler.schedule(['queues']);
      if (envelope.queueId) {
        scheduler.schedule(['queue', envelope.queueId]);
      }
    }

    // The coalesced refetch above still replaces these rows with the
    // server's; this only shows the new position and wait without waiting
    // for it.
    function patchLiveRowPosition(envelope: SocketEventEnvelope) {
      const data = envelope.data as Partial<Pick<LiveQueueTokenRow, 'position' | 'estimatedWaitMinutes'>> | null;
      if (!envelope.tokenId || !data || data.position === undefined) return;
      queryClient.setQueriesData<ApiResult<LiveQueueTokenRow[]>>({ queryKey: ['dashboard', 'tokens'] }, (old) => {
        if (!old || !old.data.some((row) => row.id === envelope.tokenId)) return old;
        return {
          ...old,
          data: old.data.map((row) =>
            row.id === envelope.tokenId
              ? {
                  ...row,
                  position: data.position ?? null,
                  estimatedWaitMinutes:
                    data.estimatedWaitMinutes === undefined ? row.estimatedWaitMinutes : data.estimatedWaitMinutes,
                }
              : row,
          ),
        };
      });
    }

    socket.on('connect', handleConnect);
    for (const type of EVENT_TYPES) {
      socket.on(type, handleEvent);
    }

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      for (const type of EVENT_TYPES) {
        socket.off(type, handleEvent);
      }
    };
  }, [organizationId, queryClient]);

  useEffect(() => {
    if (!organizationId) {
      disconnectSocket();
    }
  }, [organizationId]);
}
