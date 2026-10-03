import { apiFetch } from './client';
import type { ServiceHistoryEntry, ServiceHistoryStatus } from '../types/serviceHistory';

export interface ServiceHistoryFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  queueId?: string;
  status?: ServiceHistoryStatus;
  from?: string;
  to?: string;
  /** ADR-069: one Admin's workspace (Head / Manager). */
  adminId?: string;
}

export function listServiceHistory({
  page = 1,
  pageSize = 20,
  search,
  queueId,
  status,
  from,
  to,
  adminId,
}: ServiceHistoryFilters = {}) {
  return apiFetch<ServiceHistoryEntry[]>('/api/service-history', {
    query: {
      page,
      pageSize,
      // Empty strings are omitted entirely rather than sent as blank
      // filters — apiFetch skips undefined values.
      search: search || undefined,
      queueId: queueId || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      adminId: adminId || undefined,
    },
  });
}
