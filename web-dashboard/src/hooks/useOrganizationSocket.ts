import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, disconnectSocket } from '../services/socket.service';
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

    function handleEvent(envelope: SocketEventEnvelope) {
      switch (envelope.type) {
        case 'queue.created':
        case 'queue.updated':
        case 'queue.status_changed':
          void queryClient.invalidateQueries({ queryKey: ['queues'] });
          if (envelope.queueId) {
            void queryClient.invalidateQueries({ queryKey: ['queue', envelope.queueId] });
          }
          void queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
          break;
        case 'counter.created':
        case 'counter.updated':
        case 'counter.status_changed':
          if (envelope.queueId) {
            void queryClient.invalidateQueries({ queryKey: ['counters', envelope.queueId] });
          }
          void queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
          break;
        default:
          // All token.* events affect the live dashboard table and stats.
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          break;
      }
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
