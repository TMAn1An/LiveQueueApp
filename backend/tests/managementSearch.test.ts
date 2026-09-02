import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createService, createToken, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { recordAuditEvent } from '../src/services/audit.service';

beforeEach(async () => {
  await resetDb();
  await prisma.device.deleteMany({});
});

/** Creates a staff member through the real endpoint so the row is realistic. */
async function addStaff(
  accessToken: string,
  input: { name: string; email: string; role?: 'ADMIN' | 'STAFF' },
) {
  const res = await api()
    .post('/api/staff')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ...input, password: 'Password123', role: input.role ?? 'ADMIN' });

  if (res.status !== 201) {
    throw new Error(`addStaff failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; email: string; role: string };
}

describe('GET /api/staff?search=', () => {
  it('matches name and email case-insensitively and excludes non-matches', async () => {
    const ctx = await registerOwner();
    await addStaff(ctx.accessToken, { name: 'Amina Rahman', email: 'amina@example.com' });
    await addStaff(ctx.accessToken, {
      name: 'Bilal Khan',
      email: 'bilal@example.com',
      role: 'STAFF',
    });

    const byName = await api()
      .get('/api/staff?search=AMINA')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(byName.status).toBe(200);
    expect(byName.body.data.map((s: { email: string }) => s.email)).toEqual(['amina@example.com']);

    const byEmail = await api()
      .get('/api/staff?search=bilal@example')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(byEmail.body.data.map((s: { email: string }) => s.email)).toEqual(['bilal@example.com']);
  });

  it('matches the role enum from free text', async () => {
    const ctx = await registerOwner();
    await addStaff(ctx.accessToken, { name: 'Role One', email: 'role-one@example.com' });
    await addStaff(ctx.accessToken, {
      name: 'Role Two',
      email: 'role-two@example.com',
      role: 'STAFF',
    });

    const res = await api()
      .get('/api/staff?search=admin')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].role).toBe('ADMIN');
  });

  it('returns an empty, correctly-totalled page when nothing matches', async () => {
    const ctx = await registerOwner();
    await addStaff(ctx.accessToken, { name: 'Amina Rahman', email: 'amina@example.com' });

    const res = await api()
      .get('/api/staff?search=zzzz-no-such-person')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('never returns another organization\'s staff, even on an exact match', async () => {
    const orgA = await registerOwner();
    const orgB = await registerOwner();
    await addStaff(orgB.accessToken, {
      name: 'Secret Person',
      email: 'secret-person@example.com',
    });

    const res = await api()
      .get('/api/staff?search=Secret Person')
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/devices?search=', () => {
  it('matches device identifier and token serial, and excludes non-matches', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, { name: 'Front Desk' });
    const service = await createService(ctx.accessToken, queue.id);
    const wanted = await createToken({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier: 'pixel-alpha-001',
    });
    await createToken({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier: 'nokia-beta-002',
    });

    const byIdentifier = await api()
      .get('/api/devices?search=ALPHA')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(byIdentifier.status).toBe(200);
    expect(byIdentifier.body.data).toHaveLength(1);
    expect(byIdentifier.body.data[0].deviceIdentifier).toBe('pixel-alpha-001');

    const bySerial = await api()
      .get(`/api/devices?search=${wanted.serialNumber}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(bySerial.body.data).toHaveLength(1);
    expect(bySerial.body.data[0].deviceIdentifier).toBe('pixel-alpha-001');
  });

  it('combines with the status filter instead of replacing it', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await createToken({ queueId: queue.id, serviceId: service.id, deviceIdentifier: 'shared-1' });
    await createToken({ queueId: queue.id, serviceId: service.id, deviceIdentifier: 'shared-2' });
    const blocked = await prisma.device.findUniqueOrThrow({
      where: { deviceIdentifier: 'shared-1' },
    });
    await api()
      .post(`/api/devices/${blocked.id}/block`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await api()
      .get('/api/devices?status=BLOCKED&search=shared')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].deviceIdentifier).toBe('shared-1');
  });

  it('never surfaces a device that only matched via another organization\'s queue', async () => {
    const orgA = await registerOwner();
    const orgB = await registerOwner();
    const queueB = await createQueue(orgB.accessToken, { name: 'Confidential Clinic' });
    const serviceB = await createService(orgB.accessToken, queueB.id);
    await createToken({
      queueId: queueB.id,
      serviceId: serviceB.id,
      deviceIdentifier: 'other-org-device',
    });

    const res = await api()
      .get('/api/devices?search=Confidential Clinic')
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/audit-logs?search=', () => {
  it('matches action and actor email, and excludes non-matches', async () => {
    const ctx = await registerOwner();
    await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'queue_created',
      entityType: 'queue',
      entityId: 'queue-1',
    });
    await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'staff_created',
      entityType: 'staff',
      entityId: 'staff-1',
    });

    const byAction = await api()
      .get('/api/audit-logs?search=QUEUE_CREATED')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(byAction.status).toBe(200);
    expect(byAction.body.data).toHaveLength(1);
    expect(byAction.body.data[0].action).toBe('queue_created');

    const noMatch = await api()
      .get('/api/audit-logs?search=zzzz-no-such-action')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(noMatch.body.data).toHaveLength(0);
    expect(noMatch.body.pagination.total).toBe(0);
  });

  it('never returns another organization\'s audit events', async () => {
    const orgA = await registerOwner();
    const orgB = await registerOwner();
    await recordAuditEvent({
      actor: {
        staffId: orgB.staffId,
        organizationId: orgB.organizationId,
        staffEmail: orgB.email,
      },
      action: 'queue_created',
      entityType: 'queue',
      entityId: 'queue-b',
    });

    const res = await api()
      .get(`/api/audit-logs?search=${orgB.email}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('rejects an over-long search term instead of querying with it', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .get(`/api/audit-logs?search=${'a'.repeat(201)}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(422);
  });
});
