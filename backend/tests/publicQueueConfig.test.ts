import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createService, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/public/queues/:queueId/config', () => {
  it('returns customer-safe public configuration', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, { clientTerminology: 'Customer' });
    await createService(ctx.accessToken, queue.id, { serviceName: 'General', isActive: true });
    await createService(ctx.accessToken, queue.id, { serviceName: 'Hidden', isActive: false });
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] });

    const res = await api().get(`/api/public/queues/${queue.id}/config`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(queue.id);
    expect(res.body.data.clientTerminology).toBe('Customer');
    expect(res.body.data.services).toHaveLength(1); // only the active one
    expect(res.body.data.services[0].serviceName).toBe('General');
    expect(res.body.data.formFields).toHaveLength(1);
    expect(res.body.data.formFields[0].key).toBe('name');

    // Never exposes internal/staff/organization data.
    expect(res.body.data.organizationId).toBeUndefined();
    expect(res.body.data.counters).toBeUndefined();
    expect(res.body.data.nextTokenNumber).toBeUndefined();
    expect(res.body.data.tokenPrefix).toBeUndefined();
  });

  it('returns 404 for a non-existent queue', async () => {
    const res = await api().get('/api/public/queues/00000000-0000-0000-0000-000000000000/config');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });

  it('returns 404 for an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await api().delete(`/api/queues/${queue.id}`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await api().get(`/api/public/queues/${queue.id}/config`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });

  it('still returns the config for a paused queue, with status reflected', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'PAUSED' });

    const res = await api().get(`/api/public/queues/${queue.id}/config`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAUSED');
  });

  it('only returns form fields at the current form version', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'old', label: 'Old', type: 'text' }] });
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'new', label: 'New', type: 'text' }] });

    const res = await api().get(`/api/public/queues/${queue.id}/config`);
    expect(res.body.data.formFields).toHaveLength(1);
    expect(res.body.data.formFields[0].key).toBe('new');
  });
});
