import type { Prisma, Queue, QueueSession } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { isValidTimezone, resolveLocalMoment, type QueueLocalMoment } from '../utils/customerIdentity';
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
 * Sessions on the same weekday are allowed to overlap by design — that
 * models two concurrent capacity pools, not a mistake — so "the next
 * eligible session" (spec 4E) means the next *currently active* overlapping
 * session with room, never a session that hasn't started yet. Spec 4C is
 * explicit that joining outside every session's live window is a rejection
 * ("before first session" / "between sessions" / "after the last one ends"),
 * not a future pre-booking.
 */

export type ScheduleUnavailableCode =
  | 'SCHEDULE_CLOSED_TODAY'
  | 'SCHEDULE_NOT_YET_OPEN'
  | 'SCHEDULE_BETWEEN_SESSIONS'
  | 'SCHEDULE_ENDED_TODAY'
  | 'SCHEDULE_SESSION_FULL'
  | 'SCHEDULE_DAILY_CAPACITY_REACHED';

function formatMinute(totalMinutes: number): string {
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

/**
 * Pure time-of-day decision, no capacity, no DB — shared by the
 * authoritative in-transaction assignment below and the read-only public
 * preview (publicQueue.service.ts) so the two can never disagree about
 * "is this queue currently open," only about whether a slot has room.
 *
 * `todaysSessions` must already be filtered to the moment's weekday and
 * sorted by startMinute ascending (both callers query it that way).
 */
export function resolveOpenSessionsNow(
  todaysSessions: SessionWindow[],
  minuteOfDay: number,
): { open: SessionWindow[]; unavailableCode: ScheduleUnavailableCode | null; nextStartMinute: number | null } {
  if (todaysSessions.length === 0) {
    return { open: [], unavailableCode: 'SCHEDULE_CLOSED_TODAY', nextStartMinute: null };
  }

  const open = todaysSessions.filter(
    (s) => minuteOfDay >= s.startMinute && minuteOfDay < s.endMinute,
  );
  if (open.length > 0) {
    return { open, unavailableCode: null, nextStartMinute: null };
  }

  const firstStart = todaysSessions[0]!.startMinute;
  const lastEnd = todaysSessions.reduce((max, s) => Math.max(max, s.endMinute), 0);

  if (minuteOfDay < firstStart) {
    return { open: [], unavailableCode: 'SCHEDULE_NOT_YET_OPEN', nextStartMinute: firstStart };
  }
  if (minuteOfDay >= lastEnd) {
    return { open: [], unavailableCode: 'SCHEDULE_ENDED_TODAY', nextStartMinute: null };
  }
  const next = todaysSessions
    .filter((s) => s.startMinute > minuteOfDay)
    .sort((a, b) => a.startMinute - b.startMinute)[0];
  return {
    open: [],
    unavailableCode: 'SCHEDULE_BETWEEN_SESSIONS',
    nextStartMinute: next ? next.startMinute : null,
  };
}

export function describeScheduleUnavailable(
  code: ScheduleUnavailableCode,
  nextStartMinute: number | null,
): string {
  switch (code) {
    case 'SCHEDULE_CLOSED_TODAY':
      return 'This queue is closed today.';
    case 'SCHEDULE_NOT_YET_OPEN':
      return nextStartMinute != null
        ? `This queue opens today at ${formatMinute(nextStartMinute)}.`
        : 'This queue is not open yet today.';
    case 'SCHEDULE_BETWEEN_SESSIONS':
      return nextStartMinute != null
        ? `This queue reopens today at ${formatMinute(nextStartMinute)}.`
        : 'This queue is between sessions right now.';
    case 'SCHEDULE_ENDED_TODAY':
      return 'This queue is closed for the rest of today.';
    case 'SCHEDULE_SESSION_FULL':
      return 'This session is full. Please try again during the next session.';
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
}

/**
 * The authoritative assignment, called from inside token.service.ts's
 * createToken transaction — after the queue row is locked FOR UPDATE, which
 * serializes every concurrent createToken call for this queue to one at a
 * time (the same technique ADR-003's sequence counter and the existing
 * device-active-token check already rely on). A capacity COUNT read here is
 * therefore race-free without any extra locking: no other transaction can be
 * counting or inserting against this queue until this one commits or rolls
 * back.
 *
 * Throws AppError (409, one of the ScheduleUnavailableCode values) when no
 * session can accept the join right now. Callers must run this inside the
 * same `tx` as the queue lock — never standalone.
 */
export async function assignSessionForNewToken(
  tx: Prisma.TransactionClient,
  params: { queueId: string; dailyCapacity: number | null; moment: QueueLocalMoment },
): Promise<SessionAssignment> {
  const { queueId, dailyCapacity, moment } = params;

  const todaysSessions = await tx.queueSession.findMany({
    where: { queueId, weekday: moment.weekday },
    orderBy: [{ startMinute: 'asc' }, { id: 'asc' }],
  });

  const { open, unavailableCode, nextStartMinute } = resolveOpenSessionsNow(todaysSessions, moment.minuteOfDay);
  if (unavailableCode) {
    throw new AppError(409, unavailableCode, describeScheduleUnavailable(unavailableCode, nextStartMinute));
  }

  if (dailyCapacity != null) {
    const dailyCount = await tx.token.count({
      where: { queueId, assignedSessionDate: moment.dateKey },
    });
    if (dailyCount >= dailyCapacity) {
      throw new AppError(
        409,
        'SCHEDULE_DAILY_CAPACITY_REACHED',
        describeScheduleUnavailable('SCHEDULE_DAILY_CAPACITY_REACHED', null),
      );
    }
  }

  for (const session of open) {
    if (session.capacity == null) {
      return {
        queueSessionId: session.id,
        assignedSessionDate: moment.dateKey,
        assignedSessionStartMinute: session.startMinute,
        assignedSessionEndMinute: session.endMinute,
      };
    }
    const sessionCount = await tx.token.count({
      where: { queueSessionId: session.id, assignedSessionDate: moment.dateKey },
    });
    if (sessionCount < session.capacity) {
      return {
        queueSessionId: session.id,
        assignedSessionDate: moment.dateKey,
        assignedSessionStartMinute: session.startMinute,
        assignedSessionEndMinute: session.endMinute,
      };
    }
  }

  throw new AppError(
    409,
    'SCHEDULE_SESSION_FULL',
    describeScheduleUnavailable('SCHEDULE_SESSION_FULL', null),
  );
}

/**
 * Read-only preview for the public (pre-join) queue-config endpoint: is this
 * queue open right now, and — only when the admin has left schedule details
 * visible — today's session windows. Deliberately never checks capacity: a
 * COUNT taken outside the join transaction could not be authoritative by the
 * time the customer actually submits, so the real capacity/full rejection is
 * always the createToken call's own error, exactly as every other join
 * failure in this codebase already works.
 */
export interface PublicScheduleView {
  scheduleEnabled: boolean;
  isOpenNow: boolean;
  unavailableCode: ScheduleUnavailableCode | null;
  message: string | null;
  todaySessions: { startMinute: number; endMinute: number }[] | null;
}

export async function describePublicSchedule(
  queue: Pick<Queue, 'id' | 'scheduleEnabled' | 'scheduleVisibleToCustomers'>,
  timezone: string | null,
  now: Date = new Date(),
): Promise<PublicScheduleView> {
  if (!queue.scheduleEnabled) {
    return { scheduleEnabled: false, isOpenNow: true, unavailableCode: null, message: null, todaySessions: null };
  }

  const moment = resolveLocalMoment(now, timezone ?? 'UTC');
  const todaysSessions = await prisma.queueSession.findMany({
    where: { queueId: queue.id, weekday: moment.weekday },
    orderBy: [{ startMinute: 'asc' }, { id: 'asc' }],
  });
  const { open, unavailableCode, nextStartMinute } = resolveOpenSessionsNow(todaysSessions, moment.minuteOfDay);

  return {
    scheduleEnabled: true,
    isOpenNow: open.length > 0,
    unavailableCode,
    message: unavailableCode ? describeScheduleUnavailable(unavailableCode, nextStartMinute) : null,
    todaySessions: queue.scheduleVisibleToCustomers
      ? todaysSessions.map((s) => ({ startMinute: s.startMinute, endMinute: s.endMinute }))
      : null,
  };
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

/** Shape rules only — a human can always mean to overlap two sessions on
 * purpose (see the module doc comment), so overlap is never rejected here. */
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

  const session = await prisma.queueSession.create({
    data: {
      queueId,
      weekday: input.weekday,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      capacity: input.capacity,
    },
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

  const updated = await prisma.queueSession.update({
    where: { id: sessionId },
    data: {
      weekday: input.weekday,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      capacity: input.capacity,
    },
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
