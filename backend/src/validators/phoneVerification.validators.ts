import { z } from 'zod';

/** Phone is accepted as free text and normalized server-side — the client
 * must not be the one deciding what counts as the same number. */
export const startPhoneVerificationSchema = {
  body: z.object({
    queueId: z.string().uuid('queueId must be a valid id.'),
    phone: z.string().trim().min(4).max(32),
  }),
};

export const confirmPhoneVerificationSchema = {
  body: z.object({
    verificationId: z.string().uuid('verificationId must be a valid id.'),
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
    phone: z.string().trim().min(4).max(32),
  }),
};
