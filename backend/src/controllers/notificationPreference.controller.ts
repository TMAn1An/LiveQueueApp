import type { Request, Response } from 'express';
import * as notificationPreferenceService from '../services/notificationPreference.service';

export async function set(req: Request, res: Response) {
  const { deviceIdentifier, ...preferenceInput } = req.body as {
    deviceIdentifier: string;
    reminderMinutes: number;
    vibrationEnabled?: boolean;
    soundEnabled?: boolean;
    notificationsEnabled?: boolean;
  };

  const preference = await notificationPreferenceService.setNotificationPreference(
    req.params.tokenId as string,
    deviceIdentifier,
    preferenceInput,
  );

  res.status(200).json({ success: true, data: preference });
}
