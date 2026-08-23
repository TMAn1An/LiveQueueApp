/** Mirrors backend/src/services/audit.service.ts's AuditLog row shape. */
export interface AuditLogEntry {
  id: string;
  organizationId: string;
  staffId: string;
  staffEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}
