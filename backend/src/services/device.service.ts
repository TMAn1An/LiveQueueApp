import { Prisma, type Device } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

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

/** The shape the dashboard consumes — `status` here is this organization's
 * block state (from OrganizationDeviceBlock), never the raw global
 * Device.status column (see the OrganizationDeviceBlock model comment in
 * schema.prisma for why that column is no longer authoritative). */
function toDeviceResponse(device: Device, isBlocked: boolean) {
  return {
    id: device.id,
    deviceIdentifier: device.deviceIdentifier,
    status: isBlocked ? ('BLOCKED' as const) : ('ACTIVE' as const),
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

/**
 * Device is a deliberately global identity with no organizationId (ADR-011 /
 * ADR-016 decision 6) — the identifier itself is still a platform-wide
 * concept. But blocking is now organization-scoped (OrganizationDeviceBlock),
 * so this listing is scoped to devices that have actually interacted with
 * the authenticated organization's queues (via Token), and each device's
 * `status` reflects only this organization's block relationship — never
 * another organization's. A device is never shown merely because a different
 * organization has blocked it.
 */
export async function listDevices(
  organizationId: string,
  page: number,
  pageSize: number,
  status?: 'ACTIVE' | 'BLOCKED',
) {
  const where = {
    tokens: { some: { organizationId } },
    ...(status
      ? {
          organizationBlocks: {
            [status === 'BLOCKED' ? 'some' : 'none']: { organizationId },
          },
        }
      : {}),
  };

  const [devices, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { organizationBlocks: { where: { organizationId } } },
    }),
    prisma.device.count({ where }),
  ]);

  return {
    data: devices.map((d) => toDeviceResponse(d, d.organizationBlocks.length > 0)),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * Blocking is an upsert on the (organizationId, deviceId) compound unique key
 * — blocking an already-blocked device for the same organization is
 * idempotent, never creates a duplicate row.
 *
 * Prisma 6.12 does not compile this compound-key upsert into a native
 * Postgres ON CONFLICT — it runs as a SELECT existence check followed by an
 * INSERT, both inside one transaction (confirmed by inspecting the actual
 * emitted SQL). Two genuinely concurrent first-time block requests for the
 * same (organizationId, deviceId) can therefore both pass the existence
 * check before either commits; the loser's INSERT then hits the unique
 * constraint and Prisma throws P2002. The database is never wrong (the
 * constraint guarantees exactly one row either way) — but without this catch,
 * the loser's HTTP response would be a spurious 409 CONFLICT instead of the
 * idempotent 200 the caller actually asked for (the requested state — this
 * organization has blocked this device — is already true by the time the
 * error is thrown). Scoped narrowly to P2002 on OrganizationDeviceBlock
 * specifically, so an unrelated constraint violation still propagates.
 */
export async function blockDevice(organizationId: string, deviceId: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  try {
    await prisma.organizationDeviceBlock.upsert({
      where: { organizationId_deviceId: { organizationId, deviceId } },
      create: { organizationId, deviceId },
      update: {},
    });
  } catch (error) {
    const isConcurrentBlockRace =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      error.meta?.modelName === 'OrganizationDeviceBlock';
    if (!isConcurrentBlockRace) {
      throw error;
    }
  }

  return toDeviceResponse(device, true);
}

/**
 * Deletes only the block row belonging to (organizationId, deviceId) — never
 * touches another organization's block, never touches the global Device row.
 * A device that isn't blocked by this organization (whether it's blocked by
 * a *different* organization, or not blocked at all, or doesn't exist)
 * deletes zero rows, which is reported as 404 — the same
 * hide-cross-tenant-existence convention used elsewhere (e.g.
 * findCounterScoped/findTokenScoped), so this never reveals whether another
 * organization has a block on the device.
 */
export async function unblockDevice(organizationId: string, deviceId: string) {
  const result = await prisma.organizationDeviceBlock.deleteMany({
    where: { organizationId, deviceId },
  });
  if (result.count === 0) {
    throw new AppError(404, 'DEVICE_BLOCK_NOT_FOUND', 'No block found for this device.');
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }
  return toDeviceResponse(device, false);
}

/**
 * Phase 7 Step 7. One row per device — a device's FCM token can rotate
 * (reinstall, Firebase-initiated refresh), so registering a new one
 * replaces the old one via upsert on the unique deviceId, never
 * accumulates rows. Resolves/creates the Device the same way
 * registerDevice does (self-asserted deviceIdentifier — there is no device
 * authentication mechanism in this codebase, ADR-011), so a device
 * registering an FCM token can only ever touch its own row.
 */
export async function registerFcmToken(deviceIdentifier: string, fcmToken: string) {
  const device = await registerDevice(deviceIdentifier);

  const record = await prisma.deviceFcmToken.upsert({
    where: { deviceId: device.id },
    create: { deviceId: device.id, fcmToken },
    update: { fcmToken },
  });

  return { deviceId: device.id, updatedAt: record.updatedAt };
}
