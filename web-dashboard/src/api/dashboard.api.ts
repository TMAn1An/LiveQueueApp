import { apiFetch } from './client';
import type { DashboardStats, LiveQueueTokenRow } from '../types/dashboard';

export function getDashboardStats() {
  return apiFetch<DashboardStats>('/api/dashboard/stats');
}

/** ADR-036: `queueId` narrows the table to one queue's own line. Omitting it
 * keeps the organization-wide view the API has always returned. */
export function getLiveQueueTable(page = 1, pageSize = 20, queueId?: string) {
  return apiFetch<LiveQueueTokenRow[]>('/api/dashboard/tokens', {
    query: { page, pageSize, queueId: queueId || undefined },
  });
}
