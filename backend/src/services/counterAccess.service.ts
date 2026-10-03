import type { Prisma, StaffRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

/**
 * ADR-064: counter assignment and serving governance.
 *
 * Two separate questions:
 *
 *  - Who manages counters and assignments? OWNER and ADMIN (manage_counters,
 *    manage_staff). STAFF never do.
 *  - Who may serve? Any operator — OWNER, ADMIN or STAFF — but only from the
 *    one counter they are assigned to. Serving eligibility comes from the
 *    assignment, never from a management permission.
 *
 * There is exactly one answer to "which counter may this person operate?":
 * the counter whose `staffId` is theirs. `Counter.staffId` has a database
 * unique index (counters_staff_id_key) over every counter in every queue, so
 * a person holds at most one counter anywhere. Nothing a client sends — a
 * counterId, a staffId — can widen it: the serving paths derive the counter
 * from the authenticated actor and treat any counterId in the request only
 * as a claim to be checked against it.
 */

/** The authenticated actor, as every serving path needs it. Structurally a
 * subset of `AuthContext`, so controllers pass `req.auth` directly. */
export interface CounterActor {
  staffId: string;
  organizationId: string;
  role: StaffRole;
  /** ADR-069: an Executive's workspace; carried so scope checks see it. */
  workspaceAdminId?: string | null;
}

export const OPERATOR_NOT_ASSIGNED_TO_COUNTER = 'OPERATOR_NOT_ASSIGNED_TO_COUNTER';
export const COUNTER_ACCESS_DENIED = 'COUNTER_ACCESS_DENIED';

function notAssigned(): AppError {
  return new AppError(
    403,
    OPERATOR_NOT_ASSIGNED_TO_COUNTER,
    'You are not assigned to a counter. Ask the organization owner or an admin to assign you to one.',
  );
}

function accessDenied(message = 'You can only operate the counter you are assigned to.'): AppError {
  return new AppError(403, COUNTER_ACCESS_DENIED, message);
}

/** The actor's own counter, or null. Scoped to their organization, so a
 * stale assignment can never reach across tenants. */
export function findAssignedCounter(
  actor: Pick<CounterActor, 'staffId' | 'organizationId'>,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return client.counter.findFirst({
    where: { staffId: actor.staffId, queue: { organizationId: actor.organizationId } },
    include: { queue: { select: { id: true, name: true, organizationId: true } } },
  });
}

/**
 * The counter the actor claims from — their own, whatever their role. A
 * claim always belongs to whoever makes it, at their own counter (ADR-064).
 * A `requestedCounterId` is accepted for compatibility with older clients
 * and must match.
 */
export async function requireClaimCounter(
  actor: CounterActor,
  requestedCounterId?: string | null,
) {
  const counter = await findAssignedCounter(actor);
  if (!counter) {
    throw notAssigned();
  }
  if (requestedCounterId && requestedCounterId !== counter.id) {
    throw accessDenied();
  }
  return counter;
}

/**
 * Re-checked inside the claiming transaction, on the counter row it has
 * locked FOR UPDATE: an owner reassigning the counter between the read above
 * and the claim cannot leave the claim bound to someone no longer there.
 */
export function assertStillAssigned(actor: CounterActor, lockedStaffId: string | null) {
  if (lockedStaffId !== actor.staffId) {
    throw notAssigned();
  }
}

export const COUNTER_MANAGEMENT_DENIAL = {
  code: 'COUNTER_MANAGEMENT_FORBIDDEN',
  message: "Only the queue's Admin or the Organization Head can create, change or delete counters.",
};

/**
 * Creating, renaming, opening/closing and deleting counters is OWNER/ADMIN
 * management. The route already requires manage_counters, which STAFF do not
 * hold; this is the same rule again in the service.
 */
export function assertMayManageCounters(actor: Pick<CounterActor, 'role'>) {
  if (actor.role === 'STAFF') {
    throw new AppError(403, COUNTER_MANAGEMENT_DENIAL.code, COUNTER_MANAGEMENT_DENIAL.message);
  }
}

export const COUNTER_HAS_ACTIVE_SERVICE = 'COUNTER_HAS_ACTIVE_SERVICE';

/**
 * ADR-064: a person who has been called or is being served belongs to the
 * operator at that counter, and nobody else may finish them. So nothing may
 * separate them: the counter cannot be deleted, and its operator cannot be
 * unassigned, moved, replaced, suspended or removed, until that visit is
 * resolved (completed/skipped by that operator, or cancelled by the person).
 *
 * Locks the counter row(s) FOR UPDATE first. A claim locks the same row
 * before writing its CALLED token, so the two serialise: either the claim
 * lands first and this refuses, or this lands first and the claim finds the
 * assignment gone.
 */
export async function assertNoActiveServiceAtCounter(tx: Prisma.TransactionClient, counterId: string) {
  await tx.$queryRaw`SELECT id FROM counters WHERE id = ${counterId} FOR UPDATE`;
  const active = await tx.token.count({
    where: { counterId, status: { in: ['CALLED', 'IN_PROGRESS'] } },
  });
  if (active > 0) {
    throw new AppError(
      409,
      COUNTER_HAS_ACTIVE_SERVICE,
      'Someone is being called or served at this counter. That visit must be finished, skipped or cancelled first.',
    );
  }
}

/** The same rule, seen from the operator who holds the counter. */
export async function assertNoActiveServiceForStaff(tx: Prisma.TransactionClient, staffId: string) {
  const held = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM counters WHERE staff_id = ${staffId} FOR UPDATE
  `;
  for (const { id } of held) {
    await assertNoActiveServiceAtCounter(tx, id);
  }
}

/**
 * Acting on a token after the claim (start, complete, skip, adjust time):
 * any operator, only for the person at their own counter — or, for a
 * WAITING token (skipping the person at the front), only in the queue their
 * counter serves. There is no supervisor override for any role.
 *
 * While a person is called or being served, their counter and its operator
 * are kept together (assertNoActiveServiceAtCounter), so the person can only
 * be finished by that operator — or cancel from the app while CALLED.
 */
export async function assertMayActOnToken(
  actor: CounterActor,
  token: { counterId: string | null; queueId: string; status: string },
) {
  const own = await findAssignedCounter(actor);
  if (!own) {
    throw notAssigned();
  }
  if (token.counterId) {
    if (token.counterId !== own.id) {
      throw accessDenied('This person is being served at another counter.');
    }
    return;
  }
  // A called or in-service person always has a counter; one without is
  // never finished by "any operator in the queue".
  if (token.status === 'CALLED' || token.status === 'IN_PROGRESS') {
    throw accessDenied('This person is not at your counter.');
  }
  if (token.status !== 'WAITING') {
    // Terminal: nothing to act on — the state machine says so (422).
    return;
  }
  if (own.queueId !== token.queueId) {
    throw accessDenied('Your counter serves a different queue.');
  }
}
