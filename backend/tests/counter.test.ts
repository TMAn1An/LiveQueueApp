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
});

describe('Counter permissions', () => {
  it('blocks counter creation, update, status change, assignment, and delete without manage_counters', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    const restricted = await createRestrictedStaff(ctx.organizationId, ['manage_queues']);

    const createRes = await api()
      .post(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'X' });
    expect(createRes.status).toBe(403);

    const updateRes = await api()
      .put(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'X' });
    expect(updateRes.status).toBe(403);

    const statusRes = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ status: 'ON_BREAK' });
    expect(statusRes.status).toBe(403);

    const assignRes = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ staffId: ctx.staffId });
    expect(assignRes.status).toBe(403);

    const deleteRes = await api()
      .delete(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(deleteRes.status).toBe(403);
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
