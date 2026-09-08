import { z } from 'zod';

/**
 * The repeat-visit identity policy (ADR-034). Every field is optional here
 * and cross-validated in queueIdentityPolicy.service — the coherence rules
 * ("a restricted queue needs a period and a mode", "a recurring period needs
 * a timezone") are business rules, not shape rules, and belong with the
 * service that also has to read the queue's form fields.
 */
const repeatPolicyFields = {
  repeatRestrictionType: z.enum(['ONCE_EVER', 'DURATION', 'UNTIL_DATETIME']).nullable().optional(),
  repeatRestrictionAmount: z.number().int().positive().max(100_000).nullable().optional(),
  repeatRestrictionUnit: z
    .enum(['MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'])
    .nullable()
    .optional(),
  /** Queue-local wall clock, never an instant: the admin is naming a moment
   * on the queue's clock, and only the server knows which clock that is. */
  repeatRestrictionUntilLocal: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Enter the date and time as YYYY-MM-DD HH:mm.')
    .nullable()
    .optional(),
  // ADR-037: the two phone modes are deliberately absent — they are deferred
  // and no longer configurable. The enum values still exist in the database
  // so an old development row parses, but nothing new may be written with
  // them, and queueIdentityPolicy.service.ts refuses them again in case this
  // list and that rule ever drift apart.
  repeatIdentityMode: z
    .enum(['VERIFIED_EMAIL', 'CUSTOM_FIELD', 'VERIFIED_EMAIL_AND_CUSTOM_FIELD'])
    .nullable()
    .optional(),
  repeatIdentityFieldKey: z.string().trim().min(1).max(120).nullable().optional(),
  /** ADR-035: no longer part of the repeat-visit form. It lives in the
   * queue's own settings as an override of the organization's zone, and is
   * normally never sent at all. */
  timezone: z.string().trim().min(1).max(64).nullable().optional(),
};

const queueStatus = z.enum(['ACTIVE', 'PAUSED', 'INACTIVE']);

export const queueIdParams = z.object({
  queueId: z.string().uuid('queueId must be a valid id.'),
});

export const createQueueSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Queue name is required.').max(120),
    description: z.string().trim().max(1000).optional(),
    clientTerminology: z.string().trim().max(60).optional(),
    tokenPrefix: z.string().trim().min(1, 'Token prefix is required.').max(10),
    startingNumber: z.number().int().positive().default(1),
    baseTimeMinutes: z.number().int().positive().default(5),
    defaultNotificationMinutes: z.number().int().positive().default(10),
    status: queueStatus.default('ACTIVE'),
    allowRepeatVisits: z.boolean().default(true),
    allowMultipleServices: z.boolean().default(true),
    ...repeatPolicyFields,
  }),
};

export const updateQueueSchema = {
  params: queueIdParams,
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    clientTerminology: z.string().trim().max(60).optional(),
    tokenPrefix: z.string().trim().min(1).max(10).optional(),
    startingNumber: z.number().int().positive().optional(),
    baseTimeMinutes: z.number().int().positive().optional(),
    defaultNotificationMinutes: z.number().int().positive().optional(),
    allowRepeatVisits: z.boolean().optional(),
    allowMultipleServices: z.boolean().optional(),
    ...repeatPolicyFields,
  }),
};

export const queueIdOnlySchema = {
  params: queueIdParams,
};

export const updateQueueStatusSchema = {
  params: queueIdParams,
  body: z.object({
    status: queueStatus,
  }),
};
