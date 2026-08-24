import { beforeEach, describe, expect, it } from 'vitest';
import { api, createRestrictedStaff, createQueue, createService, createTokenRequest, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
  await prisma.device.deleteMany({});
});

describe('GET /api/devices (staff-only)', () => {
  it('lists devices, paginated', async () => {
    const ctx = await registerOwner();
    await api().post('/api/devices/register').send({ deviceIdentifier: 'device-1' });
    await api().post('/api/devices/register').send({ deviceIdentifier: 'device-2' });

    const res = await api().get('/api/devices').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it('filters by status', async () => {
    const ctx = await registerOwner();
    const registered = await api()
      .post('/api/devices/register')
      .send({ deviceIdentifier: 'device-to-block' });
    await api().post('/api/devices/register').send({ deviceIdentifier: 'device-active' });

    await api()
      .patch(`/api/devices/${registered.body.data.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'BLOCKED' });

    const res = await api()
      .get('/api/devices?status=BLOCKED')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].deviceIdentifier).toBe('device-to-block');
  });

  it('allows ACCOUNTANT (manage_blocked_devices is part of the frozen ACCOUNTANT policy)', async () => {
    const ctx = await registerOwner();
    const accountant = await createRestrictedStaff(ctx.organizationId);

    const res = await api().get('/api/devices').set('Authorization', `Bearer ${accountant.accessToken}`);

    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().get('/api/devices');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/devices/:deviceId/status', () => {
  it('blocks a device, and a blocked device can no longer create a token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const deviceIdentifier = 'device-block-e2e';

    const registered = await api().post('/api/devices/register').send({ deviceIdentifier });

    const blockRes = await api()
      .patch(`/api/devices/${registered.body.data.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'BLOCKED' });

    expect(blockRes.status).toBe(200);
    expect(blockRes.body.data.status).toBe('BLOCKED');

    const tokenRes = await createTokenRequest({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier,
    });

    expect(tokenRes.status).toBe(403);
    expect(tokenRes.body.error.code).toBe('DEVICE_BLOCKED');
  });

  it('unblocks a device', async () => {
    const ctx = await registerOwner();
    const registered = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-unblock' });
    await prisma.device.update({ where: { id: registered.body.data.id }, data: { status: 'BLOCKED' } });

    const res = await api()
      .patch(`/api/devices/${registered.body.data.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('returns 404 for a non-existent device', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .patch('/api/devices/00000000-0000-0000-0000-000000000000/status')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'BLOCKED' });

    expect(res.status).toBe(404);
  });

  it('allows ACCOUNTANT to block/unblock devices (frozen RBAC policy)', async () => {
    const ctx = await registerOwner();
    const accountant = await createRestrictedStaff(ctx.organizationId);
    const registered = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-perm' });

    const res = await api()
      .patch(`/api/devices/${registered.body.data.id}/status`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ status: 'BLOCKED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('BLOCKED');
  });

  it('rejects an unauthenticated status change request', async () => {
    const registered = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-perm-2' });

    const res = await api()
      .patch(`/api/devices/${registered.body.data.id}/status`)
      .send({ status: 'BLOCKED' });

    expect(res.status).toBe(401);
  });

  it('rejects an invalid status value', async () => {
    const ctx = await registerOwner();
    const registered = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-invalid' });

    const res = await api()
      .patch(`/api/devices/${registered.body.data.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'NOT_A_STATUS' });

    expect(res.status).toBe(422);
  });
});
