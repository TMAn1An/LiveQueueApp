import type {
  FormFieldType,
  Organization,
  Queue,
  RepeatIdentityMode,
  RepeatRestrictionType,
  RepeatRestrictionUnit,
} from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { instantFromLocalParts, isValidTimezone, unitNeedsTimezone } from '../utils/customerIdentity';
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
  repeatRestrictionType?: RepeatRestrictionType | null;
  repeatRestrictionAmount?: number | null;
  repeatRestrictionUnit?: RepeatRestrictionUnit | null;
  /** Queue-local wall-clock cutoff as `YYYY-MM-DDTHH:mm`, converted here to
   * an absolute instant. Deliberately not an ISO instant from the browser:
   * the admin means a time on the queue's clock, not on their own. */
  repeatRestrictionUntilLocal?: string | null;
  repeatIdentityMode?: RepeatIdentityMode | null;
  repeatIdentityFieldKey?: string | null;
}

/** The normalized policy actually written to the queue row. */
export interface ResolvedRepeatPolicy {
  allowRepeatVisits: boolean;
  repeatRestrictionType: RepeatRestrictionType | null;
  repeatRestrictionAmount: number | null;
  repeatRestrictionUnit: RepeatRestrictionUnit | null;
  repeatRestrictionUntil: Date | null;
  repeatIdentityMode: RepeatIdentityMode | null;
  repeatIdentityFieldKey: string | null;
}

/** A queue may not be restricted for longer than this in one step. Not a
 * security boundary — a guard against a slipped digit turning "30 days" into
 * a lifetime ban that nobody notices until a customer complains. */
const MAX_AMOUNT_BY_UNIT: Record<RepeatRestrictionUnit, number> = {
  MINUTE: 60 * 24 * 366,
  HOUR: 24 * 366,
  DAY: 366 * 10,
  WEEK: 53 * 10,
  MONTH: 120,
  YEAR: 10,
};

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
  /** The queue's effective zone, already resolved from the queue or its
   * organization. Needed only for the two configurations that involve a
   * calendar: a month/year window, and a wall-clock cutoff. */
  effectiveTimezone: string | null,
): Promise<ResolvedRepeatPolicy> {
  if (input.allowRepeatVisits) {
    return {
      allowRepeatVisits: true,
      repeatRestrictionType: null,
      repeatRestrictionAmount: null,
      repeatRestrictionUnit: null,
      repeatRestrictionUntil: null,
      repeatIdentityMode: null,
      repeatIdentityFieldKey: null,
    };
  }

  const type = input.repeatRestrictionType ?? null;
  const mode = input.repeatIdentityMode ?? null;
  if (!type || !mode) {
    throw new AppError(
      422,
      'IDENTITY_POLICY_REQUIRED',
      'A queue that restricts repeat visits must say how long a customer must wait and how customers are identified.',
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

  let amount: number | null = null;
  let unit: RepeatRestrictionUnit | null = null;
  let until: Date | null = null;

  if (type === 'DURATION') {
    amount = input.repeatRestrictionAmount ?? null;
    unit = input.repeatRestrictionUnit ?? null;
    if (!amount || !unit || !Number.isInteger(amount) || amount < 1) {
      throw new AppError(
        422,
        'REPEAT_WINDOW_REQUIRED',
        'Enter how long a customer must wait before returning.',
      );
    }
    if (amount > MAX_AMOUNT_BY_UNIT[unit]) {
      throw new AppError(
        422,
        'REPEAT_WINDOW_TOO_LONG',
        `That is longer than this queue can restrict in ${unit.toLowerCase()}s. Use a larger unit, or "only once ever".`,
      );
    }
    // Only a calendar window needs to know when the queue's day starts.
    if (unitNeedsTimezone(unit)) {
      requireTimezone(effectiveTimezone);
    }
  }

  if (type === 'UNTIL_DATETIME') {
    const zone = requireTimezone(effectiveTimezone);
    until = parseQueueLocalDateTime(input.repeatRestrictionUntilLocal, zone);
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
    repeatRestrictionType: type,
    repeatRestrictionAmount: amount,
    repeatRestrictionUnit: unit,
    repeatRestrictionUntil: until,
    repeatIdentityMode: mode,
    repeatIdentityFieldKey: identityFieldKey,
  };
}

/** A calendar-based restriction is meaningless without knowing whose
 * calendar. The zone is normally inherited from the organization and set up
 * automatically, so reaching this is a configuration gap to point at, not a
 * value to invent. */
function requireTimezone(effectiveTimezone: string | null): string {
  if (!effectiveTimezone) {
    throw new AppError(
      422,
      'QUEUE_TIMEZONE_REQUIRED',
      'Set this queue\'s timezone in its settings first — a monthly, yearly or fixed-date limit has to know when the queue\'s day ends.',
    );
  }
  if (!isValidTimezone(effectiveTimezone)) {
    throw new AppError(422, 'INVALID_TIMEZONE', 'That is not a recognized timezone.');
  }
  return effectiveTimezone;
}

/**
 * `YYYY-MM-DDTHH:mm` on the queue's clock becomes an absolute instant.
 *
 * Stored absolute rather than as text so a later correction to the queue's
 * timezone cannot silently move a cutoff an operator already announced to
 * customers.
 */
function parseQueueLocalDateTime(value: string | null | undefined, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) {
    throw new AppError(
      422,
      'REPEAT_WINDOW_REQUIRED',
      'Enter the date and time this restriction ends.',
    );
  }
  const [, year, month, day, hour, minute] = match;
  const instant = instantFromLocalParts(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: 0,
    },
    timezone,
  );
  if (Number.isNaN(instant.getTime())) {
    throw new AppError(422, 'REPEAT_WINDOW_REQUIRED', 'That is not a valid date and time.');
  }
  return instant;
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
  repeatRestrictionType: RepeatRestrictionType | null;
  repeatRestrictionAmount: number | null;
  repeatRestrictionUnit: RepeatRestrictionUnit | null;
  repeatRestrictionUntil: Date | null;
  repeatIdentityMode: RepeatIdentityMode | null;
  repeatIdentityFieldKey: string | null;
}) {
  if (queue.allowRepeatVisits) {
    return {
      repeatRestricted: false as const,
      restrictionType: null,
      restrictionAmount: null,
      restrictionUnit: null,
      restrictionUntil: null,
      identityMode: null,
      identityFieldKey: null,
      requiresVerifiedPhone: false,
      configurationRequired: false,
    };
  }

  // A restricted queue with no identity method is one that predates ADR-034.
  // It is reported as needing configuration rather than silently enforcing
  // the old installation rule, which a reinstall bypassed.
  if (!queue.repeatIdentityMode || !queue.repeatRestrictionType) {
    return {
      repeatRestricted: true as const,
      restrictionType: null,
      restrictionAmount: null,
      restrictionUnit: null,
      restrictionUntil: null,
      identityMode: null,
      identityFieldKey: null,
      requiresVerifiedPhone: false,
      configurationRequired: true,
    };
  }

  return {
    repeatRestricted: true as const,
    restrictionType: queue.repeatRestrictionType,
    restrictionAmount: queue.repeatRestrictionAmount,
    restrictionUnit: queue.repeatRestrictionUnit,
    restrictionUntil: queue.repeatRestrictionUntil,
    identityMode: queue.repeatIdentityMode,
    identityFieldKey: needsCustomField(queue.repeatIdentityMode)
      ? queue.repeatIdentityFieldKey
      : null,
    requiresVerifiedPhone: needsVerifiedPhone(queue.repeatIdentityMode),
    configurationRequired: false,
  };
}

/**
 * The zone a queue actually runs in (ADR-035).
 *
 * A queue-specific value wins, because a chain can have a branch in another
 * region; otherwise the organization's own zone applies, which is what almost
 * every queue uses and what makes per-queue configuration unnecessary. Null
 * only when neither has ever been set — every organization created since
 * ADR-035 gets one at registration.
 *
 * Deliberately never derived from the customer's device: two people in
 * different countries joining one queue must get the same answer, and that
 * answer belongs to the queue.
 */
export function resolveQueueTimezone(
  queue: Pick<Queue, 'timezone'>,
  organization: Pick<Organization, 'timezone'> | null,
): string | null {
  const own = queue.timezone?.trim();
  if (own) return own;
  const inherited = organization?.timezone?.trim();
  return inherited || null;
}

/** Loads whatever `resolveQueueTimezone` needs and answers for one queue. */
export async function loadQueueTimezone(queueId: string): Promise<string | null> {
  const queue = await prisma.queue.findUnique({
    where: { id: queueId },
    select: { timezone: true, organization: { select: { timezone: true } } },
  });
  if (!queue) return null;
  return resolveQueueTimezone(queue, queue.organization);
}
