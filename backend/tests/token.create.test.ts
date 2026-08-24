import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createQueue,
  createService,
  createTokenRequest,
  registerOwner,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

async function setQueueStatus(accessToken: string, queueId: string, status: string) {
  await api()
    .patch(`/api/queues/${queueId}/status`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ status });
}

describe('Token creation', () => {
  it('creates a token for a valid queue/service', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, { tokenPrefix: 'A' });
    const service = await createService(ctx.accessToken, queue.id);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(201);
    expect(res.body.data.serialNumber).toBe('A001');
    expect(res.body.data.status).toBe('WAITING');
    expect(res.body.data.position).toBe(1);
  });

  it('rejects an invalid (non-existent) queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await createTokenRequest({
      queueId: '00000000-0000-0000-0000-000000000000',
      serviceId: service.id,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });

  it('rejects an invalid (non-existent) service', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await createTokenRequest({
      queueId: queue.id,
      serviceId: '00000000-0000-0000-0000-000000000000',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('rejects a service that belongs to a different queue', async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken);
    const queueB = await createQueue(ctx.accessToken);
    const serviceB = await createService(ctx.accessToken, queueB.id);

    const res = await createTokenRequest({ queueId: queueA.id, serviceId: serviceB.id });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('rejects an inactive service', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await api()
      .patch(`/api/services/${service.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ isActive: false });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_NOT_ACTIVE');
  });

  it('rejects token creation on a paused queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await setQueueStatus(ctx.accessToken, queue.id, 'PAUSED');

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_NOT_ACTIVE');
  });

  it('rejects token creation on an inactive queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await setQueueStatus(ctx.accessToken, queue.id, 'INACTIVE');

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_NOT_ACTIVE');
  });

  it('rejects token creation on an archived queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_ARCHIVED');
  });

  it('rejects a blocked device', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const deviceIdentifier = `blocked-device-${Math.random().toString(36).slice(2, 10)}`;
    const device = await prisma.device.create({ data: { deviceIdentifier } });
    // Blocking is organization-scoped (OrganizationDeviceBlock) — the raw
    // Device.status column is no longer authoritative for token creation.
    await prisma.organizationDeviceBlock.create({
      data: { organizationId: ctx.organizationId, deviceId: device.id },
    });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEVICE_BLOCKED');
  });

  it('rejects invalid form data (missing a required field)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'fullName', label: 'Full Name', type: 'text', required: true }] });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id, formData: {} });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts valid form data matching the current form definition', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'fullName', label: 'Full Name', type: 'text', required: true }] });

    const res = await createTokenRequest({
      queueId: queue.id,
      serviceId: service.id,
      formData: { fullName: 'Jane Doe' },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.formData).toEqual({ fullName: 'Jane Doe' });
  });

  it('rejects a request with no Idempotency-Key header', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await api()
      .post('/api/tokens')
      .send({ queueId: queue.id, serviceId: service.id, deviceIdentifier: 'device-x', formData: {} });

    expect(res.status).toBe(422);
  });
});

describe('Token creation — optional form field validation', () => {
  async function setupWithFields(
    accessToken: string,
    fields: Array<Record<string, unknown>>,
  ): Promise<{ queueId: string; serviceId: string }> {
    const queue = await createQueue(accessToken);
    const service = await createService(accessToken, queue.id);
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ fields });
    return { queueId: queue.id, serviceId: service.id };
  }

  it('accepts an omitted key for an optional text field', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'notes', label: 'Notes', type: 'text', required: false },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: {} });

    expect(res.status).toBe(201);
  });

  it('accepts an empty string for an optional text field', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'notes', label: 'Notes', type: 'text', required: false },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { notes: '' } });

    expect(res.status).toBe(201);
    expect(res.body.data.formData).toEqual({ notes: '' });
  });

  it('still rejects an empty string for a required text field', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'fullName', label: 'Full Name', type: 'text', required: true },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { fullName: '' } });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts an empty string for an optional dropdown with no options defined', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'preference', label: 'Preference', type: 'dropdown', required: false, options: [] },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { preference: '' } });

    expect(res.status).toBe(201);
  });

  it('accepts an empty string for an optional radio field with options defined', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      {
        key: 'contactMethod',
        label: 'Contact Method',
        type: 'radio',
        required: false,
        options: ['Email', 'Phone'],
      },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { contactMethod: '' } });

    expect(res.status).toBe(201);
    expect(res.body.data.formData).toEqual({ contactMethod: '' });
  });

  it('accepts a valid option for an optional dropdown with options defined', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'preference', label: 'Preference', type: 'dropdown', required: false, options: ['A', 'B'] },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { preference: 'A' } });

    expect(res.status).toBe(201);
    expect(res.body.data.formData).toEqual({ preference: 'A' });
  });

  it('still rejects a value outside the option list for an optional dropdown', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'preference', label: 'Preference', type: 'dropdown', required: false, options: ['A', 'B'] },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { preference: 'C' } });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('still rejects an empty string for a required dropdown with options defined', async () => {
    const ctx = await registerOwner();
    const { queueId, serviceId } = await setupWithFields(ctx.accessToken, [
      { key: 'preference', label: 'Preference', type: 'dropdown', required: true, options: ['A', 'B'] },
    ]);

    const res = await createTokenRequest({ queueId, serviceId, formData: { preference: '' } });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
