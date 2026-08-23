import { apiFetch } from './client';
import type { DashboardStats, LiveQueueTokenRow } from '../types/dashboard';

export function getDashboardStats() {
  return apiFetch<DashboardStats>('/api/dashboard/stats');
}

export function getLiveQueueTable(page = 1, pageSize = 20) {
  return apiFetch<LiveQueueTokenRow[]>('/api/dashboard/tokens', { query: { page, pageSize } });
}
