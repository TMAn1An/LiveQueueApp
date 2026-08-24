import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, createRestrictedStaff, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { recordAuditEvent } from '../src/services/audit.service';

beforeEach(async () => {
  await resetDb();
});

describe('AuditLog schema foundation', () => {
  it('can be created via the audit service', async () => {
    const ctx = await registerOwner();

    const record = await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'staff_created',
      entityType: 'staff',
      entityId: ctx.staffId,
    });

    expect(record.id).toBeDefined();
    const stored = await prisma.auditLog.findUnique({ where: { id: record.id } });
    expect(stored).not.toBeNull();
  });

  it('stores organizationId/staffId/staffEmail as plain snapshot values', async () => {
    const ctx = await registerOwner();

    const record = await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'login',
      entityType: 'staff',
      entityId: ctx.staffId,
    });

    expect(record.organizationId).toBe(ctx.organizationId);
    expect(record.staffId).toBe(ctx.staffId);
    expect(record.staffEmail).toBe(ctx.email);
  });

  it('has no Prisma relation fields to Organization or Staff — plain scalar snapshots only', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AuditLog');
    expect(model).toBeDefined();

    const relationFields = model!.fields.filter((f) => f.kind === 'object');
    expect(relationFields).toHaveLength(0);

    const organizationIdField = model!.fields.find((f) => f.name === 'organizationId');
    const staffIdField = model!.fields.find((f) => f.name === 'staffId');
    expect(organizationIdField?.kind).toBe('scalar');
    expect(staffIdField?.kind).toBe('scalar');
  });

  it('survives organization deletion (real database, real DELETE endpoint)', async () => {
    const ctx = await registerOwner({ organizationName: 'Audit Survivor Org' });

    const record = await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'organization_deletion_requested',
      entityType: 'organization',
      entityId: ctx.organizationId,
    });

    const deleteRes = await api()
      .delete('/api/organizations/me')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ confirmName: 'Audit Survivor Org' });
    expect(deleteRes.status).toBe(204);

    // The organization (and, via cascade, its Staff/Session/Queue/Token rows)
    // is genuinely gone — but the audit row, having no FK to either, remains.
    const orgStillExists = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
    });
    expect(orgStillExists).toBeNull();

    const auditStillExists = await prisma.auditLog.findUnique({ where: { id: record.id } });
    expect(auditStillExists).not.toBeNull();
    expect(auditStillExists?.organizationId).toBe(ctx.organizationId);
  });

  it('can store safe, structured JSON metadata', async () => {
    const ctx = await registerOwner();

    const record = await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'staff_updated',
      entityType: 'staff',
      entityId: ctx.staffId,
      metadata: { previousStatus: 'ACTIVE', newStatus: 'SUSPENDED', changedFields: ['status'] },
    });

    const stored = await prisma.auditLog.findUnique({ where: { id: record.id } });
    expect(stored?.metadata).toEqual({
      previousStatus: 'ACTIVE',
      newStatus: 'SUSPENDED',
      changedFields: ['status'],
    });
  });

  it('never persists secret-shaped metadata keys', async () => {
    const ctx = await registerOwner();

    const record = await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'login',
      entityType: 'staff',
      entityId: ctx.staffId,
      metadata: {
        password: 'hunter2',
        passwordHash: 'abc123hash',
        accessToken: 'jwt.value.here',
        refreshToken: 'raw-refresh-token',
        fcmToken: 'fcm-device-token',
        apiKey: 'sk-live-secret',
        Authorization: 'Bearer sometoken',
        note: 'this field is safe and should survive',
      },
    });

    const stored = await prisma.auditLog.findUnique({ where: { id: record.id } });
    const metadata = stored?.metadata as Record<string, unknown>;

    expect(metadata).toEqual({ note: 'this field is safe and should survive' });
    expect(JSON.stringify(metadata)).not.toContain('hunter2');
    expect(JSON.stringify(metadata)).not.toContain('sk-live-secret');
  });

  it('has no columns beyond the approved set — no hidden secret-carrying field', async () => {
    const ctx = await registerOwner();
    const record = await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'logout',
      entityType: 'staff',
      entityId: ctx.staffId,
    });

    const stored = await prisma.auditLog.findUnique({ where: { id: record.id } });
    expect(Object.keys(stored!).sort()).toEqual(
      [
        'id',
        'organizationId',
        'staffId',
        'staffEmail',
        'action',
        'entityType',
        'entityId',
        'metadata',
        'ipAddress',
        'createdAt',
      ].sort(),
    );
  });
});

describe('GET /api/audit-logs', () => {
  it('requires authentication', async () => {
    const res = await api().get('/api/audit-logs');
    expect(res.status).toBe(401);
  });

  it('requires the view_audit_logs permission (ACCOUNTANT does not have it)', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('is granted separately from view_reports — ACCOUNTANT has view_reports but is still denied audit logs', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const reportsRes = await api()
      .get('/api/reports')
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(reportsRes.status).toBe(200);

    const auditRes = await api()
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${restricted.accessToken}`);
    expect(auditRes.status).toBe(403);
  });

  it('allows ADMIN (full access, including audit logs)', async () => {
    const ctx = await registerOwner();
    const admin = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api().get('/api/audit-logs').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('allows a staff member holding view_reports', async () => {
    const ctx = await registerOwner();

    const res = await api().get('/api/audit-logs').set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('is tenant-isolated — one organization cannot read another organization\'s records', async () => {
    const orgA = await registerOwner();
    const orgB = await registerOwner();

    await recordAuditEvent({
      actor: { staffId: orgA.staffId, organizationId: orgA.organizationId, staffEmail: orgA.email },
      action: 'login',
      entityType: 'staff',
      entityId: orgA.staffId,
    });
    await recordAuditEvent({
      actor: { staffId: orgB.staffId, organizationId: orgB.organizationId, staffEmail: orgB.email },
      action: 'login',
      entityType: 'staff',
      entityId: orgB.staffId,
    });

    const res = await api().get('/api/audit-logs').set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].organizationId).toBe(orgA.organizationId);
  });

  it('ignores a client-supplied organizationId query parameter — scope always comes from the auth context', async () => {
    const orgA = await registerOwner();
    const orgB = await registerOwner();

    await recordAuditEvent({
      actor: { staffId: orgB.staffId, organizationId: orgB.organizationId, staffEmail: orgB.email },
      action: 'login',
      entityType: 'staff',
      entityId: orgB.staffId,
    });

    const res = await api()
      .get(`/api/audit-logs?organizationId=${orgB.organizationId}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('paginates and orders results newest first', async () => {
    const ctx = await registerOwner();

    for (let i = 0; i < 5; i++) {
      await recordAuditEvent({
        actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
        action: 'login',
        entityType: 'staff',
        entityId: ctx.staffId,
        metadata: { sequence: i },
      });
      // createdAt has millisecond precision (TIMESTAMP(3)); a tight loop on a
      // fast local DB connection can otherwise land two inserts in the same
      // millisecond, making ORDER BY created_at DESC's tie-break
      // non-deterministic and this test flaky.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const page1 = await api()
      .get('/api/audit-logs?page=1&pageSize=2')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    const page2 = await api()
      .get('/api/audit-logs?page=2&pageSize=2')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(page1.body.data).toHaveLength(2);
    expect(page2.body.data).toHaveLength(2);
    expect(page1.body.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    // Newest first: the most recently created record (sequence 4) leads page 1.
    expect(page1.body.data[0].metadata.sequence).toBe(4);
    expect(page1.body.data[1].metadata.sequence).toBe(3);
    expect(page2.body.data[0].metadata.sequence).toBe(2);

    const createdTimestamps = [...page1.body.data, ...page2.body.data].map((row: { createdAt: string }) =>
      new Date(row.createdAt).getTime(),
    );
    expect(createdTimestamps).toEqual([...createdTimestamps].sort((a, b) => b - a));
  });

  it('rejects a page size beyond the maximum', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .get('/api/audit-logs?pageSize=101')
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(422);
  });

  it('never returns secret-shaped data through the read endpoint', async () => {
    const ctx = await registerOwner();
    await recordAuditEvent({
      actor: { staffId: ctx.staffId, organizationId: ctx.organizationId, staffEmail: ctx.email },
      action: 'login',
      entityType: 'staff',
      entityId: ctx.staffId,
      metadata: { password: 'hunter2', note: 'safe' },
    });

    const res = await api().get('/api/audit-logs').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(res.body.data[0].metadata).toEqual({ note: 'safe' });
  });
});
