import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { registerDevice } from './device.service';

/**
 * ADR-068: Web Push subscriptions for the Safari portal, owned by a browser
 * installation (Device, keyed by its random browserInstallationId).
 *
 * The same trust model as FCM token registration: public, no account, the
 * device identifier is the capability. A subscription endpoint belongs to
 * exactly one installation; registering it again (same browser, rotated
 * keys, or a reset installation id) moves it rather than duplicating it.
 */

/** Old subscriptions beyond this per installation are dropped, newest kept. */
const MAX_SUBSCRIPTIONS_PER_DEVICE = 5;

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function registerSubscription(deviceIdentifier: string, subscription: SubscriptionInput) {
  const device = await registerDevice(deviceIdentifier);
  const now = new Date();
  const saved = await prisma.webPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      deviceId: device.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      lastSeenAt: now,
    },
    update: {
      deviceId: device.id,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      lastSeenAt: now,
      failureCount: 0,
    },
  });

  const extra = await prisma.webPushSubscription.findMany({
    where: { deviceId: device.id },
    orderBy: { lastSeenAt: 'desc' },
    skip: MAX_SUBSCRIPTIONS_PER_DEVICE,
    select: { id: true },
  });
  if (extra.length > 0) {
    await prisma.webPushSubscription.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
  }

  return { id: saved.id, createdAt: saved.createdAt, lastSeenAt: saved.lastSeenAt };
}

/** Removes a subscription — only the installation that owns it may. */
export async function unregisterSubscription(deviceIdentifier: string, endpoint: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found.');
  }
  const { count } = await prisma.webPushSubscription.deleteMany({
    where: { endpoint, deviceId: device.id },
  });
  if (count === 0) {
    throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found.');
  }
}

/** Whether this installation currently holds at least one subscription. */
export async function hasSubscription(deviceIdentifier: string): Promise<boolean> {
  const count = await prisma.webPushSubscription.count({
    where: { device: { deviceIdentifier } },
  });
  return count > 0;
}
