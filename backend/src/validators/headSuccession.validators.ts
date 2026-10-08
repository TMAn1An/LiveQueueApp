import { z } from 'zod';
import { emailSchema } from './auth.validators';
import { LATIN_NAME_MESSAGE, LATIN_NAME_PATTERN, LATIN_TEXT_MESSAGE, LATIN_TEXT_PATTERN } from './latinText';

/** ADR-071 D10: the fixed handover reasons. */
export const successionReason = z.enum([
  'RETIREMENT',
  'RESIGNATION',
  'END_OF_TERM',
  'ORGANIZATIONAL_RESTRUCTURING',
  'CHANGE_OF_RESPONSIBILITY',
  'PERSONAL_REASONS',
  'OTHER',
]);

export const startSuccessionSchema = {
  body: z
    .object({
      successorEmail: emailSchema,
      /** Required for a new person; an existing member's own name is used. */
      successorName: z.string().trim().min(1).max(120).regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE).optional(),
      reason: successionReason,
      /** Optional up to 500 characters; at least 10 when the reason is Other
       * (checked in the service, where the reason is known). */
      note: z.string().trim().max(500).regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE).optional(),
      /** Re-authentication: the current Head's own password. */
      currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    })
    .strict(),
};

export const successionIdParams = z.object({
  successionId: z.string().uuid('successionId must be a valid id.'),
});

export const verifySuccessionSchema = {
  params: successionIdParams,
  body: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.') }).strict(),
};

export const successionIdOnlySchema = { params: successionIdParams };

export const successorTokenQuerySchema = {
  query: z.object({ token: z.string().trim().min(1).max(200) }),
};

export const acceptSuccessionSchema = {
  body: z
    .object({
      token: z.string().trim().min(1).max(200),
      /** A new person's chosen password, or an existing member's own. */
      password: z.string().min(1).max(200),
      acknowledged: z.literal(true, { message: 'Confirm that you accept responsibility as Organization Head.' }),
    })
    .strict(),
};

export const declineSuccessionSchema = {
  body: z.object({ token: z.string().trim().min(1).max(200) }).strict(),
};
