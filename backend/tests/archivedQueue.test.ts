import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

async function createService(accessToken: string, queueId: string) {
  const res = await api()
    .post(`/api/queues/${queueId}/services`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ serviceName: 'General Inquiry', durationMinutes: 5 });
  if (res.status !== 201) {
    throw new Error(`createService failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function createCounter(accessToken: string, queueId: string) {
  const res = await api()
    .post(`/api/queues/${queueId}/counters`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Counter 1' });
  if (res.status !== 201) {
    throw new Error(`createCounter failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function archiveQueue(accessToken: string, queueId: string) {
  const res = await api()
    .delete(`/api/queues/${queueId}`)
    .set('Authorization', `Bearer ${accessToken}`);
  if (res.status !== 200) {
    throw new Error(`archiveQueue failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

describe('Archived queue is read-only: Queue endpoints', () => {
  it('rejects PUT on an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await archiveQueue(ctx.accessToken, queue.id);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Should Fail' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_ARCHIVED');
  });

  it('rejects PATCH status on an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await archiveQueue(ctx.accessToken, queue.id);

    const res = await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'PAUSED' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_ARCHIVED');
  });
});

describe('Archived queue is read-only: Service endpoints', () => {
  it('rejects creating a service under an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await archiveQueue(ctx.accessToken, queue.id);

    const res = await api()
      .post(`/api/queues/${queue.id}/services`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ serviceName: 'X', durationMinutes: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_ARCHIVED');
  });

  it('rejects update, status change, and delete of a service whose queue is archived', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await archiveQueue(ctx.accessToken, queue.id);

    const updateRes = await api()
      .put(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ serviceName: 'X' });
    expect(updateRes.status).toBe(409);
    expect(updateRes.body.error.code).toBe('QUEUE_ARCHIVED');

    const statusRes = await api()
      .patch(`/api/services/${service.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ isActive: false });
    expect(statusRes.status).toBe(409);
    expect(statusRes.body.error.code).toBe('QUEUE_ARCHIVED');

    const deleteRes = await api()
      .delete(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.code).toBe('QUEUE_ARCHIVED');
  });
});

describe('Archived queue is read-only: Counter endpoints', () => {
  it('rejects creating a counter under an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await archiveQueue(ctx.accessToken, queue.id);

    const res = await api()
      .post(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'X' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_ARCHIVED');
  });

  it('rejects update, status change, assignment, and delete of a counter whose queue is archived', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await archiveQueue(ctx.accessToken, queue.id);

    const updateRes = await api()
      .put(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'X' });
    expect(updateRes.status).toBe(409);
    expect(updateRes.body.error.code).toBe('QUEUE_ARCHIVED');

    const statusRes = await api()
      .patch(`/api/counters/${counter.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'ON_BREAK' });
    expect(statusRes.status).toBe(409);
    expect(statusRes.body.error.code).toBe('QUEUE_ARCHIVED');

    const assignRes = await api()
      .patch(`/api/counters/${counter.id}/assign`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ staffId: ctx.staffId });
    expect(assignRes.status).toBe(409);
    expect(assignRes.body.error.code).toBe('QUEUE_ARCHIVED');

    const deleteRes = await api()
      .delete(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.code).toBe('QUEUE_ARCHIVED');
  });
});

describe('Archived queue is read-only: Dynamic form endpoint', () => {
  it('rejects replacing the form for an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await archiveQueue(ctx.accessToken, queue.id);

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'a', label: 'A', type: 'text' }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_ARCHIVED');
  });
});

describe('Archived queue read behavior is unaffected', () => {
  it('still allows GET on the queue, its services (nested), and its counters', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await createService(ctx.accessToken, queue.id);
    await createCounter(ctx.accessToken, queue.id);
    await archiveQueue(ctx.accessToken, queue.id);

    const getQueue = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(getQueue.status).toBe(200);
    expect(getQueue.body.data.deletedAt).not.toBeNull();
    expect(getQueue.body.data.services).toHaveLength(1);

    const getCounters = await api()
      .get(`/api/queues/${queue.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(getCounters.status).toBe(200);
    expect(getCounters.body.data).toHaveLength(1);
  });
});

describe('Archived queue guard does not bypass tenant isolation', () => {
  it("still returns 404 (not 409) for another organization's archived queue", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    await archiveQueue(orgA.accessToken, queueA.id);

    const res = await api()
      .put(`/api/queues/${queueA.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });
});
