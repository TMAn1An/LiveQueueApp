import { z } from 'zod';
import {
  LATIN_NAME_PATTERN,
  LATIN_NAME_MESSAGE,
  LATIN_TEXT_PATTERN,
  LATIN_TEXT_MESSAGE,
} from './latinText';
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES } from '../utils/reminderMinutes';

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
  /** ADR-049: what a completed visit uses up — the whole queue, or only the
   * assigned session occurrence. SESSION needs the schedule on (checked in
   * queueIdentityPolicy.service, which knows the queue's schedule state). */
  repeatRestrictionScope: z.enum(['QUEUE', 'SESSION']).optional(),
  /** ADR-035: no longer part of the repeat-visit form. It lives in the
   * queue's own settings as an override of the organization's zone, and is
   * normally never sent at all. */
  timezone: z.string().trim().min(1).max(64).nullable().optional(),
};

const queueStatus = z.enum(['ACTIVE', 'PAUSED', 'INACTIVE']);

export const queueIdParams = z.object({
  queueId: z.string().uuid('queueId must be a valid id.'),
});

/**
 * Phase 4: the schedule master switch and its two scalar options. Left
 * entirely out of createQueueSchema — a brand-new queue always starts
 * unscheduled (scheduleEnabled defaults false at the DB level, matching
 * every existing queue), and sessions cannot be created before the queue
 * itself exists. An admin turns scheduling on and adds sessions afterward
 * via PUT /:queueId and the /:queueId/sessions endpoints.
 */
const scheduleFields = {
  // ADR-068: whether this queue appears on the organization's public page.
  listedOnOrganizationPage: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleDailyCapacity: z.number().int().positive().max(100_000).nullable().optional(),
  scheduleVisibleToCustomers: z.boolean().optional(),
};

/** The queue's default reminder time, within the same range a customer may
 * choose from in the app (ADR-062). */
const queueReminderMinutes = z
  .number()
  .int()
  .min(MIN_REMINDER_MINUTES, `Reminder must be at least ${MIN_REMINDER_MINUTES} minutes.`)
  .max(MAX_REMINDER_MINUTES, `Reminder must be at most ${MAX_REMINDER_MINUTES} minutes.`);

export const createQueueSchema = {
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Queue name is required.')
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE),
    description: z
      .string()
      .trim()
      .max(1000)
      .regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE)
      .optional(),
    clientTerminology: z
      .string()
      .trim()
      .max(60)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE)
      .optional(),
    tokenPrefix: z.string().trim().min(1, 'Token prefix is required.').max(10),
    startingNumber: z.number().int().positive().default(1),
    baseTimeMinutes: z.number().int().positive().default(5),
    defaultNotificationMinutes: queueReminderMinutes.default(10),
    status: queueStatus.default('ACTIVE'),
    allowRepeatVisits: z.boolean().default(true),
    // ADR-055: both are decided here, once, and are fixed for the queue's
    // lifetime — updateQueue refuses any later change.
    allowMultipleServices: z.boolean().default(true),
    // The service-start verification code is off unless the creator turns it
    // on (ADR-055 reverses ADR-041's on-by-default).
    requireServiceStartOtp: z.boolean().default(false),
    ...repeatPolicyFields,
  }),
};

export const updateQueueSchema = {
  params: queueIdParams,
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE)
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000)
      .regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE)
      .optional(),
    clientTerminology: z
      .string()
      .trim()
      .max(60)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE)
      .optional(),
    tokenPrefix: z.string().trim().min(1).max(10).optional(),
    startingNumber: z.number().int().positive().optional(),
    baseTimeMinutes: z.number().int().positive().optional(),
    defaultNotificationMinutes: queueReminderMinutes.optional(),
    allowRepeatVisits: z.boolean().optional(),
    // ADR-055: accepted only so a change can be refused with a clear
    // QUEUE_SETTING_IMMUTABLE instead of being silently dropped by the parser.
    allowMultipleServices: z.boolean().optional(),
    requireServiceStartOtp: z.boolean().optional(),
    ...repeatPolicyFields,
    ...scheduleFields,
  }),
};

export const querySessionIdParams = queueIdParams.extend({
  sessionId: z.string().uuid('sessionId must be a valid id.'),
});

const sessionBodyFields = {
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  capacity: z.number().int().positive().max(100_000).nullable().optional().default(null),
};

export const createQueueSessionSchema = {
  params: queueIdParams,
  body: z.object(sessionBodyFields),
};

export const updateQueueSessionSchema = {
  params: querySessionIdParams,
  body: z.object(sessionBodyFields),
};

export const deleteQueueSessionSchema = {
  params: querySessionIdParams,
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
