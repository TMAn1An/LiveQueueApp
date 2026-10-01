import type { Prisma, Queue, QueueSession } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import {
  instantFromLocalParts,
  isValidTimezone,
  resolveLocalMoment,
  type QueueLocalMoment,
} from '../utils/customerIdentity';
import { assertQueueMutable, requireOwnedQueue } from '../utils/tenantScope';

/**
 * Phase 4: optional per-queue weekly schedule + session capacity.
 *
 * A weekday is "closed" purely by having zero QueueSession rows for it —
 * there is no separate open/closed flag to drift out of sync with the
 * session list. `queue.scheduleEnabled` is the only master switch; every
 * existing queue has it `false` (see migration 20260929223845), so every
 * queue that predates this feature keeps accepting joins at any time,
 * exactly as before (spec 4K).
 *
 * Sessions on the same weekday may not overlap (a product decision that
 * reversed ADR-046's original "overlap allowed"; see assertNoOverlap).
 *
 * ADR-048 changed assignment from "only a session open right now" to "the
 * first eligible session that has not ended yet *today*": a customer who
 * scans while the morning session is full, between two sessions, or before
 * the first session opens is given a place in the next session with room
 * instead of being turned away. There is still no cross-day pre-booking —
 * once every session today has ended, a join is refused.
 */

export type ScheduleUnavailableCode =
  | 'SCHEDULE_CLOSED_TODAY'
  | 'SCHEDULE_ENDED_TODAY'
  | 'SCHEDULE_SESSION_FULL'
  | 'SCHEDULE_DAILY_CAPACITY_REACHED';

export function formatMinute(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minute = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hour}:${minute}`;
}

interface SessionWindow {
  id: string;
  startMinute: number;
  endMinute: number;
  capacity: number | null;
}

export interface TodaysScheduleResolution<T extends SessionWindow> {
  /** Sessions whose window contains this minute right now. */
  open: T[];
  /**
   * Every session that has not ended yet today, in deterministic
   * chronological order: (startMinute, id) — so a currently-open session is
   * always tried before a later one, and two sessions starting together are
   * always tried in the same order. This is the full list assignment may
   * choose from; an ended session never appears in it.
   */
  candidates: T[];
  /** Set only when no session is left to join today. */
  unavailableCode: 'SCHEDULE_CLOSED_TODAY' | 'SCHEDULE_ENDED_TODAY' | null;
  /** When nothing is open right now but a later session remains: its start. */
  nextStartMinute: number | null;
}

/**
 * Pure time-of-day decision, no capacity, no DB — shared by the
 * authoritative in-transaction assignment below and the read-only public
 * preview (publicQueue.service.ts) so the two can never disagree about
 * "can this queue still be joined today," only about whether a slot has room.
 *
 * `todaysSessions` must already be filtered to the moment's weekday; it is
 * re-sorted here so the candidate order never depends on the caller.
 */
export function resolveTodaysSchedule<T extends SessionWindow>(
  todaysSessions: T[],
  minuteOfDay: number,
): TodaysScheduleResolution<T> {
  if (todaysSessions.length === 0) {
    return { open: [], candidates: [], unavailableCode: 'SCHEDULE_CLOSED_TODAY', nextStartMinute: null };
  }

  const candidates = todaysSessions
    .filter((s) => minuteOfDay < s.endMinute)
    .sort((a, b) => a.startMinute - b.startMinute || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (candidates.length === 0) {
    return { open: [], candidates: [], unavailableCode: 'SCHEDULE_ENDED_TODAY', nextStartMinute: null };
  }

  const open = candidates.filter((s) => s.startMinute <= minuteOfDay);
  return {
    open,
    candidates,
    unavailableCode: null,
    nextStartMinute: open.length > 0 ? null : candidates[0]!.startMinute,
  };
}

export function describeScheduleUnavailable(code: ScheduleUnavailableCode): string {
  switch (code) {
    case 'SCHEDULE_CLOSED_TODAY':
      return 'This queue is closed today.';
    case 'SCHEDULE_ENDED_TODAY':
      return 'All of today\'s sessions have ended. Please come back on another day.';
    case 'SCHEDULE_SESSION_FULL':
      return 'Every remaining session today is full. Please try again on another day.';
    case 'SCHEDULE_DAILY_CAPACITY_REACHED':
      return 'This queue has reached its capacity for today.';
    default:
      return 'This queue is not currently accepting new customers.';
  }
}

export interface SessionAssignment {
  queueSessionId: string;
  assignedSessionDate: Date;
  assignedSessionStartMinute: number;
  assignedSessionEndMinute: number;
  /** The session occurrence's start as an absolute instant (ADR-048). */
  assignedSessionStartsAt: Date;
}

/**
 * ADR-049: the stable identity of one *occurrence* of a weekly session.
 * A QueueSession row recurs every week, so its id alone would make "the
 * Monday morning session" one entitlement forever; the local calendar date
 * the token was assigned to is what distinguishes this Monday from next.
 * Built only from ids and the date — never from display text or times,
 * which an admin can edit without the occurrence becoming a different one.
 */
export function sessionOccurrenceScopeKey(queueSessionId: string, assignedSessionDate: Date): string {
  return `SESSION:${queueSessionId}:${assignedSessionDate.toISOString().slice(0, 10)}`;
}

/** The instant a given local minute of a local calendar date occurs in a
 * zone. `dateKey` is a QueueLocalMoment date key (midnight UTC of the local
 * date), so its UTC fields *are* the local year/month/day. */
function sessionStartInstant(dateKey: Date, startMinute: number, timezone: string): Date {
  return instantFromLocalParts(
    {
      year: dateKey.getUTCFullYear(),
      month: dateKey.getUTCMonth() + 1,
      day: dateKey.getUTCDate(),
      hour: Math.floor(startMinute / 60),
      minute: startMinute % 60,
      second: 0,
    },
    timezone,
  );
}

/**
 * The authoritative assignment, called from inside token.service.ts's
 * createToken transaction — after the queue row is locked FOR UPDATE, which
 * serializes every concurrent createToken call for this queue to one at a
 * time (the same technique ADR-003's sequence counter and the existing
 * device-active-token check already rely on). A capacity COUNT read here is
 * therefore race-free without any extra locking: no other transaction can be
 * counting or inserting against this queue until this one commits or rolls
 * back. That holds for a future session exactly as for an open one — the
 * lock is per queue, not per session.
 *
 * Algorithm (ADR-048):
 *  1. no session today → SCHEDULE_CLOSED_TODAY; every session ended →
 *     SCHEDULE_ENDED_TODAY;
 *  2. daily capacity reached → SCHEDULE_DAILY_CAPACITY_REACHED;
 *  3. otherwise walk today's not-yet-ended sessions in (startMinute, id)
 *     order — currently open ones first by construction — and take the first
 *     with room; none has room → SCHEDULE_SESSION_FULL. (ADR-049: occurrences
 *     the customer has already used up are tried last, in the same order.)
 *
 * Throws AppError (409, one of the ScheduleUnavailableCode values) when no
 * session can accept the join. Callers must run this inside the same `tx` as
 * the queue lock — never standalone.
 */
export async function assignSessionForNewToken(
  tx: Prisma.TransactionClient,
  params: {
    queueId: string;
    dailyCapacity: number | null;
    moment: QueueLocalMoment;
    timezone: string;
    /**
     * ADR-049: session occurrences (by key) this customer has already used
     * up under a per-session repeat limit. They are passed over so a
     * customer served in the morning is placed in the afternoon rather than
     * back into the morning session they may not rejoin. If nothing else has
     * room, assignment falls back to them anyway, so the join is refused
     * with the accurate repeat-visit reason (by the claim step) rather than
     * a misleading "full".
     */
    spentOccurrenceKeys?: ReadonlySet<string>;
  },
): Promise<SessionAssignment> {
  const { queueId, dailyCapacity, moment, timezone } = params;
  const spent = params.spentOccurrenceKeys ?? new Set<string>();

  const todaysSessions = await tx.queueSession.findMany({
    where: { queueId, weekday: moment.weekday },
    orderBy: [{ startMinute: 'asc' }, { id: 'asc' }],
  });

  const { candidates, unavailableCode } = resolveTodaysSchedule(todaysSessions, moment.minuteOfDay);
  if (unavailableCode) {
    throw new AppError(409, unavailableCode, describeScheduleUnavailable(unavailableCode));
  }

  if (dailyCapacity != null) {
    const dailyCount = await tx.token.count({
      where: { queueId, assignedSessionDate: moment.dateKey },
    });
    if (dailyCount >= dailyCapacity) {
      throw new AppError(
        409,
        'SCHEDULE_DAILY_CAPACITY_REACHED',
        describeScheduleUnavailable('SCHEDULE_DAILY_CAPACITY_REACHED'),
      );
    }
  }

  const isSpent = (session: QueueSession) => spent.has(sessionOccurrenceScopeKey(session.id, moment.dateKey));
  const ordered = [...candidates.filter((s) => !isSpent(s)), ...candidates.filter(isSpent)];

  for (const session of ordered) {
    if (session.capacity != null) {
      const sessionCount = await tx.token.count({
        where: { queueSessionId: session.id, assignedSessionDate: moment.dateKey },
      });
      if (sessionCount >= session.capacity) {
        continue;
      }
    }
    return {
      queueSessionId: session.id,
      assignedSessionDate: moment.dateKey,
      assignedSessionStartMinute: session.startMinute,
      assignedSessionEndMinute: session.endMinute,
      assignedSessionStartsAt: sessionStartInstant(moment.dateKey, session.startMinute, timezone),
    };
  }

  throw new AppError(409, 'SCHEDULE_SESSION_FULL', describeScheduleUnavailable('SCHEDULE_SESSION_FULL'));
}

/**
 * Read-only preview for the public (pre-join) queue-config endpoint: can this
 * queue still be joined today, is a session running right now, and — only
 * when the admin has left schedule details visible — today's session
 * windows. Deliberately never checks capacity: a COUNT taken outside the join
 * transaction could not be authoritative by the time the customer actually
 * submits, so the real capacity/full rejection is always the createToken
 * call's own error, exactly as every other join failure in this codebase
 * already works.
 */
export interface PublicScheduleView {
  scheduleEnabled: boolean;
  /** A session is running right now. */
  isOpenNow: boolean;
  /** ADR-048: a session remains today, so a join can still be assigned —
   * possibly to a later session. This, not isOpenNow, gates joining. */
  acceptingJoins: boolean;
  unavailableCode: ScheduleUnavailableCode | null;
  /** Why joining is refused, or — when accepting joins before the next
   * session starts — that the customer will be served later today. */
  message: string | null;
  /** When nothing is running now: the start of the next session today. */
  nextSessionStartMinute: number | null;
  todaySessions: { startMinute: number; endMinute: number }[] | null;
}

export async function describePublicSchedule(
  queue: Pick<Queue, 'id' | 'scheduleEnabled' | 'scheduleVisibleToCustomers'>,
  timezone: string | null,
  now: Date = new Date(),
): Promise<PublicScheduleView> {
  if (!queue.scheduleEnabled) {
    return {
      scheduleEnabled: false,
      isOpenNow: true,
      acceptingJoins: true,
      unavailableCode: null,
      message: null,
      nextSessionStartMinute: null,
      todaySessions: null,
    };
  }

  const moment = resolveLocalMoment(now, timezone ?? 'UTC');
  const todaysSessions = await prisma.queueSession.findMany({
    where: { queueId: queue.id, weekday: moment.weekday },
    orderBy: [{ startMinute: 'asc' }, { id: 'asc' }],
  });
  const { open, unavailableCode, nextStartMinute } = resolveTodaysSchedule(todaysSessions, moment.minuteOfDay);

  let message: string | null = null;
  if (unavailableCode) {
    message = describeScheduleUnavailable(unavailableCode);
  } else if (nextStartMinute != null) {
    message = `The next session starts today at ${formatMinute(nextStartMinute)}. You can join now and will be served in a later session.`;
  }

  return {
    scheduleEnabled: true,
    isOpenNow: open.length > 0,
    acceptingJoins: unavailableCode == null,
    unavailableCode,
    message,
    nextSessionStartMinute: nextStartMinute,
    todaySessions: queue.scheduleVisibleToCustomers
      ? todaysSessions.map((s) => ({ startMinute: s.startMinute, endMinute: s.endMinute }))
      : null,
  };
}

/**
 * ADR-048: queues holding a WAITING token whose assigned session started in
 * (from, to] — i.e. tokens that just stopped being scheduled and joined the
 * callable line. Nothing changes in the database at that instant (the gate
 * is a pure comparison against the fixed start), so the session-start
 * scheduler uses this to know whose ETAs and positions to re-broadcast.
 * A Prisma query rather than raw SQL, so DateTime comparison is zone-safe.
 */
export async function listQueuesWithSessionsStartingBetween(from: Date, to: Date): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: { status: 'WAITING', assignedSessionStartsAt: { gt: from, lte: to } },
    select: { queueId: true },
    distinct: ['queueId'],
  });
  return rows.map((row) => row.queueId);
}

// ---------------------------------------------------------------------------
// Admin configuration: session CRUD validation
// ---------------------------------------------------------------------------

export interface QueueSessionInput {
  weekday: number;
  startMinute: number;
  endMinute: number;
  capacity: number | null;
}

/** Shape rules only; overlap with other sessions is checked separately
 * (assertNoOverlap), because it needs the queue's other sessions. */
export function validateSessionInput(input: QueueSessionInput): void {
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
    throw new AppError(422, 'SESSION_WEEKDAY_INVALID', 'weekday must be an integer from 0 (Sunday) to 6 (Saturday).');
  }
  if (
    !Number.isInteger(input.startMinute) ||
    input.startMinute < 0 ||
    input.startMinute > 1439 ||
    !Number.isInteger(input.endMinute) ||
    input.endMinute < 0 ||
    input.endMinute > 1439
  ) {
    throw new AppError(422, 'SESSION_TIME_INVALID', 'Session start and end must be times within a single day.');
  }
  if (input.endMinute <= input.startMinute) {
    throw new AppError(422, 'SESSION_TIME_ORDER_INVALID', 'A session must end after it starts.');
  }
  if (input.capacity != null && (!Number.isInteger(input.capacity) || input.capacity < 1)) {
    throw new AppError(422, 'SESSION_CAPACITY_INVALID', 'Session capacity must be a positive whole number, or left unset for unlimited.');
  }
}

/** A queue may only turn scheduling on once it has a real, resolvable
 * timezone — every window in this feature is evaluated on the queue's own
 * clock, and guessing one would silently mean the wrong day for someone. */
export function requireScheduleTimezone(effectiveTimezone: string | null): void {
  if (!effectiveTimezone) {
    throw new AppError(
      422,
      'QUEUE_TIMEZONE_REQUIRED',
      'Set this queue\'s timezone before enabling scheduling — sessions are evaluated on the queue\'s own clock.',
    );
  }
  if (!isValidTimezone(effectiveTimezone)) {
    throw new AppError(422, 'INVALID_TIMEZONE', 'That is not a recognized timezone.');
  }
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Half-open windows [start, end): 09:00-12:00 and 12:00-15:00 touch but do
 * not overlap, so back-to-back sessions stay allowed. */
export function sessionsOverlap(
  a: { startMinute: number; endMinute: number },
  b: { startMinute: number; endMinute: number },
): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/**
 * Product rule (reverses ADR-046's "overlap allowed"): sessions on the same
 * weekday may not overlap — a customer is assigned to exactly one window, and
 * two windows covering the same minutes made "which session am I in" and
 * each session's capacity ambiguous to the people configuring them.
 *
 * Runs inside the caller's transaction after the queue row is locked, so two
 * administrators adding sessions at the same moment cannot both pass.
 */
async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  queueId: string,
  input: QueueSessionInput,
  excludeSessionId?: string,
): Promise<void> {
  const sameDay = await tx.queueSession.findMany({
    where: { queueId, weekday: input.weekday, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
    orderBy: { startMinute: 'asc' },
  });
  const clash = sameDay.find((existing) => sessionsOverlap(existing, input));
  if (clash) {
    throw new AppError(
      409,
      'SESSION_OVERLAP',
      `This overlaps the ${formatMinute(clash.startMinute)}–${formatMinute(clash.endMinute)} session on ${WEEKDAY_NAMES[input.weekday]}. Sessions on the same day cannot overlap.`,
    );
  }
}

async function lockQueueRow(tx: Prisma.TransactionClient, queueId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM queues WHERE id = ${queueId} FOR UPDATE`;
}

export function serializeSession(session: QueueSession) {
  return {
    id: session.id,
    weekday: session.weekday,
    startMinute: session.startMinute,
    endMinute: session.endMinute,
    capacity: session.capacity,
  };
}

/**
 * Direct session-id operations never trust the id alone — ownership is
 * always verified through the parent queue's organizationId (CLAUDE.md
 * Rule 4 / "session → queue → organizationId"), same as every other
 * queue-nested resource in this codebase (see service.service.ts).
 */
async function findSessionScoped(
  organizationId: string,
  sessionId: string,
): Promise<QueueSession & { queue: Queue }> {
  const session = await prisma.queueSession.findFirst({
    where: { id: sessionId, queue: { organizationId } },
    include: { queue: true },
  });
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }
  return session;
}

export async function listQueueSessions(organizationId: string, queueId: string) {
  await requireOwnedQueue(organizationId, queueId);
  const sessions = await prisma.queueSession.findMany({
    where: { queueId },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
  return sessions.map(serializeSession);
}

export async function createQueueSession(
  organizationId: string,
  queueId: string,
  input: QueueSessionInput,
) {
  const queue = await requireOwnedQueue(organizationId, queueId);
  assertQueueMutable(queue);
  validateSessionInput(input);

  const session = await prisma.$transaction(async (tx) => {
    await lockQueueRow(tx, queueId);
    await assertNoOverlap(tx, queueId, input);
    return tx.queueSession.create({
      data: {
        queueId,
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        capacity: input.capacity,
      },
    });
  });
  return serializeSession(session);
}

export async function updateQueueSession(
  organizationId: string,
  sessionId: string,
  input: QueueSessionInput,
) {
  const session = await findSessionScoped(organizationId, sessionId);
  assertQueueMutable(session.queue);
  validateSessionInput(input);

  const updated = await prisma.$transaction(async (tx) => {
    await lockQueueRow(tx, session.queueId);
    await assertNoOverlap(tx, session.queueId, input, sessionId);
    return tx.queueSession.update({
      where: { id: sessionId },
      data: {
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        capacity: input.capacity,
      },
    });
  });
  return serializeSession(updated);
}

/**
 * A hard delete, not a soft one — unlike a queue, a session carries no
 * customer-facing history of its own: every token that was ever assigned to
 * it already snapshotted the session's start/end minutes onto itself
 * (Token.assignedSessionStartMinute/EndMinute), so History and Live Tracking
 * keep displaying correctly (queueSessionId simply goes null via
 * onDelete: SetNull). Capacity accounting for that already-elapsed date is
 * likewise unaffected — it counts tokens, never the session row itself.
 */
export async function deleteQueueSession(organizationId: string, sessionId: string): Promise<void> {
  const session = await findSessionScoped(organizationId, sessionId);
  assertQueueMutable(session.queue);
  await prisma.queueSession.delete({ where: { id: sessionId } });
}
