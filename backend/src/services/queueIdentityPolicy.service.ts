import type { FormFieldType, Queue, RepeatIdentityMode, RepeatRestrictionPeriod } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { isValidTimezone } from '../utils/customerIdentity';
import { isPhoneVerificationAvailable } from './sms.service';

/**
 * The rules that decide whether a queue's repeat-visit configuration is
 * coherent, and what a customer must supply to join it.
 *
 * The central product change (ADR-034): a restricted queue is identified by
 * something the customer carries — a verified phone, or an identifier they
 * write down — never by the app installation, which a reinstall replaces.
 */

/**
 * Form-field types that can carry an identity.
 *
 * Included: the free-text scalars where a real identifier can actually be
 * written. Excluded, deliberately:
 *  - `checkbox` is a boolean — two values cannot distinguish people;
 *  - `dropdown`/`radio` are low-cardinality choices, so everyone picking the
 *    same option would collide into one identity;
 *  - `date` alone identifies nobody (many people share a birthday).
 */
export const IDENTITY_FIELD_TYPES: FormFieldType[] = ['text', 'number', 'email', 'phone'];

export interface RepeatPolicyInput {
  allowRepeatVisits: boolean;
  repeatRestrictionPeriod?: RepeatRestrictionPeriod | null;
  repeatIdentityMode?: RepeatIdentityMode | null;
  repeatIdentityFieldKey?: string | null;
  timezone?: string | null;
}

/** The normalized policy actually written to the queue row. */
export interface ResolvedRepeatPolicy {
  allowRepeatVisits: boolean;
  repeatRestrictionPeriod: RepeatRestrictionPeriod | null;
  repeatIdentityMode: RepeatIdentityMode | null;
  repeatIdentityFieldKey: string | null;
  timezone: string | null;
}

function needsCustomField(mode: RepeatIdentityMode): boolean {
  return mode === 'CUSTOM_FIELD' || mode === 'VERIFIED_PHONE_AND_CUSTOM_FIELD';
}

function needsVerifiedPhone(mode: RepeatIdentityMode): boolean {
  return mode === 'VERIFIED_PHONE' || mode === 'VERIFIED_PHONE_AND_CUSTOM_FIELD';
}

export const repeatPolicyHelpers = { needsCustomField, needsVerifiedPhone };

/**
 * Validates a queue's repeat configuration and returns what to store.
 *
 * An allowed queue clears every identity setting: leaving a half-configured
 * policy behind would make a later re-enable silently inherit a stale rule.
 * Historical claims are never touched — turning a restriction off must not
 * destroy the record of who already visited (ADR-034).
 */
export async function resolveRepeatPolicy(
  queueId: string | null,
  formFieldsSource: { queueId: string; version: number } | null,
  input: RepeatPolicyInput,
): Promise<ResolvedRepeatPolicy> {
  if (input.allowRepeatVisits) {
    return {
      allowRepeatVisits: true,
      repeatRestrictionPeriod: null,
      repeatIdentityMode: null,
      repeatIdentityFieldKey: null,
      timezone: null,
    };
  }

  const period = input.repeatRestrictionPeriod ?? null;
  const mode = input.repeatIdentityMode ?? null;
  if (!period || !mode) {
    throw new AppError(
      422,
      'IDENTITY_POLICY_REQUIRED',
      'A queue that restricts repeat visits must say how often a customer may return and how customers are identified.',
    );
  }

  if (needsVerifiedPhone(mode) && !isPhoneVerificationAvailable()) {
    // Fail safe: better to refuse the configuration than to create a queue
    // whose customers can never complete the verification it demands.
    throw new AppError(
      409,
      'PHONE_VERIFICATION_UNAVAILABLE',
      'Verified phone identification is unavailable because this server has no SMS provider configured.',
    );
  }

  let timezone: string | null = null;
  if (period !== 'ONCE_EVER') {
    const candidate = input.timezone?.trim();
    if (!candidate) {
      throw new AppError(
        422,
        'QUEUE_TIMEZONE_REQUIRED',
        'Choose the timezone this queue uses, so a day, week or month ends at the right moment for your customers.',
      );
    }
    if (!isValidTimezone(candidate)) {
      throw new AppError(422, 'INVALID_TIMEZONE', 'That is not a recognized timezone.');
    }
    timezone = candidate;
  }

  let identityFieldKey: string | null = null;
  if (needsCustomField(mode)) {
    const key = input.repeatIdentityFieldKey?.trim();
    if (!key) {
      throw new AppError(
        422,
        'IDENTITY_FIELD_REQUIRED',
        'Choose which form question identifies the customer.',
      );
    }
    await assertUsableIdentityField(formFieldsSource ?? (queueId ? { queueId, version: -1 } : null), key);
    identityFieldKey = key;
  }

  return {
    allowRepeatVisits: false,
    repeatRestrictionPeriod: period,
    repeatIdentityMode: mode,
    repeatIdentityFieldKey: identityFieldKey,
    timezone,
  };
}

/**
 * The chosen field must exist on the queue's current form, carry a type that
 * can hold an identifier, and be required — an optional identity question
 * would let anyone skip the restriction by leaving it blank.
 *
 * Requiredness is enforced rather than silently flipped: quietly changing a
 * form the admin is looking at is more surprising than telling them what to
 * fix, and the dashboard offers only required fields anyway.
 */
export async function assertUsableIdentityField(
  source: { queueId: string; version: number } | null,
  key: string,
): Promise<void> {
  if (!source) {
    throw new AppError(
      422,
      'IDENTITY_FIELD_REQUIRED',
      'Add the form question that identifies the customer before restricting repeat visits.',
    );
  }

  const version =
    source.version >= 0
      ? source.version
      : (await prisma.queue.findUnique({ where: { id: source.queueId } }))?.formVersion ?? 1;

  const field = await prisma.queueFormField.findFirst({
    where: { queueId: source.queueId, version, key },
  });

  if (!field) {
    throw new AppError(
      422,
      'IDENTITY_FIELD_NOT_FOUND',
      'That form question does not exist on this queue.',
    );
  }
  if (!IDENTITY_FIELD_TYPES.includes(field.type)) {
    throw new AppError(
      422,
      'IDENTITY_FIELD_TYPE_INVALID',
      'That question cannot identify a customer. Choose a text, number, email or phone question.',
    );
  }
  if (!field.required) {
    throw new AppError(
      422,
      'IDENTITY_FIELD_MUST_BE_REQUIRED',
      'The question that identifies the customer must be a required question.',
    );
  }
}

/**
 * Guards the form builder: a queue cannot lose the question its restriction
 * depends on, or have it turned into something that cannot identify anyone,
 * while that restriction is still switched on. Rejecting here is what stops
 * a queue reaching a state where it restricts by a field that no longer
 * exists.
 */
export async function assertIdentityFieldSurvives(
  queue: Pick<Queue, 'allowRepeatVisits' | 'repeatIdentityMode' | 'repeatIdentityFieldKey'>,
  nextFields: { key: string; type: FormFieldType; required: boolean }[],
): Promise<void> {
  if (queue.allowRepeatVisits || !queue.repeatIdentityMode || !queue.repeatIdentityFieldKey) {
    return;
  }
  if (!needsCustomField(queue.repeatIdentityMode)) {
    return;
  }

  const replacement = nextFields.find((field) => field.key === queue.repeatIdentityFieldKey);
  if (!replacement) {
    throw new AppError(
      409,
      'IDENTITY_FIELD_IN_USE',
      'This queue identifies customers by that question. Change the repeat-visit settings before removing it.',
    );
  }
  if (!IDENTITY_FIELD_TYPES.includes(replacement.type) || !replacement.required) {
    throw new AppError(
      409,
      'IDENTITY_FIELD_IN_USE',
      'This queue identifies customers by that question, so it must stay a required text, number, email or phone question.',
    );
  }
}

/** What a customer must provide to join, derived from the stored policy —
 * exposed publicly so the app can render the right flow before attempting a
 * join it would otherwise fail. */
export function describeJoinRequirements(queue: {
  allowRepeatVisits: boolean;
  repeatRestrictionPeriod: RepeatRestrictionPeriod | null;
  repeatIdentityMode: RepeatIdentityMode | null;
  repeatIdentityFieldKey: string | null;
}) {
  if (queue.allowRepeatVisits) {
    return {
      repeatRestricted: false as const,
      restrictionPeriod: null,
      identityMode: null,
      identityFieldKey: null,
      requiresVerifiedPhone: false,
      configurationRequired: false,
    };
  }

  // A restricted queue with no identity method is one that predates this
  // feature. It is reported as needing configuration rather than silently
  // enforcing the old installation rule, which a reinstall bypassed.
  if (!queue.repeatIdentityMode || !queue.repeatRestrictionPeriod) {
    return {
      repeatRestricted: true as const,
      restrictionPeriod: null,
      identityMode: null,
      identityFieldKey: null,
      requiresVerifiedPhone: false,
      configurationRequired: true,
    };
  }

  return {
    repeatRestricted: true as const,
    restrictionPeriod: queue.repeatRestrictionPeriod,
    identityMode: queue.repeatIdentityMode,
    identityFieldKey: needsCustomField(queue.repeatIdentityMode)
      ? queue.repeatIdentityFieldKey
      : null,
    requiresVerifiedPhone: needsVerifiedPhone(queue.repeatIdentityMode),
    configurationRequired: false,
  };
}
