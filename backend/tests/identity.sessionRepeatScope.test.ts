import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  registerOwner,
  setCounterStatus,
  setFormFields,
  startToken,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { setEmailAvailableForTesting } from '../src/services/email.service';
import { issueEmailVerificationProof, resolveLocalMoment } from '../src/utils/customerIdentity';

/**
 * ADR-049: repeat-visit entitlement scoped to the whole queue (the default,
 * unchanged) or to one session *occurrence* (weekly session + local date).
 *
 * Each queue runs in an `Etc/GMT±N` zone chosen so its local clock reads
 * 10:xx now — the morning session (09:00–12:00) is open and the afternoon
 * one (14:00–17:00) is later today — see queueSchedule.futureSession.test.ts.
 */

beforeEach(async () => {
  await resetDb();
  setEmailAvailableForTesting(true);
});

afterEach(() => {
  setEmailAvailableForTesting(null);
});

const MORNING = { startMinute: 9 * 60, endMinute: 12 * 60 };
const AFTERNOON = { startMinute: 14 * 60, endMinute: 17 * 60 };
const NID_FIELD = { key: 'nid', label: 'NID Number', type: 'text', required: true } as const;

type Mode = 'CUSTOM_FIELD' | 'VERIFIED_EMAIL' | 'VERIFIED_EMAIL_AND_CUSTOM_FIELD';

function zoneWhereItIsTenAm(now = new Date()): string {
  let offset = 10 - now.getUTCHours();
  if (offset < -12) offset += 24;
  if (offset > 14) offset -= 24;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

async function restrictedQueue(options: {
  scope?: 'QUEUE' | 'SESSION';
  mode?: Mode;
  sessions?: { startMinute: number; endMinute: number; capacity?: number | null }[];
}) {
  const mode = options.mode ?? 'CUSTOM_FIELD';
  const timezone = zoneWhereItIsTenAm();
  const ctx = await registerOwner({ timezone });
  const queue = await createQueue(ctx.accessToken, { name: 'Relief' });
  const service = await createService(ctx.accessToken, queue.id);
  if (mode !== 'VERIFIED_EMAIL') {
    await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);
  }
  const moment = resolveLocalMoment(new Date(), timezone);
  const sessionRows: { id: string }[] = [];
  for (const session of options.sessions ?? [MORNING, AFTERNOON]) {
    const res = await api()
      .post(`/api/queues/${queue.id}/sessions`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ weekday: moment.weekday, capacity: null, ...session });
    expect(res.status).toBe(201);
    sessionRows.push(res.body.data);
  }
  const policy = await api()
    .put(`/api/queues/${queue.id}`)
    .set('Authorization', `Bearer ${ctx.accessToken}`)
    .send({
      scheduleEnabled: true,
      allowRepeatVisits: false,
      repeatRestrictionType: 'ONCE_EVER',
      repeatIdentityMode: mode,
      ...(mode === 'VERIFIED_EMAIL' ? {} : { repeatIdentityFieldKey: 'nid' }),
      ...(options.scope ? { repeatRestrictionScope: options.scope } : {}),
    });
  expect(policy.status).toBe(200);
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
  return { ctx, queue, service, counter, mode, moment, sessions: sessionRows };
}

type Setup = Awaited<ReturnType<typeof restrictedQueue>>;

/** Identity material for one person, in whatever form the queue asks for. */
function person(setup: Setup, who: string) {
  const body: Record<string, unknown> = { formData: {} };
  if (setup.mode !== 'VERIFIED_EMAIL') {
    body.formData = { nid: `NID-${who}` };
  }
  if (setup.mode !== 'CUSTOM_FIELD') {
    body.emailVerificationProof = issueEmailVerificationProof(setup.queue.id, `email-fp-${who}`, 10 * 60_000);
  }
  return body;
}

function join(setup: Setup, who: string, device = `device-${Math.random().toString(36).slice(2)}`) {
  return api()
    .post('/api/tokens')
    .set('Idempotency-Key', `key-${Math.random().toString(36).slice(2)}`)
    .send({ queueId: setup.queue.id, serviceId: setup.service.id, deviceIdentifier: device, ...person(setup, who) })
    .then((res) => ({ res, device }));
}

async function serve(setup: Setup, tokenId: string, device: string) {
  const called = await api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${setup.ctx.accessToken}`)
    .send({ counterId: setup.counter.id });
  expect(called.status).toBe(200);
  const started = await startToken(setup.ctx.accessToken, tokenId, device);
  expect(started.status).toBe(200);
  const completed = await api()
    .post(`/api/tokens/${tokenId}/complete`)
    .set('Authorization', `Bearer ${setup.ctx.accessToken}`);
  expect(completed.status).toBe(200);
}

/** Joins and completes one visit, returning the served token's id. */
async function completedVisit(setup: Setup, who: string) {
  const { res, device } = await join(setup, who);
  expect(res.status).toBe(201);
  await serve(setup, res.body.data.id, device);
  return res.body.data.id as string;
}

describe('configuration (ADR-049)', () => {
  it('a new restricted queue defaults to the queue-wide scope, and persists an explicit choice', async () => {
    const queueWide = await restrictedQueue({});
    const perSession = await restrictedQueue({ scope: 'SESSION' });

    expect((await prisma.queue.findUniqueOrThrow({ where: { id: queueWide.queue.id } })).repeatRestrictionScope).toBe('QUEUE');
    const stored = await api()
      .get(`/api/queues/${perSession.queue.id}`)
      .set('Authorization', `Bearer ${perSession.ctx.accessToken}`);
    expect(stored.body.data.repeatRestrictionScope).toBe('SESSION');
  });

  it('refuses a per-session scope on a queue whose schedule is off', async () => {
    const ctx = await registerOwner({ timezone: 'UTC' });
    const queue = await createQueue(ctx.accessToken);
    await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        allowRepeatVisits: false,
        repeatRestrictionType: 'ONCE_EVER',
        repeatIdentityMode: 'CUSTOM_FIELD',
        repeatIdentityFieldKey: 'nid',
        repeatRestrictionScope: 'SESSION',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REPEAT_SCOPE_REQUIRES_SCHEDULE');
  });

  it('refuses turning the schedule off while the per-session scope is on, and allows it after switching back', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION' });

    const refused = await api()
      .put(`/api/queues/${setup.queue.id}`)
      .set('Authorization', `Bearer ${setup.ctx.accessToken}`)
      .send({ scheduleEnabled: false });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('REPEAT_SCOPE_REQUIRES_SCHEDULE');
    expect((await prisma.queue.findUniqueOrThrow({ where: { id: setup.queue.id } })).scheduleEnabled).toBe(true);

    const allowed = await api()
      .put(`/api/queues/${setup.queue.id}`)
      .set('Authorization', `Bearer ${setup.ctx.accessToken}`)
      .send({ scheduleEnabled: false, repeatRestrictionScope: 'QUEUE' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.repeatRestrictionScope).toBe('QUEUE');
  });

  it('allowing repeat visits resets the scope to the queue-wide default', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION' });

    const res = await api()
      .put(`/api/queues/${setup.queue.id}`)
      .set('Authorization', `Bearer ${setup.ctx.accessToken}`)
      .send({ allowRepeatVisits: true });

    expect(res.status).toBe(200);
    expect(res.body.data.repeatRestrictionScope).toBe('QUEUE');
  });

  it('the public config tells the app which scope applies', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION' });
    const res = await api().get(`/api/public/queues/${setup.queue.id}/config`);
    expect(res.body.data.identity.restrictionScope).toBe('SESSION');
  });

  it('another organization cannot change this queue’s scope (22)', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION' });
    const other = await registerOwner();

    const res = await api()
      .put(`/api/queues/${setup.queue.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ repeatRestrictionScope: 'QUEUE' });

    expect(res.status).toBe(404);
    expect((await prisma.queue.findUniqueOrThrow({ where: { id: setup.queue.id } })).repeatRestrictionScope).toBe('SESSION');
  });
});

describe('queue scope is unchanged (12)', () => {
  it('a completed morning visit blocks the afternoon too', async () => {
    const setup = await restrictedQueue({});
    await completedVisit(setup, 'alice');

    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
    expect(res.body.error.details).toMatchObject({ reason: 'ALREADY_USED', scope: 'QUEUE' });
    const claims = await prisma.queueIdentityClaim.findMany({ where: { queueId: setup.queue.id } });
    expect(claims.map((c) => c.entitlementScopeKey)).toEqual(['QUEUE']);
  });
});

const MODES: Mode[] = ['CUSTOM_FIELD', 'VERIFIED_EMAIL', 'VERIFIED_EMAIL_AND_CUSTOM_FIELD'];

describe.each(MODES)('session scope — identity mode %s (19/20/21)', (mode) => {
  it('13. morning completed → the same person is placed in the afternoon session', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION', mode });
    const morningToken = await completedVisit(setup, 'alice');
    const served = await prisma.token.findUniqueOrThrow({ where: { id: morningToken } });
    expect(served.assignedSessionStartMinute).toBe(MORNING.startMinute);

    // The morning session is still open and has room — they are steered past
    // it, not back into the session they already used.
    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(AFTERNOON);
  });

  it('14/17. a completed visit blocks a second visit in the same session occurrence', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION', mode, sessions: [MORNING] });
    await completedVisit(setup, 'alice');

    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
    expect(res.body.error.details).toMatchObject({ reason: 'ALREADY_USED', scope: 'SESSION' });
    expect(res.body.error.message).toMatch(/this session/i);
    // Another person is unaffected.
    expect((await join(setup, 'bob')).res.status).toBe(201);
  });
});

describe('session scope — occurrence identity and lifecycle', () => {
  it('14b. only the spent session has room → the accurate repeat reason, not "full"', async () => {
    const setup = await restrictedQueue({
      scope: 'SESSION',
      sessions: [MORNING, { ...AFTERNOON, capacity: 1 }],
    });
    await completedVisit(setup, 'alice');
    // Bob is served in the morning too, then takes the afternoon's one slot.
    await completedVisit(setup, 'bob');
    const { res: bobAgain } = await join(setup, 'bob');
    expect(bobAgain.body.data.assignedSession).toMatchObject(AFTERNOON);

    // Alice: the afternoon is full and the morning — which has room — is
    // the session she already used.
    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
    expect(res.body.error.details).toMatchObject({ reason: 'ALREADY_USED', scope: 'SESSION' });
  });

  it('15. the same weekly session next week is a different occurrence, and allowed', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION', mode: 'CUSTOM_FIELD', sessions: [MORNING] });
    const tokenId = await completedVisit(setup, 'alice');
    const claim = await prisma.queueIdentityClaim.findUniqueOrThrow({ where: { tokenId } });
    const todayKey = setup.moment.dateKey.toISOString().slice(0, 10);
    expect(claim.entitlementScopeKey).toBe(`SESSION:${setup.sessions[0]!.id}:${todayKey}`);

    // Re-date that visit to the same session one week earlier.
    const lastWeek = new Date(setup.moment.dateKey.getTime() - 7 * 24 * 60 * 60 * 1000);
    await prisma.queueIdentityClaim.update({
      where: { id: claim.id },
      data: { entitlementScopeKey: `SESSION:${setup.sessions[0]!.id}:${lastWeek.toISOString().slice(0, 10)}` },
    });

    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(MORNING);
  });

  it('16. SKIPPED does not consume the session entitlement', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION', sessions: [MORNING] });
    const { res: first } = await join(setup, 'alice');
    const skipped = await api()
      .post(`/api/tokens/${first.body.data.id}/skip`)
      .set('Authorization', `Bearer ${setup.ctx.accessToken}`)
      .send({ reasonCode: 'CUSTOMER_NOT_PRESENT' });
    expect(skipped.status).toBe(200);

    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(201);
    expect(res.body.data.assignedSession).toMatchObject(MORNING);
  });

  it('18. active-duplicate prevention is unchanged: an active morning token blocks joining the afternoon', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION' });
    const { res: first, device } = await join(setup, 'alice');
    expect(first.status).toBe(201);

    const otherPhone = await join(setup, 'alice');
    expect(otherPhone.res.status).toBe(409);
    expect(otherPhone.res.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
    expect(otherPhone.res.body.error.details).toMatchObject({ reason: 'ALREADY_IN_QUEUE' });

    const samePhone = await join(setup, 'someone-else', device);
    expect(samePhone.res.status).toBe(409);
    expect(samePhone.res.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('a queue-wide visit recorded before switching to per-session still blocks (a claim keeps its scope)', async () => {
    const setup = await restrictedQueue({});
    await completedVisit(setup, 'alice');
    await api()
      .put(`/api/queues/${setup.queue.id}`)
      .set('Authorization', `Bearer ${setup.ctx.accessToken}`)
      .send({ repeatRestrictionScope: 'SESSION' });

    const { res } = await join(setup, 'alice');

    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ reason: 'ALREADY_USED', scope: 'QUEUE' });
  });

  it('never exposes the scope key or fingerprint on a token', async () => {
    const setup = await restrictedQueue({ scope: 'SESSION' });
    const { res } = await join(setup, 'alice');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('SESSION:');
    expect(body).not.toContain('identityScopeKey');
    expect(body).not.toContain('identityFingerprint');

    const staff = await api().get(`/api/tokens/${res.body.data.id}`).set('Authorization', `Bearer ${setup.ctx.accessToken}`);
    expect(JSON.stringify(staff.body)).not.toContain('identityScopeKey');
  });
});

describe('cross-organization isolation (22)', () => {
  it('the same identifier at another organization is an unrelated entitlement', async () => {
    const a = await restrictedQueue({ scope: 'SESSION', sessions: [MORNING] });
    const b = await restrictedQueue({ scope: 'SESSION', sessions: [MORNING] });
    await completedVisit(a, 'alice');

    expect((await join(a, 'alice')).res.status).toBe(409);
    expect((await join(b, 'alice')).res.status).toBe(201);
  });
});
