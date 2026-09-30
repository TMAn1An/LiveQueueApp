import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createService, createTokenRequest, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { resolveLocalMoment } from '../src/utils/customerIdentity';
import { assignSessionForNewToken, resolveTodaysSchedule } from '../src/services/queueSchedule.service';

/**
 * Phase 4: optional per-queue weekly schedule + session capacity.
 *
 * Time-of-day branch coverage (closed/before/between/after/open) is
 * exercised directly against resolveTodaysSchedule/assignSessionForNewToken
 * with a literal moment — the same functions createToken calls, but
 * deterministic regardless of when this suite actually runs. HTTP-level
 * tests use a session window built relative to the real current time (in
 * UTC, matching every test organization's inherited timezone), wide enough
 * that the test can never straddle its own boundary mid-run.
 */

beforeEach(async () => {
  await resetDb();
});

function nowUtcMoment() {
  return resolveLocalMoment(new Date(), 'UTC');
}

async function orgWithQueue() {
  const ctx = await registerOwner({ timezone: 'UTC' });
  const queue = await createQueue(ctx.accessToken, { name: 'Clinic' });
  const service = await createService(ctx.accessToken, queue.id);
  return { ctx, queue, service };
}

function addSession(
  accessToken: string,
  queueId: string,
  overrides: { weekday: number; startMinute: number; endMinute: number; capacity?: number | null },
) {
  return api()
    .post(`/api/queues/${queueId}/sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(overrides);
}

function enableSchedule(accessToken: string, queueId: string, body: Record<string, unknown> = {}) {
  return api()
    .put(`/api/queues/${queueId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ scheduleEnabled: true, ...body });
}

describe('resolveTodaysSchedule (pure time-of-day decision, ADR-048)', () => {
  const wide = [{ id: 's-wide', startMinute: 0, endMinute: 1439, capacity: null }];

  it('closed today: zero sessions for the weekday', () => {
    const result = resolveTodaysSchedule([], 600);
    expect(result).toEqual({
      open: [],
      candidates: [],
      unavailableCode: 'SCHEDULE_CLOSED_TODAY',
      nextStartMinute: null,
    });
  });

  it('before the first session: joinable, with that session as the first candidate', () => {
    const sessions = [{ id: 's1', startMinute: 540, endMinute: 720, capacity: null }];
    const result = resolveTodaysSchedule(sessions, 100);
    expect(result.unavailableCode).toBeNull();
    expect(result.open).toEqual([]);
    expect(result.candidates.map((s) => s.id)).toEqual(['s1']);
    expect(result.nextStartMinute).toBe(540);
  });

  it('between sessions: the ended one is dropped, the later one is the candidate', () => {
    const sessions = [
      { id: 's1', startMinute: 540, endMinute: 720, capacity: null },
      { id: 's2', startMinute: 840, endMinute: 1020, capacity: null },
    ];
    const result = resolveTodaysSchedule(sessions, 780);
    expect(result.unavailableCode).toBeNull();
    expect(result.candidates.map((s) => s.id)).toEqual(['s2']);
    expect(result.nextStartMinute).toBe(840);
  });

  it('ended today: at or after the last session ends', () => {
    const sessions = [{ id: 's1', startMinute: 540, endMinute: 720, capacity: null }];
    const result = resolveTodaysSchedule(sessions, 720);
    expect(result.unavailableCode).toBe('SCHEDULE_ENDED_TODAY');
    expect(result.candidates).toEqual([]);
    expect(result.nextStartMinute).toBeNull();
  });

  it('open: currently inside a session window', () => {
    const result = resolveTodaysSchedule(wide, 700);
    expect(result.unavailableCode).toBeNull();
    expect(result.open.map((s) => s.id)).toEqual(['s-wide']);
    expect(result.nextStartMinute).toBeNull();
  });

  it('open: two overlapping sessions both count as currently open', () => {
    const sessions = [
      { id: 'a', startMinute: 0, endMinute: 1439, capacity: 1 },
      { id: 'b', startMinute: 0, endMinute: 1439, capacity: 1 },
    ];
    const result = resolveTodaysSchedule(sessions, 700);
    expect(result.open.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('candidate order is chronological and deterministic regardless of input order', () => {
    const sessions = [
      { id: 'later', startMinute: 840, endMinute: 1020, capacity: null },
      { id: 'z-open', startMinute: 540, endMinute: 720, capacity: null },
      { id: 'a-open', startMinute: 540, endMinute: 720, capacity: null },
      { id: 'ended', startMinute: 300, endMinute: 400, capacity: null },
    ];
    const result = resolveTodaysSchedule(sessions, 630);
    expect(result.candidates.map((s) => s.id)).toEqual(['a-open', 'z-open', 'later']);
    expect(result.open.map((s) => s.id)).toEqual(['a-open', 'z-open']);
  });
});

describe('resolveLocalMoment timezone boundary', () => {
  it('the same instant can fall on different calendar dates/weekdays in different zones', () => {
    // 2026-01-01T02:00:00Z — already Thursday in UTC, but still Wednesday
    // evening in a zone west of UTC.
    const instant = new Date('2026-01-01T02:00:00.000Z');
    const utc = resolveLocalMoment(instant, 'UTC');
    const westCoast = resolveLocalMoment(instant, 'America/Los_Angeles');

    expect(utc.weekday).toBe(4); // Thursday
    expect(westCoast.weekday).toBe(3); // Wednesday
    expect(utc.dateKey.getTime()).not.toBe(westCoast.dateKey.getTime());
  });
});

describe('assignSessionForNewToken (authoritative, DB-backed)', () => {
  it('assigns the currently-open session when it has room', async () => {
    const { queue } = await orgWithQueue();
    const moment = nowUtcMoment();
    await prisma.queueSession.create({
      data: { queueId: queue.id, weekday: moment.weekday, startMinute: 0, endMinute: 1439, capacity: null },
    });

    const assignment = await prisma.$transaction((tx) =>
      assignSessionForNewToken(tx, { queueId: queue.id, dailyCapacity: null, moment, timezone: 'UTC' }),
    );
    expect(assignment.assignedSessionStartMinute).toBe(0);
    expect(assignment.assignedSessionEndMinute).toBe(1439);
  });

  it('a full session tries the next eligible (overlapping) session', async () => {
    const { queue, service } = await orgWithQueue();
    const moment = nowUtcMoment();
    const full = await prisma.queueSession.create({
      data: { queueId: queue.id, weekday: moment.weekday, startMinute: 0, endMinute: 1439, capacity: 1 },
    });
    const roomy = await prisma.queueSession.create({
      data: { queueId: queue.id, weekday: moment.weekday, startMinute: 0, endMinute: 1439, capacity: 5 },
    });
    // Occupy the first session's one slot directly, as a prior assignment would.
    await prisma.token.create({
      data: {
        organizationId: queue.organizationId,
        queueId: queue.id,
        serviceId: service.id,
        deviceId: (await prisma.device.create({ data: { deviceIdentifier: `filler-${Math.random()}` } })).id,
        sequenceNumber: 999,
        serialNumber: 'FILLER',
        status: 'WAITING',
        formData: {},
        formVersion: 1,
        idempotencyKey: `filler-${Math.random()}`,
        queueSessionId: full.id,
        assignedSessionDate: moment.dateKey,
        assignedSessionStartMinute: full.startMinute,
        assignedSessionEndMinute: full.endMinute,
      },
    });

    const assignment = await prisma.$transaction((tx) =>
      assignSessionForNewToken(tx, { queueId: queue.id, dailyCapacity: null, moment, timezone: 'UTC' }),
    );
    expect(assignment.queueSessionId).toBe(roomy.id);
  });

  it('rejects with SCHEDULE_SESSION_FULL when every remaining session today is full', async () => {
    const { queue } = await orgWithQueue();
    const moment = nowUtcMoment();
    await prisma.queueSession.create({
      data: { queueId: queue.id, weekday: moment.weekday, startMinute: 0, endMinute: 1439, capacity: 0 },
    });

    await expect(
      prisma.$transaction((tx) => assignSessionForNewToken(tx, { queueId: queue.id, dailyCapacity: null, moment, timezone: 'UTC' })),
    ).rejects.toMatchObject({ code: 'SCHEDULE_SESSION_FULL' });
  });

  it('rejects with SCHEDULE_DAILY_CAPACITY_REACHED even when the session itself has room', async () => {
    const { queue } = await orgWithQueue();
    const moment = nowUtcMoment();
    await prisma.queueSession.create({
      data: { queueId: queue.id, weekday: moment.weekday, startMinute: 0, endMinute: 1439, capacity: 100 },
    });
    const service = await prisma.queueService.findFirstOrThrow({ where: { queueId: queue.id } });
    await prisma.token.create({
      data: {
        organizationId: queue.organizationId,
        queueId: queue.id,
        serviceId: service.id,
        deviceId: (await prisma.device.create({ data: { deviceIdentifier: `filler-${Math.random()}` } })).id,
        sequenceNumber: 999,
        serialNumber: 'FILLER',
        status: 'WAITING',
        formData: {},
        formVersion: 1,
        idempotencyKey: `filler-${Math.random()}`,
        assignedSessionDate: moment.dateKey,
      },
    });

    await expect(
      prisma.$transaction((tx) => assignSessionForNewToken(tx, { queueId: queue.id, dailyCapacity: 1, moment, timezone: 'UTC' })),
    ).rejects.toMatchObject({ code: 'SCHEDULE_DAILY_CAPACITY_REACHED' });
  });
});

describe('existing-queue compatibility (spec 4K)', () => {
  it('a queue with scheduling never enabled accepts joins at any time, with no session assignment', async () => {
    const { queue, service } = await orgWithQueue();

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toBeNull();

    const stored = await prisma.token.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.queueSessionId).toBeNull();
  });
});

describe('admin session configuration', () => {
  it('rejects enabling scheduling without a resolvable timezone', async () => {
    const ctx = await registerOwner({ timezone: undefined });
    // This organization never set a timezone, so the queue has none either.
    await prisma.organization.update({ where: { id: ctx.organizationId }, data: { timezone: null } });
    const queue = await createQueue(ctx.accessToken);

    const res = await enableSchedule(ctx.accessToken, queue.id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUEUE_TIMEZONE_REQUIRED');
  });

  it('rejects a session ending before or at its own start', async () => {
    const { ctx, queue } = await orgWithQueue();
    const res = await addSession(ctx.accessToken, queue.id, { weekday: 1, startMinute: 600, endMinute: 500 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SESSION_TIME_ORDER_INVALID');
  });

  it('rejects a negative or zero capacity at the request-shape layer', async () => {
    // Caught by the Zod schema before queueSchedule.service's own
    // SESSION_CAPACITY_INVALID check ever runs — that check is defense in
    // depth for any caller that reaches the service directly.
    const { ctx, queue } = await orgWithQueue();
    const res = await addSession(ctx.accessToken, queue.id, {
      weekday: 1,
      startMinute: 500,
      endMinute: 600,
      capacity: 0,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range weekday at the request-shape layer', async () => {
    const { ctx, queue } = await orgWithQueue();
    const res = await addSession(ctx.accessToken, queue.id, { weekday: 7, startMinute: 500, endMinute: 600 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not let another organization edit or delete this queue’s sessions', async () => {
    const { ctx, queue } = await orgWithQueue();
    const created = await addSession(ctx.accessToken, queue.id, { weekday: 1, startMinute: 500, endMinute: 600 });
    const other = await registerOwner();

    const updateRes = await api()
      .put(`/api/queues/${queue.id}/sessions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ weekday: 2, startMinute: 500, endMinute: 600 });
    const deleteRes = await api()
      .delete(`/api/queues/${queue.id}/sessions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(updateRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
  });
});

describe('fixed session assignment (spec 4D)', () => {
  it('a join snapshots the session window; editing the session afterward does not change it', async () => {
    const { ctx, queue, service } = await orgWithQueue();
    const moment = nowUtcMoment();
    const session = await addSession(ctx.accessToken, queue.id, {
      weekday: moment.weekday,
      startMinute: 0,
      endMinute: 1439,
    }).then((r) => r.body.data);
    await enableSchedule(ctx.accessToken, queue.id);

    const created = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(created.status).toBe(201);
    expect(created.body.data.assignedSession).toMatchObject({ startMinute: 0, endMinute: 1439 });

    const stored = await prisma.token.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(stored.queueSessionId).toBe(session.id);

    // Now edit the session's window entirely.
    await api()
      .put(`/api/queues/${queue.id}/sessions/${session.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: moment.weekday, startMinute: 100, endMinute: 200 });

    const afterEdit = await prisma.token.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(afterEdit.assignedSessionStartMinute).toBe(0);
    expect(afterEdit.assignedSessionEndMinute).toBe(1439);
  });
});

describe('capacity concurrency (spec 4F — security/business-critical)', () => {
  it('a session capacity of 1 lets exactly one of several simultaneous joins through', async () => {
    const { ctx, queue, service } = await orgWithQueue();
    const moment = nowUtcMoment();
    await addSession(ctx.accessToken, queue.id, {
      weekday: moment.weekday,
      startMinute: 0,
      endMinute: 1439,
      capacity: 1,
    });
    await enableSchedule(ctx.accessToken, queue.id);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => createTokenRequest({ queueId: queue.id, serviceId: service.id })),
    );

    const succeeded = attempts.filter((res) => res.status === 201);
    const rejected = attempts.filter((res) => res.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(rejected.every((res) => res.body.error.code === 'SCHEDULE_SESSION_FULL')).toBe(true);

    const stored = await prisma.token.count({ where: { queueId: queue.id } });
    expect(stored).toBe(1);
  });

  it('a daily capacity of 1 lets exactly one of several simultaneous joins through, even across two open sessions', async () => {
    const { ctx, queue, service } = await orgWithQueue();
    const moment = nowUtcMoment();
    await addSession(ctx.accessToken, queue.id, {
      weekday: moment.weekday,
      startMinute: 0,
      endMinute: 700,
      capacity: null,
    });
    await addSession(ctx.accessToken, queue.id, {
      weekday: moment.weekday,
      startMinute: 700,
      endMinute: 1439,
      capacity: null,
    });
    await enableSchedule(ctx.accessToken, queue.id, { scheduleDailyCapacity: 1 });

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => createTokenRequest({ queueId: queue.id, serviceId: service.id })),
    );

    expect(attempts.filter((res) => res.status === 201)).toHaveLength(1);
    expect(
      attempts
        .filter((res) => res.status === 409)
        .every((res) => res.body.error.code === 'SCHEDULE_DAILY_CAPACITY_REACHED'),
    ).toBe(true);
  });
});
