import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

export interface SetNotificationPreferenceInput {
  reminderMinutes: number;
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

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }

  const preference = await prisma.notificationPreference.upsert({
    where: { deviceId_tokenId: { deviceId: device.id, tokenId } },
    create: {
      deviceId: device.id,
      tokenId,
      reminderMinutes: input.reminderMinutes,
      vibrationEnabled: input.vibrationEnabled ?? true,
      soundEnabled: input.soundEnabled ?? true,
      notificationsEnabled: input.notificationsEnabled ?? true,
    },
    update: {
      reminderMinutes: input.reminderMinutes,
      ...(input.vibrationEnabled !== undefined ? { vibrationEnabled: input.vibrationEnabled } : {}),
      ...(input.soundEnabled !== undefined ? { soundEnabled: input.soundEnabled } : {}),
      ...(input.notificationsEnabled !== undefined
        ? { notificationsEnabled: input.notificationsEnabled }
        : {}),
    },
  });

  return {
    tokenId: preference.tokenId,
    reminderMinutes: preference.reminderMinutes,
    vibrationEnabled: preference.vibrationEnabled,
    soundEnabled: preference.soundEnabled,
    notificationsEnabled: preference.notificationsEnabled,
    updatedAt: preference.updatedAt,
  };
}
