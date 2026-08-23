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

export function useLiveQueueTable(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['dashboard', 'tokens', page, pageSize],
    queryFn: async () => dashboardApi.getLiveQueueTable(page, pageSize),
    refetchInterval: 30_000,
  });
}
