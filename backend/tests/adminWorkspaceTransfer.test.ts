import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaffWithRole } from './helpers/app';
import { resetDb } from './helpers/db';
import {
  addService,
  adminWorkspace,
  as,
  callAndStart,
  complete,
  executiveCounter,
  executiveOf,
  headOrganization,
  join,
  type Workspace,
} from './helpers/workspace';
import { prisma } from '../src/config/prisma';

/**
 * ADR-071: every live queue keeps exactly one Admin. An Admin's workspace
 * (queue and Executives) moves to a replacement Admin atomically; nothing
 * about the queue changes, and earlier audit rows stay with the Admin who
 * performed them.
 */

beforeEach(async () => {
  await resetDb();
});

const transfer = (ws: Pick<Workspace, 'head'>, adminId: string, body: Record<string, unknown>) =>
  as(ws.head.accessToken).post(`/api/staff/${adminId}/workspace-transfer`, {
    reason: 'Changing roles this quarter',
    outcome: 'MANAGER',
    ...body,
  });

async function snapshotQueue(queueId: string) {
  const queue = await prisma.queue.findUniqueOrThrow({
    where: { id: queueId },
    include: {
      services: { orderBy: { id: 'asc' } },
      counters: { orderBy: { id: 'asc' }, include: { services: { orderBy: { serviceId: 'asc' } } } },
      recommendedSteps: { orderBy: { position: 'asc' } },
    },
  });
  const tokens = await prisma.token.findMany({ where: { queueId }, orderBy: { id: 'asc' }, include: { journeySteps: true } });
  return {
    id: queue.id,
    name: queue.name,
    listed: queue.listedOnOrganizationPage,
    services: queue.services.map((s) => [s.id, s.serviceName, s.maxOccurrencesPerJourney]),
    counters: queue.counters.map((c) => [c.id, c.name, c.services.map((s) => s.serviceId)]),
    recommended: queue.recommendedSteps.map((s) => s.serviceId),
    tokens: tokens.map((t) => [t.id, t.status, t.journeySteps.map((s) => [s.stepNumber, s.status, s.staffName])]),
  };
}

describe('the generic role and removal routes refuse to strand a live queue', () => {
  it('the impact preview tells the Head a replacement is needed and who is eligible', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const freeAdmin = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const busy = await adminWorkspace(ws.head); // an Admin who already runs a queue
    const suspended = await createStaffWithRole(ws.head.organizationId, 'STAFF', { workspaceAdminId: ws.admin.staffId });
    await prisma.staff.update({ where: { id: suspended.staffId }, data: { status: 'SUSPENDED' } });
    const invited = await as(ws.head.accessToken).post('/api/staff', {
      name: 'Invitee',
      email: `invitee-${Date.now()}@example.com`,
      role: 'STAFF',
      workspaceAdminId: ws.admin.staffId,
    });
    expect(invited.status).toBe(201);

    const res = await as(ws.head.accessToken).get(`/api/staff/${ws.admin.staffId}/role-change-impact`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      liveQueue: { id: ws.queueId },
      executiveCount: 3,
      requiresReplacement: true,
      holdsCounter: true,
    });
    const ids = res.body.data.eligibleReplacements.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([exec.staffId, freeAdmin.staffId, manager.staffId]));
    for (const excluded of [ws.admin.staffId, busy.admin.staffId, suspended.staffId, invited.body.data.id, ws.head.staffId]) {
      expect(ids).not.toContain(excluded);
    }

    // Only the Head may ask.
    expect((await as(manager.accessToken).get(`/api/staff/${ws.admin.staffId}/role-change-impact`)).status).toBe(403);
    expect((await as(ws.admin.accessToken).get(`/api/staff/${ws.admin.staffId}/role-change-impact`)).status).toBe(403);
  });
});

describe('Admin workspace transfer', () => {
  it('moves the queue and every Executive to the replacement; nothing about the queue changes', async () => {
    const ws = await adminWorkspace();
    const svcA = await addService(ws.admin.accessToken, ws.queueId, 'Intake');
    const svcB = await addService(ws.admin.accessToken, ws.queueId, 'Lab');
    const { counterId, operator } = await executiveCounter(ws, 'Desk 2', [svcB]);
    await as(ws.admin.accessToken).put(`/api/queues/${ws.queueId}/recommended-journey`, { serviceIds: [svcA, svcB] });
    // A visit served before the handover, and one waiting through it.
    await join(ws.queueId, [svcB]);
    const served = await callAndStart(operator.accessToken, ws.queueId);
    expect((await complete(operator.accessToken, served)).status).toBe(200);
    await join(ws.queueId, [svcA]);
    const invited = await as(ws.admin.accessToken).post('/api/staff', {
      name: 'Pending Exec',
      email: `pending-${Date.now()}@example.com`,
      role: 'STAFF',
    });
    expect(invited.status).toBe(201);
    const replacement = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const before = await snapshotQueue(ws.queueId);
    const auditBefore = await prisma.auditLog.findMany({ where: { organizationId: ws.head.organizationId }, orderBy: { id: 'asc' } });

    const res = await transfer(ws, ws.admin.staffId, { replacementStaffId: replacement.staffId, outcome: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      queue: { id: ws.queueId },
      oldAdmin: { id: ws.admin.staffId, outcome: 'MANAGER' },
      newAdmin: { id: replacement.staffId, previousRole: 'ADMIN' },
      executivesMoved: 2,
    });

    const queue = await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } });
    expect(queue.adminId).toBe(replacement.staffId);
    expect(await snapshotQueue(ws.queueId)).toEqual(before);
    // Executives — active and invited — moved; the Executive keeps their counter.
    for (const id of [operator.staffId, invited.body.data.id]) {
      expect((await prisma.staff.findUniqueOrThrow({ where: { id } })).workspaceAdminId).toBe(replacement.staffId);
    }
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: counterId } })).staffId).toBe(operator.staffId);
    // The old Admin is now a Manager; Managers never serve, so their counter was released.
    const old = await prisma.staff.findUniqueOrThrow({ where: { id: ws.admin.staffId } });
    expect(old).toMatchObject({ role: 'MANAGER', workspaceAdminId: null });
    expect(await prisma.counter.findUniqueOrThrow({ where: { id: ws.firstCounterId } })).toMatchObject({
      staffId: null,
      status: 'OFFLINE',
    });

    // History: one immutable transfer row and its audit event; earlier
    // audit rows untouched.
    const rows = await prisma.adminWorkspaceTransfer.findMany({ where: { organizationId: ws.head.organizationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      queueId: ws.queueId,
      oldAdminId: ws.admin.staffId,
      oldAdminEmail: ws.admin.email,
      newAdminId: replacement.staffId,
      transferredById: ws.head.staffId,
      reason: 'Changing roles this quarter',
      executivesMoved: 2,
    });
    const auditAfter = await prisma.auditLog.findMany({
      where: { organizationId: ws.head.organizationId, id: { in: auditBefore.map((a) => a.id) } },
      orderBy: { id: 'asc' },
    });
    expect(auditAfter).toEqual(auditBefore);
    const event = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin_workspace_transferred' } });
    expect(event.workspaceAdminId).toBe(replacement.staffId);
    expect(event.metadata).toMatchObject({
      oldAdmin: { id: ws.admin.staffId, email: ws.admin.email },
      newAdmin: { id: replacement.staffId },
      queue: { id: ws.queueId },
      executivesMoved: 2,
    });
    await expect(prisma.adminWorkspaceTransfer.update({ where: { id: rows[0]!.id }, data: { reason: 'x' } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('the new Admin gets the queue and its operations, but not the predecessor’s audit trail (D3)', async () => {
    const ws = await adminWorkspace();
    const svc = await addService(ws.admin.accessToken, ws.queueId, 'Intake');
    const { operator } = await executiveCounter(ws, 'Desk 2');
    await join(ws.queueId, [svc]);
    const served = await callAndStart(operator.accessToken, ws.queueId);
    await complete(operator.accessToken, served);
    const replacement = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    expect((await transfer(ws, ws.admin.staffId, { replacementStaffId: replacement.staffId })).status).toBe(200);

    const me = as(replacement.accessToken);
    expect((await me.get(`/api/queues/${ws.queueId}`)).status).toBe(200);
    const history = await me.get('/api/service-history');
    expect(history.status).toBe(200);
    expect(history.body.data.map((t: { tokenId: string }) => t.tokenId)).toContain(served);
    const audit = await me.get('/api/audit-logs?pageSize=100');
    expect(audit.status).toBe(200);
    const actions = audit.body.data.map((a: { action: string }) => a.action);
    expect(actions).toContain('admin_workspace_transferred');
    expect(actions).not.toContain('token_completed');
    expect(audit.body.data.every((a: { workspaceAdminId: string }) => a.workspaceAdminId === replacement.staffId)).toBe(true);
    // The Head still sees the whole history.
    const headAudit = await as(ws.head.accessToken).get('/api/audit-logs?pageSize=100');
    expect(headAudit.body.data.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['token_completed', 'admin_workspace_transferred']),
    );
    // The former Admin (now Manager) reads with their new scope only.
    expect((await as(ws.admin.accessToken).post(`/api/queues/${ws.queueId}/counters`, { name: 'X' })).status).toBe(403);
    // An Admin sees the transfers that handed them a workspace.
    const transfers = await me.get('/api/staff/workspace-transfers');
    expect(transfers.body.data).toHaveLength(1);
  });

  it('promotes an Executive of the workspace; the old Admin can stay on as an Executive with their counter', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const other = await executiveOf(ws);
    const res = await transfer(ws, ws.admin.staffId, { replacementStaffId: exec.staffId, outcome: 'EXECUTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.data.newAdmin.previousRole).toBe('STAFF');
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: exec.staffId } })).toMatchObject({
      role: 'ADMIN',
      workspaceAdminId: null,
    });
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: ws.admin.staffId } })).toMatchObject({
      role: 'STAFF',
      workspaceAdminId: exec.staffId,
    });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: other.staffId } })).workspaceAdminId).toBe(exec.staffId);
    // The old Admin is an Executive of the queue's workspace now, so their counter stays.
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: ws.firstCounterId } })).staffId).toBe(ws.admin.staffId);
  });

  it('promotes an Organization Manager; the old Admin can leave the organization entirely', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const res = await transfer(ws, ws.admin.staffId, { replacementStaffId: manager.staffId, outcome: 'REMOVE' });
    expect(res.status).toBe(200);
    expect(await prisma.staff.findUnique({ where: { id: ws.admin.staffId } })).toBeNull();
    expect((await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } })).adminId).toBe(manager.staffId);
    // Their sessions and access ended with the account.
    expect((await as(ws.admin.accessToken).get('/api/auth/me')).status).toBe(401);
    expect((await prisma.session.count({ where: { staffId: ws.admin.staffId } }))).toBe(0);
  });

  it('works for an Admin with Executives but no live queue', async () => {
    const head = await headOrganization();
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const exec = await createStaffWithRole(head.organizationId, 'STAFF', { workspaceAdminId: admin.staffId });
    const blocked = await as(head.accessToken).put(`/api/staff/${admin.staffId}`, { role: 'MANAGER' });
    expect(blocked.body.error.code).toBe('ADMIN_HAS_EXECUTIVES');
    const replacement = await createStaffWithRole(head.organizationId, 'ADMIN');
    const res = await transfer({ head }, admin.staffId, { replacementStaffId: replacement.staffId });
    expect(res.status).toBe(200);
    expect(res.body.data.queue).toBeNull();
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: exec.staffId } })).workspaceAdminId).toBe(replacement.staffId);
  });

  it('refuses a replacement who already runs a live queue', async () => {
    const ws = await adminWorkspace();
    const busy = await adminWorkspace(ws.head);
    const res = await transfer(ws, ws.admin.staffId, { replacementStaffId: busy.admin.staffId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REPLACEMENT_ADMIN_ALREADY_HAS_QUEUE');
    expect((await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } })).adminId).toBe(ws.admin.staffId);
  });

  it('refuses a suspended, invited or same-person replacement, and the Head', async () => {
    const ws = await adminWorkspace();
    const suspended = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    await prisma.staff.update({ where: { id: suspended.staffId }, data: { status: 'SUSPENDED' } });
    const invited = await as(ws.head.accessToken).post('/api/staff', {
      name: 'Invited Admin',
      email: `inv-admin-${Date.now()}@example.com`,
      role: 'ADMIN',
    });
    for (const id of [suspended.staffId, invited.body.data.id, ws.head.staffId]) {
      const res = await transfer(ws, ws.admin.staffId, { replacementStaffId: id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REPLACEMENT_ADMIN_NOT_ELIGIBLE');
    }
    const self = await transfer(ws, ws.admin.staffId, { replacementStaffId: ws.admin.staffId });
    expect(self.status).toBe(422);
  });

  it('cannot reach across organizations', async () => {
    const ws = await adminWorkspace();
    const otherOrg = await adminWorkspace();
    const outsider = await createStaffWithRole(otherOrg.head.organizationId, 'ADMIN');
    expect((await transfer(ws, ws.admin.staffId, { replacementStaffId: outsider.staffId })).status).toBe(404);
    expect((await transfer(ws, otherOrg.admin.staffId, { replacementStaffId: outsider.staffId })).status).toBe(404);
  });

  it('only the Organization Head may hand over a workspace', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const replacement = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    for (const token of [manager.accessToken, ws.admin.accessToken, replacement.accessToken]) {
      const res = await as(token).post(`/api/staff/${ws.admin.staffId}/workspace-transfer`, {
        replacementStaffId: replacement.staffId,
        outcome: 'MANAGER',
        reason: 'Trying it myself',
      });
      expect(res.status).toBe(403);
    }
  });

  it('refuses while the leaving Admin is serving someone — nothing is stranded or half-done', async () => {
    const ws = await adminWorkspace();
    const svc = await addService(ws.admin.accessToken, ws.queueId, 'Intake');
    await join(ws.queueId, [svc]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    const replacement = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const res = await transfer(ws, ws.admin.staffId, { replacementStaffId: replacement.staffId, outcome: 'MANAGER' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_HAS_ACTIVE_SERVICE');
    expect((await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } })).adminId).toBe(ws.admin.staffId);
    expect(await prisma.adminWorkspaceTransfer.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'admin_workspace_transferred' } })).toBe(0);
  });

  it('two simultaneous transfers of the same workspace: exactly one succeeds', async () => {
    const ws = await adminWorkspace();
    const a = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const b = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const results = await Promise.all([
      transfer(ws, ws.admin.staffId, { replacementStaffId: a.staffId }),
      transfer(ws, ws.admin.staffId, { replacementStaffId: b.staffId }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(await prisma.adminWorkspaceTransfer.count()).toBe(1);
    const queue = await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } });
    expect([a.staffId, b.staffId]).toContain(queue.adminId);
  });

  it('validates the request: a reason is required, unknown fields are refused', async () => {
    const ws = await adminWorkspace();
    const replacement = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const noReason = await as(ws.head.accessToken).post(`/api/staff/${ws.admin.staffId}/workspace-transfer`, {
      replacementStaffId: replacement.staffId,
      outcome: 'MANAGER',
    });
    expect(noReason.status).toBe(422);
    const extra = await transfer(ws, ws.admin.staffId, { replacementStaffId: replacement.staffId, queueId: 'x' });
    expect(extra.status).toBe(422);
  });
});

describe('ADR-071 role transition matrix', () => {
  it('Executive → Manager releases their counter; refused while they are serving', async () => {
    const ws = await adminWorkspace();
    const svc = await addService(ws.admin.accessToken, ws.queueId, 'Intake');
    const { counterId, operator } = await executiveCounter(ws, 'Desk 2');
    await join(ws.queueId, [svc]);
    await callAndStart(operator.accessToken, ws.queueId);
    const serving = await as(ws.head.accessToken).put(`/api/staff/${operator.staffId}`, { role: 'MANAGER' });
    expect(serving.status).toBe(409);
    expect(serving.body.error.code).toBe('COUNTER_HAS_ACTIVE_SERVICE');
    const token = await prisma.token.findFirstOrThrow({ where: { counterId, status: 'IN_PROGRESS' } });
    await complete(operator.accessToken, token.id);
    const res = await as(ws.head.accessToken).put(`/api/staff/${operator.staffId}`, { role: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: 'MANAGER', workspaceAdminId: null });
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: counterId } })).staffId).toBeNull();
  });

  it('Executive → Admin and Manager → Admin: promoted with no queue and no workspace', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    for (const person of [exec, manager]) {
      const res = await as(ws.head.accessToken).put(`/api/staff/${person.staffId}`, { role: 'ADMIN' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ role: 'ADMIN', workspaceAdminId: null });
      expect(await prisma.queue.count({ where: { adminId: person.staffId } })).toBe(0);
    }
  });

  it('Manager → Executive requires a destination Admin workspace', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const missing = await as(ws.head.accessToken).put(`/api/staff/${manager.staffId}`, { role: 'STAFF' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('EXECUTIVE_WORKSPACE_REQUIRED');
    const notAdmin = await as(ws.head.accessToken).put(`/api/staff/${manager.staffId}`, {
      role: 'STAFF',
      workspaceAdminId: ws.head.staffId,
    });
    expect(notAdmin.status).toBe(404);
    const res = await as(ws.head.accessToken).put(`/api/staff/${manager.staffId}`, {
      role: 'STAFF',
      workspaceAdminId: ws.admin.staffId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: 'STAFF', workspaceAdminId: ws.admin.staffId });
  });

  it('a workspace can only be chosen together with becoming an Executive', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const res = await as(ws.head.accessToken).put(`/api/staff/${exec.staffId}`, { workspaceAdminId: ws.admin.staffId });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WORKSPACE_ONLY_WITH_EXECUTIVE_ROLE');
  });

  it('the Organization Head is never changed by an ordinary edit, and nobody becomes Head that way', async () => {
    const ws = await adminWorkspace();
    const toManager = await as(ws.head.accessToken).put(`/api/staff/${ws.head.staffId}`, { role: 'MANAGER' });
    expect(toManager.status).toBe(403);
    expect(toManager.body.error.code).toBe('CANNOT_MODIFY_OWNER');
    const toHead = await as(ws.head.accessToken).put(`/api/staff/${ws.admin.staffId}`, { role: 'OWNER' });
    expect(toHead.status).toBe(422);
  });

  it('suspending an Admin keeps their queue and Executives, releases their counter and ends every session', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const res = await as(ws.head.accessToken).put(`/api/staff/${ws.admin.staffId}`, { status: 'SUSPENDED' });
    expect(res.status).toBe(200);
    expect((await prisma.queue.findUniqueOrThrow({ where: { id: ws.queueId } })).adminId).toBe(ws.admin.staffId);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: exec.staffId } })).workspaceAdminId).toBe(ws.admin.staffId);
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: ws.firstCounterId } })).staffId).toBeNull();
    expect(await prisma.session.count({ where: { staffId: ws.admin.staffId, revokedAt: null } })).toBe(0);
    expect((await as(ws.admin.accessToken).get('/api/auth/me')).status).toBe(401);

    // Reactivated: they sign in again; the old token stays dead.
    expect((await as(ws.head.accessToken).put(`/api/staff/${ws.admin.staffId}`, { status: 'ACTIVE' })).status).toBe(200);
    expect((await as(ws.admin.accessToken).get('/api/auth/me')).status).toBe(401);
    const login = await api().post('/api/auth/login').send({ email: ws.admin.email, password: 'Password123' });
    expect(login.status).toBe(200);
  });

  it('role and status changes are audited with before and after values in the same transaction', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    await as(ws.head.accessToken).put(`/api/staff/${manager.staffId}`, { role: 'ADMIN' });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'staff_updated', entityId: manager.staffId } });
    expect(row.metadata).toMatchObject({
      changedFields: ['role'],
      before: { role: 'MANAGER', email: manager.email },
      after: { role: 'ADMIN' },
      actor: { id: ws.head.staffId, role: 'OWNER' },
    });
  });
});
