import { z } from 'zod';

/**
 * The repeat-visit identity policy (ADR-034). Every field is optional here
 * and cross-validated in queueIdentityPolicy.service — the coherence rules
 * ("a restricted queue needs a period and a mode", "a recurring period needs
 * a timezone") are business rules, not shape rules, and belong with the
 * service that also has to read the queue's form fields.
 */
const repeatPolicyFields = {
  repeatRestrictionPeriod: z.enum(['ONCE_EVER', 'DAILY', 'WEEKLY', 'MONTHLY']).nullable().optional(),
  repeatIdentityMode: z
    .enum(['VERIFIED_PHONE', 'CUSTOM_FIELD', 'VERIFIED_PHONE_AND_CUSTOM_FIELD'])
    .nullable()
    .optional(),
  repeatIdentityFieldKey: z.string().trim().min(1).max(120).nullable().optional(),
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
