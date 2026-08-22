import { prisma } from '../config/prisma';

/**
 * Idempotent get-or-create: a device that registers twice (or is implicitly
 * resolved during token creation without a prior explicit register call)
 * just gets its lastSeenAt bumped, never a duplicate row (ADR-011).
 */
export async function registerDevice(deviceIdentifier: string) {
  return prisma.device.upsert({
    where: { deviceIdentifier },
    create: { deviceIdentifier, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
  });
}
