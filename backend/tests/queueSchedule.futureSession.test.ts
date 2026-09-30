import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createToken,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { resolveLocalMoment } from '../src/utils/customerIdentity';
import { assignSessionForNewToken } from '../src/services/queueSchedule.service';
import { resetSessionStartTickForTests, runSessionStartTick } from '../src/scheduler/sessionStartScheduler';

/**
 * ADR-048: future eligible session assignment, and the "scheduled token is
 * not callable before its session starts" rule it requires.
 *
 * Every HTTP test here runs its queue in an `Etc/GMT±N` zone chosen so the
 * queue's local clock reads 10:xx right now, whatever the real UTC time is.
 * That reproduces the spec's own example deterministically — a 09:00–12:00
 * morning session that is open, a 14:00–17:00 afternoon session that has not
 * started — with at least an hour of margin on every boundary, so no test
 * can straddle a session edge mid-run.
 */

beforeEach(async () => {
  await resetDb();
});

const MORNING = { startMinute: 9 * 60, endMinute: 12 * 60 };
const AFTERNOON = { startMinute: 14 * 60, endMinute: 17 * 60 };

/** A zone where the local hour is 10 right now. `Etc/GMT-3` means UTC+3. */
function zoneWhereItIsTenAm(now = new Date()): string {
  let offset = 10 - now.getUTCHours();
  if (offset < -12) offset += 24;
  if (offset > 14) offset -= 24;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

async function scheduledQueue(
  sessions: { startMinute: number; endMinute: number; capacity?: number | null }[],
  scheduleBody: Record<string, unknown> = {},
) {
  const timezone = zoneWhereItIsTenAm();
  const ctx = await registerOwner({ timezone });
  const queue = await createQueue(ctx.accessToken, { name: 'Clinic' });
  const service = await createService(ctx.accessToken, queue.id);
  const moment = resolveLocalMoment(new Date(), timezone);
  expect(Math.floor(moment.minuteOfDay / 60)).toBe(10);

  const created: { id: string }[] = [];
  for (const session of sessions) {
    const res = await api()
      .post(`/api/queues/${queue.id}/sessions`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: moment.weekday, capacity: null, ...session });
    expect(res.status).toBe(201);
    created.push(res.body.data);
  }
  const enabled = await api()
    .put(`/api/queues/${queue.id}`)
    .set('Authorization', `Bearer ${ctx.accessToken}`)
    .send({ scheduleEnabled: true, ...scheduleBody });
  expect(enabled.status).toBe(200);

  return { ctx, queue, service, timezone, moment, sessions: created };
}

async function activeCounter(accessToken: string, queueId: string) {
  const counter = await createCounter(accessToken, queueId);
  await setCounterStatus(accessToken, counter.id, 'ACTIVE');
  return counter;
}

function call(accessToken: string, tokenId: string, counterId: string) {
  return api().post(`/api/tokens/${tokenId}/call`).set('Authorization', `Bearer ${accessToken}`).send({ counterId });
}

function next(accessToken: string, queueId: string, counterId: string) {
  return api().post(`/api/queues/${queueId}/next`).set('Authorization', `Bearer ${accessToken}`).send({ counterId });
}

function skip(accessToken: string, tokenId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/skip`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ reasonCode: 'CUSTOMER_NOT_PRESENT' });
}

describe('future eligible session assignment (ADR-048)', () => {
  it('1. prefers the currently-open session when it has room', async () => {
    const { queue, service } = await scheduledQueue([
      { ...MORNING, capacity: 5 },
      { ...AFTERNOON, capacity: 5 },
    ]);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(MORNING);
    expect(new Date(res.body.data.assignedSession.startsAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(res.body.data.position).toBe(1);
    expect(res.body.data.etaUnavailableReason).not.toBe('SESSION_NOT_STARTED');
  });

  it('2. a full current session assigns the next future session today, not a rejection', async () => {
    const { queue, service } = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 5 },
    ]);
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(AFTERNOON);
    expect(new Date(res.body.data.assignedSession.startsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('3. scanning before the first session assigns the first eligible session', async () => {
    const early = { startMinute: 12 * 60, endMinute: 13 * 60 };
    const { queue, service } = await scheduledQueue([{ ...AFTERNOON }, { ...early }]);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(early);
  });

  it('4. an ended session is never assigned, even with room', async () => {
    const ended = { startMinute: 7 * 60, endMinute: 8 * 60 };
    const { queue, service } = await scheduledQueue([{ ...ended, capacity: 100 }, { ...AFTERNOON }]);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(AFTERNOON);
  });

  it('4b. only ended sessions left today → SCHEDULE_ENDED_TODAY', async () => {
    const { queue, service } = await scheduledQueue([{ startMinute: 7 * 60, endMinute: 8 * 60 }]);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_ENDED_TODAY');
    expect(await prisma.token.count({ where: { queueId: queue.id } })).toBe(0);
  });

  it('5. every remaining session full → a clear SCHEDULE_SESSION_FULL rejection, nothing created', async () => {
    const { queue, service } = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 1 },
    ]);
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_SESSION_FULL');
    expect(res.body.error.message).toMatch(/remaining session/i);
    expect(await prisma.token.count({ where: { queueId: queue.id } })).toBe(2);
  });

  it('5b. a weekday with no sessions → SCHEDULE_CLOSED_TODAY', async () => {
    const { ctx, queue, service, moment } = await scheduledQueue([]);
    // A session on a different weekday only.
    await api()
      .post(`/api/queues/${queue.id}/sessions`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: (moment.weekday + 1) % 7, ...AFTERNOON, capacity: null });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_CLOSED_TODAY');
  });

  it('6/7. a future assignment is fixed: editing or adding sessions later never reassigns or moves it', async () => {
    const { ctx, queue, service, moment, sessions } = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 5 },
    ]);
    await createToken({ queueId: queue.id, serviceId: service.id });
    const future = await createToken({ queueId: queue.id, serviceId: service.id });
    const before = await prisma.token.findUniqueOrThrow({ where: { id: future.id } });

    // Move the afternoon session, raise the morning capacity, add a new one.
    await api()
      .put(`/api/queues/${queue.id}/sessions/${sessions[1]!.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: moment.weekday, startMinute: 15 * 60, endMinute: 18 * 60, capacity: 5 });
    await api()
      .put(`/api/queues/${queue.id}/sessions/${sessions[0]!.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: moment.weekday, ...MORNING, capacity: 10 });

    const after = await prisma.token.findUniqueOrThrow({ where: { id: future.id } });
    expect(after.queueSessionId).toBe(before.queueSessionId);
    expect(after.assignedSessionStartMinute).toBe(AFTERNOON.startMinute);
    expect(after.assignedSessionEndMinute).toBe(AFTERNOON.endMinute);
    expect(after.assignedSessionStartsAt?.getTime()).toBe(before.assignedSessionStartsAt?.getTime());

    const view = await api().get(`/api/tokens/${future.id}`);
    expect(view.body.data.assignedSession).toMatchObject(AFTERNOON);
  });

  it('8. a future session capacity is enforced', async () => {
    const { queue, service } = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 2 },
    ]);
    await createToken({ queueId: queue.id, serviceId: service.id });
    const a = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    const b = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    const c = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('SCHEDULE_SESSION_FULL');
  });

  it('9. concurrent joins racing for the final future slot: exactly one wins', async () => {
    const { queue, service, sessions } = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 1 },
    ]);
    await createToken({ queueId: queue.id, serviceId: service.id });

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => createTokenRequest({ queueId: queue.id, serviceId: service.id })),
    );

    const succeeded = attempts.filter((res) => res.status === 201);
    const rejected = attempts.filter((res) => res.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]!.body.data.assignedSession).toMatchObject(AFTERNOON);
    expect(rejected).toHaveLength(5);
    expect(rejected.every((res) => res.body.error.code === 'SCHEDULE_SESSION_FULL')).toBe(true);
    expect(await prisma.token.count({ where: { queueSessionId: sessions[1]!.id } })).toBe(1);
  });

  it('10. daily capacity still applies across the current and future sessions', async () => {
    const { queue, service } = await scheduledQueue(
      [
        { ...MORNING, capacity: 1 },
        { ...AFTERNOON, capacity: 10 },
      ],
      { scheduleDailyCapacity: 2 },
    );
    const first = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    const second = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    const third = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(first.body.data.assignedSession).toMatchObject(MORNING);
    expect(second.body.data.assignedSession).toMatchObject(AFTERNOON);
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('SCHEDULE_DAILY_CAPACITY_REACHED');
  });

  it('10b. concurrent joins against a daily cap spanning a future session never overbook', async () => {
    const { queue, service } = await scheduledQueue([{ ...MORNING, capacity: 1 }, { ...AFTERNOON }], {
      scheduleDailyCapacity: 3,
    });

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => createTokenRequest({ queueId: queue.id, serviceId: service.id })),
    );

    expect(attempts.filter((res) => res.status === 201)).toHaveLength(3);
    expect(await prisma.token.count({ where: { queueId: queue.id } })).toBe(3);
  });
});

describe('timezone correctness of the assigned start instant (ADR-048)', () => {
  it('11. the start instant is resolved on the queue clock, across a DST change', async () => {
    const ctx = await registerOwner({ timezone: 'America/New_York' });
    const queue = await createQueue(ctx.accessToken, { name: 'NY' });
    // 2026-03-07 is a Saturday (EST, UTC-5); 2026-03-08 a Sunday (EDT, UTC-4).
    await prisma.queueSession.createMany({
      data: [
        { queueId: queue.id, weekday: 6, startMinute: 14 * 60, endMinute: 17 * 60 },
        { queueId: queue.id, weekday: 0, startMinute: 14 * 60, endMinute: 17 * 60 },
      ],
    });

    const saturday = resolveLocalMoment(new Date('2026-03-07T15:00:00Z'), 'America/New_York'); // 10:00 EST
    const sunday = resolveLocalMoment(new Date('2026-03-08T14:00:00Z'), 'America/New_York'); // 10:00 EDT
    expect(saturday.minuteOfDay).toBe(600);
    expect(sunday.minuteOfDay).toBe(600);

    const sat = await prisma.$transaction((tx) =>
      assignSessionForNewToken(tx, { queueId: queue.id, dailyCapacity: null, moment: saturday, timezone: 'America/New_York' }),
    );
    const sun = await prisma.$transaction((tx) =>
      assignSessionForNewToken(tx, { queueId: queue.id, dailyCapacity: null, moment: sunday, timezone: 'America/New_York' }),
    );

    expect(sat.assignedSessionStartsAt.toISOString()).toBe('2026-03-07T19:00:00.000Z');
    expect(sun.assignedSessionStartsAt.toISOString()).toBe('2026-03-08T18:00:00.000Z');
  });

  it('11b. the queue zone, not UTC, decides which sessions have ended', async () => {
    // Local 10:xx in the queue zone; the real UTC hour is almost always
    // different, so a UTC-evaluated schedule would pick the wrong session.
    const { queue, service } = await scheduledQueue([{ ...MORNING }, { ...AFTERNOON }]);
    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res.body.data.assignedSession).toMatchObject(MORNING);
  });
});

describe('a scheduled token is not callable before its session starts (ADR-048)', () => {
  async function morningFullWithFutureToken() {
    const setup = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 5 },
    ]);
    const counter = await activeCounter(setup.ctx.accessToken, setup.queue.id);
    const morning = await createToken({ queueId: setup.queue.id, serviceId: setup.service.id });
    const future = await createToken({ queueId: setup.queue.id, serviceId: setup.service.id });
    return { ...setup, counter, morning, future };
  }

  it('shows no position and no ETA — never a false pre-session estimate', async () => {
    const { future } = await morningFullWithFutureToken();

    const view = await api().get(`/api/tokens/${future.id}`);

    expect(view.body.data.status).toBe('WAITING');
    expect(view.body.data.position).toBeNull();
    expect(view.body.data.estimatedWaitMinutes).toBeNull();
    expect(view.body.data.estimatedReadyAt).toBeNull();
    expect(view.body.data.etaUnavailableReason).toBe('SESSION_NOT_STARTED');
  });

  it('cannot be called, skipped, or picked by Next before its session starts', async () => {
    const { ctx, queue, counter, morning, future } = await morningFullWithFutureToken();

    const directCall = await call(ctx.accessToken, future.id, counter.id);
    expect(directCall.status).toBe(409);
    expect(directCall.body.error.code).toBe('SESSION_NOT_STARTED');

    const skipped = await skip(ctx.accessToken, future.id);
    expect(skipped.status).toBe(409);
    expect(skipped.body.error.code).toBe('SESSION_NOT_STARTED');

    // Next takes the morning customer, then finds nobody callable.
    const first = await next(ctx.accessToken, queue.id, counter.id);
    expect(first.status).toBe(200);
    expect(first.body.data.id).toBe(morning.id);
    await api().post(`/api/tokens/${morning.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`).send({ reasonCode: 'CUSTOMER_NOT_PRESENT' });
    const second = await next(ctx.accessToken, queue.id, counter.id);
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe('NO_ELIGIBLE_TOKENS');

    expect((await prisma.token.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('WAITING');
  });

  it('does not block FCFS for callable customers behind it', async () => {
    const { ctx, queue, service, counter, morning, future, moment } = await morningFullWithFutureToken();
    // A new overlapping session opens now, so a later joiner is callable
    // today while the earlier-numbered future token is still scheduled.
    await api()
      .post(`/api/queues/${queue.id}/sessions`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: moment.weekday, startMinute: 10 * 60, endMinute: 12 * 60, capacity: null });
    const later = await createToken({ queueId: queue.id, serviceId: service.id });

    await call(ctx.accessToken, morning.id, counter.id);
    await api().post(`/api/tokens/${morning.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`).send({ reasonCode: 'CUSTOMER_NOT_PRESENT' });

    const laterView = await api().get(`/api/tokens/${later.id}`);
    expect(laterView.body.data.position).toBe(1);

    const allowed = await call(ctx.accessToken, later.id, counter.id);
    expect(allowed.status).toBe(200);
    expect((await prisma.token.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('WAITING');
  });

  it('joins the line, in sequence order, once its session start has passed', async () => {
    const { ctx, counter, morning, future } = await morningFullWithFutureToken();
    // Simulate the clock reaching 14:00 for this token.
    await prisma.token.update({
      where: { id: future.id },
      data: { assignedSessionStartsAt: new Date(Date.now() - 1000) },
    });

    const view = await api().get(`/api/tokens/${future.id}`);
    expect(view.body.data.position).toBe(2);
    expect(view.body.data.etaUnavailableReason).toBeNull();
    expect(view.body.data.estimatedReadyAt).not.toBeNull();

    // Still strictly FCFS: the morning customer goes first.
    const blocked = await call(ctx.accessToken, future.id, counter.id);
    expect(blocked.body.error.code).toBe('FCFS_VIOLATION');
    await call(ctx.accessToken, morning.id, counter.id);
    await api().post(`/api/tokens/${morning.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`).send({ reasonCode: 'CUSTOMER_NOT_PRESENT' });
    const allowed = await call(ctx.accessToken, future.id, counter.id);
    expect(allowed.status).toBe(200);
  });

  it('the dashboard live table marks the row as awaiting its session and shows the window', async () => {
    const { ctx, queue, future } = await morningFullWithFutureToken();

    const res = await api()
      .get('/api/dashboard/tokens')
      .query({ queueId: queue.id })
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    const row = res.body.data.find((r: { id: string }) => r.id === future.id);
    expect(row.actionEligibility).toEqual({ eligible: false, reason: 'SESSION_NOT_STARTED' });
    expect(row.assignedSession).toMatchObject(AFTERNOON);
    expect(row.position).toBeNull();
    expect(row).not.toHaveProperty('queueSessionId');
  });
});

describe('public pre-join schedule preview (ADR-048)', () => {
  it('before the first session: accepting joins, not open now, and says when the next session starts', async () => {
    const { queue } = await scheduledQueue([{ startMinute: 12 * 60, endMinute: 13 * 60 }, { ...AFTERNOON }]);

    const res = await api().get(`/api/public/queues/${queue.id}/config`);

    expect(res.body.data.schedule).toMatchObject({
      scheduleEnabled: true,
      isOpenNow: false,
      acceptingJoins: true,
      unavailableCode: null,
      nextSessionStartMinute: 12 * 60,
    });
    expect(res.body.data.schedule.message).toMatch(/12:00/);
  });

  it('after every session ended: not accepting joins, with the specific reason', async () => {
    const { queue } = await scheduledQueue([{ startMinute: 7 * 60, endMinute: 8 * 60 }]);

    const res = await api().get(`/api/public/queues/${queue.id}/config`);

    expect(res.body.data.schedule).toMatchObject({
      acceptingJoins: false,
      unavailableCode: 'SCHEDULE_ENDED_TODAY',
    });
  });

  it('an unscheduled queue is always accepting joins', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const res = await api().get(`/api/public/queues/${queue.id}/config`);
    expect(res.body.data.schedule).toMatchObject({ scheduleEnabled: false, acceptingJoins: true, isOpenNow: true });
  });
});

describe('session-start broadcast tick (ADR-048)', () => {
  it('reports exactly the queues whose scheduled tokens became callable since the last tick', async () => {
    resetSessionStartTickForTests();
    const { queue, service } = await scheduledQueue([
      { ...MORNING, capacity: 1 },
      { ...AFTERNOON, capacity: 5 },
    ]);
    await createToken({ queueId: queue.id, serviceId: service.id });
    const future = await createToken({ queueId: queue.id, serviceId: service.id });
    const startsAt = (await prisma.token.findUniqueOrThrow({ where: { id: future.id } })).assignedSessionStartsAt!;

    // A tick well before 14:00 finds nothing; the first tick at/after it does;
    // the tick after that does not report it again.
    expect(await runSessionStartTick(new Date(startsAt.getTime() - 120_000))).toEqual([]);
    expect(await runSessionStartTick(new Date(startsAt.getTime() + 30_000))).toEqual([queue.id]);
    expect(await runSessionStartTick(new Date(startsAt.getTime() + 90_000))).toEqual([]);
  });
});
