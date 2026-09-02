import { apiFetch } from './client';
import type { AuditLogEntry } from '../types/auditLog';

export function listAuditLogs(page = 1, pageSize = 20, search?: string) {
  return apiFetch<AuditLogEntry[]>('/api/audit-logs', {
    query: { page, pageSize, search: search || undefined },
  });
}
