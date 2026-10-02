import type { Counter, Prisma, StaffRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

/**
 * ADR-064: counter assignment and serving governance.
 *
 * There is exactly one answer to "which counter may this person operate?":
 * the counter whose `staffId` is theirs (`Counter.staffId`, unique, so a
 * person holds at most one). Only OWNER and ADMIN change that column
 * (`PATCH /api/counters/:id/assign`, gated on manage_staff). Nothing a
 * client sends — a counterId, a staffId — can widen it: the serving paths
 * derive the counter from the authenticated actor and treat any counterId in
 * the request only as a claim to be checked against it.
 */

/** The authenticated actor, as every serving path needs it. Structurally a
 * subset of `AuthContext`, so controllers pass `req.auth` directly. */
export interface CounterActor {
  staffId: string;
  organizationId: string;
  role: StaffRole;
}

export const STAFF_NOT_ASSIGNED_TO_COUNTER = 'STAFF_NOT_ASSIGNED_TO_COUNTER';
export const COUNTER_ACCESS_DENIED = 'COUNTER_ACCESS_DENIED';

function notAssigned(): AppError {
  return new AppError(
    403,
    STAFF_NOT_ASSIGNED_TO_COUNTER,
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
 * The counter the actor claims from. Every role is bound by it — OWNER and
 * ADMIN decide who stands at which counter, but a claim always belongs to
 * whoever makes it, at their own counter (ADR-064 §3D). A `requestedCounterId`
 * is accepted for compatibility with older clients and must match.
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

/**
 * Status changes and renames: STAFF only on their own counter; OWNER and
 * ADMIN on any counter in their organization.
 */
export function assertMayOperateCounter(actor: CounterActor, counter: Pick<Counter, 'staffId'>) {
  if (actor.role !== 'STAFF') {
    return;
  }
  if (counter.staffId !== actor.staffId) {
    throw accessDenied();
  }
}

/**
 * Acting on a token after the claim (start, complete, skip, adjust time).
 *
 * STAFF act only on tokens at their own counter — and, for a WAITING token
 * (skipping the person at the front), only in the queue their counter
 * serves. OWNER and ADMIN may resolve a token at any counter: a person
 * already at a counter must never be stranded because whoever called them
 * was unassigned or went home. That is supervision of a claim already made,
 * not dispatching a person to someone (which no path allows).
 */
export async function assertMayActOnToken(
  actor: CounterActor,
  token: { counterId: string | null; queueId: string },
) {
  if (actor.role !== 'STAFF') {
    return;
  }
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
  if (own.queueId !== token.queueId) {
    throw accessDenied('Your counter serves a different queue.');
  }
}
