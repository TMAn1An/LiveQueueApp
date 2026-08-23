import { prisma } from '../../src/config/prisma';

/**
 * Cascades through Staff, Session, Queue, Service, Counter, FormField, and
 * Token via the schema's onDelete: Cascade. Device and AuditLog are both
 * deliberately excluded from that cascade — Device because it's a global
 * identity, not org-scoped (ADR-011); AuditLog because an audit record must
 * survive organization deletion (Phase 7 Step 4) — so both are cleared
 * separately here.
 */
export async function resetDb() {
  await prisma.organization.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.auditLog.deleteMany({});
}
