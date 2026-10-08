import { prisma } from '../../src/config/prisma';

/**
 * Cascades through Staff, Session, Queue, Service, Counter, FormField, Token
 * and the ADR-071 governance history via the schema's onDelete: Cascade.
 * Device is a global identity (ADR-011) and is cleared separately. Audit
 * rows have no foreign key; ADR-071's triggers allow deleting them only once
 * their organization is gone, which is the order used here. Deletion
 * receipts are permanent by design, so the test database truncates them.
 */
export async function resetDb() {
  await prisma.organization.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.$executeRawUnsafe('TRUNCATE "organization_deletion_receipts"');
}

/**
 * Test-only: reproduces a legacy (pre-ADR-069) Head-managed queue — a live
 * queue without an Admin. No product path can create that state any more
 * (ADR-071's `queues_live_requires_admin` trigger refuses it), but rows from
 * before workspaces still exist and must keep working, so their behaviour
 * stays under test. The trigger is suspended only around this one update.
 */
export async function makeLegacyAdminlessQueues(queueIds: string[]) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "queues" DISABLE TRIGGER "queues_live_requires_admin"'),
    prisma.queue.updateMany({ where: { id: { in: queueIds } }, data: { adminId: null } }),
    prisma.$executeRawUnsafe('ALTER TABLE "queues" ENABLE TRIGGER "queues_live_requires_admin"'),
  ]);
}

/** Test-only: creates a legacy Head-managed (Admin-less) queue — see
 * makeLegacyAdminlessQueues. */
export async function createLegacyAdminlessQueue(data: { organizationId: string; name: string; tokenPrefix: string }) {
  const [, queue] = await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "queues" DISABLE TRIGGER "queues_live_requires_admin"'),
    prisma.queue.create({ data }),
    prisma.$executeRawUnsafe('ALTER TABLE "queues" ENABLE TRIGGER "queues_live_requires_admin"'),
  ]);
  return queue;
}
