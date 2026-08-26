import { beforeEach, describe, expect, it } from 'vitest';
import { api, createRestrictedStaff, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/organizations/me', () => {
  it('returns the authenticated staff member\'s own organization', async () => {
    const ctx = await registerOwner({ organizationName: 'Acme Corp' });

    const res = await api().get('/api/organizations/me').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ctx.organizationId);
    expect(res.body.data.name).toBe('Acme Corp');
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().get('/api/organizations/me');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/organizations/me', () => {
  it('lets the owner rename the organization', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .put('/api/organizations/me')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Org' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Org');
  });

  it('rejects a non-owner even with manage_organization permission (ADMIN has it by default)', async () => {
    const ctx = await registerOwner();
    const restricted = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .put('/api/organizations/me')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'Hijacked Name' });

    expect(res.status).toBe(403);
  });

  it('rejects a staff member without manage_organization (STAFF)', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .put('/api/organizations/me')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'X' });

    expect(res.status).toBe(403);
  });

  it('rejects an empty name', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .put('/api/organizations/me')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: '' });

    expect(res.status).toBe(422);
  });

  it('does not affect another organization', async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });

    await api()
      .put('/api/organizations/me')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ name: 'Org A Renamed' });

    const orgBCheck = await prisma.organization.findUnique({ where: { id: orgB.organizationId } });
    expect(orgBCheck?.name).toBe('Org B');
  });
});

describe('DELETE /api/organizations/me', () => {
  it('rejects deletion when confirmName does not match', async () => {
    const ctx = await registerOwner({ organizationName: 'Acme Corp' });

    const res = await api()
      .delete('/api/organizations/me')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ confirmName: 'Wrong Name' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORGANIZATION_NAME_MISMATCH');

    const stillExists = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
    expect(stillExists).not.toBeNull();
  });

  it('rejects a non-owner from deleting the organization, even ADMIN with manage_organization', async () => {
    const ctx = await registerOwner({ organizationName: 'Acme Corp' });
    const restricted = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .delete('/api/organizations/me')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ confirmName: 'Acme Corp' });

    expect(res.status).toBe(403);
    const stillExists = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
    expect(stillExists).not.toBeNull();
  });

  it('rejects an STAFF from deleting the organization', async () => {
    const ctx = await registerOwner({ organizationName: 'Acme Corp' });
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .delete('/api/organizations/me')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ confirmName: 'Acme Corp' });

    expect(res.status).toBe(403);
    const stillExists = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
    expect(stillExists).not.toBeNull();
  });

  it('deletes the organization and cascades to staff, sessions, queues, and tokens when confirmed', async () => {
    const ctx = await registerOwner({ organizationName: 'Acme Corp' });
    const queue = await prisma.queue.create({
      data: { organizationId: ctx.organizationId, name: 'Q1', tokenPrefix: 'A' },
    });
    const service = await prisma.queueService.create({
      data: { queueId: queue.id, serviceName: 'S1', durationMinutes: 5 },
    });
    const device = await prisma.device.create({ data: { deviceIdentifier: 'device-org-delete' } });
    const token = await prisma.token.create({
      data: {
        organizationId: ctx.organizationId,
        queueId: queue.id,
        serviceId: service.id,
        deviceId: device.id,
        sequenceNumber: 1,
        serialNumber: 'A001',
        formData: {},
        formVersion: 1,
        idempotencyKey: 'org-delete-key',
      },
    });

    const res = await api()
      .delete('/api/organizations/me')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ confirmName: 'Acme Corp' });

    expect(res.status).toBe(204);

    expect(await prisma.organization.findUnique({ where: { id: ctx.organizationId } })).toBeNull();
    expect(await prisma.staff.findUnique({ where: { id: ctx.staffId } })).toBeNull();
    expect(await prisma.queue.findUnique({ where: { id: queue.id } })).toBeNull();
    expect(await prisma.token.findUnique({ where: { id: token.id } })).toBeNull();
    // Device is a global identity (ADR-011) — deleting an organization must
    // not delete devices that merely interacted with one of its queues.
    expect(await prisma.device.findUnique({ where: { id: device.id } })).not.toBeNull();
  });
});
