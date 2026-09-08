import { useQuery } from '@tanstack/react-query';
import * as dashboardApi from '../api/dashboard.api';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => (await dashboardApi.getDashboardStats()).data,
    // Real-time events keep this fresh, but a light poll covers the gap
    // before the socket connects or after a missed reconnect (spec 34: don't
    // poll aggressively when Socket.io can provide the update).
    refetchInterval: 30_000,
  });
}

/** The queue id is part of the cache key, so switching queues never shows
 * the previous queue's line while the new one loads (ADR-036). */
export function useLiveQueueTable(page = 1, pageSize = 20, queueId?: string) {
  return useQuery({
    queryKey: ['dashboard', 'tokens', page, pageSize, queueId ?? 'all'],
    queryFn: async () => dashboardApi.getLiveQueueTable(page, pageSize, queueId),
    refetchInterval: 30_000,
  });
}
