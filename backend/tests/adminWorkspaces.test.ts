import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaffWithRole } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import {
  ADMIN_PERMISSIONS,
  MANAGER_PERMISSIONS,
  OWNER_PERMISSIONS,
  STAFF_PERMISSIONS,
} from '../src/constants/permissions';
import {
  addService,
  adminWorkspace,
  as,
  callAndStart,
  executiveCounter,
  executiveOf,
  headOrganization,
  join,
} from './helpers/workspace';

/**
 * ADR-069: Organization Head / Organization Manager / Admin / Executive, one
 * Admin = one queue, hard Admin-workspace isolation, atomic queue creation,
 * the counter lifecycle and queue deletion governance.
 */

beforeEach(async () => {
  await resetDb();
});

describe('roles and permissions', () => {
  it('Head keeps every power; Admin everything but organization-wide reach; Manager read + delete only', () => {
    expect(OWNER_PERMISSIONS).toEqual(expect.arrayContaining(['manage_admins', 'view_all_workspaces', 'delete_queues']));
    expect(ADMIN_PERMISSIONS).not.toContain('manage_admins');
    expect(ADMIN_PERMISSIONS).not.toContain('view_all_workspaces');
    expect(ADMIN_PERMISSIONS).toEqual(expect.arrayContaining(['manage_queues', 'manage_counters', 'operate_tokens']));
    expect([...MANAGER_PERMISSIONS].sort()).toEqual(
      ['delete_queues', 'export_reports', 'view_all_workspaces', 'view_audit_logs', 'view_reports', 'view_staff'].sort(),
    );
    expect(STAFF_PERMISSIONS).toEqual(['operate_tokens', 'view_reports', 'export_reports', 'manage_blocked_devices']);
  });

  it('only the Head invites Admins and Managers; Managers invite nobody', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const byAdmin = await as(ws.admin.accessToken).post('/api/staff', { name: 'New Admin', email: 'na@example.com', role: 'ADMIN' });
    expect(byAdmin.status).toBe(403);
    expect(byAdmin.body.error.code).toBe('HIGHER_ROLE_REQUIRES_HEAD');
    const managerByAdmin = await as(ws.admin.accessToken).post('/api/staff', { name: 'New Mgr', email: 'nm@example.com', role: 'MANAGER' });
    expect(managerByAdmin.status).toBe(403);
    const byManager = await as(manager.accessToken).post('/api/staff', { name: 'Exec', email: 'ex@example.com', role: 'STAFF' });
    expect(byManager.status).toBe(403);
    const byHead = await as(ws.head.accessToken).post('/api/staff', { name: 'Org Manager', email: 'om@example.com', role: 'MANAGER' });
    expect(byHead.status).toBe(201);
    expect(byHead.body.data.role).toBe('MANAGER');
  });

  it('only the Head changes roles — an Admin can no longer promote an Executive', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const promote = await as(ws.admin.accessToken).put(`/api/staff/${exec.staffId}`, { role: 'ADMIN' });
    expect(promote.status).toBe(403);
    expect(promote.body.error.code).toBe('HIGHER_ROLE_REQUIRES_HEAD');
    const byHead = await as(ws.head.accessToken).put(`/api/staff/${exec.staffId}`, { role: 'ADMIN' });
    expect(byHead.status).toBe(200);
    expect(byHead.body.data.workspaceAdminId).toBeNull();
  });

  it('a Manager cannot configure, open/close, operate or assign — only read and delete', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const m = as(manager.accessToken);
    expect((await m.get(`/api/queues/${ws.queueId}`)).status).toBe(200);
    expect((await m.put(`/api/queues/${ws.queueId}`, { name: 'Renamed' })).status).toBe(403);
    expect((await m.patch(`/api/queues/${ws.queueId}/status`, { status: 'PAUSED' })).status).toBe(403);
    expect((await m.post(`/api/queues/${ws.queueId}/counters`, { name: 'X' })).status).toBe(403);
    expect((await m.patch(`/api/counters/${ws.firstCounterId}/status`, { status: 'OFFLINE' })).status).toBe(403);
    expect((await m.patch(`/api/counters/${ws.firstCounterId}/assign`, { staffId: manager.staffId })).status).toBe(403);
    expect((await m.post(`/api/queues/${ws.queueId}/services`, { serviceName: 'S', durationMinutes: 5 })).status).toBe(403);
    expect((await m.post(`/api/queues/${ws.queueId}/next`, {})).status).toBe(403);
    expect((await m.post('/api/queues', { name: 'Mine' })).status).toBe(403);
  });
});

describe('Admin workspace isolation (backend-enforced)', () => {
  async function twoAdmins() {
    const head = await headOrganization();
    const a = await adminWorkspace(head, { name: 'Alpha' });
    const b = await adminWorkspace(head, { name: 'Bravo' });
    return { head, a, b };
  }

  it('an Admin lists only their own queue; another queue id is "not found" everywhere', async () => {
    const { a, b } = await twoAdmins();
    const B = as(b.admin.accessToken);
    const list = await B.get('/api/queues');
    expect(list.body.data.map((q: { name: string }) => q.name)).toEqual(['Bravo']);
    for (const res of [
      await B.get(`/api/queues/${a.queueId}`),
      await B.put(`/api/queues/${a.queueId}`, { name: 'Hijack' }),
      await B.patch(`/api/queues/${a.queueId}/status`, { status: 'PAUSED' }),
      await B.get(`/api/queues/${a.queueId}/counters`),
      await B.post(`/api/queues/${a.queueId}/counters`, { name: 'Sneaky' }),
      await B.post(`/api/queues/${a.queueId}/services`, { serviceName: 'Sneaky', durationMinutes: 5 }),
      await B.get(`/api/queues/${a.queueId}/form-fields`),
      await B.delete(`/api/queues/${a.queueId}`, { reason: 'Because' }),
      await B.get(`/api/dashboard/tokens?queueId=${a.queueId}`),
    ]) {
      expect(res.status).toBe(404);
    }
    for (const res of [
      await B.put(`/api/counters/${a.firstCounterId}`, { name: 'X' }),
      await B.patch(`/api/counters/${a.firstCounterId}/status`, { status: 'OFFLINE' }),
      await B.patch(`/api/counters/${a.firstCounterId}/assign`, { staffId: b.admin.staffId }),
      await B.get(`/api/counters/${a.firstCounterId}/available-staff`),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("an Admin never sees or touches another workspace's Executives", async () => {
    const { a, b } = await twoAdmins();
    const execA = await executiveOf(a);
    const B = as(b.admin.accessToken);
    const list = await B.get('/api/staff');
    expect(list.body.data.map((s: { id: string }) => s.id)).not.toContain(execA.staffId);
    expect(list.body.data.map((s: { id: string }) => s.id)).not.toContain(a.admin.staffId);
    expect((await B.get(`/api/staff/${execA.staffId}`)).status).toBe(404);
    expect((await B.put(`/api/staff/${execA.staffId}`, { name: 'Renamed' })).status).toBe(404);
    expect((await B.delete(`/api/staff/${execA.staffId}`)).status).toBe(404);
    // …nor assigns them to their own counter.
    const assign = await B.patch(`/api/counters/${b.firstCounterId}/assign`, { staffId: execA.staffId, move: true });
    expect(assign.status).toBe(409);
    expect(assign.body.error.code).toBe('OPERATOR_NOT_ASSIGNABLE');
  });

  it("tokens, reports, service history and audit events of another workspace don't leak", async () => {
    const { a, b } = await twoAdmins();
    const serviceA = await addService(a.admin.accessToken, a.queueId, 'Alpha Service');
    const visit = await join(a.queueId, [serviceA]);
    await callAndStart(a.admin.accessToken, a.queueId);
    await as(a.admin.accessToken).post(`/api/tokens/${visit.id}/complete`, {});

    const B = as(b.admin.accessToken);
    expect((await B.post(`/api/tokens/${visit.id}/skip`, { reasonCode: 'OTHER', reasonText: 'x' })).status).toBe(404);
    const token = await B.get(`/api/tokens/${visit.id}`);
    expect(token.body.data.formData).toBeDefined();
    expect(token.body.data.deviceId).toBeUndefined(); // the public view only, never staff detail

    const report = await B.get('/api/reports?range=today');
    expect(report.body.data.tokensCreated).toBe(0);
    expect(report.body.data.queuePerformance.map((q: { queueName: string }) => q.queueName)).toEqual(['Bravo']);
    const history = await B.get('/api/service-history');
    expect(history.body.data).toEqual([]);
    const audit = await B.get('/api/audit-logs');
    expect(audit.body.data.every((e: { workspaceAdminId: string }) => e.workspaceAdminId === b.admin.staffId)).toBe(true);
    const stats = await B.get('/api/dashboard/stats');
    expect(stats.body.data.completedToday).toBe(0);

    // Admin A sees their own.
    const ownReport = await as(a.admin.accessToken).get('/api/reports?range=today');
    expect(ownReport.body.data.tokensCreated).toBe(1);
  });

  it('the Head and Managers see every workspace and can filter by Admin', async () => {
    const { head, a, b } = await twoAdmins();
    const manager = await createStaffWithRole(head.organizationId, 'MANAGER');
    for (const token of [head.accessToken, manager.accessToken]) {
      const all = await as(token).get('/api/queues');
      expect(all.body.data.map((q: { name: string }) => q.name).sort()).toEqual(['Alpha', 'Bravo']);
      const onlyA = await as(token).get(`/api/queues?adminId=${a.admin.staffId}`);
      expect(onlyA.body.data.map((q: { name: string }) => q.name)).toEqual(['Alpha']);
      const auditA = await as(token).get(`/api/audit-logs?adminId=${a.admin.staffId}`);
      expect(auditA.body.data.length).toBeGreaterThan(0);
      expect(auditA.body.data.every((e: { workspaceAdminId: string }) => e.workspaceAdminId === a.admin.staffId)).toBe(true);
      const reportB = await as(token).get(`/api/reports?range=today&adminId=${b.admin.staffId}`);
      expect(reportB.body.data.queuePerformance.map((q: { queueName: string }) => q.queueName)).toEqual(['Bravo']);
      const staffA = await as(token).get(`/api/staff?adminId=${a.admin.staffId}`);
      expect(staffA.body.data.map((s: { id: string }) => s.id)).toContain(a.admin.staffId);
    }
  });

  it('a socket only joins the staff rooms of its own scope', async () => {
    // The room choice is server-side (socketServer.staffRoomsFor); the emit
    // side is covered in realtime tests. Here: an Admin's events carry their
    // own workspace, so another Admin's audit view never shows them.
    const { a, b } = await twoAdmins();
    await as(a.admin.accessToken).put(`/api/queues/${a.queueId}`, { name: 'Alpha 2' });
    const auditB = await as(b.admin.accessToken).get('/api/audit-logs');
    expect(auditB.body.data.some((e: { entityId: string }) => e.entityId === a.queueId)).toBe(false);
  });
});

describe('one Admin = one queue', () => {
  it('the first queue is allowed, a second is refused with a friendly error', async () => {
    const ws = await adminWorkspace();
    const second = await as(ws.admin.accessToken).post('/api/queues', { name: 'Another' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ADMIN_ALREADY_HAS_QUEUE');
    expect(second.body.error.message).toMatch(/Each Admin runs one queue/);
  });

  it('the database refuses a second live queue too; deleted queues do not count', async () => {
    const ws = await adminWorkspace();
    await expect(
      prisma.queue.create({
        data: { organizationId: ws.head.organizationId, name: 'Direct', tokenPrefix: 'D', adminId: ws.admin.staffId },
      }),
    ).rejects.toThrow();
    const removed = await as(ws.admin.accessToken).delete(`/api/queues/${ws.queueId}`, { reason: 'Moving premises' });
    expect(removed.status).toBe(200);
    const again = await as(ws.admin.accessToken).post('/api/queues', { name: 'New Home' });
    expect(again.status).toBe(201);
  });
});

describe('Executive ownership', () => {
  it("an Admin's invitation lands in their own workspace, never another", async () => {
    const head = await headOrganization();
    const a = await adminWorkspace(head);
    const b = await adminWorkspace(head);
    const own = await as(a.admin.accessToken).post('/api/staff', { name: 'Exec One', email: 'e1@example.com', role: 'STAFF' });
    expect(own.status).toBe(201);
    expect(own.body.data.workspaceAdminId).toBe(a.admin.staffId);
    const other = await as(a.admin.accessToken).post('/api/staff', {
      name: 'Exec Two',
      email: 'e2@example.com',
      role: 'STAFF',
      workspaceAdminId: b.admin.staffId,
    });
    expect(other.status).toBe(403);
  });

  it('the Head invites into a chosen workspace and moves an Executive later, releasing their counter', async () => {
    const head = await headOrganization();
    const a = await adminWorkspace(head);
    const b = await adminWorkspace(head);
    const invited = await as(head.accessToken).post('/api/staff', {
      name: 'Exec Three',
      email: 'e3@example.com',
      role: 'STAFF',
      workspaceAdminId: b.admin.staffId,
    });
    expect(invited.body.data.workspaceAdminId).toBe(b.admin.staffId);

    const { counterId, operator } = await executiveCounter(a, 'Desk 2');
    const moved = await as(head.accessToken).patch(`/api/staff/${operator.staffId}/workspace`, { adminId: b.admin.staffId });
    expect(moved.status).toBe(200);
    const counter = await prisma.counter.findUniqueOrThrow({ where: { id: counterId } });
    expect(counter.staffId).toBeNull();
    expect(counter.status).toBe('OFFLINE');
    // Only the Head moves Executives.
    const byAdmin = await as(a.admin.accessToken).patch(`/api/staff/${operator.staffId}/workspace`, { adminId: a.admin.staffId });
    expect(byAdmin.status).toBe(403);
  });
});

describe('atomic queue creation', () => {
  it('creates the queue with one active counter operated by its Admin by default', async () => {
    const head = await headOrganization();
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const res = await as(admin.accessToken).post('/api/queues', { name: 'Records Office' });
    expect(res.status).toBe(201);
    expect(res.body.data.adminId).toBe(admin.staffId);
    expect(res.body.data.tokenPrefix).toBe('R');
    const counters = await prisma.counter.findMany({ where: { queueId: res.body.data.id } });
    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({ name: 'Counter 1', status: 'ACTIVE', staffId: admin.staffId });
  });

  it('assigns one of the Admin’s Executives when chosen', async () => {
    const head = await headOrganization();
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const exec = await createStaffWithRole(head.organizationId, 'STAFF', { workspaceAdminId: admin.staffId });
    const res = await as(admin.accessToken).post('/api/queues', {
      name: 'Payments',
      firstCounter: { name: 'Window A', operatorStaffId: exec.staffId },
    });
    expect(res.status).toBe(201);
    const counter = await prisma.counter.findFirstOrThrow({ where: { queueId: res.body.data.id } });
    expect(counter).toMatchObject({ name: 'Window A', status: 'ACTIVE', staffId: exec.staffId });
  });

  it('rolls everything back when the operator is not eligible — no counterless queue is left', async () => {
    const head = await headOrganization();
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const otherAdmin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const foreign = await createStaffWithRole(head.organizationId, 'STAFF', { workspaceAdminId: otherAdmin.staffId });
    const res = await as(admin.accessToken).post('/api/queues', {
      name: 'Should Not Exist',
      firstCounter: { operatorStaffId: foreign.staffId },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OPERATOR_NOT_ASSIGNABLE');
    expect(await prisma.queue.count({ where: { name: 'Should Not Exist' } })).toBe(0);
    expect(await prisma.counter.count()).toBe(0);
  });

  it('rolls back when the operator already holds another counter', async () => {
    const head = await headOrganization();
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const exec = await createStaffWithRole(head.organizationId, 'STAFF', { workspaceAdminId: admin.staffId });
    const legacy = await prisma.queue.create({
      data: { organizationId: head.organizationId, name: 'Legacy', tokenPrefix: 'L' },
    });
    await prisma.counter.create({ data: { queueId: legacy.id, name: 'Held', status: 'ACTIVE', staffId: exec.staffId } });
    const res = await as(admin.accessToken).post('/api/queues', {
      name: 'Blocked',
      firstCounter: { operatorStaffId: exec.staffId },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPERATOR_ALREADY_ASSIGNED');
    expect(await prisma.queue.count({ where: { name: 'Blocked' } })).toBe(0);
  });

  it('the Head names the Admin; Managers and Executives cannot create queues', async () => {
    const head = await headOrganization();
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const noAdmin = await as(head.accessToken).post('/api/queues', { name: 'Orphan' });
    expect(noAdmin.status).toBe(422);
    expect(noAdmin.body.error.code).toBe('QUEUE_ADMIN_REQUIRED');
    const forAdmin = await as(head.accessToken).post('/api/queues', { name: 'For Admin', adminId: admin.staffId });
    expect(forAdmin.status).toBe(201);
    const counter = await prisma.counter.findFirstOrThrow({ where: { queueId: forAdmin.body.data.id } });
    expect(counter.staffId).toBe(admin.staffId); // never the Head
    const exec = await createStaffWithRole(head.organizationId, 'STAFF', { workspaceAdminId: admin.staffId });
    expect((await as(exec.accessToken).post('/api/queues', { name: 'Nope' })).status).toBe(403);
  });
});

describe('counter lifecycle', () => {
  it('a counter without an operator starts off and cannot be activated or paused', async () => {
    const ws = await adminWorkspace();
    const created = await as(ws.admin.accessToken).post(`/api/queues/${ws.queueId}/counters`, { name: 'Spare' });
    expect(created.body.data).toMatchObject({ status: 'OFFLINE', staffId: null });
    for (const status of ['ACTIVE', 'ON_BREAK']) {
      const res = await as(ws.admin.accessToken).patch(`/api/counters/${created.body.data.id}/status`, { status });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COUNTER_OPERATOR_REQUIRED');
    }
  });

  it('pausing keeps the operator; turning off releases them; reactivating needs one', async () => {
    const ws = await adminWorkspace();
    const { counterId, operator } = await executiveCounter(ws, 'Desk 2');
    const A = as(ws.admin.accessToken);
    const paused = await A.patch(`/api/counters/${counterId}/status`, { status: 'ON_BREAK' });
    expect(paused.body.data).toMatchObject({ status: 'ON_BREAK', staffId: operator.staffId });
    const off = await A.patch(`/api/counters/${counterId}/status`, { status: 'OFFLINE' });
    expect(off.body.data).toMatchObject({ status: 'OFFLINE', staffId: null });
    expect((await A.patch(`/api/counters/${counterId}/status`, { status: 'ACTIVE' })).status).toBe(409);
    const back = await A.patch(`/api/counters/${counterId}/status`, { status: 'ACTIVE', operatorStaffId: operator.staffId });
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ status: 'ACTIVE', staffId: operator.staffId });
  });

  it('assigning an operator to an off counter pauses it; an active counter is never simply emptied', async () => {
    const ws = await adminWorkspace();
    const A = as(ws.admin.accessToken);
    const spare = (await A.post(`/api/queues/${ws.queueId}/counters`, { name: 'Spare' })).body.data;
    const exec = await executiveOf(ws);
    const assigned = await A.patch(`/api/counters/${spare.id}/assign`, { staffId: exec.staffId });
    expect(assigned.body.data).toMatchObject({ status: 'ON_BREAK', staffId: exec.staffId });
    const empty = await A.patch(`/api/counters/${ws.firstCounterId}/assign`, { staffId: null });
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('COUNTER_MUST_BE_OFF');
  });

  it('turning off is refused while someone is called or being served there', async () => {
    const ws = await adminWorkspace();
    const service = await addService(ws.admin.accessToken, ws.queueId, 'General');
    await join(ws.queueId, [service]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    const off = await as(ws.admin.accessToken).patch(`/api/counters/${ws.firstCounterId}/status`, { status: 'OFFLINE' });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('COUNTER_HAS_ACTIVE_SERVICE');
  });

  it("a queue's last counter cannot be deleted", async () => {
    const ws = await adminWorkspace();
    const res = await as(ws.admin.accessToken).delete(`/api/counters/${ws.firstCounterId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_NEEDS_A_COUNTER');
  });
});

describe('queue deletion governance', () => {
  it('a reason is mandatory — blank and whitespace are refused', async () => {
    const ws = await adminWorkspace();
    for (const body of [{}, { reason: '' }, { reason: '   ' }]) {
      const res = await as(ws.admin.accessToken).delete(`/api/queues/${ws.queueId}`, body);
      expect(res.status).toBe(422);
    }
  });

  it('a Manager deletes with a reason; who, role and why are kept and audited', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const res = await as(manager.accessToken).delete(`/api/queues/${ws.queueId}`, { reason: 'Service discontinued' });
    expect(res.status).toBe(200);
    const queue = await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } });
    expect(queue).toMatchObject({ deletedByStaffId: manager.staffId, deletedByRole: 'MANAGER', deletionReason: 'Service discontinued' });
    expect(queue.deletedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'queue_deleted_or_archived', entityId: ws.queueId } });
    expect(log.metadata).toMatchObject({ reason: 'Service discontinued' });
    expect(log.workspaceAdminId).toBe(ws.admin.staffId);
    const history = await as(ws.head.accessToken).get('/api/queues/deleted');
    expect(history.body.data[0]).toMatchObject({ id: ws.queueId, deletionReason: 'Service discontinued', deletedByRole: 'MANAGER' });
    // Its counters are off and released.
    const counter = await prisma.counter.findUniqueOrThrow({ where: { id: ws.firstCounterId } });
    expect(counter).toMatchObject({ status: 'OFFLINE', staffId: null });
  });

  it('is refused while anyone is called or being served', async () => {
    const ws = await adminWorkspace();
    const service = await addService(ws.admin.accessToken, ws.queueId, 'General');
    await join(ws.queueId, [service]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    const res = await as(ws.head.accessToken).delete(`/api/queues/${ws.queueId}`, { reason: 'Closing' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_HAS_ACTIVE_SERVICE');
  });

  it('cancels everyone waiting; they see the reason — public visitors never do', async () => {
    const ws = await adminWorkspace();
    const service = await addService(ws.admin.accessToken, ws.queueId, 'General');
    const visit = await join(ws.queueId, [service]);
    await as(ws.admin.accessToken).delete(`/api/queues/${ws.queueId}`, { reason: 'Flooded building' }).expect(200);

    const mine = await api().get(`/api/tokens/${visit.id}`);
    expect(mine.body.data.status).toBe('CANCELLED');
    expect(mine.body.data.queueRemoved).toEqual({ reason: 'Flooded building' });

    const publicConfig = await api().get(`/api/public/queues/${ws.queueId}/config`);
    expect(publicConfig.status).toBe(404);
    expect(JSON.stringify(publicConfig.body)).not.toContain('Flooded');
    const code = (await prisma.organization.findUniqueOrThrow({ where: { id: ws.head.organizationId } })).publicCode;
    const orgPage = await api().get(`/api/public/organizations/${code}`);
    expect(JSON.stringify(orgPage.body)).not.toContain('Flooded');
  });
});

describe('legacy queues and Executives (D2/D3)', () => {
  it('the Head assigns a Head-managed queue to an Admin; organization-level Executives on it join that workspace', async () => {
    const head = await headOrganization();
    const legacy = await prisma.queue.create({
      data: { organizationId: head.organizationId, name: 'Legacy Desk', tokenPrefix: 'L' },
    });
    const orgExec = await createStaffWithRole(head.organizationId, 'STAFF');
    await prisma.counter.create({ data: { queueId: legacy.id, name: 'Old Counter', status: 'ACTIVE', staffId: orgExec.staffId } });
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');

    // Before assignment the Admin cannot see it.
    expect((await as(admin.accessToken).get(`/api/queues/${legacy.id}`)).status).toBe(404);
    const byAdmin = await as(admin.accessToken).patch(`/api/queues/${legacy.id}/admin`, { adminId: admin.staffId });
    expect(byAdmin.status).toBe(403);

    const assigned = await as(head.accessToken).patch(`/api/queues/${legacy.id}/admin`, { adminId: admin.staffId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.adminId).toBe(admin.staffId);
    const exec = await prisma.staff.findUniqueOrThrow({ where: { id: orgExec.staffId } });
    expect(exec.workspaceAdminId).toBe(admin.staffId);
    expect((await as(admin.accessToken).get(`/api/queues/${legacy.id}`)).status).toBe(200);
  });

  it('when an Admin leaves, their queue and Executives return to the Head instead of disappearing', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    // The Admin's own counter must be released first (active-service rule), then removal.
    await as(ws.admin.accessToken).post(`/api/queues/${ws.queueId}/counters`, { name: 'Spare' });
    const removed = await as(ws.head.accessToken).delete(`/api/staff/${ws.admin.staffId}`);
    expect(removed.status).toBe(204);
    const queue = await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } });
    expect(queue.adminId).toBeNull();
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: exec.staffId } })).workspaceAdminId).toBeNull();
    const counter = await prisma.counter.findUniqueOrThrow({ where: { id: ws.firstCounterId } });
    expect(counter).toMatchObject({ status: 'OFFLINE', staffId: null });
  });
});
