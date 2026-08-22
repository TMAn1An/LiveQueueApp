import { prisma } from '../../src/config/prisma';

/**
 * Cascades through Staff, Session, Queue, Service, Counter, FormField, and
 * Token via the schema's onDelete: Cascade. Device is deliberately excluded
 * from that cascade (ADR-011 — it's a global identity, not org-scoped), so
 * it's cleared separately here.
 */
export async function resetDb() {
  await prisma.organization.deleteMany({});
  await prisma.device.deleteMany({});
}
