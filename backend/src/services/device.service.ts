import type { DeviceStatus } from '@prisma/client';
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

/**
 * Device is a deliberately global identity with no organizationId (ADR-011 /
 * ADR-016 decision 6) — blocking is a platform-wide abuse-prevention control,
 * not an organization-owned resource. This listing is therefore global too,
 * not tenant-scoped; see ADR-019 for the tenant-visibility tradeoff this
 * surfaces now that it has a dashboard page, and why redesigning Device to be
 * per-organization is out of Phase 6's scope (would reverse an already
 * approved Phase 3 architecture decision).
 */
export async function listDevices(page: number, pageSize: number, status?: DeviceStatus) {
  const where = status ? { status } : {};
  const [devices, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.device.count({ where }),
  ]);

  return {
    data: devices,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function setDeviceStatus(deviceId: string, status: DeviceStatus) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }
  return prisma.device.update({ where: { id: deviceId }, data: { status } });
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
