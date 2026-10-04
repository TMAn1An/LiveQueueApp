import { beforeEach, describe, expect, it } from 'vitest';
import { api, assignCounterTo, createQueue, createStaffWithRole, queueAdmins, registerOwner } from './helpers/app';
import { prisma } from '../src/config/prisma';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

/** ADR-069: an Executive of the queue's Admin — the people who may operate
 * its counters. */
function executiveOf(ctx: { organizationId: string }, queue: { id: string }) {
  return createStaffWithRole(ctx.organizationId, 'STAFF', { workspaceAdminId: queueAdmins.get(queue.id)!.staffId });
}

async function createCounter(accessToken: string, queueId: string, name = 'Counter 1') {
  const res = await api()
    .post(`/api/queues/${queueId}/counters`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name });
  if (res.status !== 201) {
    throw new Error(`createCounter failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

describe('Counter CRUD', () => {
  it('creates and lists counters for a queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const created = await createCounter(ctx.accessToken, queue.id);
    expect(created.status).toBe('OFFLINE');

    const list = await api()
      .get(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('updates a counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);

    const res = await api()
      .put(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Counter' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Counter');
  });

  it('changes counter status', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    const worker = await executiveOf(ctx, queue);

    // ADR-069: an open or paused counter always has an operator.
    const unstaffed = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'ON_BREAK' });
    expect(unstaffed.status).toBe(409);
    expect(unstaffed.body.error.code).toBe('COUNTER_OPERATOR_REQUIRED');

    const res = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'ON_BREAK', operatorStaffId: worker.staffId });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ON_BREAK');
    expect(res.body.data.staffId).toBe(worker.staffId);

    // Turning it off releases the operator.
    const off = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'OFFLINE' });
    expect(off.body.data.staffId).toBeNull();
  });

  it('rejects an invalid counter status', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);

    const res = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'BUSY' });

    expect(res.status).toBe(422);
  });

  it('deletes a counter, but never a queue\'s last one (ADR-069)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    const spare = await createCounter(ctx.accessToken, queue.id, 'Counter 2');

    const res = await api()
      .delete(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(204);

    const last = await api()
      .delete(`/api/counters/${spare.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('QUEUE_NEEDS_A_COUNTER');

    const list = await api()
      .get(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([spare.id]);
  });
});

describe('Counter staff assignment', () => {
  // ADR-069: OFF → operator assigned → PAUSED. Never ACTIVE by itself.
  it('assigning an operator to an OFF counter makes it PAUSED, not ACTIVE; opening stays explicit', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    expect(counter.status).toBe('OFFLINE');
    const worker = await executiveOf(ctx, queue);

    const assigned = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: worker.staffId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data).toMatchObject({ status: 'ON_BREAK', staffId: worker.staffId });

    const opened = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'ACTIVE' });
    expect(opened.body.data).toMatchObject({ status: 'ACTIVE', staffId: worker.staffId });

    // Turning it off releases the operator again.
    const off = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'OFFLINE' });
    expect(off.body.data).toMatchObject({ status: 'OFFLINE', staffId: null });
  });

  it('assigns a counter to a staff member in the same organization', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    // ADR-069: only the queue's Admin or their Executives operate it.
    const worker = await executiveOf(ctx, queue);
    const counter = await createCounter(ctx.accessToken, queue.id);

    const res = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: worker.staffId });

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(worker.staffId);
  });

  it('rejects assignment to a staff member from another organization', async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const counter = await createCounter(orgA.accessToken, queueA.id);

    const res = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ staffId: orgB.staffId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_ORGANIZATION_MISMATCH');
  });

  it('rejects assignment to a non-existent staff member', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);

    const res = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STAFF_NOT_FOUND');
  });

  it('rejects assigning a staff member who is already assigned to a different counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    // ADR-069: only the queue's Admin or their Executives operate it.
    const worker = await executiveOf(ctx, queue);
    const counterA = await createCounter(ctx.accessToken, queue.id, 'Counter A');
    const counterB = await createCounter(ctx.accessToken, queue.id, 'Counter B');

    await api()
      .patch(`/api/counters/${counterA.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: worker.staffId });

    const res = await api()
      .patch(`/api/counters/${counterB.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: worker.staffId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPERATOR_ALREADY_ASSIGNED');

    // Counter B must remain unassigned — the rejected call had no side effect.
    const check = await api()
      .get(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    const b = check.body.data.find((c: { id: string }) => c.id === counterB.id);
    expect(b.staffId).toBeNull();
  });

  it('allows re-assigning a counter to the staff member already assigned to it (no-op, not a conflict)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    // ADR-069: only the queue's Admin or their Executives operate it.
    const worker = await executiveOf(ctx, queue);
    const counter = await createCounter(ctx.accessToken, queue.id);

    await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: worker.staffId });

    const res = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: worker.staffId });

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(worker.staffId);
  });

  it('allows a different, unassigned staff member to be assigned to a second counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counterA = await createCounter(ctx.accessToken, queue.id, 'Counter A');
    const counterB = await createCounter(ctx.accessToken, queue.id, 'Counter B');
    const other = await executiveOf(ctx, queue);

    // ADR-069: the queue's own Admin may stand at one of its counters.
    await api()
      .patch(`/api/counters/${counterA.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: queueAdmins.get(queue.id)!.staffId })
      .expect(200);

    const res = await api()
      .patch(`/api/counters/${counterB.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: other.staffId });

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(other.staffId);
  });
});

describe('Counter permissions', () => {
  it('blocks counter creation, update, status change, assignment, and delete without any staff permissions', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    // No role under the frozen RBAC policy lacks manage_counters (OWNER,
    // ADMIN, and STAFF all have it) — an unauthenticated/invalid token
    // is the only way left to demonstrate the route is actually gated.
    const createRes = await api()
      .post(`/api/queues/${queue.id}/counters`)
      .send({ name: 'X' });
    expect(createRes.status).toBe(401);

    const updateRes = await api().put(`/api/counters/${counter.id}`).send({ name: 'X' });
    expect(updateRes.status).toBe(401);

    const statusRes = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .send({ status: 'ON_BREAK' });
    expect(statusRes.status).toBe(401);

    const assignRes = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .send({ staffId: ctx.staffId });
    expect(assignRes.status).toBe(401);

    const deleteRes = await api().delete(`/api/counters/${counter.id}`);
    expect(deleteRes.status).toBe(401);
  });

  // ADR-064: counters are owner/admin management; STAFF only serve.
  it('refuses STAFF creating, renaming, changing status of, or deleting counters (ADR-064)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const staff = await executiveOf(ctx, queue);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await assignCounterTo(ctx.accessToken, counter.id, staff.staffId);
    const auth = `Bearer ${staff.accessToken}`;

    const results = [
      await api().post(`/api/queues/${queue.id}/counters`).set('Authorization', auth).send({ name: 'X' }),
      await api().put(`/api/counters/${counter.id}`).set('Authorization', auth).send({ name: 'Y' }),
      await api().patch(`/api/counters/${counter.id}/status`).set('Authorization', auth).send({ status: 'ON_BREAK' }),
      await api().delete(`/api/counters/${counter.id}`).set('Authorization', auth),
    ];
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('COUNTER_MANAGEMENT_FORBIDDEN');
    }
    const stored = await prisma.counter.findMany({ where: { queueId: queue.id } });
    // Assigned to an off counter, it became paused (ADR-069) — and stayed so.
    expect(stored.map((c) => [c.name, c.status])).toEqual([['Counter 1', 'ON_BREAK']]);
  });

  /**
   * ADR-036 narrowed exactly one capability. Deciding who stands at a
   * counter is a staffing decision, not an operational one — a staff member
   * could previously move colleagues (including themselves) between counters
   * and queues, because assignment was guarded by manage_counters, which
   * STAFF holds. It now requires manage_staff, which STAFF does not.
   */
  it('does not let STAFF decide who stands at a counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    const operator = await executiveOf(ctx, queue);

    const assignRes = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .send({ staffId: operator.staffId });
    const availableRes = await api()
      .get(`/api/counters/${counter.id}/available-staff`)
      .set('Authorization', `Bearer ${operator.accessToken}`);

    expect(assignRes.status).toBe(403);
    expect(availableRes.status).toBe(403);
  });
});

describe('Counter tenant isolation', () => {
  it("rejects direct-id operations on another organization's counter", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const counter = await createCounter(orgA.accessToken, queueA.id);

    const updateRes = await api()
      .put(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ name: 'Hijacked' });
    expect(updateRes.status).toBe(404);

    const statusRes = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ status: 'ON_BREAK' });
    expect(statusRes.status).toBe(404);

    const assignRes = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ staffId: orgB.staffId });
    expect(assignRes.status).toBe(404);

    const deleteRes = await api()
      .delete(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(deleteRes.status).toBe(404);
  });

  it("rejects listing or creating counters for another organization's queue", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);

    const listRes = await api()
      .get(`/api/queues/${queueA.id}/counters`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(listRes.status).toBe(404);

    const createRes = await api()
      .post(`/api/queues/${queueA.id}/counters`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ name: 'Hijack' });
    expect(createRes.status).toBe(404);
  });
});
