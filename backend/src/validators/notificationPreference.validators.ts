import { z } from 'zod';
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES } from '../utils/reminderMinutes';
import { tokenIdParams } from './token.validators';

export const setNotificationPreferenceSchema = {
  params: tokenIdParams,
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
    // Spec 7.18: customer-configurable, minimum 2 minutes. Null or omitted
    // means the customer chose none of their own and the queue's default
    // applies (ADR-062). Null is matched before the coercion so it is never
    // read as the number 0.
    reminderMinutes: z
      .union([
        z.null(),
        z.coerce
          .number()
          .int()
          .min(MIN_REMINDER_MINUTES, `reminderMinutes must be at least ${MIN_REMINDER_MINUTES}.`)
          .max(MAX_REMINDER_MINUTES, `reminderMinutes must be at most ${MAX_REMINDER_MINUTES}.`),
      ])
      .optional(),
    vibrationEnabled: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
  }),
};
