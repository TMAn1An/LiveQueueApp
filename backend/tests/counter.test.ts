import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createRestrictedStaff, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

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

    const res = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'ON_BREAK' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ON_BREAK');
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

  it('deletes a counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);

    const res = await api()
      .delete(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(204);

    const list = await api()
      .get(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(list.body.data).toHaveLength(0);
  });
});

describe('Counter staff assignment', () => {
  it('assigns a counter to a staff member in the same organization', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);

    const res = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(ctx.staffId);
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
    const counterA = await createCounter(ctx.accessToken, queue.id, 'Counter A');
    const counterB = await createCounter(ctx.accessToken, queue.id, 'Counter B');

    await api()
      .patch(`/api/counters/${counterA.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });

    const res = await api()
      .patch(`/api/counters/${counterB.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAFF_ALREADY_ASSIGNED');

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
    const counter = await createCounter(ctx.accessToken, queue.id);

    await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });

    const res = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(ctx.staffId);
  });

  it('allows a different, unassigned staff member to be assigned to a second counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counterA = await createCounter(ctx.accessToken, queue.id, 'Counter A');
    const counterB = await createCounter(ctx.accessToken, queue.id, 'Counter B');
    const other = await createRestrictedStaff(ctx.organizationId);

    await api()
      .patch(`/api/counters/${counterA.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });

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

  it('allows STAFF to create, update, change status, assign, and delete counters (frozen RBAC policy)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const accountant = await createRestrictedStaff(ctx.organizationId);

    const createRes = await api()
      .post(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ name: 'X' });
    expect(createRes.status).toBe(201);
    const counterId = createRes.body.data.id;

    const updateRes = await api()
      .put(`/api/counters/${counterId}`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ name: 'Y' });
    expect(updateRes.status).toBe(200);

    const statusRes = await api()
      .patch(`/api/counters/${counterId}/status`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ status: 'ON_BREAK' });
    expect(statusRes.status).toBe(200);

    const assignRes = await api()
      .patch(`/api/counters/${counterId}/assign`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ staffId: ctx.staffId });
    expect(assignRes.status).toBe(200);

    const deleteRes = await api()
      .delete(`/api/counters/${counterId}`)
      .set('Authorization', `Bearer ${accountant.accessToken}`);
    expect(deleteRes.status).toBe(204);
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
