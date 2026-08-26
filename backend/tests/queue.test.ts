import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createRestrictedStaff, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

describe('Queue CRUD', () => {
  it('creates a queue scoped to the caller organization', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        name: 'Customer Service',
        tokenPrefix: 'A',
        startingNumber: 1,
        baseTimeMinutes: 5,
        defaultNotificationMinutes: 10,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Customer Service');
    expect(res.body.data.organizationId).toBe(ctx.organizationId);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.nextTokenNumber).toBe(1);
    expect(res.body.data.formVersion).toBe(1);
    expect(res.body.data.qrCodeUri).toBe(`livequeue://queue/${res.body.data.id}`);
    expect(res.body.data.services).toEqual([]);
  });

  it('lists queues for the caller organization only', async () => {
    const ctx = await registerOwner();
    await createQueue(ctx.accessToken, { name: 'Queue 1' });
    await createQueue(ctx.accessToken, { name: 'Queue 2' });

    const res = await api().get('/api/queues').set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('includes an accurate counterCount per queue in the list response (Issue 1: discoverability)', async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken, { name: 'Queue A' });
    const queueB = await createQueue(ctx.accessToken, { name: 'Queue B' });

    await api()
      .post(`/api/queues/${queueA.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Counter 1' });
    await api()
      .post(`/api/queues/${queueA.id}/counters`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Counter 2' });

    const res = await api().get('/api/queues').set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);

    const a = res.body.data.find((q: { id: string }) => q.id === queueA.id);
    const b = res.body.data.find((q: { id: string }) => q.id === queueB.id);
    expect(a.counterCount).toBe(2);
    expect(b.counterCount).toBe(0);
  });

  it('gets a single queue by id', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(queue.id);
  });

  it('returns 404 for a non-existent queue', async () => {
    const ctx = await registerOwner();
    const res = await api()
      .get('/api/queues/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });

  it('updates a queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Queue', baseTimeMinutes: 8 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Queue');
    expect(res.body.data.baseTimeMinutes).toBe(8);
  });

  it('changes queue status', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'PAUSED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAUSED');
  });

  it('rejects an invalid status value', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'DELETED' });

    expect(res.status).toBe(422);
  });
});

describe('Queue soft deletion', () => {
  it('soft deletes a queue, keeping the row and setting deletedAt', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).not.toBeNull();

    const row = await prisma.queue.findUnique({ where: { id: queue.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it('excludes soft-deleted queues from the default list', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await api().delete(`/api/queues/${queue.id}`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await api().get('/api/queues').set('Authorization', `Bearer ${ctx.accessToken}`);
    const ids = (res.body.data as Array<{ id: string }>).map((q) => q.id);
    expect(ids).not.toContain(queue.id);
  });

  it('still returns a soft-deleted queue via direct GET, exposing deletedAt without changing status', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await api().delete(`/api/queues/${queue.id}`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).not.toBeNull();
    // deletedAt is archival state, independent of status (approved decision 6).
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('rejects a second delete attempt once the queue is already archived', async () => {
    // Archiving is the one allowed transition into the archived state; once
    // there, the queue is read-only, and that includes a repeat delete call
    // (approved "archived queue must be read-only" decision).
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const first = await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(first.status).toBe(200);
    expect(first.body.data.deletedAt).not.toBeNull();

    const second = await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('QUEUE_ARCHIVED');
  });
});

describe('Queue permissions', () => {
  it('blocks queue creation for STAFF (manage_queues is not part of that role)', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'Should Fail', tokenPrefix: 'B' });

    expect(res.status).toBe(403);
  });

  it('blocks queue update, pause/resume, and delete for STAFF', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const updateRes = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'Should Fail' });
    expect(updateRes.status).toBe(403);

    const statusRes = await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ status: 'PAUSED' });
    expect(statusRes.status).toBe(403);

    const deleteRes = await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(deleteRes.status).toBe(403);
  });

  it('allows STAFF to read queues (view-only, per the frozen RBAC policy)', async () => {
    const ctx = await registerOwner();
    await createQueue(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .get('/api/queues')
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(res.status).toBe(200);
  });
});

describe('Queue tenant isolation', () => {
  it("does not let org B read, update, change status, or delete org A's queue", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queue = await createQueue(orgA.accessToken);

    const getRes = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(getRes.status).toBe(404);

    const putRes = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ name: 'Hijacked' });
    expect(putRes.status).toBe(404);

    const statusRes = await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ status: 'PAUSED' });
    expect(statusRes.status).toBe(404);

    const deleteRes = await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(deleteRes.status).toBe(404);
  });

  it('does not list org A queues for org B', async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    await createQueue(orgA.accessToken);

    const res = await api().get('/api/queues').set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('QR code URI', () => {
  it('returns the correct livequeue:// URI format for an authorized queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.body.data.qrCodeUri).toBe(`livequeue://queue/${queue.id}`);
  });

  it("blocks the URI (and everything else) for another organization's queue", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queue = await createQueue(orgA.accessToken);

    const res = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
  });
});
