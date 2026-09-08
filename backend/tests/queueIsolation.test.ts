import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * Two queues in one organization are two separate lines (ADR-036).
 *
 * Every rule that decides who may be served next — arrival order, counter
 * capacity, the locked state the dashboard renders, the ETA — has to answer
 * for one queue without consulting another. A pharmacy running out of staff
 * must not freeze the registration desk.
 */

beforeEach(async () => {
  await resetDb();
});

/** An organization with two independent queues, each with its own counter. */
async function twoQueues() {
  const ctx = await registerOwner();
  const queueA = await createQueue(ctx.accessToken, { name: 'Pharmacy', tokenPrefix: 'A' });
  const queueB = await createQueue(ctx.accessToken, { name: 'Registration', tokenPrefix: 'B' });
  const serviceA = await createService(ctx.accessToken, queueA.id);
  const serviceB = await createService(ctx.accessToken, queueB.id);
  const counterA = await createCounter(ctx.accessToken, queueA.id, { name: 'A1' });
  const counterB = await createCounter(ctx.accessToken, queueB.id, { name: 'B1' });
  return { ctx, queueA, queueB, serviceA, serviceB, counterA, counterB };
}

function liveLine(accessToken: string, queueId?: string) {
  const request = api().get('/api/dashboard/tokens').set('Authorization', `Bearer ${accessToken}`);
  return queueId ? request.query({ queueId }) : request;
}

interface LiveRow {
  serialNumber: string;
  queue: { id: string; name: string };
  actionEligibility: { eligible: boolean; reason: string | null } | null;
}

function rowFor(body: { data: LiveRow[] }, serial: string): LiveRow {
  const row = body.data.find((entry) => entry.serialNumber === serial);
  if (!row) throw new Error(`no row for ${serial} in the live line`);
  return row;
}

describe('a queue is its own customer line', () => {
  it('shows only the selected queue’s customers', async () => {
    const org = await twoQueues();
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id });

    const res = await liveLine(org.ctx.accessToken, org.queueA.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].serialNumber).toBe('A001');
    expect(res.body.data[0].queue.name).toBe('Pharmacy');
  });

  it('numbers each line from its own prefix and sequence', async () => {
    const org = await twoQueues();
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id });

    const a = await liveLine(org.ctx.accessToken, org.queueA.id);
    const b = await liveLine(org.ctx.accessToken, org.queueB.id);

    expect(a.body.data.map((row: { serialNumber: string }) => row.serialNumber)).toEqual([
      'A001',
      'A002',
    ]);
    // B's first customer is B001, not B003 — the lines do not share a counter.
    expect(b.body.data.map((row: { serialNumber: string }) => row.serialNumber)).toEqual(['B001']);
  });

  it('refuses a queue belonging to another organization', async () => {
    const org = await twoQueues();
    const other = await registerOwner();

    const res = await liveLine(other.accessToken, org.queueA.id);

    expect(res.status).toBe(404);
  });
});

describe('first-come-first-served runs per queue', () => {
  it('unlocks the first customer of each queue independently', async () => {
    const org = await twoQueues();
    await setCounterStatus(org.ctx.accessToken, org.counterA.id, 'ACTIVE');
    await setCounterStatus(org.ctx.accessToken, org.counterB.id, 'ACTIVE');
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id }); // A001
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id }); // A002
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id }); // B001
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id }); // B002

    const a = await liveLine(org.ctx.accessToken, org.queueA.id);
    const b = await liveLine(org.ctx.accessToken, org.queueB.id);

    expect(rowFor(a.body, 'A001').actionEligibility?.eligible).toBe(true);
    expect(rowFor(a.body, 'A002').actionEligibility?.eligible).toBe(false);
    // B001 is the first customer of its own line, so A001 waiting does not
    // hold it back — there is no organization-wide ordering.
    expect(rowFor(b.body, 'B001').actionEligibility?.eligible).toBe(true);
    expect(rowFor(b.body, 'B002').actionEligibility?.eligible).toBe(false);
  });

  it('locks A002 behind A001 only, never behind anything in B', async () => {
    const org = await twoQueues();
    await setCounterStatus(org.ctx.accessToken, org.counterA.id, 'ACTIVE');
    const first = await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id }); // A002
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id }); // B001, never called

    // Clearing A001 out of the way is enough to free A002; B001 is irrelevant.
    await api()
      .post(`/api/tokens/${first.id}/skip`)
      .set('Authorization', `Bearer ${org.ctx.accessToken}`)
      .expect(200);

    const a = await liveLine(org.ctx.accessToken, org.queueA.id);
    expect(rowFor(a.body, 'A002').actionEligibility?.eligible).toBe(true);
  });

  it('will not call a token onto a counter from another queue', async () => {
    const org = await twoQueues();
    await setCounterStatus(org.ctx.accessToken, org.counterB.id, 'ACTIVE');
    const tokenA = await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });

    const res = await api()
      .post(`/api/tokens/${tokenA.id}/call`)
      .set('Authorization', `Bearer ${org.ctx.accessToken}`)
      .send({ counterId: org.counterB.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_QUEUE_MISMATCH');
  });

  it('Next on an empty queue does not reach into the other one', async () => {
    const org = await twoQueues();
    await setCounterStatus(org.ctx.accessToken, org.counterA.id, 'ACTIVE');
    // Only queue B has anybody waiting.
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id });

    const res = await api()
      .post(`/api/queues/${org.queueA.id}/next`)
      .set('Authorization', `Bearer ${org.ctx.accessToken}`)
      .send({ counterId: org.counterA.id });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_ELIGIBLE_TOKENS');
    // B's customer is untouched.
    const b = await prisma.token.findFirstOrThrow({ where: { queueId: org.queueB.id } });
    expect(b.status).toBe('WAITING');
  });

  it('Next takes the earliest customer of its own queue', async () => {
    const org = await twoQueues();
    await setCounterStatus(org.ctx.accessToken, org.counterA.id, 'ACTIVE');
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id }); // earlier overall
    const firstA = await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });

    const res = await api()
      .post(`/api/queues/${org.queueA.id}/next`)
      .set('Authorization', `Bearer ${org.ctx.accessToken}`)
      .send({ counterId: org.counterA.id });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(firstA.id);
  });

  it('Skip eligibility is decided by the token’s own queue', async () => {
    const org = await twoQueues();
    // Only queue B has a counter, so queue A cannot serve — or skip — anyone.
    await setCounterStatus(org.ctx.accessToken, org.counterB.id, 'ACTIVE');
    const tokenA = await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });

    const res = await api()
      .post(`/api/tokens/${tokenA.id}/skip`)
      .set('Authorization', `Bearer ${org.ctx.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it('keeps arrival order within each queue when both are joined at once', async () => {
    const org = await twoQueues();

    const results = await Promise.all([
      createTokenRequest({ queueId: org.queueA.id, serviceId: org.serviceA.id }),
      createTokenRequest({ queueId: org.queueB.id, serviceId: org.serviceB.id }),
      createTokenRequest({ queueId: org.queueA.id, serviceId: org.serviceA.id }),
      createTokenRequest({ queueId: org.queueB.id, serviceId: org.serviceB.id }),
    ]);
    expect(results.every((res) => res.status === 201)).toBe(true);

    // Each queue numbered 1..n independently: no shared sequence, no gaps.
    for (const queueId of [org.queueA.id, org.queueB.id]) {
      const tokens = await prisma.token.findMany({
        where: { queueId },
        orderBy: { sequenceNumber: 'asc' },
      });
      expect(tokens.map((token) => token.sequenceNumber)).toEqual([1, 2]);
    }
  });
});

describe('counters belong to exactly one queue', () => {
  it('lists only the queue’s own counters', async () => {
    const org = await twoQueues();

    const res = await api()
      .get(`/api/queues/${org.queueA.id}/counters`)
      .set('Authorization', `Bearer ${org.ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((counter: { name: string }) => counter.name)).toEqual(['A1']);
  });

  it('binds a counter to the queue it was created in', async () => {
    const org = await twoQueues();

    const created = await createCounter(org.ctx.accessToken, org.queueB.id, { name: 'B2' });

    expect(created.queueId).toBe(org.queueB.id);
  });

  it('another queue’s active counter creates no capacity here', async () => {
    const org = await twoQueues();
    // Three active counters in B, none in A.
    await setCounterStatus(org.ctx.accessToken, org.counterB.id, 'ACTIVE');
    for (const name of ['B2', 'B3']) {
      const extra = await createCounter(org.ctx.accessToken, org.queueB.id, { name });
      await setCounterStatus(org.ctx.accessToken, extra.id, 'ACTIVE');
    }
    const tokenA = await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });

    const a = await liveLine(org.ctx.accessToken, org.queueA.id);
    expect(rowFor(a.body, 'A001').actionEligibility).toEqual({
      eligible: false,
      reason: 'NO_AVAILABLE_COUNTER',
    });
    // And no estimate is invented from B's capacity.
    const customerView = await api().get(`/api/tokens/${tokenA.id}`);
    expect(customerView.body.data.estimatedWaitMinutes).toBeNull();
    expect(customerView.body.data.etaUnavailableReason).toBe('NO_ACTIVE_COUNTER');
  });

  it('gives the queue with a counter a real estimate', async () => {
    const org = await twoQueues();
    await setCounterStatus(org.ctx.accessToken, org.counterB.id, 'ACTIVE');
    const tokenB = await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id });

    const res = await api().get(`/api/tokens/${tokenB.id}`);

    expect(res.body.data.estimatedWaitMinutes).not.toBeNull();
    expect(res.body.data.etaUnavailableReason).toBeNull();
  });

  it('opening a counter in one queue changes nothing in the other', async () => {
    const org = await twoQueues();
    await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });
    await createToken({ queueId: org.queueB.id, serviceId: org.serviceB.id });

    await setCounterStatus(org.ctx.accessToken, org.counterA.id, 'ACTIVE');

    const a = await liveLine(org.ctx.accessToken, org.queueA.id);
    const b = await liveLine(org.ctx.accessToken, org.queueB.id);
    expect(rowFor(a.body, 'A001').actionEligibility?.eligible).toBe(true);
    expect(rowFor(b.body, 'B001').actionEligibility?.eligible).toBe(false);
  });

  it('refuses to touch a counter in another organization', async () => {
    const org = await twoQueues();
    const other = await registerOwner();

    const res = await api()
      .patch(`/api/counters/${org.counterA.id}/status`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(404);
  });
});

describe('staff stay bound to the queue they were assigned in', () => {
  async function assign(accessToken: string, counterId: string, staffId: string | null) {
    return api()
      .patch(`/api/counters/${counterId}/assign`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ staffId });
  }

  function assignableStaff(accessToken: string, counterId: string) {
    return api()
      .get(`/api/counters/${counterId}/available-staff`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  it('a staff member on a counter in one queue is not offered in another', async () => {
    const org = await twoQueues();
    const kara = await createStaffWithRole(org.ctx.organizationId, 'STAFF');
    await assign(org.ctx.accessToken, org.counterA.id, kara.staffId);

    const offered = await assignableStaff(org.ctx.accessToken, org.counterB.id);

    expect(offered.status).toBe(200);
    expect(offered.body.data.map((s: { id: string }) => s.id)).not.toContain(kara.staffId);
  });

  it.each([
    ['idle and ACTIVE', 'ACTIVE'],
    ['ON_BREAK', 'ON_BREAK'],
    ['OFFLINE', 'OFFLINE'],
  ])('stays bound while their counter is %s', async (_label, status) => {
    const org = await twoQueues();
    const kara = await createStaffWithRole(org.ctx.organizationId, 'STAFF');
    await assign(org.ctx.accessToken, org.counterA.id, kara.staffId);
    await setCounterStatus(org.ctx.accessToken, org.counterA.id, status);

    // Availability is about assignment, not workload: an idle or closed
    // counter still has its person standing at it.
    const offered = await assignableStaff(org.ctx.accessToken, org.counterB.id);
    expect(offered.body.data.map((s: { id: string }) => s.id)).not.toContain(kara.staffId);

    const moved = await assign(org.ctx.accessToken, org.counterB.id, kara.staffId);
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('STAFF_ALREADY_ASSIGNED');
  });

  it('frees them only once an administrator unassigns them', async () => {
    const org = await twoQueues();
    const kara = await createStaffWithRole(org.ctx.organizationId, 'STAFF');
    await assign(org.ctx.accessToken, org.counterA.id, kara.staffId);

    const unassigned = await assign(org.ctx.accessToken, org.counterA.id, null);
    expect(unassigned.status).toBe(200);

    const offered = await assignableStaff(org.ctx.accessToken, org.counterB.id);
    expect(offered.body.data.map((s: { id: string }) => s.id)).toContain(kara.staffId);
    const moved = await assign(org.ctx.accessToken, org.counterB.id, kara.staffId);
    expect(moved.status).toBe(200);
    // The old counter was not silently emptied by the move — it was emptied
    // by the explicit unassign above, which is the whole point.
    const counterA = await prisma.counter.findUniqueOrThrow({ where: { id: org.counterA.id } });
    expect(counterA.staffId).toBeNull();
  });

  it('still offers the counter’s own current holder while editing it', async () => {
    const org = await twoQueues();
    const kara = await createStaffWithRole(org.ctx.organizationId, 'STAFF');
    await assign(org.ctx.accessToken, org.counterA.id, kara.staffId);

    const offered = await assignableStaff(org.ctx.accessToken, org.counterA.id);

    expect(offered.body.data.map((s: { id: string }) => s.id)).toContain(kara.staffId);
  });

  it('lets only one of two simultaneous assignments in different queues win', async () => {
    const org = await twoQueues();
    const kara = await createStaffWithRole(org.ctx.organizationId, 'STAFF');

    const results = await Promise.all([
      assign(org.ctx.accessToken, org.counterA.id, kara.staffId),
      assign(org.ctx.accessToken, org.counterB.id, kara.staffId),
    ]);

    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(1);
    const held = await prisma.counter.count({ where: { staffId: kara.staffId } });
    expect(held).toBe(1);
  });
});

describe('only owners and admins move staff between counters', () => {
  async function setup() {
    const org = await twoQueues();
    const kara = await createStaffWithRole(org.ctx.organizationId, 'STAFF');
    const admin = await createStaffWithRole(org.ctx.organizationId, 'ADMIN');
    const operator = await createStaffWithRole(org.ctx.organizationId, 'STAFF');
    return { ...org, kara, admin, operator };
  }

  const assign = (token: string, counterId: string, staffId: string | null) =>
    api()
      .patch(`/api/counters/${counterId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId });

  it('an owner may assign', async () => {
    const org = await setup();
    const res = await assign(org.ctx.accessToken, org.counterA.id, org.kara.staffId);
    expect(res.status).toBe(200);
  });

  it('an admin may assign', async () => {
    const org = await setup();
    const res = await assign(org.admin.accessToken, org.counterA.id, org.kara.staffId);
    expect(res.status).toBe(200);
  });

  it('a staff member may not assign, unassign, or move anyone', async () => {
    const org = await setup();
    await assign(org.ctx.accessToken, org.counterA.id, org.kara.staffId);

    const assigning = await assign(org.operator.accessToken, org.counterB.id, org.operator.staffId);
    const unassigning = await assign(org.operator.accessToken, org.counterA.id, null);
    const moving = await assign(org.operator.accessToken, org.counterB.id, org.kara.staffId);

    for (const res of [assigning, unassigning, moving]) {
      expect(res.status).toBe(403);
    }
    // Nothing moved.
    const counterA = await prisma.counter.findUniqueOrThrow({ where: { id: org.counterA.id } });
    expect(counterA.staffId).toBe(org.kara.staffId);
  });

  it('a staff member may not even read who is available', async () => {
    const org = await setup();

    const res = await api()
      .get(`/api/counters/${org.counterA.id}/available-staff`)
      .set('Authorization', `Bearer ${org.operator.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('leaves a staff member’s operational actions untouched', async () => {
    const org = await setup();
    await setCounterStatus(org.ctx.accessToken, org.counterA.id, 'ACTIVE');
    const token = await createToken({ queueId: org.queueA.id, serviceId: org.serviceA.id });

    // Still able to run the line: open a counter, call, and view it.
    const status = await api()
      .patch(`/api/counters/${org.counterA.id}/status`)
      .set('Authorization', `Bearer ${org.operator.accessToken}`)
      .send({ status: 'ACTIVE' });
    const called = await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${org.operator.accessToken}`)
      .send({ counterId: org.counterA.id });
    const line = await api()
      .get('/api/dashboard/tokens')
      .set('Authorization', `Bearer ${org.operator.accessToken}`)
      .query({ queueId: org.queueA.id });

    expect(status.status).toBe(200);
    expect(called.status).toBe(200);
    expect(line.status).toBe(200);
  });
});
