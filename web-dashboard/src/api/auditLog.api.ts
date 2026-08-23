import { apiFetch } from './client';
import type { AuditLogEntry } from '../types/auditLog';

export function listAuditLogs(page = 1, pageSize = 20) {
  return apiFetch<AuditLogEntry[]>('/api/audit-logs', { query: { page, pageSize } });
}
