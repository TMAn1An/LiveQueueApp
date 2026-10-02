import type {
  Counter,
  Prisma,
  Queue,
  QueueFormField,
  RepeatIdentityMode,
  RepeatRestrictionScope,
  RepeatRestrictionType,
  RepeatRestrictionUnit,
  Token,
  TokenStatus,
} from '@prisma/client';
import { z, type ZodTypeAny } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertValidTransition } from '../utils/tokenStateMachine';
import {
  resolveCompletionFeedback,
  resolveSkipReason,
  type SkipReasonInput,
} from '../utils/skipReason';
import {
  assertMayActOnToken,
  assertStillAssigned,
  requireClaimCounter,
  type CounterActor,
} from './counterAccess.service';
import { requireOwnedQueue } from '../utils/tenantScope';
import { registerDevice } from './device.service';
import {
  computeEligibleAgainAt,
  computeIdentityFingerprint,
  normalizeCustomIdentity,
  resolveLocalMoment,
  verifyEmailVerificationProof,
  verifyPhoneVerificationProof,
  type RepeatWindow,
} from '../utils/customerIdentity';
import {
  describeJoinRequirements,
  repeatPolicyHelpers,
  resolveQueueTimezone,
} from './queueIdentityPolicy.service';
import { assignSessionForNewToken, sessionOccurrenceScopeKey } from './queueSchedule.service';
import type { AuthContext } from '../utils/authContext';
import {
  decryptOtpCode,
  encryptOtpCode,
  generateOtpCode,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_FAILED_ATTEMPTS,
  verifyOtpCode,
} from '../utils/otp';
import {
  computeEffectiveDurationMinutes,
  computeEffectiveEndTime,
  minutesUntil,
  simulateWaitingTokenEtas,
  type CounterOccupancy,
  type WaitingTokenInput,
} from './queueEtaEngine';

const QUEUE_ARCHIVED_MSG = 'This queue has been archived and can no longer accept new tokens.';
const QUEUE_NOT_ACTIVE_MSG = 'This queue is currently not accepting new customers.';

/**
 * What a restricted queue will match this joiner against, or null when the
 * queue allows repeats and therefore needs no identity at all.
 *
 * The fingerprint is always computed here from the customer's own answers
 * and a server-issued phone proof — a client-supplied fingerprint is never
 * accepted, since that would let anyone claim to be anyone.
 */
interface ResolvedCustomerIdentity {
  fingerprint: string;
  mode: RepeatIdentityMode;
  /** The queue's window, carried through so a rejection can say when the
   * customer may come back and settlement can compute it (ADR-035). */
  window: RepeatWindow;
  /** ADR-049: whether a completed visit spends the whole queue's allowance
   * or only the assigned session occurrence's. */
  scope: RepeatRestrictionScope;
}

function resolveCustomerIdentity(
  queue: Pick<
    Queue,
    | 'id'
    | 'allowRepeatVisits'
    | 'repeatRestrictionScope'
    | 'repeatRestrictionType'
    | 'repeatRestrictionAmount'
    | 'repeatRestrictionUnit'
    | 'repeatRestrictionUntil'
    | 'repeatIdentityMode'
    | 'repeatIdentityFieldKey'
  >,
  input: CreateTokenInput,
  formData: Record<string, unknown>,
): ResolvedCustomerIdentity | null {
  const requirements = describeJoinRequirements(queue);
  if (!requirements.repeatRestricted) {
    return null;
  }

  // A queue restricted before this feature existed has no identity method.
  // It refuses joins until an admin configures one, rather than silently
  // enforcing the old per-installation rule that a reinstall bypassed.
  if (requirements.configurationRequired) {
    throw new AppError(
      409,
      'QUEUE_IDENTITY_CONFIGURATION_REQUIRED',
      'This queue limits repeat visits but has not been set up to identify customers yet. Please contact the organization.',
    );
  }

  const mode = requirements.identityMode!;

  // The verified contact this identity rests on, always carried through as
  // the already-proven fingerprint rather than a raw address or number: the
  // server never has to trust a contact value from this request.
  let normalizedVerifiedContact: string | null = null;

  if (repeatPolicyHelpers.needsVerifiedEmail(mode)) {
    const proof = input.emailVerificationProof?.trim();
    if (!proof) {
      throw new AppError(
        422,
        'EMAIL_VERIFICATION_REQUIRED',
        'This queue requires a verified email address.',
      );
    }
    const provenFingerprint = verifyEmailVerificationProof(proof, queue.id);
    if (!provenFingerprint) {
      throw new AppError(
        401,
        'EMAIL_VERIFICATION_INVALID',
        'Your email verification has expired. Please verify your address again.',
      );
    }
    normalizedVerifiedContact = provenFingerprint;
  } else if (repeatPolicyHelpers.needsVerifiedPhone(mode)) {
    // Unreachable through configuration since ADR-037 — a phone-mode queue is
    // reported as configurationRequired above and never gets this far. Kept
    // so the legacy mode still behaves correctly rather than silently
    // producing an identity with no verified contact at all.
    const proof = input.phoneVerificationProof?.trim();
    if (!proof) {
      throw new AppError(
        422,
        'PHONE_VERIFICATION_REQUIRED',
        'This queue requires a verified phone number.',
      );
    }
    const provenFingerprint = verifyPhoneVerificationProof(proof, queue.id);
    if (!provenFingerprint) {
      throw new AppError(
        401,
        'PHONE_VERIFICATION_INVALID',
        'Your phone verification has expired. Please verify your number again.',
      );
    }
    normalizedVerifiedContact = provenFingerprint;
  }

  let normalizedCustomValue: string | null = null;
  if (repeatPolicyHelpers.needsCustomField(mode)) {
    const key = queue.repeatIdentityFieldKey!;
    const raw = formData[key];
    const asText = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
    normalizedCustomValue = normalizeCustomIdentity(asText);
    if (!normalizedCustomValue) {
      throw new AppError(
        422,
        'IDENTITY_VALUE_REQUIRED',
        'Please answer the question that identifies you for this queue.',
      );
    }
  }

  return {
    fingerprint: computeIdentityFingerprint({
      queueId: queue.id,
      mode,
      normalizedVerifiedContact,
      normalizedCustomValue,
    }),
    mode,
    window: {
      type: requirements.restrictionType!,
      amount: requirements.restrictionAmount,
      unit: requirements.restrictionUnit,
      until: requirements.restrictionUntil,
    },
    scope: requirements.restrictionScope ?? 'QUEUE',
  };
}

/**
 * ADR-049: the scope key every queue-wide claim carries (and every claim
 * taken before scopes existed — the column defaults to it).
 */
const QUEUE_ENTITLEMENT_SCOPE_KEY = 'QUEUE';

export interface CreateTokenInput {
  queueId: string;
  /// V2 Checkpoint 5 (ADR-027): the validator canonicalizes both the legacy
  /// `serviceId` and the new `serviceIds` request shapes into this one array
  /// (already deduplicated, length >= 1) before this ever runs.
  serviceIds: string[];
  /// Identifies the *installation*, never the person (ADR-034). Still used
  /// for FCM registration, "my current token" lookups and installation
  /// blocking — but a queue's repeat restriction is enforced against the
  /// customer identity below, which a reinstall cannot reset.
  deviceIdentifier: string;
  formData: Record<string, unknown>;
  /// Present only when the queue identifies customers by verified phone: the
  /// server-signed proof returned by the phone-verification flow. Never a
  /// client-asserted "verified" flag.
  phoneVerificationProof?: string;
  /** ADR-037: the server-issued proof that this customer read a code sent to
   * their mailbox. Never a client-asserted "verified" flag. */
  emailVerificationProof?: string;
}

/** The shape every idempotency comparison needs — the existing token's full
 * selected-service set, not just its legacy primary Token.serviceId. */
type TokenWithServices = Token & { tokenServices: { serviceId: string }[] };

interface QueueLockRow {
  id: string;
  nextTokenNumber: number;
  formVersion: number;
  status: string;
  deletedAt: Date | null;
  tokenPrefix: string;
  organizationId: string;
  /** V2 Checkpoint 6 — read under the same row lock as the active-token
   * check below, so both checks are race-free against the same lock. */
  allowRepeatVisits: boolean;
}

/**
 * token → organizationId directly (Token carries its own organizationId,
 * denormalized at creation from queue.organizationId) — never authorize
 * using tokenId alone (CLAUDE.md Rule 4).
 */
async function findTokenScoped(organizationId: string, tokenId: string): Promise<Token> {
  const token = await prisma.token.findFirst({ where: { id: tokenId, organizationId } });
  if (!token) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  return token;
}

const INTERNAL_FIELD_NAMES = [
  'serviceStartOtpCipher',
  'serviceStartOtpExpiresAt',
  'serviceStartOtpFailedAttempts',
  // ADR-034 follow-up: the identity snapshot is internal enforcement state.
  // The fingerprint is a keyed HMAC and cannot be reversed, but it is derived
  // from the customer-identity secret and nothing outside this service has
  // any use for it — so it leaves the same way the OTP cipher does, rather
  // than riding along in every staff token response.
  'identityFingerprint',
  'identityPeriodKey',
  'identityMode',
  'identityScopeKey',
] as const;

/**
 * V2 Checkpoint 7: the verification-code cipher/expiry/attempt-count are
 * customer-only-adjacent internal state — they must NEVER reach a staff or
 * customer serialization (REST response, socket payload, FCM payload, audit
 * metadata). Every function in this file that returns a raw Token object
 * (as opposed to the explicit-whitelist toCustomerView) routes its final
 * return through this, so no call site has to remember to strip them
 * individually — centralizing this once here is what makes the "search
 * every serialization path" security review in ADR-029 actually verifiable.
 */
/** A token row with every internal field stripped — what staff-facing
 * responses actually carry. */
export type SafeToken = Omit<Token, (typeof INTERNAL_FIELD_NAMES)[number]>;

function omitInternalFields<T extends Record<string, unknown>>(
  token: T,
): Omit<T, (typeof INTERNAL_FIELD_NAMES)[number]> {
  const safe = { ...token };
  for (const field of INTERNAL_FIELD_NAMES) {
    delete safe[field];
  }
  return safe;
}

/**
 * V2 Checkpoint 5 (ADR-027): a token's base required duration is the sum of
 * every selected service's own durationMinutes — the backend-authoritative
 * replacement for the single-service duration the ETA engine previously
 * received directly. Never trusts a client-supplied total; always derived
 * fresh from the DB rows.
 */
function sumServiceDurations(tokenServices: { service: { durationMinutes: number } }[]): number {
  return tokenServices.reduce((sum, ts) => sum + ts.service.durationMinutes, 0);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
    );
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) =>
        deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
}

/**
 * Dynamic per-queue validation built from the current QueueFormField rows —
 * there is no static schema for form data, since it's entirely operator
 * defined (spec section 7.6 / 9).
 *
 * The non-empty constraint (`.min(1)` / enum membership) is applied only
 * when the field is actually required — an optional field accepts either an
 * omitted key or an empty string as "no answer," not just an omitted key.
 * Real form clients (web and mobile) commonly submit "" for a blank optional
 * input rather than dropping the key entirely.
 */
function buildFieldSchema(field: QueueFormField): ZodTypeAny {
  switch (field.type) {
    case 'number':
      return field.required ? z.number() : z.number().optional();
    case 'checkbox':
      return field.required ? z.boolean() : z.boolean().optional();
    case 'dropdown':
    case 'radio':
      if (field.options.length > 0) {
        const enumSchema = z.enum(field.options as [string, ...string[]]);
        return field.required ? enumSchema : z.union([enumSchema, z.literal('')]).optional();
      }
      return field.required ? z.string().trim().min(1) : z.string().trim().optional();
    default:
      return field.required ? z.string().trim().min(1) : z.string().trim().optional();
  }
}

function buildFormDataSchema(fields: QueueFormField[]) {
  const shape: Record<string, ZodTypeAny> = {};

  for (const field of fields) {
    shape[field.key] = buildFieldSchema(field);
  }

  return z.object(shape).strict();
}

function validateFormData(
  fields: QueueFormField[],
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const schema = buildFormDataSchema(fields);
  const result = schema.safeParse(formData);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new AppError(422, 'VALIDATION_ERROR', message || 'Invalid form data.');
  }
  return result.data as Record<string, unknown>;
}

/**
 * V2 Checkpoint 5 (ADR-027): the same idempotency key must resolve to the
 * existing token only when it represents the same *set* of services —
 * order must never matter ([A,B] === [B,A]), but the actual set must
 * ([A,B] !== [A,C]). Canonicalized by sorting both sides rather than
 * trusting array order from either the stored rows or the new request.
 */
function assertIdempotentPayloadMatches(
  existing: TokenWithServices,
  input: CreateTokenInput,
  validatedFormData: Record<string, unknown>,
): void {
  const existingServiceIds = existing.tokenServices.map((ts) => ts.serviceId).sort();
  const inputServiceIds = [...input.serviceIds].sort();
  const sameServices =
    existingServiceIds.length === inputServiceIds.length &&
    existingServiceIds.every((id, i) => id === inputServiceIds[i]);

  const same = existing.queueId === input.queueId && sameServices && deepEqual(existing.formData, validatedFormData);

  if (!same) {
    throw new AppError(
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      'This idempotency key was already used with different request data.',
    );
  }
}

/**
 * Token creation, per approved Phase 3 decisions 1-4 and 13-14. Everything
 * that can independently fail is validated before the queue row is locked;
 * the lock + sequence increment + insert are the last steps, so a failed
 * transaction never leaves next_token_number advanced (ADR-003).
 */
export async function createToken(input: CreateTokenInput, idempotencyKey: string) {
  const queue = await prisma.queue.findUnique({
    where: { id: input.queueId },
    include: { organization: { select: { timezone: true } } },
  });
  if (!queue) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }
  if (queue.deletedAt) {
    throw new AppError(409, 'QUEUE_ARCHIVED', QUEUE_ARCHIVED_MSG);
  }
  if (queue.status !== 'ACTIVE') {
    throw new AppError(409, 'QUEUE_NOT_ACTIVE', QUEUE_NOT_ACTIVE_MSG);
  }

  // V2 Checkpoint 5 (ADR-027): every selected service must belong to this
  // exact queue and be active — checked as a set, never trusting a
  // client-supplied duration or count. `services.length !== serviceIds.length`
  // catches both "doesn't exist at all" and "belongs to a different queue"
  // in one comparison, matching the existing single-service 404 semantics.
  const services = await prisma.queueService.findMany({
    where: { id: { in: input.serviceIds }, queueId: input.queueId },
  });
  if (services.length !== input.serviceIds.length) {
    throw new AppError(404, 'SERVICE_NOT_FOUND', 'One or more selected services could not be found.');
  }
  if (services.some((s) => !s.isActive)) {
    throw new AppError(409, 'SERVICE_NOT_ACTIVE', 'One or more selected services are not currently available.');
  }
  // V2 Checkpoint 6: a static queue-configuration gate, not a resource
  // allocation — needs no transactional lock (unlike the checks below).
  // The legacy singular `serviceId` shape already normalizes to a
  // 1-element serviceIds array, so it always satisfies this unchanged.
  if (!queue.allowMultipleServices && input.serviceIds.length !== 1) {
    throw new AppError(
      409,
      'MULTIPLE_SERVICES_NOT_ALLOWED',
      'This queue only allows selecting a single service.',
    );
  }

  const device = await registerDevice(input.deviceIdentifier);
  // OrganizationDeviceBlock, not device.status, is authoritative — a device
  // can be blocked by one organization without affecting any other
  // (organizationId here comes from the already-resolved queue, never from
  // the customer request).
  const block = await prisma.organizationDeviceBlock.findUnique({
    where: { organizationId_deviceId: { organizationId: queue.organizationId, deviceId: device.id } },
  });
  if (block) {
    throw new AppError(403, 'DEVICE_BLOCKED', 'This device has been blocked.');
  }

  const formFields = await prisma.queueFormField.findMany({
    where: { queueId: input.queueId, version: queue.formVersion },
  });
  const formData = validateFormData(formFields, input.formData);

  // Resolved before the transaction: this is pure computation over the
  // request plus the queue's stored policy, and doing it here keeps the
  // queue lock below as short as it already was.
  const identity = resolveCustomerIdentity(queue, input, formData);

  // Fast pre-lock idempotency check — a pure optimization to avoid
  // contending for the queue lock on a known-duplicate request. The
  // authoritative check happens again below, inside the transaction.
  const preCheck = await prisma.token.findUnique({
    where: { deviceId_idempotencyKey: { deviceId: device.id, idempotencyKey } },
    include: { tokenServices: { select: { serviceId: true } } },
  });
  if (preCheck) {
    assertIdempotentPayloadMatches(preCheck, input, formData);
    return getTokenCustomerView(preCheck.id);
  }

  const created = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<QueueLockRow[]>`
      SELECT id, next_token_number AS "nextTokenNumber", form_version AS "formVersion",
             status, deleted_at AS "deletedAt", token_prefix AS "tokenPrefix",
             organization_id AS "organizationId", allow_repeat_visits AS "allowRepeatVisits"
      FROM queues WHERE id = ${input.queueId} FOR UPDATE
    `;
    const lockedQueue = rows[0];
    if (!lockedQueue) {
      throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
    }
    // Re-verified against the freshly-locked row (not the pre-lock read
    // above) to close the TOCTOU window between validation and the lock —
    // e.g. staff pausing the queue in between.
    if (lockedQueue.deletedAt) {
      throw new AppError(409, 'QUEUE_ARCHIVED', QUEUE_ARCHIVED_MSG);
    }
    if (lockedQueue.status !== 'ACTIVE') {
      throw new AppError(409, 'QUEUE_NOT_ACTIVE', QUEUE_NOT_ACTIVE_MSG);
    }

    // Authoritative idempotency re-check, taken while holding the queue
    // lock. This ordering — lock first, then check — is what prevents a
    // concurrent duplicate-key request from consuming a sequence number
    // that no token ends up using (no gaps under a duplicate-key race).
    const existing = await tx.token.findUnique({
      where: { deviceId_idempotencyKey: { deviceId: device.id, idempotencyKey } },
      include: { tokenServices: { select: { serviceId: true } } },
    });
    if (existing) {
      assertIdempotentPayloadMatches(existing, input, formData);
      return existing;
    }

    // One device may hold at most one active token per queue at a time
    // (approved design). Scoped by (deviceId, queueId) only — queueId
    // already determines organizationId, so adding it would be redundant.
    // SKIPPED (and CANCELLED) are excluded from the blocking set because
    // they are terminal — the slot frees the moment either happens, and the
    // customer may rejoin immediately with a brand new token. Checked under
    // the queue row lock acquired above, so this is race-free
    // against another concurrent createToken call for the same queue —
    // backed by a DB partial unique index (tokens_device_queue_active_key)
    // as a defense-in-depth backstop.
    const existingActive = await tx.token.findFirst({
      where: {
        deviceId: device.id,
        queueId: input.queueId,
        status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] },
      },
    });
    if (existingActive) {
      throw new AppError(
        409,
        'DEVICE_ALREADY_IN_QUEUE',
        'This device already has an active token in this queue.',
      );
    }

    // The repeat-visit rule used to live here, as a second (deviceId,
    // queueId) lookup for a COMPLETED token — which a reinstall reset, since
    // a fresh install is simply a different device row. ADR-034 moves it
    // onto the customer's own identity: the claim created alongside the
    // token below is the enforcement point now, and its unique constraint is
    // what makes it hold. The device rule above is unchanged and still
    // separate — stopping one installation from queueing twice at once is an
    // installation-scoped concern, and correctly stays one.

    // Phase 4: scheduleEnabled/scheduleDailyCapacity are a static queue-
    // configuration gate — read from the pre-lock `queue`, not the locked
    // row, exactly like the allowMultipleServices check above. The session
    // lookup and capacity COUNT below are the actual resource allocation,
    // and run only now, after the queue row lock, which is what makes them
    // race-free against a concurrent createToken call for the same queue
    // (see assignSessionForNewToken's own doc comment).
    const scheduleTimezone = resolveQueueTimezone(queue, queue.organization) ?? 'UTC';
    const sessionAssignment = queue.scheduleEnabled
      ? await assignSessionForNewToken(tx, {
          queueId: input.queueId,
          dailyCapacity: queue.scheduleDailyCapacity,
          moment: resolveLocalMoment(new Date(), scheduleTimezone),
          timezone: scheduleTimezone,
          spentOccurrenceKeys:
            identity?.scope === 'SESSION'
              ? await spentSessionOccurrenceKeys(tx, input.queueId, identity.fingerprint)
              : undefined,
        })
      : null;

    // ADR-049: which entitlement this join spends, decided from the session
    // it was just assigned to. A per-session queue with no assignment cannot
    // arise through configuration (SESSION requires the schedule); if it ever
    // did, the join falls back to the stricter queue-wide scope rather than
    // to no restriction at all.
    const occurrenceScopeKey = sessionAssignment
      ? sessionOccurrenceScopeKey(sessionAssignment.queueSessionId, sessionAssignment.assignedSessionDate)
      : null;
    const claimScopeKey =
      identity?.scope === 'SESSION' && occurrenceScopeKey ? occurrenceScopeKey : QUEUE_ENTITLEMENT_SCOPE_KEY;

    const sequenceNumber = lockedQueue.nextTokenNumber;
    await tx.queue.update({
      where: { id: input.queueId },
      data: { nextTokenNumber: sequenceNumber + 1 },
    });

    // V2 Checkpoint 5 (ADR-027): the legacy Token.serviceId column is kept
    // populated — the first service in the customer's selection — so any
    // code path still reading it directly (including an old, not-yet-
    // updated mobile app parsing this same token's future responses) keeps
    // working. tokenServices is the authoritative full set, created
    // atomically with the token itself in this same transaction/statement.
    const token = await tx.token.create({
      data: {
        organizationId: lockedQueue.organizationId,
        queueId: input.queueId,
        serviceId: input.serviceIds[0]!,
        deviceId: device.id,
        sequenceNumber,
        serialNumber: `${lockedQueue.tokenPrefix}${String(sequenceNumber).padStart(3, '0')}`,
        status: 'WAITING',
        formData: formData as Prisma.InputJsonValue,
        formVersion: lockedQueue.formVersion,
        idempotencyKey,
        // Snapshot of the identity this token was admitted under, kept for
        // the settlement read at COMPLETED (ADR-034 follow-up) even though
        // the live claim itself is deleted on skip/cancel. The window itself
        // is deliberately NOT snapshotted: it is read from the queue when the
        // visit completes, so a policy an admin corrects mid-shift takes
        // effect the way the dashboard says it does.
        identityFingerprint: identity?.fingerprint ?? null,
        identityMode: identity?.mode ?? null,
        identityScopeKey: identity ? claimScopeKey : null,
        // Phase 4: fixed at creation, never reassigned — see Token's own
        // schema doc comment for why the start/end minutes are snapshotted
        // rather than only referenced live through queueSessionId.
        queueSessionId: sessionAssignment?.queueSessionId ?? null,
        assignedSessionDate: sessionAssignment?.assignedSessionDate ?? null,
        assignedSessionStartMinute: sessionAssignment?.assignedSessionStartMinute ?? null,
        assignedSessionEndMinute: sessionAssignment?.assignedSessionEndMinute ?? null,
        assignedSessionStartsAt: sessionAssignment?.assignedSessionStartsAt ?? null,
        tokenServices: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });

    if (identity) {
      await claimIdentityForNewToken(tx, {
        organizationId: lockedQueue.organizationId,
        queueId: input.queueId,
        tokenId: token.id,
        identity,
        occurrenceScopeKey,
        claimScopeKey,
      });
    }

    return token;
  });

  return getTokenCustomerView(created.id);
}

/**
 * Why a waiting customer has no estimate. `NO_ACTIVE_COUNTER` is the honest
 * and by far most common answer: with nobody serving, any number would be
 * invented. Sent to the customer app so it can say something useful instead
 * of a bare "not available" — it names a queue-level operational state, not
 * anything about staff or other customers.
 */
export type EtaUnavailableReason = 'NO_ACTIVE_COUNTER' | 'SESSION_NOT_STARTED';

/**
 * ADR-048: a WAITING token assigned to a session that has not started yet is
 * *scheduled* — held out of the callable line until that instant. True when
 * the token carries a start instant still in the future. One definition,
 * mirrored exactly by the `assigned_session_starts_at` condition in the three
 * SQL paths (callToken's FCFS check, getWaitingTokenActionEligibility, nextToken).
 *
 * Those conditions compare against `(${now} AT TIME ZONE 'UTC')`, never the
 * bare parameter: Prisma stores DateTime as a UTC wall-clock `timestamp`
 * (no zone) but binds a JS Date as `timestamptz`, and Postgres would bridge
 * the two through the *session* TimeZone — silently off by the server's
 * offset anywhere that is not UTC.
 */
export function isAwaitingSessionStart(
  token: { assignedSessionStartsAt: Date | null },
  now: Date = new Date(),
): boolean {
  return token.assignedSessionStartsAt != null && token.assignedSessionStartsAt.getTime() > now.getTime();
}

interface QueueEtaEntry {
  id: string;
  organizationId: string;
  queueId: string;
  sequenceNumber: number;
  /** 1-based place in the callable line; null while the token is scheduled
   * for a session that has not started (ADR-048). */
  position: number | null;
  estimatedWaitMinutes: number | null;
  estimatedReadyAt: Date | null;
  etaUnavailableReason: EtaUnavailableReason | null;
}

/**
 * V2 Checkpoint 4 (ADR-026): the shared core behind both
 * computeComputedFields (single token) and listWaitingTokenPositions
 * (queue-wide batch, used by the realtime layer) — a real multi-counter
 * FCFS scheduling simulation (queueEtaEngine.ts), not the old
 * `duration × position / counters` approximation. Always simulates every
 * currently-WAITING token in the queue at once (there's no way to
 * correctly answer "when will token X be called" without knowing the state
 * of every active counter and everyone ahead of it) — queue sizes in a
 * live queue-management system are small, so this stays cheap.
 *
 * `now` is a parameter (not read internally) purely so tests can pin it;
 * every real call site uses the default.
 */
async function computeQueueEtas(queueId: string, now: Date = new Date()): Promise<QueueEtaEntry[]> {
  const [activeCounters, waitingTokens] = await Promise.all([
    prisma.counter.findMany({
      where: { queueId, status: 'ACTIVE' },
      include: {
        // At most one match per counter, by the existing busy-check
        // invariant (callToken/nextToken never let two CALLED/IN_PROGRESS
        // tokens share a counter) — never trusted as a hard guarantee here,
        // just how the data is actually shaped.
        tokens: {
          where: { status: { in: ['CALLED', 'IN_PROGRESS'] } },
          include: { tokenServices: { include: { service: true } } },
        },
      },
    }),
    prisma.token.findMany({
      where: { queueId, status: 'WAITING' },
      orderBy: { sequenceNumber: 'asc' },
      include: { tokenServices: { include: { service: true } } },
    }),
  ]);

  // ADR-048: a token whose assigned session has not started yet is not in
  // the callable line at all — it has no position, cannot be called, and is
  // given no ETA (any number would suggest service before its session
  // starts). It rejoins this computation, in sequence order, the moment its
  // session begins.
  const scheduled = waitingTokens.filter((token) => isAwaitingSessionStart(token, now));
  const callable = waitingTokens.filter((token) => !isAwaitingSessionStart(token, now));
  const scheduledEntries: QueueEtaEntry[] = scheduled.map((token) => ({
    id: token.id,
    organizationId: token.organizationId,
    queueId: token.queueId,
    sequenceNumber: token.sequenceNumber,
    position: null,
    estimatedWaitMinutes: null,
    estimatedReadyAt: null,
    etaUnavailableReason: 'SESSION_NOT_STARTED' as const,
  }));

  if (activeCounters.length === 0) {
    // No meaningful denominator — an estimate here would imply active
    // service that isn't happening (approved product decision, carried
    // forward unchanged from the pre-Checkpoint-4 design).
    return [
      ...callable.map((token, index) => ({
        id: token.id,
        organizationId: token.organizationId,
        queueId: token.queueId,
        sequenceNumber: token.sequenceNumber,
        position: index + 1,
        estimatedWaitMinutes: null,
        estimatedReadyAt: null,
        etaUnavailableReason: 'NO_ACTIVE_COUNTER' as const,
      })),
      ...scheduledEntries,
    ];
  }

  const counterOccupancy: CounterOccupancy[] = activeCounters.map((counter) => {
    const occupying = counter.tokens[0];
    if (!occupying) {
      return { freeAt: now };
    }
    // V2 Checkpoint 5 (ADR-027): the base (pre-override) duration is now
    // the sum of every selected service's own duration, not one service's
    // — the staff override, when set, still fully replaces this rather
    // than adding to it (computeEffectiveDurationMinutes's existing
    // either/or logic, unchanged).
    const durationMinutes = computeEffectiveDurationMinutes(
      occupying.requiredDurationMinutes,
      sumServiceDurations(occupying.tokenServices),
    );
    // IN_PROGRESS anchors from when service actually began (startedAt);
    // CALLED-but-not-yet-started anchors from calledAt as the best
    // available approximation of "about to start."
    const anchor = occupying.startedAt ?? occupying.calledAt ?? now;
    return { freeAt: computeEffectiveEndTime(anchor, durationMinutes, now) };
  });

  const waitingInputs: WaitingTokenInput[] = callable.map((token) => ({
    id: token.id,
    durationMinutes: sumServiceDurations(token.tokenServices),
  }));

  const etaByTokenId = simulateWaitingTokenEtas(counterOccupancy, waitingInputs);

  const callableEntries = callable.map((token, index) => {
    const estimatedReadyAt = etaByTokenId.get(token.id) ?? null;
    return {
      id: token.id,
      organizationId: token.organizationId,
      queueId: token.queueId,
      sequenceNumber: token.sequenceNumber,
      position: index + 1,
      estimatedWaitMinutes: estimatedReadyAt ? minutesUntil(estimatedReadyAt, now) : null,
      estimatedReadyAt,
      // Capacity exists, so any missing value here is a genuine anomaly
      // rather than the expected "nobody is serving" case — deliberately
      // left unexplained rather than mislabelled.
      etaUnavailableReason: null,
    };
  });
  return [...callableEntries, ...scheduledEntries];
}

async function computeComputedFields(token: Token): Promise<ComputedFields> {
  if (token.status !== 'WAITING') {
    return {
      position: null,
      estimatedWaitMinutes: null,
      estimatedReadyAt: null,
      etaUnavailableReason: null,
    };
  }

  const entries = await computeQueueEtas(token.queueId);
  const entry = entries.find((e) => e.id === token.id);
  return entry
    ? {
        position: entry.position,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        estimatedReadyAt: entry.estimatedReadyAt,
        etaUnavailableReason: entry.etaUnavailableReason,
      }
    : {
        position: null,
        estimatedWaitMinutes: null,
        estimatedReadyAt: null,
        etaUnavailableReason: null,
      };
}

/**
 * Batch equivalent of computeComputedFields, for every currently-WAITING
 * token in one queue at once — used by the realtime layer to recompute
 * ETAs after anything that could shift them (approved Phase 4 decision 4,
 * broadened in V2 Checkpoint 4: not just a token leaving WAITING, but any
 * change to counter occupancy — call/start/complete/skip/a staff duration
 * override — since every WAITING token's ETA now depends on the
 * state of every active counter, not just its own position).
 */
export async function listWaitingTokenPositions(queueId: string): Promise<QueueEtaEntry[]> {
  return computeQueueEtas(queueId);
}

/**
 * Customer-safe view (approved decision 8): no organizationId, deviceId,
 * idempotencyKey, or formVersion — only what the customer needs to track
 * their own token, plus which counter to go to once called.
 */
type ComputedFields = {
  position: number | null;
  estimatedWaitMinutes: number | null;
  /** V2 Checkpoint 4: server-authoritative anchor for the mobile live
   * countdown — the client ticks locally against this timestamp and
   * re-anchors whenever a fresh one arrives, never treating its own clock
   * as authoritative (Rule F). */
  estimatedReadyAt: Date | null;
  /** Why the two fields above are null, when the reason is a known
   * operational state rather than an anomaly. Lets the customer app explain
   * the wait instead of showing a bare "unavailable". */
  etaUnavailableReason: EtaUnavailableReason | null;
};

interface SelectedService {
  id: string;
  name: string;
  durationMinutes: number;
}

/** Deterministic order (the queue's own service-menu order), not insertion
 * order into the join table — every response that lists a token's selected
 * services shows them the same way regardless of how they were submitted. */
type TokenWithSelectedServices = { tokenServices: { service: { id: string; serviceName: string; durationMinutes: number; createdAt: Date } }[] };

function toSelectedServices(token: TokenWithSelectedServices): SelectedService[] {
  return [...token.tokenServices]
    .sort((a, b) => a.service.createdAt.getTime() - b.service.createdAt.getTime())
    .map((ts) => ({ id: ts.service.id, name: ts.service.serviceName, durationMinutes: ts.service.durationMinutes }));
}

const TOKEN_SERVICES_INCLUDE = {
  tokenServices: { include: { service: { select: { id: true, serviceName: true, durationMinutes: true, createdAt: true } } } },
} satisfies Prisma.TokenInclude;

function toCustomerView(
  token: Token & { counter?: Counter | null } & TokenWithSelectedServices,
  computed: ComputedFields,
  /** ADR-035: the queue's own zone, so the app can show the queue's clock
   * beside the customer's when they differ. A fact about the queue, never
   * derived from the device reading it. */
  queueTimezone: string | null = null,
  /** ADR-041: whether this token's queue uses the service-start code — the
   * only thing the customer app needs to decide whether to show the code
   * card. Never the code, its ciphertext, expiry or attempt count. Exposed
   * as `serviceStartVerificationRequired` rather than the column name: token
   * responses are guarded against any key mentioning "otp" (ADR-029's leak
   * test), and a derived yes/no has no business weakening that guard. */
  serviceStartVerificationRequired = true,
) {
  return {
    id: token.id,
    queueId: token.queueId,
    queueTimezone,
    serviceStartVerificationRequired,
    /// LEGACY — the first selected service, kept for an old mobile client
    /// still parsing this field directly (V2 Checkpoint 5, ADR-027).
    serviceId: token.serviceId,
    /// The authoritative, complete selection. New clients should read this.
    services: toSelectedServices(token),
    serialNumber: token.serialNumber,
    status: token.status,
    formData: token.formData,
    position: computed.position,
    estimatedWaitMinutes: computed.estimatedWaitMinutes,
    estimatedReadyAt: computed.estimatedReadyAt,
    etaUnavailableReason: computed.etaUnavailableReason,
    /** ADR-062: whether the "almost your turn" push has already gone out for
     * this token, so the app never announces the same reminder a second time
     * on its own. A yes/no only — never the timestamp. */
    reminderSent: token.reminderSentAt !== null,
    counter: token.counter ? { id: token.counter.id, name: token.counter.name } : null,
    /** Phase 4: the customer-safe view of this token's fixed session
     * assignment — the snapshotted window, never the internal
     * queueSessionId. Null for every token on an unscheduled queue, and for
     * any token created before this feature existed. */
    assignedSession:
      token.assignedSessionStartMinute != null && token.assignedSessionEndMinute != null
        ? {
            startMinute: token.assignedSessionStartMinute,
            endMinute: token.assignedSessionEndMinute,
            /** ADR-048: the occurrence's absolute start. While it is in the
             * future the token is scheduled, and the app shows "Scheduled for
             * 14:00–17:00" instead of an ETA. Null on tokens assigned before
             * this existed (always to an already-open session). */
            startsAt: token.assignedSessionStartsAt,
          }
        : null,
    createdAt: token.createdAt,
    calledAt: token.calledAt,
    startedAt: token.startedAt,
    completedAt: token.completedAt,
    skippedAt: token.skippedAt,
    /** ADR-042: why this customer was skipped — the code for the app's own
     * logic, the text exactly as they should read it. Null when not skipped,
     * and on skips from before reasons were required. */
    skipReason: token.skipReasonCode
      ? { code: token.skipReasonCode, text: token.skipReasonText }
      : null,
    /** ADR-042: staff's optional completion note; null for an ordinary one. */
    completionFeedback: token.completionFeedback,
  };
}

function toStaffView(
  token: Token & { counter?: Counter | null } & TokenWithSelectedServices,
  computed: ComputedFields,
) {
  // V2 Checkpoint 7: stripped even from the full staff shape — see
  // omitInternalFields's doc comment. This is the shape realtime/emit.ts reuses
  // directly for the organization-room socket payload, so this is also
  // where a leak into Socket.io would happen if this were skipped.
  return omitInternalFields({ ...token, services: toSelectedServices(token), ...computed });
}

/**
 * The exact customer-safe shape (approved decision 8) — reused by the REST
 * response and by the realtime layer's token:{id} room payloads, so "what's
 * safe to show a customer" stays defined in exactly one place.
 */
export async function getTokenCustomerView(tokenId: string) {
  const token = await prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    include: {
      counter: true,
      ...TOKEN_SERVICES_INCLUDE,
      queue: {
        select: {
          timezone: true,
          requireServiceStartOtp: true,
          organization: { select: { timezone: true } },
        },
      },
    },
  });
  const computed = await computeComputedFields(token);
  return toCustomerView(
    token,
    computed,
    resolveQueueTimezone(token.queue, token.queue.organization),
    token.queue.requireServiceStartOtp,
  );
}

/**
 * Full staff-authorized shape — used by the realtime layer's
 * organization:{id} room payloads (approved decision 2/5). Callers are
 * responsible for having already established the recipient is staff of the
 * owning organization (room-join authorization already does this); this
 * function itself does not re-check organization membership.
 */
export async function getTokenStaffView(tokenId: string) {
  const token = await prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    include: { counter: true, ...TOKEN_SERVICES_INCLUDE },
  });
  const computed = await computeComputedFields(token);
  return toStaffView(token, computed);
}

/**
 * Staff (matching organization) get the full record; anyone else — an
 * anonymous customer, or staff of a different organization — gets the
 * customer-safe view. The customer view is safe to return to literally
 * anyone who knows the token's (high-entropy) id, per approved decision 8.
 */
export async function getToken(tokenId: string, auth?: AuthContext) {
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: {
      counter: true,
      ...TOKEN_SERVICES_INCLUDE,
      queue: { select: { requireServiceStartOtp: true } },
    },
  });
  if (!token) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }

  const computed = await computeComputedFields(token);

  // The queue relation was loaded only for the flag; it never rides along
  // in either response shape.
  const { queue, ...tokenRow } = token;
  if (auth && auth.organizationId === token.organizationId) {
    return toStaffView(tokenRow, computed);
  }
  return toCustomerView(tokenRow, computed, null, queue.requireServiceStartOtp);
}

export async function getTokenStatus(tokenId: string) {
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  const computed = await computeComputedFields(token);
  return { id: token.id, status: token.status, ...computed };
}

/**
 * counterId must belong to the same organization AND the same queue as the
 * token (CLAUDE.md Rule 4 — never authorize via a child id alone). The
 * counter row is locked (FOR UPDATE) for the busy/active check; the token
 * update is a conditional (compare-and-swap) UPDATE on status, which is the
 * "lock the token row appropriately" step — Postgres implicitly locks the
 * row for the duration of that UPDATE statement.
 *
 * Only WAITING -> CALLED. Recall (the former SKIPPED -> CALLED path) has
 * been removed — SKIPPED is now terminal (see tokenStateMachine.ts).
 */
export async function callToken(
  actor: CounterActor,
  tokenId: string,
  requestedCounterId?: string | null,
) {
  const token = await findTokenScoped(actor.organizationId, tokenId);
  // ADR-064: the counter is the caller's own, never one named by the client.
  const counter = await requireClaimCounter(actor, requestedCounterId);
  const counterId = counter.id;

  if (counter.queueId !== token.queueId) {
    throw new AppError(409, 'COUNTER_QUEUE_MISMATCH', 'Your counter serves a different queue.');
  }

  if (token.status !== 'WAITING') {
    throw new AppError(
      422,
      'INVALID_TOKEN_TRANSITION',
      `Cannot transition token from ${token.status} to CALLED.`,
    );
  }
  assertValidTransition(token.status, 'CALLED');
  // ADR-048: assignedSessionStartsAt is fixed at creation, so this read
  // needs no lock — a scheduled token can only ever become callable, never
  // the reverse.
  const now = new Date();
  if (isAwaitingSessionStart(token, now)) {
    throw new AppError(409, 'SESSION_NOT_STARTED', SESSION_NOT_STARTED_MESSAGE);
  }

  return prisma.$transaction(async (tx) => {
    const counterRows = await tx.$queryRaw<{ id: string; status: string; staff_id: string | null }[]>`
      SELECT id, status, staff_id FROM counters WHERE id = ${counterId} FOR UPDATE
    `;
    const lockedCounter = counterRows[0];
    assertStillAssigned(actor, lockedCounter?.staff_id ?? null);
    if (!lockedCounter || lockedCounter.status !== 'ACTIVE') {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Your counter is not active.');
    }

    // V2 Checkpoint 3 (ADR-025): strict FCFS — a manually chosen tokenId
    // must be the earliest WAITING token in its queue, or staff could bypass
    // arrival order entirely (the exact V1 gap this checkpoint closes).
    //
    // A plain (non-locking) EXISTS read is sufficient here, not a race: a
    // token's sequenceNumber is assigned once at creation and never reused,
    // and nothing in the state machine transitions a token back into
    // WAITING. So the set of "WAITING tokens with a smaller sequence number
    // than this one" can only
    // ever shrink over time, never gain a new, smaller member after this
    // check runs — there is no window in which a concurrent transaction can
    // turn a true "no earlier token" result into a false one before this
    // transaction's own compare-and-swap UPDATE commits.
    //
    // ADR-048: "earlier" means earlier *in the callable line* — a token
    // scheduled for a session that has not started is not waiting its turn
    // yet, so it must not block the customers whose session is running. The
    // exclusion is monotonic in the same way: a scheduled token can only
    // join the callable set as time passes, and it does so with its own
    // (fixed) sequence number, so this check stays race-free.
    const earlierWaitingRows = await tx.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM tokens
        WHERE queue_id = ${token.queueId}
          AND status = 'WAITING'
          AND sequence_number < ${token.sequenceNumber}
          AND (assigned_session_starts_at IS NULL OR assigned_session_starts_at <= (${now} AT TIME ZONE 'UTC'))
      ) AS "exists"
    `;
    if (earlierWaitingRows[0]?.exists) {
      throw new AppError(
        409,
        'FCFS_VIOLATION',
        'An earlier customer is still waiting. The earliest eligible customer must be called first.',
      );
    }

    const busy = await tx.token.findFirst({
      where: { counterId, status: { in: ['CALLED', 'IN_PROGRESS'] }, id: { not: tokenId } },
    });
    if (busy) {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is already serving another token.');
    }

    // V2 Checkpoint 7 (ADR-029): every legitimate entry into CALLED gets a
    // brand new service-start verification code — when the queue uses one
    // (ADR-041). A queue that does not gets no code at all.
    const requiresCode = await readRequireServiceStartOtp(tx, token.queueId);

    const result = await tx.token.updateMany({
      where: { id: tokenId, status: token.status },
      data: {
        status: 'CALLED',
        counterId,
        calledAt: new Date(),
        ...serviceStartCodeFields(tokenId, requiresCode),
      },
    });
    if (result.count === 0) {
      throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
    }

    // The code itself is deliberately discarded (see serviceStartCodeFields),
    // never returned — this function's caller is staff (the one clicking
    // Call), who must never be able to read the code (checkpoint section 20).
    // The customer retrieves it separately and directly via
    // getServiceStartVerificationCode, ownership-checked against their own
    // device.
    const updated = await tx.token.findUniqueOrThrow({ where: { id: tokenId } });
    return omitInternalFields(updated);
  });
}

/**
 * Why a WAITING token cannot currently be acted on. Both reasons are
 * queue-operational facts staff can act on, not internal detail.
 */
export type WaitingActionBlockedReason = 'SESSION_NOT_STARTED' | 'EARLIER_WAITING' | 'NO_AVAILABLE_COUNTER';

const SESSION_NOT_STARTED_MESSAGE =
  "This customer's assigned session has not started yet. They can be called once it begins.";

export interface WaitingActionEligibility {
  eligible: boolean;
  reason: WaitingActionBlockedReason | null;
}

/**
 * The single authority on whether a WAITING token may be acted on right now.
 *
 * The product rule is that Skip unlocks exactly when Call unlocks — a
 * customer who cannot yet be called cannot be skipped either, so staff can
 * never quietly remove a later customer from the queue ahead of their turn.
 * Both conditions below are precisely the two that `callToken` enforces for
 * a WAITING source:
 *
 *  1. strict FCFS — no earlier WAITING token in the same queue;
 *  2. capacity — at least one ACTIVE counter in the queue is free.
 *
 * Call additionally requires the *specific* counter staff picked to be
 * active and free; that stays inside callToken's own transaction, where the
 * counter row is locked. This function answers the counter-agnostic
 * question ("could this token be called by someone right now?"), which is
 * what Skip needs and what the dashboard renders.
 *
 * Runs on a transaction client when called inside one, so the check and the
 * state change it guards observe the same snapshot.
 */
export async function getWaitingTokenActionEligibility(
  client: Prisma.TransactionClient,
  token: { id: string; queueId: string; sequenceNumber: number; assignedSessionStartsAt: Date | null },
  now: Date = new Date(),
): Promise<WaitingActionEligibility> {
  // ADR-048: checked first — a scheduled customer is not in the line yet,
  // so neither order nor capacity is the reason they cannot be handled.
  if (isAwaitingSessionStart(token, now)) {
    return { eligible: false, reason: 'SESSION_NOT_STARTED' };
  }

  const earlierWaitingRows = await client.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM tokens
      WHERE queue_id = ${token.queueId}
        AND status = 'WAITING'
        AND sequence_number < ${token.sequenceNumber}
        AND (assigned_session_starts_at IS NULL OR assigned_session_starts_at <= (${now} AT TIME ZONE 'UTC'))
    ) AS "exists"
  `;
  if (earlierWaitingRows[0]?.exists) {
    return { eligible: false, reason: 'EARLIER_WAITING' };
  }

  // "Free" means active, staffed, and not already serving a CALLED/IN_PROGRESS
  // token — the same occupancy rule callToken's busy-check applies to one
  // counter. ADR-064: an unassigned counter cannot claim anyone, so it is
  // not capacity.
  const freeCounterRows = await client.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM counters c
      WHERE c.queue_id = ${token.queueId}
        AND c.status = 'ACTIVE'
        AND c.staff_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tokens t
          WHERE t.counter_id = c.id
            AND t.status IN ('CALLED', 'IN_PROGRESS')
        )
    ) AS "exists"
  `;
  if (!freeCounterRows[0]?.exists) {
    return { eligible: false, reason: 'NO_AVAILABLE_COUNTER' };
  }

  return { eligible: true, reason: null };
}

/** Queue-level half of the eligibility rule, for read-only display paths
 * (the live queue table) that already know each row's position and only
 * need one capacity probe per queue rather than one per row. */
export async function hasFreeActiveCounter(queueId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM counters c
      WHERE c.queue_id = ${queueId}
        AND c.status = 'ACTIVE'
        AND c.staff_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tokens t
          WHERE t.counter_id = c.id
            AND t.status IN ('CALLED', 'IN_PROGRESS')
        )
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

/**
 * The same rule as getWaitingTokenActionEligibility, expressed over values
 * a caller already has. Position 1 *is* "no earlier WAITING token" — that is
 * how listWaitingTokenPositions numbers them — so the two conditions and
 * their order match the authoritative check exactly. Display-only: the API
 * still re-decides authoritatively inside the transaction that acts.
 */
export function waitingActionEligibilityFrom(
  position: number | null,
  queueHasFreeCounter: boolean,
  /** ADR-048: the row's ETA entry says its session has not started. */
  awaitingSessionStart = false,
): WaitingActionEligibility {
  if (awaitingSessionStart) {
    return { eligible: false, reason: 'SESSION_NOT_STARTED' };
  }
  if (position !== 1) {
    return { eligible: false, reason: 'EARLIER_WAITING' };
  }
  if (!queueHasFreeCounter) {
    return { eligible: false, reason: 'NO_AVAILABLE_COUNTER' };
  }
  return { eligible: true, reason: null };
}

const WAITING_ACTION_BLOCKED_MESSAGE: Record<WaitingActionBlockedReason, string> = {
  SESSION_NOT_STARTED: SESSION_NOT_STARTED_MESSAGE,
  EARLIER_WAITING: 'An earlier customer is still waiting. The earliest eligible customer must be handled first.',
  NO_AVAILABLE_COUNTER: 'No active counter is free right now, so this customer cannot be handled yet.',
};

type TimestampField = 'completedAt' | 'skippedAt';

/**
 * Shared implementation for the two remaining counter-independent,
 * staff-triggered transitions (complete/skip). Loads current state,
 * validates the transition centrally, then applies a conditional
 * (compare-and-swap) UPDATE as the concurrency-safety net — two racing
 * requests against the same token can only have one succeed.
 *
 * V2 Checkpoint 7: CALLED -> IN_PROGRESS moved out to startToken below (it
 * can require a verified code, not just a valid source status),
 * so this helper no longer handles `startedAt` — it remains the shared
 * implementation for exactly the two transitions that still need nothing
 * beyond "is this transition legal, apply it atomically."
 *
 * Returns `previousStatus` alongside the updated token: the realtime layer
 * needs it to decide whether a WAITING->SKIPPED transition (which affects
 * other waiting tokens' positions) actually happened, versus a
 * CALLED/IN_PROGRESS->SKIPPED transition (which doesn't) — see
 * token.controller.ts `skip` (approved Phase 4 decision 4).
 */
async function transitionToken(
  actor: CounterActor,
  tokenId: string,
  targetStatus: TokenStatus,
  timestampField: TimestampField,
  guard?: (tx: Prisma.TransactionClient, token: Token) => Promise<void>,
  /** ADR-042: written in the same compare-and-swap as the status, so a
   * skip reason or completion note exists exactly when its status does. */
  terminalNote: Prisma.TokenUpdateManyMutationInput = {},
): Promise<{ token: SafeToken; previousStatus: TokenStatus }> {
  const token = await findTokenScoped(actor.organizationId, tokenId);
  assertValidTransition(token.status, targetStatus);
  await assertMayActOnToken(actor, token);
  const previousStatus = token.status;

  // The guard and the compare-and-swap share one transaction so an
  // eligibility decision can never be made against a snapshot the write
  // then contradicts.
  return prisma.$transaction(async (tx) => {
    if (guard) {
      await guard(tx, token);
    }

    const result = await tx.token.updateMany({
      where: { id: tokenId, status: token.status },
      data: { ...terminalNote, status: targetStatus, [timestampField]: new Date() },
    });
    if (result.count === 0) {
      throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
    }

    // COMPLETED spends the customer's repeat entitlement, SKIPPED releases
    // it — both settled here so the claim can never disagree with the status
    // that caused it (ADR-034).
    await settleIdentityClaim(tx, tokenId, targetStatus);

    const updated = await tx.token.findUniqueOrThrow({ where: { id: tokenId } });
    return { token: omitInternalFields(updated), previousStatus };
  });
}

/**
 * ADR-042: completion stays one step. Feedback is optional — blank or absent
 * is an ordinary completion and stores nothing — and never changes the
 * resulting status, which is COMPLETED either way. The state machine still
 * only allows this from IN_PROGRESS, so a queue that requires the
 * service-start code (ADR-041) can still never be completed without it.
 */
export const completeToken = (actor: CounterActor, tokenId: string, feedback?: string) => {
  const completionFeedback = resolveCompletionFeedback(feedback);
  return transitionToken(
    actor,
    tokenId,
    'COMPLETED',
    'completedAt',
    undefined,
    completionFeedback ? { completionFeedback } : {},
  );
};

/**
 * Skipping a WAITING customer is gated on exactly the same eligibility that
 * unlocks Call (getWaitingTokenActionEligibility): a customer who is not yet
 * callable is not yet skippable either. Without this, staff — or anyone with
 * direct API access — could remove a later customer from the queue while
 * earlier ones still waited, which is the same out-of-order handling strict
 * FCFS exists to prevent.
 *
 * Skipping a CALLED or IN_PROGRESS token is untouched: that customer is
 * already at a counter, so neither queue order nor free capacity is in
 * question.
 *
 * ADR-042: every skip, from any status, must say why — checked before
 * anything else, and stored with the status in one write. SKIPPED is
 * terminal, so nothing can later overwrite the reason.
 */
export const skipToken = (actor: CounterActor, tokenId: string, reason: SkipReasonInput = {}) => {
  const resolved = resolveSkipReason(reason);
  return transitionToken(
    actor,
    tokenId,
    'SKIPPED',
    'skippedAt',
    async (tx, token) => {
      if (token.status !== 'WAITING') {
        return;
      }
      const eligibility = await getWaitingTokenActionEligibility(tx, token);
      if (eligibility.eligible || !eligibility.reason) {
        return;
      }
      throw new AppError(
        409,
        eligibility.reason === 'EARLIER_WAITING'
          ? 'FCFS_VIOLATION'
          : eligibility.reason === 'SESSION_NOT_STARTED'
            ? 'SESSION_NOT_STARTED'
            : 'COUNTER_NOT_AVAILABLE',
        WAITING_ACTION_BLOCKED_MESSAGE[eligibility.reason],
      );
    },
    { skipReasonCode: resolved.code, skipReasonText: resolved.text },
  );
};

/**
 * V2 Checkpoint 7 (ADR-029): CALLED -> IN_PROGRESS, gated on a customer-
 * supplied, backend-verified code — the entire point being that staff
 * cannot start service merely by clicking a button (CLAUDE.md: never trust
 * a frontend-only restriction; this is the backend enforcement that makes
 * that restriction real). This is now the ONLY code path in the backend
 * capable of producing an IN_PROGRESS token — see ADR-029's security review
 * for the full repository search confirming no other route reaches it.
 *
 * Deliberately NOT built on transitionToken: every other transition there
 * only needs "is this legal, apply it" — this one needs three additional,
 * ordered checks (code issued? not expired? attempts remaining?) before the
 * same compare-and-swap pattern applies, and a wrong-code attempt must
 * itself durably record the failed attempt without transitioning anything.
 *
 * ADR-041: the code is required only while the token's queue says so, and
 * the queue's *current* value decides. A queue that does not use the code
 * starts the CALLED token directly — any code left over from before the
 * setting was turned off is ignored and cleared, never demanded.
 */
export async function startToken(
  actor: CounterActor,
  tokenId: string,
  verificationCode: string | undefined,
) {
  const token = await findTokenScoped(actor.organizationId, tokenId);
  assertValidTransition(token.status, 'IN_PROGRESS');
  await assertMayActOnToken(actor, token);

  const queue = await prisma.queue.findUniqueOrThrow({
    where: { id: token.queueId },
    select: { requireServiceStartOtp: true },
  });
  if (!queue.requireServiceStartOtp) {
    return startWithoutVerification(tokenId, token.status);
  }

  if (!verificationCode) {
    throw new AppError(
      422,
      'SERVICE_START_VERIFICATION_REQUIRED',
      "This queue requires the customer's verification code to start service.",
    );
  }

  if (!token.serviceStartOtpCipher || !token.serviceStartOtpExpiresAt) {
    throw new AppError(
      409,
      'VERIFICATION_CODE_REQUIRED',
      'No verification code has been issued for this token yet.',
    );
  }
  if (token.serviceStartOtpExpiresAt.getTime() < Date.now()) {
    throw new AppError(
      410,
      'VERIFICATION_CODE_EXPIRED',
      'This verification code has expired. Ask the customer for a new one.',
    );
  }
  if (token.serviceStartOtpFailedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    throw new AppError(
      429,
      'VERIFICATION_CODE_LOCKED',
      'Too many incorrect attempts with this code. Ask the customer for a new one.',
    );
  }

  const isValid = verifyOtpCode(tokenId, verificationCode, token.serviceStartOtpCipher);
  if (!isValid) {
    // V2 Checkpoint 7A: an atomic DB-side increment, not `token.serviceStartOtpFailedAttempts + 1`
    // written back as a literal — two concurrent wrong guesses reading the
    // same stale count would otherwise both write the same incremented
    // value, silently losing an attempt (a real lost-update race: unlike
    // the compare-and-swap transitions elsewhere in this file, the WHERE
    // clause here — status='CALLED' — doesn't itself change as attempts
    // accumulate, so Postgres has nothing to reject a stale write against).
    // `increment` pushes the read-modify-write into a single server-side
    // SQL statement instead, so N concurrent wrong attempts always produce
    // exactly N increments, never fewer.
    const incremented = await prisma.token.updateMany({
      where: { id: tokenId, status: 'CALLED' },
      data: { serviceStartOtpFailedAttempts: { increment: 1 } },
    });
    // Best-effort — if a concurrent cancellation/start already moved the
    // token out of CALLED, the increment above simply no-ops (0 rows),
    // which is fine: the failed-attempt count no longer matters once the
    // token has left CALLED by any path, and there is nothing left to
    // invalidate below either.
    if (incremented.count > 0) {
      const fresh = await prisma.token.findUnique({
        where: { id: tokenId },
        select: { serviceStartOtpFailedAttempts: true },
      });
      if (fresh && fresh.serviceStartOtpFailedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
        await prisma.token.updateMany({
          where: { id: tokenId, status: 'CALLED' },
          data: { serviceStartOtpCipher: null, serviceStartOtpExpiresAt: null },
        });
      }
    }
    // Never reveals which digits were right (checkpoint section 26) — one
    // generic code regardless of how close the guess was.
    throw new AppError(422, 'INVALID_VERIFICATION_CODE', 'Incorrect verification code.');
  }

  // Single-use: the transition and the OTP invalidation happen in the same
  // conditional UPDATE, so a replay of this same code can never succeed a
  // second time — status is already IN_PROGRESS, cipher already null.
  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: 'CALLED' },
    data: {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      serviceStartOtpCipher: null,
      serviceStartOtpExpiresAt: null,
      serviceStartOtpFailedAttempts: 0,
    },
  });
  if (result.count === 0) {
    // Concurrency (checkpoint section 28): a cancellation could have won the
    // race between the checks above and this UPDATE — the WHERE clause's
    // status='CALLED' guard is what makes exactly one of {cancel, start}
    // ever succeed, mirroring transitionToken/cancelToken's identical
    // compare-and-swap pattern. No new locking mechanism.
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  const updated = await prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
  return { token: omitInternalFields(updated), previousStatus: token.status };
}

/**
 * ADR-041: CALLED -> IN_PROGRESS for a queue that does not use the
 * service-start code. The queue condition sits inside the same conditional
 * UPDATE as the status check, so a concurrent switch back ON can never let
 * one unverified start through: either this statement sees the old setting,
 * or it matches nothing and is refused below.
 */
async function startWithoutVerification(tokenId: string, previousStatus: TokenStatus) {
  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: 'CALLED', queue: { requireServiceStartOtp: false } },
    data: {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      serviceStartOtpCipher: null,
      serviceStartOtpExpiresAt: null,
      serviceStartOtpFailedAttempts: 0,
    },
  });
  if (result.count === 0) {
    const fresh = await prisma.token.findUnique({
      where: { id: tokenId },
      select: { status: true, queue: { select: { requireServiceStartOtp: true } } },
    });
    if (fresh?.status === 'CALLED' && fresh.queue.requireServiceStartOtp) {
      throw new AppError(
        422,
        'SERVICE_START_VERIFICATION_REQUIRED',
        "This queue requires the customer's verification code to start service.",
      );
    }
    throw new AppError(
      409,
      'TOKEN_STATE_CHANGED',
      'Token state changed concurrently. Please retry.',
    );
  }

  const updated = await prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
  return { token: omitInternalFields(updated), previousStatus };
}

/**
 * V2 Checkpoint 7 (ADR-029): customer-initiated cancellation. Ownership is
 * established the same way the pre-existing notification-preferences
 * customer write does (ADR-011/Phase 7 Step 7) — there is no device
 * authentication in this codebase, so a self-asserted deviceIdentifier is
 * resolved to a Device, and the token must actually belong to that device.
 * A mismatch is reported as the same 404 TOKEN_NOT_FOUND used for "doesn't
 * exist," never a 403 — this codebase never confirms a resource's existence
 * across an ownership boundary the caller isn't inside.
 *
 * Concurrency (checkpoint section 28): the same conditional
 * (compare-and-swap) UPDATE pattern used everywhere else in this file — the
 * WHERE clause's status match against the freshly-read status is what makes
 * a concurrent cancel-vs-start race resolve to exactly one winner, without
 * any new locking mechanism (see startToken's matching comment).
 */
export async function cancelToken(tokenId: string, deviceIdentifier: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }

  // WAITING/CALLED -> CANCELLED only; IN_PROGRESS/COMPLETED/SKIPPED/already-
  // CANCELLED all fall through to the same generic INVALID_TOKEN_TRANSITION
  // every other illegal transition in this file produces — reusing the
  // existing error architecture rather than inventing a one-off code for
  // this specific case (including the "cancel an already-cancelled token"
  // case, which needs no special-cased semantics of its own).
  assertValidTransition(token.status, 'CANCELLED');

  // Transactional as of ADR-034: the compare-and-swap and the release of the
  // customer's identity claim have to succeed or fail together, or a
  // cancelled customer could be left holding a reservation for a visit that
  // never happened.
  return prisma.$transaction(async (tx) => {
    const result = await tx.token.updateMany({
      where: { id: tokenId, status: token.status },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        // Checkpoint section 19: a cancelled token's verification material
        // must never remain usable.
        serviceStartOtpCipher: null,
        serviceStartOtpExpiresAt: null,
        serviceStartOtpFailedAttempts: 0,
      },
    });
    if (result.count === 0) {
      throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
    }

    await settleIdentityClaim(tx, tokenId, 'CANCELLED');

    const updated = await tx.token.findUniqueOrThrow({ where: { id: tokenId } });
    return { token: omitInternalFields(updated), previousStatus: token.status };
  });
}

/** ADR-041: a queue that does not use the service-start code has none to
 * show and none to reissue. Checked after ownership, so it reveals nothing
 * to a device that does not own the token. */
function assertQueueUsesServiceStartCode(requireServiceStartOtp: boolean): void {
  if (!requireServiceStartOtp) {
    throw new AppError(
      409,
      'SERVICE_START_VERIFICATION_NOT_REQUIRED',
      'This queue does not use a verification code to start service.',
    );
  }
}

/**
 * V2 Checkpoint 7 (ADR-029): the customer's own read of the currently
 * active verification code — the ONLY path anywhere in the backend that
 * ever returns the raw (decrypted) code, and only after confirming this
 * exact device owns this exact token. Deliberately not folded into
 * getTokenCustomerView/toCustomerView: that function's result is also
 * reused directly for the Socket.io token-room payload (realtime/emit.ts),
 * which must never carry the OTP (checkpoint section 20/33) — keeping this
 * as a fully separate function makes that leak structurally impossible
 * rather than something a future edit could accidentally reintroduce.
 *
 * Never regenerates on a read (checkpoint section 23) — returns the same
 * code every call until it's consumed, expires, or is explicitly reissued.
 */
export async function getServiceStartVerificationCode(tokenId: string, deviceIdentifier: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { queue: { select: { requireServiceStartOtp: true } } },
  });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  if (token.status !== 'CALLED') {
    throw new AppError(
      409,
      'TOKEN_NOT_CALLED',
      'A verification code is only available while this token is CALLED.',
    );
  }
  assertQueueUsesServiceStartCode(token.queue.requireServiceStartOtp);
  if (!token.serviceStartOtpCipher || !token.serviceStartOtpExpiresAt || token.serviceStartOtpExpiresAt.getTime() < Date.now()) {
    throw new AppError(
      410,
      'VERIFICATION_CODE_EXPIRED',
      'This verification code has expired. Request a new one.',
    );
  }

  const code = decryptOtpCode(tokenId, token.serviceStartOtpCipher);
  if (!code) {
    // Practically unreachable (would mean a corrupted/tampered stored
    // value) — treated the same as expired rather than a 500, since the
    // customer-facing remedy is identical either way: request a new code.
    throw new AppError(
      410,
      'VERIFICATION_CODE_EXPIRED',
      'This verification code has expired. Request a new one.',
    );
  }

  return { code, expiresAt: token.serviceStartOtpExpiresAt };
}

/**
 * V2 Checkpoint 7 (ADR-029): the smallest safe renewal path (section 23) —
 * a customer whose code expired, or who simply didn't catch it, is never
 * permanently stuck in CALLED. Same ownership check as the getter above;
 * unconditionally mints a fresh code and expiry, invalidating whatever was
 * there before (overwritten, not merged) and resetting the failed-attempt
 * counter. Rate-limited at the route level (publicRateLimiter), the same
 * category the pre-existing notification-preferences customer write uses —
 * this function itself never regenerates except when explicitly called.
 */
export async function reissueServiceStartVerificationCode(tokenId: string, deviceIdentifier: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { queue: { select: { requireServiceStartOtp: true } } },
  });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  if (token.status !== 'CALLED') {
    throw new AppError(
      409,
      'TOKEN_NOT_CALLED',
      'A verification code can only be reissued while this token is CALLED.',
    );
  }
  // ADR-041: a queue without the code never mints one, even on request.
  assertQueueUsesServiceStartCode(token.queue.requireServiceStartOtp);

  const code = generateOtpCode();
  const cipher = encryptOtpCode(tokenId, code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: 'CALLED' },
    data: {
      serviceStartOtpCipher: cipher,
      serviceStartOtpExpiresAt: expiresAt,
      serviceStartOtpFailedAttempts: 0,
    },
  });
  if (result.count === 0) {
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  return { code, expiresAt };
}

/**
 * Auto-selects the oldest eligible WAITING token for the given counter
 * (approved decision 3 — staff selects the counter, not the token).
 * Archived-queue guard is deliberately NOT applied here (approved decision
 * 11): archival stops new intake but must not strand tokens already in the
 * queue.
 */
export async function nextToken(
  actor: CounterActor,
  queueId: string,
  requestedCounterId?: string | null,
) {
  await requireOwnedQueue(actor.organizationId, queueId);
  // ADR-064: the counter is the caller's own, never one named by the client.
  const counter = await requireClaimCounter(actor, requestedCounterId);
  const counterId = counter.id;

  if (counter.queueId !== queueId) {
    throw new AppError(409, 'COUNTER_QUEUE_MISMATCH', 'Your counter serves a different queue.');
  }

  return prisma.$transaction(async (tx) => {
    const counterRows = await tx.$queryRaw<{ id: string; status: string; staff_id: string | null }[]>`
      SELECT id, status, staff_id FROM counters WHERE id = ${counterId} FOR UPDATE
    `;
    const lockedCounter = counterRows[0];
    assertStillAssigned(actor, lockedCounter?.staff_id ?? null);
    if (!lockedCounter || lockedCounter.status !== 'ACTIVE') {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Your counter is not active.');
    }

    const busy = await tx.token.findFirst({
      where: { counterId, status: { in: ['CALLED', 'IN_PROGRESS'] } },
    });
    if (busy) {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is already serving another token.');
    }

    // SKIP LOCKED (approved decision 5, scoped only to this selection query
    // — not the sequence-allocation lock in createToken) lets two counters
    // calling /next concurrently claim two different waiting tokens without
    // blocking on each other.
    // ADR-048: a token scheduled for a session that has not started yet is
    // passed over — it is not in the callable line until that instant.
    const eligibleRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tokens
      WHERE queue_id = ${queueId} AND status = 'WAITING'
        AND (assigned_session_starts_at IS NULL OR assigned_session_starts_at <= (${new Date()} AT TIME ZONE 'UTC'))
      ORDER BY sequence_number ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const eligible = eligibleRows[0];
    if (!eligible) {
      throw new AppError(404, 'NO_ELIGIBLE_TOKENS', 'No eligible waiting tokens.');
    }

    // ADR-041: /next enters CALLED exactly like /call, so it issues the
    // service-start code on the same terms. Before this it issued none, which
    // left a code-requiring queue's token waiting on a customer reissue.
    const requiresCode = await readRequireServiceStartOtp(tx, queueId);

    const updated = await tx.token.update({
      where: { id: eligible.id },
      data: {
        status: 'CALLED',
        counterId,
        calledAt: new Date(),
        ...serviceStartCodeFields(eligible.id, requiresCode),
      },
    });
    // Staff response: the cipher must never leave, same as every other path.
    return omitInternalFields(updated);
  });
}

/**
 * ADR-041: the queue's service-start verification setting, read under a
 * share lock. ADR-055 fixed the setting at creation, so it no longer changes
 * under a CALLED token; the lock is kept as cheap defense in depth.
 */
async function readRequireServiceStartOtp(
  tx: Prisma.TransactionClient,
  queueId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ require_service_start_otp: boolean }[]>`
    SELECT require_service_start_otp FROM queues WHERE id = ${queueId} FOR SHARE
  `;
  // A missing row cannot happen for a token's own queue; failing closed keeps
  // the verified flow rather than silently skipping it.
  return rows[0]?.require_service_start_otp ?? true;
}

/**
 * The code columns for a token entering CALLED. A queue that does not use
 * the code stores none — no ciphertext, no expiry — so nothing unnecessary is
 * generated, kept, or ever at risk of being read back.
 */
function serviceStartCodeFields(tokenId: string, requiresCode: boolean) {
  if (!requiresCode) {
    return {
      serviceStartOtpCipher: null,
      serviceStartOtpExpiresAt: null,
      serviceStartOtpFailedAttempts: 0,
    };
  }
  return {
    serviceStartOtpCipher: encryptOtpCode(tokenId, generateOtpCode()),
    serviceStartOtpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000),
    serviceStartOtpFailedAttempts: 0,
  };
}

/**
 * V2 Checkpoint 4 (ADR-026): staff override of a currently-active
 * customer's required service duration. Restricted to CALLED/IN_PROGRESS
 * ("an active customer," per the product requirement) — a WAITING or
 * terminal-state token has no occupancy for this to meaningfully affect,
 * and allowing it there would let the field silently accumulate stale
 * values with no relationship to an actual in-progress service. This
 * itself is not a state-machine transition (status is untouched), so it
 * doesn't go through assertValidTransition/transitionToken.
 */
export async function setRequiredDuration(
  actor: CounterActor,
  tokenId: string,
  requiredDurationMinutes: number,
) {
  const token = await findTokenScoped(actor.organizationId, tokenId);
  await assertMayActOnToken(actor, token);

  if (token.status !== 'CALLED' && token.status !== 'IN_PROGRESS') {
    throw new AppError(
      409,
      'TOKEN_NOT_ACTIVE',
      'Required duration can only be set for a currently CALLED or IN_PROGRESS customer.',
    );
  }

  const updated = await prisma.token.update({
    where: { id: tokenId },
    data: { requiredDurationMinutes },
  });
  return omitInternalFields(updated);
}

/** Wording a customer can act on, without implying their phone or device is
 * blocked — it is the visit that is spent, not the equipment. */
function repeatRejectionMessage(restrictionEndsAt: Date | null, scope: 'QUEUE' | 'SESSION' = 'QUEUE'): string {
  // ADR-049: a per-session allowance is spent only for that session, so the
  // customer is told a later session is still open to them.
  if (scope === 'SESSION') {
    return restrictionEndsAt
      ? 'You have already been served in this session. You can join again after the time shown, or in another session.'
      : 'You have already been served in this session. You can join again in another session.';
  }
  if (!restrictionEndsAt) {
    return 'You have already used this queue, and it can only be used once.';
  }
  return 'You have already used this queue. You can join again after the time shown.';
}

/** The message for the other case entirely: not a spent visit, but a visit
 * already in progress somewhere else. */
const ACTIVE_ELSEWHERE_MESSAGE =
  'You are already in this queue. Check your existing token rather than joining again.';

/**
 * Moves a token's identity claim as its visit resolves.
 *
 *  - COMPLETED  → CONSUMED: the visit happened, so the entitlement for this
 *    period is spent and the customer cannot rejoin until the next one.
 *  - CANCELLED / SKIPPED → released: neither is a delivered service, and the
 *    pre-existing product rule (V2 Checkpoint 6) is that only COMPLETED
 *    consumes the allowance. Deleting the row frees the person to rejoin
 *    immediately, which is what made the reservation safe to take at join
 *    time in the first place.
 *
 * Runs inside the caller's transaction, alongside the status change itself,
 * rather than after the response like the audit and realtime work: a claim
 * left RESERVED because the process died mid-flight would lock a cancelled
 * customer out of a queue they never actually used, and only an operator
 * could unstick them. A token that never had a claim (an unrestricted queue)
 * simply matches nothing — updateMany/deleteMany make that a no-op rather
 * than an error.
 */
async function settleIdentityClaim(
  tx: Prisma.TransactionClient,
  tokenId: string,
  status: TokenStatus,
): Promise<void> {
  if (status === 'CANCELLED' || status === 'SKIPPED') {
    await tx.queueIdentityClaim.deleteMany({ where: { tokenId } });
    return;
  }
  if (status !== 'COMPLETED') {
    return;
  }

  // The visit happened, so this is where the wait actually starts. Reading
  // the queue now — rather than a window snapshotted at join — is what makes
  // the dashboard's "applies to customers joining from now on" true for the
  // next customer, without stranding this one under a policy nobody can see
  // any more. A token's life is minutes, so the two can barely diverge.
  const token = await tx.token.findUniqueOrThrow({
    where: { id: tokenId },
    select: {
      organizationId: true,
      queueId: true,
      ...IDENTITY_SNAPSHOT_SELECT,
      queue: {
        select: {
          repeatRestrictionType: true,
          repeatRestrictionAmount: true,
          repeatRestrictionUnit: true,
          repeatRestrictionUntil: true,
          timezone: true,
          organization: { select: { timezone: true } },
        },
      },
    },
  });

  const consumedAt = new Date();
  const eligibleAgainAt = eligibilityAfterVisit(token.queue, consumedAt);

  const updated = await tx.queueIdentityClaim.updateMany({
    where: { tokenId },
    data: { status: 'CONSUMED', consumedAt, eligibleAgainAt },
  });
  if (updated.count > 0) {
    return;
  }

  // No claim to consume. For an unrestricted queue that is simply correct.
  // For a restricted one this token's own claim should already exist and be
  // matched by the updateMany above — SKIPPED/CANCELLED are both terminal
  // (Recall, the one path that used to delete-then-need-this, is removed),
  // so a token reaching COMPLETED should never have had its claim released.
  // Recreated from the snapshot as a defensive fallback rather than assumed
  // impossible: a visit that was actually delivered must be recorded however
  // this token got here.
  const snapshot = identitySnapshotOf(token);
  if (!snapshot) {
    return;
  }
  await tx.queueIdentityClaim.create({
    data: {
      organizationId: token.organizationId,
      queueId: token.queueId,
      identityFingerprint: snapshot.fingerprint,
      mode: snapshot.mode,
      status: 'CONSUMED',
      consumedAt,
      eligibleAgainAt,
      entitlementScopeKey: snapshot.scopeKey,
      tokenId,
    },
  });
}

/**
 * When a customer served now may return, or null for never. Null is also the
 * answer for a queue whose restriction has since been switched off — the
 * claim is still recorded, but nothing is waiting on it.
 */
function eligibilityAfterVisit(
  queue: {
    repeatRestrictionType: RepeatRestrictionType | null;
    repeatRestrictionAmount: number | null;
    repeatRestrictionUnit: RepeatRestrictionUnit | null;
    repeatRestrictionUntil: Date | null;
    timezone: string | null;
    organization: { timezone: string | null } | null;
  },
  consumedAt: Date,
): Date | null {
  if (!queue.repeatRestrictionType) {
    return null;
  }
  return computeEligibleAgainAt(
    {
      type: queue.repeatRestrictionType,
      amount: queue.repeatRestrictionAmount,
      unit: queue.repeatRestrictionUnit,
      until: queue.repeatRestrictionUntil,
    },
    consumedAt,
    resolveQueueTimezone(queue, queue.organization),
  );
}

/**
 * ADR-049: the session occurrences this identity may not rejoin right now —
 * live CONSUMED session-scoped claims whose wait has not ended. Read under the
 * same queue-row lock as the claim itself, so it cannot go stale before the
 * token is created. Used only to steer assignment; the claim step below
 * remains the enforcement.
 */
async function spentSessionOccurrenceKeys(
  tx: Prisma.TransactionClient,
  queueId: string,
  identityFingerprint: string,
): Promise<Set<string>> {
  const claims = await tx.queueIdentityClaim.findMany({
    where: {
      queueId,
      identityFingerprint,
      supersededAt: null,
      status: 'CONSUMED',
      entitlementScopeKey: { startsWith: 'SESSION:' },
      OR: [{ eligibleAgainAt: null }, { eligibleAgainAt: { gt: new Date() } }],
    },
    select: { entitlementScopeKey: true },
  });
  return new Set(claims.map((claim) => claim.entitlementScopeKey));
}

const IDENTITY_SNAPSHOT_SELECT = {
  identityFingerprint: true,
  identityMode: true,
  identityScopeKey: true,
} as const;

interface TokenIdentitySnapshot {
  fingerprint: string;
  mode: RepeatIdentityMode;
  /** ADR-049: the entitlement scope the join was admitted under. */
  scopeKey: string;
}

/** The identity a token was admitted under, or null for a token on an
 * unrestricted queue. All three columns are written together at join time, so
 * a partial snapshot is not a state this can produce — it is treated as
 * "no identity" rather than guessed at. A token from before ADR-049 has no
 * scope key; its claim was queue-wide, which is what the default says. */
function identitySnapshotOf(token: {
  identityFingerprint: string | null;
  identityMode: RepeatIdentityMode | null;
  identityScopeKey: string | null;
}): TokenIdentitySnapshot | null {
  if (!token.identityFingerprint || !token.identityMode) {
    return null;
  }
  return {
    fingerprint: token.identityFingerprint,
    mode: token.identityMode,
    scopeKey: token.identityScopeKey ?? QUEUE_ENTITLEMENT_SCOPE_KEY,
  };
}

/**
 * Decides whether this customer may join, and takes their hold if so
 * (ADR-035, scoped by ADR-049).
 *
 * The old model asked a unique index a yes/no question, because eligibility
 * was a discrete window and "same window" was the whole rule. A custom window
 * is not discrete — it is an instant — so the decision is read explicitly
 * here and the index's job narrows to guaranteeing that only one claim per
 * (identity, entitlement scope) is ever the governing one.
 *
 * ADR-049 separates the two questions this used to answer with one row:
 *
 *  1. Active-duplicate prevention — unchanged and deliberately *not* scoped:
 *     any live RESERVED claim for this identity anywhere in the queue means
 *     the person already has a token in progress, so they cannot join again,
 *     whatever session either token is in.
 *  2. Completed-visit entitlement — a CONSUMED claim blocks this join only
 *     if its scope covers it: a queue-wide claim ("QUEUE") covers every join;
 *     a session-occurrence claim covers only a join assigned to that same
 *     occurrence. A claim keeps the scope it was taken under, so changing a
 *     queue's scope later neither retroactively widens nor erases a visit
 *     already recorded — the same rule ADR-035 applies to a changed window.
 *
 * Reading before writing is safe precisely here: every join to a queue is
 * serialized by the `SELECT ... FOR UPDATE` on the queue row taken at the top
 * of this transaction, so no second joiner can slip between the read and the
 * write. The unique index remains as the backstop that would turn a future
 * mistake into a failed request rather than a silently doubled entitlement.
 */
async function claimIdentityForNewToken(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    queueId: string;
    tokenId: string;
    identity: ResolvedCustomerIdentity;
    /** The session occurrence this join was assigned to, if any. */
    occurrenceScopeKey: string | null;
    /** The scope the new claim is taken under. */
    claimScopeKey: string;
  },
): Promise<void> {
  const { identity } = input;
  const live = await tx.queueIdentityClaim.findMany({
    where: {
      queueId: input.queueId,
      identityFingerprint: identity.fingerprint,
      supersededAt: null,
    },
  });

  // Held by a token that is still being served — the same person cannot be
  // in the queue twice at once, from any number of installations.
  if (live.some((claim) => claim.status === 'RESERVED')) {
    throw new AppError(409, 'REPEAT_VISIT_NOT_ALLOWED', ACTIVE_ELSEWHERE_MESSAGE, {
      reason: 'ALREADY_IN_QUEUE',
    });
  }

  const covering = live.filter(
    (claim) =>
      claim.entitlementScopeKey === QUEUE_ENTITLEMENT_SCOPE_KEY ||
      (input.occurrenceScopeKey != null && claim.entitlementScopeKey === input.occurrenceScopeKey),
  );

  const now = Date.now();
  const blocking = covering.filter(
    (claim) => claim.eligibleAgainAt == null || claim.eligibleAgainAt.getTime() > now,
  );
  if (blocking.length > 0) {
    // The longest-lasting block is the honest answer; "never" outlasts all.
    const permanent = blocking.find((claim) => claim.eligibleAgainAt == null);
    const governing =
      permanent ??
      blocking.reduce((latest, claim) =>
        claim.eligibleAgainAt!.getTime() > latest.eligibleAgainAt!.getTime() ? claim : latest,
      );
    const scope = governing.entitlementScopeKey === QUEUE_ENTITLEMENT_SCOPE_KEY ? 'QUEUE' : 'SESSION';
    const endsAt = governing.eligibleAgainAt;
    throw new AppError(409, 'REPEAT_VISIT_NOT_ALLOWED', repeatRejectionMessage(endsAt, scope), {
      reason: 'ALREADY_USED',
      // Which allowance is spent — the whole queue's, or this session's —
      // so the app can word it. Never which session or whose visit.
      scope,
      // Safe context only: when they may return. Never the other visit's
      // identity, form answers or token.
      ...(endsAt ? { restrictionEndsAt: endsAt.toISOString() } : {}),
    });
  }

  // Every covering claim's wait is over. Spent claims become history rather
  // than being deleted, so the record of each visit survives (ADR-034
  // §historical claims); a slot is freed by taking the row's own id, which
  // cannot collide.
  for (const claim of covering) {
    await tx.queueIdentityClaim.update({
      where: { id: claim.id },
      data: { claimSlot: claim.id, supersededAt: new Date() },
    });
  }

  await tx.queueIdentityClaim.create({
    data: {
      organizationId: input.organizationId,
      queueId: input.queueId,
      identityFingerprint: identity.fingerprint,
      mode: identity.mode,
      status: 'RESERVED',
      entitlementScopeKey: input.claimScopeKey,
      tokenId: input.tokenId,
    },
  });
}
