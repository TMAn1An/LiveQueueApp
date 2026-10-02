import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { effectiveReminderMinutes, queueDefaultReminderMinutes } from '../utils/reminderMinutes';
import { getTokenStatus } from './token.service';

export interface SetNotificationPreferenceInput {
  /** The customer's own reminder time. Null or omitted: they chose none, and
   * the queue's default applies (ADR-062). */
  reminderMinutes?: number | null;
  vibrationEnabled?: boolean;
  soundEnabled?: boolean;
  notificationsEnabled?: boolean;
}

/**
 * Spec §15/§29.7's NotificationPreference model (Phase 7 Step 7). Scoped to
 * (deviceId, tokenId) — a customer's reminder preference is per queue-join,
 * not one global device setting. The device is resolved by its self-asserted
 * deviceIdentifier (no device auth exists, ADR-011) but the resolved device
 * must actually own the token — a device cannot set preferences on a token
 * that isn't its own. A 404 (not 403) on mismatch, matching this codebase's
 * existing convention of never confirming a resource's existence across a
 * tenant/ownership boundary a caller isn't inside.
 *
 * The response states the reminder time actually in force and where it came
 * from, plus the token's current estimate, so the app can show the customer
 * the truth — including that a reminder longer than the wait cannot give
 * them that much notice — without repeating any of this logic itself.
 */
export async function setNotificationPreference(
  tokenId: string,
  deviceIdentifier: string,
  input: SetNotificationPreferenceInput,
) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { queue: { select: { defaultNotificationMinutes: true } } },
  });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }

  // Always written, never merged: leaving the choice out is how the app says
  // "back to the queue's default", and that has to clear an earlier choice.
  const customReminderMinutes = input.reminderMinutes ?? null;

  const preference = await prisma.notificationPreference.upsert({
    where: { deviceId_tokenId: { deviceId: device.id, tokenId } },
    create: {
      deviceId: device.id,
      tokenId,
      reminderMinutes: customReminderMinutes,
      vibrationEnabled: input.vibrationEnabled ?? true,
      soundEnabled: input.soundEnabled ?? true,
      notificationsEnabled: input.notificationsEnabled ?? true,
    },
    update: {
      reminderMinutes: customReminderMinutes,
      ...(input.vibrationEnabled !== undefined ? { vibrationEnabled: input.vibrationEnabled } : {}),
      ...(input.soundEnabled !== undefined ? { soundEnabled: input.soundEnabled } : {}),
      ...(input.notificationsEnabled !== undefined
        ? { notificationsEnabled: input.notificationsEnabled }
        : {}),
    },
  });

  const { status, estimatedWaitMinutes } = await getTokenStatus(tokenId);

  return {
    tokenId: preference.tokenId,
    reminderMinutes: effectiveReminderMinutes(
      preference.reminderMinutes,
      token.queue.defaultNotificationMinutes,
    ),
    reminderSource: preference.reminderMinutes === null ? 'QUEUE_DEFAULT' : 'CUSTOMER',
    queueDefaultReminderMinutes: queueDefaultReminderMinutes(token.queue.defaultNotificationMinutes),
    vibrationEnabled: preference.vibrationEnabled,
    soundEnabled: preference.soundEnabled,
    notificationsEnabled: preference.notificationsEnabled,
    status,
    estimatedWaitMinutes,
    updatedAt: preference.updatedAt,
  };
}
