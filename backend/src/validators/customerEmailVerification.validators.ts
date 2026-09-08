import { z } from 'zod';

/** Email is accepted as free text and normalized server-side — the client
 * must not be the one deciding what counts as the same mailbox. */
export const startCustomerEmailVerificationSchema = {
  body: z.object({
    queueId: z.string().uuid('queueId must be a valid id.'),
    email: z.string().trim().min(3).max(254),
  }),
};

export const confirmCustomerEmailVerificationSchema = {
  body: z.object({
    verificationId: z.string().uuid('verificationId must be a valid id.'),
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
    email: z.string().trim().min(3).max(254),
  }),
};
