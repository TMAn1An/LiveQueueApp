import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createRestrictedStaff,
  createService,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import type { Prisma } from '@prisma/client';

beforeEach(async () => {
  await resetDb();
});

/**
 * Every audit write except organization deletion happens deliberately AFTER
 * the HTTP response is already sent (recordAuditEventSafely, mirroring
 * realtime/emit.ts's post-response pattern — approved Step 5 decision B).
 * That means the client's `await api()...` resolves before the server's
 * still-running handler has necessarily finished its audit write — a real
 * race, not a flake to paper over. Polling briefly for the expected row is
 * the correct way to test a deliberately-decoupled side effect; a fixed
 * immediate query is not.
 */
async function waitForAuditLogs(
  where: Prisma.AuditLogWhereInput,
  expectedCount = 1,
  timeoutMs = 2000,
) {
  const start = Date.now();
  let rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
  while (rows.length < expectedCount && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
  }
  return rows;
}

describe('Phase 7 Step 5 — audit write wiring', () => {
  it('successful login creates exactly one login audit event', async () => {
    const ctx = await registerOwner();

    const res = await api().post('/api/auth/login').send({ email: ctx.email, password: ctx.password });
    expect(res.status).toBe(200);

    const rows = await waitForAuditLogs({ organizationId: ctx.organizationId, action: 'login' });
    expect(rows).toHaveLength(1);
  });

  it('failed login does not create a login audit event', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/auth/login')
      .send({ email: ctx.email, password: 'wrong-password' });
    expect(res.status).toBe(401);

    // No race here: authService.login throws before the controller ever
    // reaches the audit call, so there is nothing to wait for.
    const count = await prisma.auditLog.count({
      where: { organizationId: ctx.organizationId, action: 'login' },
    });
    expect(count).toBe(0);
  });

  it('successful logout creates exactly one logout audit event', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ refreshToken: ctx.refreshToken });
    expect(res.status).toBe(204);

    const rows = await waitForAuditLogs({ organizationId: ctx.organizationId, action: 'logout' });
    expect(rows).toHaveLength(1);
  });

  it('staff creation creates exactly one staff_created audit event with no credential data', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/staff')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        name: 'New Hire',
        email: `newhire-${Date.now()}@example.com`,
        password: 'Password123',
        role: 'ADMIN',
        permissions: ['manage_queues'],
      });
    expect(res.status).toBe(201);

    const rows = await waitForAuditLogs({
      organizationId: ctx.organizationId,
      action: 'staff_created',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(res.body.data.id);
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain('Password123');
  });

  it('staff update creates exactly one staff_updated audit event', async () => {
    const ctx = await registerOwner();
    const target = await api()
      .post('/api/staff')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        name: 'Target',
        email: `target-${Date.now()}@example.com`,
        password: 'Password123',
        role: 'ADMIN',
        permissions: [],
      });

    const res = await api()
      .put(`/api/staff/${target.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Target' });
    expect(res.status).toBe(200);

    const rows = await waitForAuditLogs({
      organizationId: ctx.organizationId,
      action: 'staff_updated',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(target.body.data.id);
    expect(rows[0]?.metadata).toEqual({ changedFields: ['name'] });
  });

  it('queue creation creates exactly one queue_created audit event', async () => {
    const ctx = await registerOwner();

    const queue = await createQueue(ctx.accessToken, { name: 'Audit Queue' });

    const rows = await waitForAuditLogs({
      organizationId: ctx.organizationId,
      action: 'queue_created',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(queue.id);
  });

  it('queue update creates exactly one queue_updated audit event', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Queue' });
    expect(res.status).toBe(200);

    const rows = await waitForAuditLogs({
      organizationId: ctx.organizationId,
      action: 'queue_updated',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(queue.id);
  });

  it('queue archival creates exactly one queue_deleted_or_archived audit event', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .delete(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);

    const rows = await waitForAuditLogs({
      organizationId: ctx.organizationId,
      action: 'queue_deleted_or_archived',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(queue.id);
    // Snapshot survives even though the queue is now archived (soft-deleted).
    expect((rows[0]?.metadata as Record<string, unknown>)?.name).toBe(queue.name);
  });

  it('counter create/update/status changes each create exactly one counter_changed audit event', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);

    await api()
      .put(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Counter' });

    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const rows = await waitForAuditLogs(
      { organizationId: ctx.organizationId, action: 'counter_changed', entityId: counter.id },
      3,
    );
    // create + update + status = 3 counter_changed rows, one per request.
    expect(rows).toHaveLength(3);
    expect((rows[0]?.metadata as Record<string, unknown>)?.change).toBe('created');
    expect((rows[1]?.metadata as Record<string, unknown>)?.change).toBe('updated');
    expect((rows[2]?.metadata as Record<string, unknown>)?.change).toBe('status');
  });

  describe('token lifecycle audit events', () => {
    async function setupWaitingToken() {
      const ctx = await registerOwner();
      const queue = await createQueue(ctx.accessToken);
      const service = await createService(ctx.accessToken, queue.id);
      const counter = await createCounter(ctx.accessToken, queue.id);
      await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

      const tokenRes = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
      expect(tokenRes.status).toBe(201);

      return { ctx, counter, token: tokenRes.body.data };
    }

    it('calling a token creates exactly one token_called audit event', async () => {
      const { ctx, counter, token } = await setupWaitingToken();

      const res = await api()
        .post(`/api/tokens/${token.id}/call`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .send({ counterId: counter.id });
      expect(res.status).toBe(200);

      const rows = await waitForAuditLogs({
        organizationId: ctx.organizationId,
        action: 'token_called',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(token.id);
    });

    it('skipping a token creates exactly one token_skipped audit event', async () => {
      const { ctx, token } = await setupWaitingToken();

      const res = await api()
        .post(`/api/tokens/${token.id}/skip`)
        .set('Authorization', `Bearer ${ctx.accessToken}`);
      expect(res.status).toBe(200);

      const rows = await waitForAuditLogs({
        organizationId: ctx.organizationId,
        action: 'token_skipped',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(token.id);
      expect(rows[0]?.metadata).toEqual({ previousStatus: 'WAITING' });
    });

    it('recalling a skipped token creates exactly one token_recalled audit event', async () => {
      const { ctx, counter, token } = await setupWaitingToken();

      await api()
        .post(`/api/tokens/${token.id}/skip`)
        .set('Authorization', `Bearer ${ctx.accessToken}`);
      const res = await api()
        .post(`/api/tokens/${token.id}/recall`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .send({ counterId: counter.id });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CALLED');

      const rows = await waitForAuditLogs({
        organizationId: ctx.organizationId,
        action: 'token_recalled',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(token.id);

      // Recall is audited distinctly from an ordinary call — this token was
      // skipped directly from WAITING (no prior call), so recall must not
      // also produce a token_called row.
      const calledCount = await prisma.auditLog.count({
        where: { organizationId: ctx.organizationId, entityId: token.id, action: 'token_called' },
      });
      expect(calledCount).toBe(0);
    });

    it('completing a token creates exactly one token_completed audit event', async () => {
      const { ctx, counter, token } = await setupWaitingToken();

      await api()
        .post(`/api/tokens/${token.id}/call`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .send({ counterId: counter.id });
      await api()
        .post(`/api/tokens/${token.id}/start`)
        .set('Authorization', `Bearer ${ctx.accessToken}`);
      const res = await api()
        .post(`/api/tokens/${token.id}/complete`)
        .set('Authorization', `Bearer ${ctx.accessToken}`);
      expect(res.status).toBe(200);

      const rows = await waitForAuditLogs({
        organizationId: ctx.organizationId,
        action: 'token_completed',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(token.id);

      // start (IN_PROGRESS transition) has no approved audit action — confirms
      // it is intentionally not audited, not silently missed. No race here:
      // start() never calls the audit service at all, so there is nothing to
      // wait for — a non-event is deterministic, unlike a pending one.
      const startCount = await prisma.auditLog.count({
        where: { organizationId: ctx.organizationId, entityId: token.id, action: 'token_started' },
      });
      expect(startCount).toBe(0);
    });

    it('a failed call (invalid counter) does not create a token_called audit event', async () => {
      const { ctx, token } = await setupWaitingToken();

      const res = await api()
        .post(`/api/tokens/${token.id}/call`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .send({ counterId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBeGreaterThanOrEqual(400);

      // No race: tokenService.callToken throws before the controller reaches
      // the audit call.
      const count = await prisma.auditLog.count({
        where: { organizationId: ctx.organizationId, action: 'token_called' },
      });
      expect(count).toBe(0);
    });
  });

  it('organization deletion creates the audit event, and it survives the deletion', async () => {
    const ctx = await registerOwner({ organizationName: 'Deletion Wiring Org' });

    const res = await api()
      .delete('/api/organizations/me')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ confirmName: 'Deletion Wiring Org' });
    expect(res.status).toBe(204);

    // No race here, unlike every other action: the audit write happens
    // before the delete and before the response is sent (see
    // organization.service.ts), so it is already durable by this point.
    const rows = await prisma.auditLog.findMany({
      where: { organizationId: ctx.organizationId, action: 'organization_deletion_requested' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(ctx.organizationId);
    expect(rows[0]?.staffId).toBe(ctx.staffId);
    expect(rows[0]?.staffEmail).toBe(ctx.email);
    expect((rows[0]?.metadata as Record<string, unknown>)?.organizationName).toBe('Deletion Wiring Org');

    const orgStillExists = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
    expect(orgStillExists).toBeNull();
  });

  it('blocked-device status change creates exactly one blocked_device_changed audit event', async () => {
    const ctx = await registerOwner();
    const deviceRes = await api()
      .post('/api/devices/register')
      .send({ deviceIdentifier: `audit-wiring-device-${Date.now()}` });

    const res = await api()
      .patch(`/api/devices/${deviceRes.body.data.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'BLOCKED' });
    expect(res.status).toBe(200);

    const rows = await waitForAuditLogs({
      organizationId: ctx.organizationId,
      action: 'blocked_device_changed',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(deviceRes.body.data.id);
    expect((rows[0]?.metadata as Record<string, unknown>)?.newStatus).toBe('BLOCKED');
  });

  it('audit events always use the authenticated organization, never a client-supplied one', async () => {
    const ctx = await registerOwner();
    const other = await registerOwner();

    // manage_organization is real, but the actor's organizationId always
    // comes from req.auth — there is no body/query field that could redirect
    // the audit row to a different organization.
    await createQueue(ctx.accessToken, { name: 'Scoped Queue' });

    const rows = await waitForAuditLogs({ action: 'queue_created' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(ctx.organizationId);
    expect(rows[0]?.organizationId).not.toBe(other.organizationId);
  });

  it('repeated identical requests do not produce duplicate audit events beyond one per successful operation', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    // Two independent, separately-successful update requests -> two separate
    // logical operations -> two rows is correct; the guarantee under test is
    // that a single request never produces more than one row for itself.
    await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'First Rename' });
    await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Second Rename' });

    const rows = await waitForAuditLogs(
      { organizationId: ctx.organizationId, action: 'queue_updated', entityId: queue.id },
      2,
    );
    expect(rows).toHaveLength(2);
  });

  it('a permission-denied request never creates an audit event', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'Should Not Exist', tokenPrefix: 'X' });
    expect(res.status).toBe(403);

    // No race: requirePermission rejects before the controller ever runs.
    const count = await prisma.auditLog.count({
      where: { organizationId: ctx.organizationId, action: 'queue_created' },
    });
    expect(count).toBe(0);
  });
});
