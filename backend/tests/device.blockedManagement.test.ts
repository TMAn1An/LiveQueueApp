import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createRestrictedStaff,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  createTokenRequest,
  registerOwner,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
  await prisma.device.deleteMany({});
});

/** Registers an org with a queue+service ready to accept tokens. */
async function setupOrg() {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id);
  return { ...ctx, queue, service };
}

describe('GET /api/devices (staff-only, organization-scoped)', () => {
  it('lists devices that have joined this organization\'s queues, paginated', async () => {
    const org = await setupOrg();
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-1' });
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-2' });

    const res = await api().get('/api/devices').set('Authorization', `Bearer ${org.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it('filters by status (this organization\'s block state)', async () => {
    const org = await setupOrg();
    await createToken({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier: 'device-to-block',
    });
    await createToken({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier: 'device-active',
    });

    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier: 'device-to-block' } });
    await api()
      .post(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    const res = await api()
      .get('/api/devices?status=BLOCKED')
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].deviceIdentifier).toBe('device-to-block');
  });

  it('does not list a device that only another organization has interacted with', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier: 'a-only-device' });
    await createToken({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier: 'b-only-device' });

    const res = await api().get('/api/devices').set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { deviceIdentifier: string }) => d.deviceIdentifier)).toEqual([
      'a-only-device',
    ]);
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

describe('POST /api/devices/:deviceId/block and DELETE /api/devices/:deviceId/block', () => {
  it('blocks a device, and a blocked device can no longer create a token for this organization', async () => {
    const org = await setupOrg();
    const deviceIdentifier = 'device-block-e2e';
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });

    const blockRes = await api()
      .post(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(blockRes.status).toBe(200);
    expect(blockRes.body.data.status).toBe('BLOCKED');

    const tokenRes = await createTokenRequest({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier,
    });

    expect(tokenRes.status).toBe(403);
    expect(tokenRes.body.error.code).toBe('DEVICE_BLOCKED');
  });

  it('unblocks a device', async () => {
    const org = await setupOrg();
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-unblock' });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier: 'device-unblock' } });
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${org.accessToken}`);

    const res = await api()
      .delete(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('returns 404 blocking a non-existent device', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/devices/00000000-0000-0000-0000-000000000000/block')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 unblocking a device with no block for this organization', async () => {
    const org = await setupOrg();
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-never-blocked' });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier: 'device-never-blocked' } });

    const res = await api()
      .delete(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(res.status).toBe(404);
  });

  it('allows ACCOUNTANT to block/unblock devices (frozen RBAC policy)', async () => {
    const org = await setupOrg();
    const accountant = await createRestrictedStaff(org.organizationId);
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-perm' });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier: 'device-perm' } });

    const res = await api()
      .post(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${accountant.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('BLOCKED');
  });

  it('rejects an unauthenticated block request', async () => {
    const org = await setupOrg();
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-perm-2' });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier: 'device-perm-2' } });

    const res = await api().post(`/api/devices/${device.id}/block`);

    expect(res.status).toBe(401);
  });
});

describe('Organization-scoped device blocking — tenant isolation', () => {
  it('Test 1: Org A blocking Device X keeps Org A blocked', async () => {
    const orgA = await setupOrg();
    const deviceIdentifier = 'shared-device-1';
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgA.accessToken}`);

    const tokenRes = await createTokenRequest({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });

    expect(tokenRes.status).toBe(403);
    expect(tokenRes.body.error.code).toBe('DEVICE_BLOCKED');
  });

  it('Test 2: Org A blocking Device X does not block Org B (same deviceIdentifier)', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const deviceIdentifier = 'shared-device-2';
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgA.accessToken}`);

    const tokenRes = await createTokenRequest({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });

    expect(tokenRes.status).toBe(201);
  });

  it('Test 3: Org A and Org B can independently block the same device', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const deviceIdentifier = 'shared-device-3';
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    await createToken({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });

    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgA.accessToken}`);
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgB.accessToken}`);

    const blocks = await prisma.organizationDeviceBlock.findMany({ where: { deviceId: device.id } });
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.organizationId).sort()).toEqual(
      [orgA.organizationId, orgB.organizationId].sort(),
    );
  });

  it('Test 4: Org A unblocking does not unblock Org B', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const deviceIdentifier = 'shared-device-4';
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    await createToken({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });

    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgA.accessToken}`);
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgB.accessToken}`);
    await api().delete(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgA.accessToken}`);

    const tokenA = await createTokenRequest({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    const tokenB = await createTokenRequest({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });

    expect(tokenA.status).toBe(201);
    expect(tokenB.status).toBe(403);
    expect(tokenB.body.error.code).toBe('DEVICE_BLOCKED');
  });

  it('Test 5: Org A cannot remove Org B\'s block (404, and the block survives)', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const deviceIdentifier = 'shared-device-5';
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    await createToken({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgB.accessToken}`);

    const res = await api()
      .delete(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(404);

    const stillBlocked = await prisma.organizationDeviceBlock.findUnique({
      where: { organizationId_deviceId: { organizationId: orgB.organizationId, deviceId: device.id } },
    });
    expect(stillBlocked).not.toBeNull();
  });

  it('Test 6: Org A\'s device listing never exposes Org B\'s block state for a shared device', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const deviceIdentifier = 'shared-device-6';
    await createToken({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    await createToken({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });
    await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${orgA.accessToken}`);

    const listA = await api().get('/api/devices').set('Authorization', `Bearer ${orgA.accessToken}`);
    const listB = await api().get('/api/devices').set('Authorization', `Bearer ${orgB.accessToken}`);

    const rowA = listA.body.data.find((d: { id: string }) => d.id === device.id);
    const rowB = listB.body.data.find((d: { id: string }) => d.id === device.id);

    expect(rowA.status).toBe('BLOCKED');
    expect(rowB.status).toBe('ACTIVE');
  });

  it('Test 7: blocking the same device twice for the same organization is idempotent', async () => {
    const org = await setupOrg();
    const deviceIdentifier = 'shared-device-7';
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });

    const first = await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${org.accessToken}`);
    const second = await api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${org.accessToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const count = await prisma.organizationDeviceBlock.count({
      where: { organizationId: org.organizationId, deviceId: device.id },
    });
    expect(count).toBe(1);
  });

  it('Test 7b: two genuinely concurrent first-time block requests both succeed and create exactly one row', async () => {
    const org = await setupOrg();
    const deviceIdentifier = 'shared-device-7b';
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier } });

    const preCount = await prisma.organizationDeviceBlock.count({
      where: { organizationId: org.organizationId, deviceId: device.id },
    });
    expect(preCount).toBe(0);

    const blockRequest = () =>
      api().post(`/api/devices/${device.id}/block`).set('Authorization', `Bearer ${org.accessToken}`);

    // Both requests are dispatched before either is awaited — real concurrent
    // HTTP requests against the real app and database, not two sequential
    // calls. This is the scenario that previously raced Prisma's client-side
    // check-then-insert upsert: both requests can see "not blocked yet"
    // before either commits, so the loser must not surface a spurious 409.
    const [first, second] = await Promise.all([blockRequest(), blockRequest()]);

    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('BLOCKED');
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('BLOCKED');

    const finalCount = await prisma.organizationDeviceBlock.count({
      where: { organizationId: org.organizationId, deviceId: device.id },
    });
    expect(finalCount).toBe(1);
  });

  it('Test 8: permission regression — OWNER/ADMIN/ACCOUNTANT allowed, unauthenticated rejected', async () => {
    const org = await setupOrg();
    const admin = await createStaffWithRoleForTest(org.organizationId, 'ADMIN');
    const accountant = await createRestrictedStaff(org.organizationId);
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'perm-regression' });
    const device = await prisma.device.findUniqueOrThrow({ where: { deviceIdentifier: 'perm-regression' } });

    const ownerRes = await api().get('/api/devices').set('Authorization', `Bearer ${org.accessToken}`);
    const adminRes = await api().get('/api/devices').set('Authorization', `Bearer ${admin.accessToken}`);
    const accountantRes = await api()
      .post(`/api/devices/${device.id}/block`)
      .set('Authorization', `Bearer ${accountant.accessToken}`);
    const unauthRes = await api().get('/api/devices');

    expect(ownerRes.status).toBe(200);
    expect(adminRes.status).toBe(200);
    expect(accountantRes.status).toBe(200);
    expect(unauthRes.status).toBe(401);
  });

  it('Test 9: a stale global Device.status=BLOCKED does not block token creation without an OrganizationDeviceBlock row', async () => {
    const org = await setupOrg();
    const deviceIdentifier = 'legacy-globally-blocked';
    await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    // Simulate a pre-existing legacy-blocked device: the column is set directly,
    // bypassing the API, with no OrganizationDeviceBlock row created for any org.
    await prisma.device.update({
      where: { deviceIdentifier },
      data: { status: 'BLOCKED' },
    });

    const tokenRes = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });

    expect(tokenRes.status).toBe(201);
  });
});

async function createStaffWithRoleForTest(organizationId: string, role: 'ADMIN') {
  return createStaffWithRole(organizationId, role);
}
