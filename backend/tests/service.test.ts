import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createRestrictedStaff, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

async function createService(
  accessToken: string,
  queueId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await api()
    .post(`/api/queues/${queueId}/services`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ serviceName: 'General Inquiry', durationMinutes: 5, ...overrides });
  if (res.status !== 201) {
    throw new Error(`createService failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

describe('Service CRUD', () => {
  it('creates a service under a queue owned by the caller', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .post(`/api/queues/${queue.id}/services`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ serviceName: 'General Inquiry', durationMinutes: 5 });

    expect(res.status).toBe(201);
    expect(res.body.data.queueId).toBe(queue.id);
    expect(res.body.data.isActive).toBe(true);
  });

  it('updates a service by its direct id', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await api()
      .put(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ serviceName: 'Account Update', durationMinutes: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.serviceName).toBe('Account Update');
    expect(res.body.data.durationMinutes).toBe(10);
  });

  it('toggles service status', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await api()
      .patch(`/api/services/${service.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('deletes a service', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await api()
      .delete(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(204);

    const getQueue = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(getQueue.body.data.services).toHaveLength(0);
  });

  it('surfaces services nested in the queue response, with no dedicated list endpoint', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await createService(ctx.accessToken, queue.id, { serviceName: 'General Inquiry' });

    const res = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.body.data.services).toHaveLength(1);
    expect(res.body.data.services[0].serviceName).toBe('General Inquiry');
  });
});

describe('Service permissions', () => {
  it('blocks service creation, update, status change, and delete for ACCOUNTANT (no manage_services)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const createRes = await api()
      .post(`/api/queues/${queue.id}/services`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ serviceName: 'X', durationMinutes: 5 });
    expect(createRes.status).toBe(403);

    const updateRes = await api()
      .put(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ serviceName: 'X' });
    expect(updateRes.status).toBe(403);

    const statusRes = await api()
      .patch(`/api/services/${service.id}/status`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ isActive: false });
    expect(statusRes.status).toBe(403);

    const deleteRes = await api()
      .delete(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(deleteRes.status).toBe(403);
  });
});

describe('Service tenant isolation', () => {
  it("rejects creating a service under another organization's queue", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);

    const res = await api()
      .post(`/api/queues/${queueA.id}/services`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ serviceName: 'Hijack', durationMinutes: 5 });

    expect(res.status).toBe(404);
  });

  it("rejects update, status change, and delete of another organization's service via its direct id", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const service = await createService(orgA.accessToken, queueA.id);

    const updateRes = await api()
      .put(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ serviceName: 'Hijacked' });
    expect(updateRes.status).toBe(404);

    const statusRes = await api()
      .patch(`/api/services/${service.id}/status`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ isActive: false });
    expect(statusRes.status).toBe(404);

    const deleteRes = await api()
      .delete(`/api/services/${service.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(deleteRes.status).toBe(404);
  });
});
