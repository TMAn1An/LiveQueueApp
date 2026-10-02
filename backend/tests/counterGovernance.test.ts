import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * ADR-064: counter assignment and serving governance.
 *
 *  - Who stands at which counter (Counter.staffId) is decided by OWNER and
 *    ADMIN only.
 *  - Everyone claims people only at their own counter, and only the next
 *    eligible person (strict FCFS). No path lets anyone hand a person to a
 *    particular staff member.
 *  - Client-sent counter or staff ids never choose anything.
 */

beforeEach(async () => {
  await resetDb();
});

const bearer = (token: string) => `Bearer ${token}`;

function assign(accessToken: string, counterId: string, staffId: string | null) {
  return api().patch(`/api/counters/${counterId}/assign`).set('Authorization', bearer(accessToken)).send({ staffId });
}

function mine(accessToken: string) {
  return api().get('/api/counters/mine').set('Authorization', bearer(accessToken));
}

function next(accessToken: string, queueId: string, body: Record<string, unknown> = {}) {
  return api().post(`/api/queues/${queueId}/next`).set('Authorization', bearer(accessToken)).send(body);
}

function call(accessToken: string, tokenId: string, body: Record<string, unknown> = {}) {
  return api().post(`/api/tokens/${tokenId}/call`).set('Authorization', bearer(accessToken)).send(body);
}

async function status(tokenId: string) {
  return (await prisma.token.findUniqueOrThrow({ where: { id: tokenId } })).status;
}

/** An organization with one queue, two unassigned counters (both ACTIVE), an
 * admin and two staff members. */
async function setup() {
  const owner = await registerOwner();
  const queue = await createQueue(owner.accessToken, { requireServiceStartOtp: false });
  const service = await createService(owner.accessToken, queue.id);
  const counterA = await createCounter(owner.accessToken, queue.id, { name: 'Counter A', assignToCreator: false });
  const counterB = await createCounter(owner.accessToken, queue.id, { name: 'Counter B', assignToCreator: false });
  await setCounterStatus(owner.accessToken, counterA.id, 'ACTIVE');
  await setCounterStatus(owner.accessToken, counterB.id, 'ACTIVE');
  const admin = await createStaffWithRole(owner.organizationId, 'ADMIN');
  const staffS = await createStaffWithRole(owner.organizationId, 'STAFF');
  const staffT = await createStaffWithRole(owner.organizationId, 'STAFF');
  const join = () => createToken({ queueId: queue.id, serviceId: service.id });
  return { owner, queue, service, counterA, counterB, admin, staffS, staffT, join };
}

describe('ADR-064 — owner and admin manage counter assignments', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    it(`${role} assigns a staff member to a counter`, async () => {
      const org = await setup();
      const manager = role === 'OWNER' ? org.owner : org.admin;

      const res = await assign(manager.accessToken, org.counterA.id, org.staffS.staffId);
      expect(res.status).toBe(200);
      expect(res.body.data.staffId).toBe(org.staffS.staffId);

      const own = await mine(org.staffS.accessToken);
      expect(own.status).toBe(200);
      expect(own.body.data).toMatchObject({ id: org.counterA.id, name: 'Counter A', queueId: org.queue.id });
    });

    it(`${role} changes a staff member's counter`, async () => {
      const org = await setup();
      const manager = role === 'OWNER' ? org.owner : org.admin;
      await assign(manager.accessToken, org.counterA.id, org.staffS.staffId);

      // A person holds one counter, so a move is release-then-assign.
      const blocked = await assign(manager.accessToken, org.counterB.id, org.staffS.staffId);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('STAFF_ALREADY_ASSIGNED');

      expect((await assign(manager.accessToken, org.counterA.id, null)).status).toBe(200);
      expect((await assign(manager.accessToken, org.counterB.id, org.staffS.staffId)).status).toBe(200);
      expect((await mine(org.staffS.accessToken)).body.data.id).toBe(org.counterB.id);
    });

    it(`${role} unassigns a staff member`, async () => {
      const org = await setup();
      const manager = role === 'OWNER' ? org.owner : org.admin;
      await assign(manager.accessToken, org.counterA.id, org.staffS.staffId);

      const res = await assign(manager.accessToken, org.counterA.id, null);
      expect(res.status).toBe(200);
      expect(res.body.data.staffId).toBeNull();
      expect((await mine(org.staffS.accessToken)).body.data).toBeNull();
    });
  }
});

describe('ADR-064 — STAFF cannot change counter assignments', () => {
  it('cannot assign themselves to a counter', async () => {
    const org = await setup();
    const res = await assign(org.staffS.accessToken, org.counterA.id, org.staffS.staffId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COUNTER_ASSIGNMENT_FORBIDDEN');
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: org.counterA.id } })).staffId).toBeNull();
  });

  it('cannot switch their own counter', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);

    const move = await assign(org.staffS.accessToken, org.counterB.id, org.staffS.staffId);
    expect(move.status).toBe(403);
    expect(move.body.error.code).toBe('COUNTER_ASSIGNMENT_FORBIDDEN');
    expect((await mine(org.staffS.accessToken)).body.data.id).toBe(org.counterA.id);
  });

  it('cannot unassign themselves', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);

    const res = await assign(org.staffS.accessToken, org.counterA.id, null);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COUNTER_ASSIGNMENT_FORBIDDEN');
    expect((await mine(org.staffS.accessToken)).body.data.id).toBe(org.counterA.id);
  });

  it('cannot assign another staff member', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);

    const res = await assign(org.staffS.accessToken, org.counterB.id, org.staffT.staffId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COUNTER_ASSIGNMENT_FORBIDDEN');
    expect((await mine(org.staffT.accessToken)).body.data).toBeNull();
  });

  it('cannot list who is assignable, nor delete a counter (which would end an assignment)', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffT.staffId);

    const list = await api()
      .get(`/api/counters/${org.counterA.id}/available-staff`)
      .set('Authorization', bearer(org.staffS.accessToken));
    expect(list.status).toBe(403);

    const del = await api().delete(`/api/counters/${org.counterA.id}`).set('Authorization', bearer(org.staffS.accessToken));
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('COUNTER_MANAGEMENT_FORBIDDEN');
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: org.counterA.id } })).staffId).toBe(org.staffT.staffId);
  });

  it('cannot create, rename, open/close or delete any counter — not even their own', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const t = bearer(org.staffS.accessToken);

    const attempts = [
      await api().post(`/api/queues/${org.queue.id}/counters`).set('Authorization', t).send({ name: 'Mine' }),
      await api().put(`/api/counters/${org.counterA.id}`).set('Authorization', t).send({ name: 'Renamed' }),
      await api().put(`/api/counters/${org.counterB.id}`).set('Authorization', t).send({ name: 'Renamed' }),
      await api().patch(`/api/counters/${org.counterA.id}/status`).set('Authorization', t).send({ status: 'ON_BREAK' }),
      await api().patch(`/api/counters/${org.counterB.id}/status`).set('Authorization', t).send({ status: 'OFFLINE' }),
      await api().delete(`/api/counters/${org.counterA.id}`).set('Authorization', t),
      await api().delete(`/api/counters/${org.counterB.id}`).set('Authorization', t),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('COUNTER_MANAGEMENT_FORBIDDEN');
    }
    const counters = await prisma.counter.findMany({ where: { queueId: org.queue.id }, orderBy: { name: 'asc' } });
    expect(counters.map((c) => [c.name, c.status])).toEqual([
      ['Counter A', 'ACTIVE'],
      ['Counter B', 'ACTIVE'],
    ]);
  });

  it('can still see their counter and Serve next from it', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const p1 = await org.join();

    const list = await api().get(`/api/queues/${org.queue.id}/counters`).set('Authorization', bearer(org.staffS.accessToken));
    expect(list.status).toBe(200);
    expect((await mine(org.staffS.accessToken)).body.data.id).toBe(org.counterA.id);
    const res = await next(org.staffS.accessToken, org.queue.id);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(p1.id);
  });

  it('has operate_tokens and nothing that manages counters or staff', async () => {
    const org = await setup();
    const me = await api().get('/api/auth/me').set('Authorization', bearer(org.staffS.accessToken));
    expect(me.body.data.permissions).toContain('operate_tokens');
    expect(me.body.data.permissions).not.toContain('manage_counters');
    expect(me.body.data.permissions).not.toContain('manage_staff');
  });
});

describe('ADR-064 — owner and admin manage counters', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    it(`${role} creates, renames, opens/closes and deletes counters`, async () => {
      const org = await setup();
      const t = bearer((role === 'OWNER' ? org.owner : org.admin).accessToken);

      const created = await api().post(`/api/queues/${org.queue.id}/counters`).set('Authorization', t).send({ name: 'Window C' });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      expect((await api().put(`/api/counters/${id}`).set('Authorization', t).send({ name: 'Window D' })).status).toBe(200);
      expect((await api().patch(`/api/counters/${id}/status`).set('Authorization', t).send({ status: 'ACTIVE' })).status).toBe(200);
      expect((await api().patch(`/api/counters/${id}/status`).set('Authorization', t).send({ status: 'OFFLINE' })).status).toBe(200);
      expect((await api().delete(`/api/counters/${id}`).set('Authorization', t)).status).toBe(204);
    });
  }
});

describe('ADR-064 — serving is a self-claim at your own counter', () => {
  it('an assigned staff member claims the next eligible person, bound to their own counter', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const p1 = await org.join();

    const res = await next(org.staffS.accessToken, org.queue.id);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(p1.id);
    expect(res.body.data.counterId).toBe(org.counterA.id);

    // The audit trail records the claim as the caller's own.
    await expect
      .poll(async () => (await prisma.auditLog.findFirst({ where: { action: 'token_called', entityId: p1.id } }))?.staffId)
      .toBe(org.staffS.staffId);
  });

  it('ignores a staffId in the request and refuses a spoofed counterId', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await assign(org.owner.accessToken, org.counterB.id, org.staffT.staffId);
    const p1 = await org.join();

    const spoofed = await next(org.staffS.accessToken, org.queue.id, { counterId: org.counterB.id });
    expect(spoofed.status).toBe(403);
    expect(spoofed.body.error.code).toBe('COUNTER_ACCESS_DENIED');
    const spoofedCall = await call(org.staffS.accessToken, p1.id, { counterId: org.counterB.id });
    expect(spoofedCall.status).toBe(403);
    expect(await status(p1.id)).toBe('WAITING');

    // "Make T serve this person": the staffId is not part of the contract,
    // so the claim still lands on the caller's own counter.
    const res = await call(org.staffS.accessToken, p1.id, { staffId: org.staffT.staffId });
    expect(res.status).toBe(200);
    expect(res.body.data.counterId).toBe(org.counterA.id);
  });

  it('an owner cannot dispatch a person to a staff member’s counter', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const p1 = await org.join();

    const dispatched = await call(org.owner.accessToken, p1.id, { counterId: org.counterA.id, staffId: org.staffS.staffId });
    expect(dispatched.status).toBe(403);
    expect(dispatched.body.error.code).toBe('SERVING_STAFF_ONLY');
    expect(await status(p1.id)).toBe('WAITING');
  });

  it('cannot pick a later person — only the next eligible one', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const p1 = await org.join();
    const p2 = await org.join();

    const skipAhead = await call(org.staffS.accessToken, p2.id);
    expect(skipAhead.status).toBe(409);
    expect(skipAhead.body.error.code).toBe('FCFS_VIOLATION');
    expect(await status(p2.id)).toBe('WAITING');

    const first = await call(org.staffS.accessToken, p1.id);
    expect(first.status).toBe(200);
  });

  it("cannot claim another queue's next person", async () => {
    const org = await setup();
    const other = await createQueue(org.owner.accessToken, { name: 'Other line', tokenPrefix: 'B' });
    const otherService = await createService(org.owner.accessToken, other.id);
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const elsewhere = await createToken({ queueId: other.id, serviceId: otherService.id });

    const viaNext = await next(org.staffS.accessToken, other.id);
    expect(viaNext.status).toBe(409);
    expect(viaNext.body.error.code).toBe('COUNTER_QUEUE_MISMATCH');
    const viaCall = await call(org.staffS.accessToken, elsewhere.id);
    expect(viaCall.status).toBe(409);
    expect(viaCall.body.error.code).toBe('COUNTER_QUEUE_MISMATCH');
    expect(await status(elsewhere.id)).toBe('WAITING');
  });

  it('an unassigned staff member cannot claim anyone', async () => {
    const org = await setup();
    const p1 = await org.join();

    const viaNext = await next(org.staffS.accessToken, org.queue.id);
    expect(viaNext.status).toBe(403);
    expect(viaNext.body.error.code).toBe('STAFF_NOT_ASSIGNED_TO_COUNTER');
    const viaCall = await call(org.staffS.accessToken, p1.id);
    expect(viaCall.status).toBe(403);
    expect(viaCall.body.error.code).toBe('STAFF_NOT_ASSIGNED_TO_COUNTER');
    expect(await status(p1.id)).toBe('WAITING');
  });

  it('loses the ability to claim the moment they are unassigned', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await org.join();
    await assign(org.owner.accessToken, org.counterA.id, null);

    const res = await next(org.staffS.accessToken, org.queue.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_NOT_ASSIGNED_TO_COUNTER');
  });

  it('an empty queue answers with NO_ELIGIBLE_TOKENS', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const res = await next(org.staffS.accessToken, org.queue.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_ELIGIBLE_TOKENS');
  });

  it('a terminal person cannot be claimed', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const p1 = await org.join();
    await call(org.staffS.accessToken, p1.id);
    await api().post(`/api/tokens/${p1.id}/start`).set('Authorization', bearer(org.staffS.accessToken)).send({});
    const done = await api().post(`/api/tokens/${p1.id}/complete`).set('Authorization', bearer(org.staffS.accessToken));
    expect(done.status).toBe(200);

    const again = await call(org.staffS.accessToken, p1.id);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('STAFF act only on the person at their own counter', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await assign(org.owner.accessToken, org.counterB.id, org.staffT.staffId);
    const p1 = await org.join();
    await call(org.staffS.accessToken, p1.id);

    const act = (who: string, path: string, body: Record<string, unknown> = {}) =>
      api().post(`/api/tokens/${p1.id}/${path}`).set('Authorization', bearer(who)).send(body);

    const start = await act(org.staffT.accessToken, 'start');
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe('COUNTER_ACCESS_DENIED');
    const skip = await act(org.staffT.accessToken, 'skip', { reasonCode: 'NO_RESPONSE' });
    expect(skip.status).toBe(403);
    const duration = await api()
      .patch(`/api/tokens/${p1.id}/duration`)
      .set('Authorization', bearer(org.staffT.accessToken))
      .send({ requiredDurationMinutes: 9 });
    expect(duration.status).toBe(403);
    expect(await status(p1.id)).toBe('CALLED');

    expect((await act(org.staffS.accessToken, 'start')).status).toBe(200);
    expect((await act(org.staffS.accessToken, 'complete')).status).toBe(200);
  });

  it('an active counter with nobody at it is not capacity', async () => {
    const org = await setup();
    await org.join();

    const line = await api()
      .get('/api/dashboard/tokens')
      .set('Authorization', bearer(org.owner.accessToken))
      .query({ queueId: org.queue.id });
    expect(line.status).toBe(200);
    expect(line.body.data[0].actionEligibility).toEqual({ eligible: false, reason: 'NO_AVAILABLE_COUNTER' });
  });
});

describe('ADR-064 — strict FCFS and atomic claims', () => {
  it('only the current eligible person can be claimed; the second waits their turn', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await assign(org.owner.accessToken, org.counterB.id, org.staffT.staffId);
    const p1 = await org.join();
    const p2 = await org.join();

    expect((await call(org.staffT.accessToken, p2.id)).body.error.code).toBe('FCFS_VIOLATION');
    expect((await next(org.staffS.accessToken, org.queue.id)).body.data.id).toBe(p1.id);
    expect((await next(org.staffT.accessToken, org.queue.id)).body.data.id).toBe(p2.id);
  });

  it('two simultaneous claims of the same person: exactly one succeeds', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await assign(org.owner.accessToken, org.counterB.id, org.staffT.staffId);
    const p1 = await org.join();

    const results = await Promise.all([call(org.staffS.accessToken, p1.id), call(org.staffT.accessToken, p1.id)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.token.count({ where: { queueId: org.queue.id, status: 'CALLED' } })).toBe(1);
  });

  it('two simultaneous "serve next" with one person waiting: exactly one succeeds', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await assign(org.owner.accessToken, org.counterB.id, org.staffT.staffId);
    const p1 = await org.join();

    const results = await Promise.all([
      next(org.staffS.accessToken, org.queue.id),
      next(org.staffT.accessToken, org.queue.id),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 404]);
    expect(await status(p1.id)).toBe('CALLED');
  });

  it('a double-clicked "serve next" never claims two people for one counter', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await org.join();
    await org.join();

    const results = await Promise.all([
      next(org.staffS.accessToken, org.queue.id),
      next(org.staffS.accessToken, org.queue.id),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.token.count({ where: { counterId: org.counterA.id, status: 'CALLED' } })).toBe(1);
  });
});

describe('ADR-064 — serving is STAFF work; owners and admins manage, never serve', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    it(`${role} cannot Serve next or call anyone`, async () => {
      const org = await setup();
      const manager = role === 'OWNER' ? org.owner : org.admin;
      await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
      const p1 = await org.join();

      for (const res of [
        await next(manager.accessToken, org.queue.id),
        await next(manager.accessToken, org.queue.id, { counterId: org.counterA.id }),
        await call(manager.accessToken, p1.id),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SERVING_STAFF_ONLY');
      }
      expect(await status(p1.id)).toBe('WAITING');
    });

    it(`${role} cannot be assigned to a counter, so cannot assign themselves to serve`, async () => {
      const org = await setup();
      const manager = role === 'OWNER' ? org.owner : org.admin;
      const managerId = role === 'OWNER' ? org.owner.staffId : org.admin.staffId;

      const res = await assign(manager.accessToken, org.counterA.id, managerId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STAFF_NOT_ASSIGNABLE');
      expect((await mine(manager.accessToken)).body.data).toBeNull();

      const offered = await api()
        .get(`/api/counters/${org.counterA.id}/available-staff`)
        .set('Authorization', bearer(manager.accessToken));
      expect(offered.status).toBe(200);
      expect((offered.body.data as { role: string }[]).every((s) => s.role === 'STAFF')).toBe(true);
      expect((offered.body.data as { id: string }[]).map((s) => s.id).sort()).toEqual(
        [org.staffS.staffId, org.staffT.staffId].sort(),
      );
    });

    it(`${role} cannot start, complete, skip or adjust a person at a staff member's counter`, async () => {
      const org = await setup();
      const manager = role === 'OWNER' ? org.owner : org.admin;
      await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
      const p1 = await org.join();
      const p2 = await org.join();
      await call(org.staffS.accessToken, p1.id);

      for (const [path, body] of [
        ['start', {}],
        ['complete', {}],
        ['skip', { reasonCode: 'NO_RESPONSE' }],
      ] as const) {
        const res = await api().post(`/api/tokens/${p1.id}/${path}`).set('Authorization', bearer(manager.accessToken)).send(body);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SERVING_STAFF_ONLY');
      }
      const duration = await api()
        .patch(`/api/tokens/${p1.id}/duration`)
        .set('Authorization', bearer(manager.accessToken))
        .send({ requiredDurationMinutes: 9 });
      expect(duration.status).toBe(403);
      // Nor skip the person at the front of the line.
      const skipWaiting = await api()
        .post(`/api/tokens/${p2.id}/skip`)
        .set('Authorization', bearer(manager.accessToken))
        .send({ reasonCode: 'NO_RESPONSE' });
      expect(skipWaiting.status).toBe(403);
      expect(await status(p1.id)).toBe('CALLED');
      expect(await status(p2.id)).toBe('WAITING');
    });
  }

  it('owner and admin hold every management permission but not operate_tokens', async () => {
    const org = await setup();
    for (const who of [org.owner, org.admin]) {
      const me = await api().get('/api/auth/me').set('Authorization', bearer(who.accessToken));
      expect(me.body.data.permissions).toContain('manage_staff');
      expect(me.body.data.permissions).toContain('manage_counters');
      expect(me.body.data.permissions).not.toContain('operate_tokens');
    }
    const staff = await api().get('/api/auth/me').set('Authorization', bearer(org.staffS.accessToken));
    expect(staff.body.data.permissions).toContain('operate_tokens');
  });

  it('there is no hand-over mid-visit: the counter keeps its staff member until the visit is resolved', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    const p1 = await org.join();
    await call(org.staffS.accessToken, p1.id);

    const handOver = await assign(org.owner.accessToken, org.counterA.id, org.staffT.staffId);
    expect(handOver.status).toBe(409);
    expect(handOver.body.error.code).toBe('COUNTER_HAS_ACTIVE_SERVICE');
    const byT = await api().post(`/api/tokens/${p1.id}/start`).set('Authorization', bearer(org.staffT.accessToken)).send({});
    expect(byT.status).toBe(403);
    const byS = await api().post(`/api/tokens/${p1.id}/start`).set('Authorization', bearer(org.staffS.accessToken)).send({});
    expect(byS.status).toBe(200);
  });

  it('promoting a staff member to admin releases their counter', async () => {
    const org = await setup();
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);

    const promoted = await api()
      .put(`/api/staff/${org.staffS.staffId}`)
      .set('Authorization', bearer(org.owner.accessToken))
      .send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: org.counterA.id } })).staffId).toBeNull();
  });
});

describe('ADR-064 — a called or in-service person is never orphaned', () => {
  async function serving(org: Awaited<ReturnType<typeof setup>>, phase: 'CALLED' | 'IN_PROGRESS') {
    await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId);
    await assign(org.owner.accessToken, org.counterB.id, org.staffT.staffId);
    const p1 = await org.join();
    expect((await call(org.staffS.accessToken, p1.id)).status).toBe(200);
    if (phase === 'IN_PROGRESS') {
      const started = await api().post(`/api/tokens/${p1.id}/start`).set('Authorization', bearer(org.staffS.accessToken)).send({});
      expect(started.status).toBe(200);
    }
    return p1;
  }

  const blocked = (res: { status: number; body: { error?: { code: string } } }) => {
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('COUNTER_HAS_ACTIVE_SERVICE');
  };

  for (const phase of ['CALLED', 'IN_PROGRESS'] as const) {
    it(`a counter with a ${phase} person cannot be deleted`, async () => {
      const org = await setup();
      await serving(org, phase);
      for (const manager of [org.owner, org.admin]) {
        blocked(await api().delete(`/api/counters/${org.counterA.id}`).set('Authorization', bearer(manager.accessToken)));
      }
      expect(await prisma.counter.findUnique({ where: { id: org.counterA.id } })).not.toBeNull();
    });

    it(`its staff member cannot be unassigned, replaced, moved, promoted, suspended or removed while a person is ${phase}`, async () => {
      const org = await setup();
      const p1 = await serving(org, phase);
      const t = bearer(org.owner.accessToken);

      blocked(await assign(org.owner.accessToken, org.counterA.id, null));
      const extra = await createStaffWithRole(org.owner.organizationId, 'STAFF');
      blocked(await assign(org.admin.accessToken, org.counterA.id, extra.staffId));
      blocked(await api().put(`/api/staff/${org.staffS.staffId}`).set('Authorization', t).send({ role: 'ADMIN' }));
      blocked(await api().put(`/api/staff/${org.staffS.staffId}`).set('Authorization', t).send({ status: 'SUSPENDED' }));
      blocked(await api().delete(`/api/staff/${org.staffS.staffId}`).set('Authorization', t));

      const counter = await prisma.counter.findUniqueOrThrow({ where: { id: org.counterA.id } });
      expect(counter.staffId).toBe(org.staffS.staffId);
      expect(await status(p1.id)).toBe(phase);
      // Re-assigning the same person is a no-op, not an orphaning.
      expect((await assign(org.owner.accessToken, org.counterA.id, org.staffS.staffId)).status).toBe(200);
    });

    it(`nobody at another counter can act on a ${phase} person`, async () => {
      const org = await setup();
      const p1 = await serving(org, phase);
      const t = bearer(org.staffT.accessToken);
      for (const [path, body] of [
        ['start', {}],
        ['complete', {}],
        ['skip', { reasonCode: 'NO_RESPONSE' }],
      ] as const) {
        const res = await api().post(`/api/tokens/${p1.id}/${path}`).set('Authorization', t).send(body);
        expect(res.status).toBeGreaterThanOrEqual(403);
        expect(res.status).not.toBe(200);
      }
      const duration = await api().patch(`/api/tokens/${p1.id}/duration`).set('Authorization', t).send({ requiredDurationMinutes: 9 });
      expect(duration.status).toBe(403);
      expect(await status(p1.id)).toBe(phase);
    });
  }

  it('a called person with no counter is not finished by "any staff in the queue"', async () => {
    const org = await setup();
    const p1 = await serving(org, 'CALLED');
    // Legacy data: a CALLED token whose counter link was lost.
    await prisma.token.update({ where: { id: p1.id }, data: { counterId: null } });
    for (const who of [org.staffS, org.staffT]) {
      const res = await api().post(`/api/tokens/${p1.id}/skip`).set('Authorization', bearer(who.accessToken)).send({ reasonCode: 'NO_RESPONSE' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('COUNTER_ACCESS_DENIED');
    }
  });

  it('once the visit is resolved, the counter can be unassigned and deleted normally', async () => {
    const org = await setup();
    const p1 = await serving(org, 'IN_PROGRESS');
    const done = await api().post(`/api/tokens/${p1.id}/complete`).set('Authorization', bearer(org.staffS.accessToken));
    expect(done.status).toBe(200);

    expect((await assign(org.admin.accessToken, org.counterA.id, null)).status).toBe(200);
    expect((await api().delete(`/api/counters/${org.counterA.id}`).set('Authorization', bearer(org.owner.accessToken))).status).toBe(204);
    const promoted = await api()
      .put(`/api/staff/${org.staffS.staffId}`)
      .set('Authorization', bearer(org.owner.accessToken))
      .send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);
  });

  it('a person who cancels from the app releases the counter too', async () => {
    const org = await setup();
    const p1 = await serving(org, 'CALLED');
    const cancelled = await api().post(`/api/tokens/${p1.id}/cancel`).send({ deviceIdentifier: p1.deviceIdentifier });
    expect(cancelled.status).toBe(200);
    expect((await assign(org.owner.accessToken, org.counterA.id, null)).status).toBe(200);
  });
});
