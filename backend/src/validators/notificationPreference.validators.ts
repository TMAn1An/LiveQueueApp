import { z } from 'zod';
import { tokenIdParams } from './token.validators';

export const setNotificationPreferenceSchema = {
  params: tokenIdParams,
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
    // Spec 7.18: customer-configurable, minimum 2 minutes.
    reminderMinutes: z.coerce.number().int().min(2, 'reminderMinutes must be at least 2.').max(120),
    vibrationEnabled: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
  }),
};
