import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { api, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { adminWorkspace, as, executiveOf } from './helpers/workspace';
import {
  closeSocketTestServer,
  connectClient,
  ensureSocketTestServer,
  joinOrganization,
  waitForConnect,
  waitForConnectError,
} from './helpers/socket';
import { prisma } from '../src/config/prisma';
import * as emailService from '../src/services/email.service';

/**
 * ADR-071: whenever someone's authority changes, their open sockets are
 * closed so the rooms they may hear are rebuilt from their current role —
 * and a token issued before their access was revoked can no longer open one.
 */

let port: number;
const open: ClientSocket[] = [];

beforeAll(async () => {
  port = await ensureSocketTestServer();
});
afterAll(async () => {
  await closeSocketTestServer();
});
beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  for (const s of open.splice(0)) s.disconnect();
});

async function joined(accessToken: string, organizationId: string): Promise<ClientSocket> {
  const socket = connectClient(port, accessToken);
  open.push(socket);
  await waitForConnect(socket);
  const ack = await joinOrganization(socket, organizationId);
  expect(ack.success).toBe(true);
  return socket;
}

function closed(socket: ClientSocket, timeoutMs = 3000): Promise<boolean> {
  if (!socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe('sockets are closed when authority changes', () => {
  it('on a role change', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const socket = await joined(manager.accessToken, ws.head.organizationId);
    const wait = closed(socket);
    expect((await as(ws.head.accessToken).put(`/api/staff/${manager.staffId}`, { role: 'ADMIN' })).status).toBe(200);
    expect(await wait).toBe(true);
  });

  it('on suspension — and the old token cannot reconnect', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const socket = await joined(exec.accessToken, ws.head.organizationId);
    const wait = closed(socket);
    expect((await as(ws.head.accessToken).put(`/api/staff/${exec.staffId}`, { status: 'SUSPENDED' })).status).toBe(200);
    expect(await wait).toBe(true);
    const retry = connectClient(port, exec.accessToken);
    open.push(retry);
    expect((await waitForConnectError(retry)).message).toBe('UNAUTHENTICATED');
  });

  it('on reactivation', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    await as(ws.head.accessToken).put(`/api/staff/${exec.staffId}`, { status: 'SUSPENDED' });
    await as(ws.head.accessToken).put(`/api/staff/${exec.staffId}`, { status: 'ACTIVE' });
    const login = await api().post('/api/auth/login').send({ email: exec.email, password: 'Password123' });
    const socket = await joined(login.body.data.accessToken, ws.head.organizationId);
    const wait = closed(socket);
    await as(ws.head.accessToken).put(`/api/staff/${exec.staffId}`, { status: 'SUSPENDED' });
    expect(await wait).toBe(true);
  });

  it('on an Admin workspace transfer — the old Admin, the new Admin and moved Executives', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const replacement = await createStaffWithRole(ws.head.organizationId, 'ADMIN');
    const sockets = await Promise.all(
      [ws.admin, exec, replacement].map((p) => joined(p.accessToken, ws.head.organizationId)),
    );
    const waits = sockets.map((s) => closed(s));
    const res = await as(ws.head.accessToken).post(`/api/staff/${ws.admin.staffId}/workspace-transfer`, {
      replacementStaffId: replacement.staffId,
      outcome: 'MANAGER',
      reason: 'Reorganizing the desks',
    });
    expect(res.status).toBe(200);
    expect(await Promise.all(waits)).toEqual([true, true, true]);
  });

  it('on moving an Executive to another workspace, and on removal', async () => {
    const ws = await adminWorkspace();
    const other = await adminWorkspace(ws.head);
    const exec = await executiveOf(ws);
    const socket = await joined(exec.accessToken, ws.head.organizationId);
    const wait = closed(socket);
    await as(ws.head.accessToken).patch(`/api/staff/${exec.staffId}/workspace`, { adminId: other.admin.staffId });
    expect(await wait).toBe(true);

    const login = await api().post('/api/auth/login').send({ email: exec.email, password: 'Password123' });
    const again = await joined(login.body.data.accessToken, ws.head.organizationId);
    const waitRemoval = closed(again);
    expect((await as(ws.head.accessToken).delete(`/api/staff/${exec.staffId}`)).status).toBe(204);
    expect(await waitRemoval).toBe(true);
  });

  it('on Head succession — the former Head is disconnected and cannot reconnect', async () => {
    const codes: string[] = [];
    const links: string[] = [];
    vi.spyOn(emailService, 'sendHeadSuccessionCodeEmail').mockImplementation(async (i) => (codes.push(i.code), true));
    vi.spyOn(emailService, 'sendHeadSuccessorInvitationEmail').mockImplementation(
      async (i) => (links.push(new URL(i.acceptUrl).searchParams.get('token')!), true),
    );
    vi.spyOn(emailService, 'sendHeadSuccessionOutcomeEmail').mockResolvedValue(true);
    const head = await registerOwner();
    const socket = await joined(head.accessToken, head.organizationId);
    const started = await as(head.accessToken).post('/api/organizations/me/leadership-transfers', {
      successorEmail: 'next@example.com',
      successorName: 'Next Head',
      reason: 'RETIREMENT',
      currentPassword: head.password,
    });
    await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${started.body.data.id}/verify`, {
      code: codes[0],
    });
    const wait = closed(socket);
    const accepted = await api()
      .post('/api/auth/leadership-handover/accept')
      .send({ token: links[0], password: 'Password123', acknowledged: true });
    expect(accepted.status).toBe(200);
    expect(await wait).toBe(true);
    const retry = connectClient(port, head.accessToken);
    open.push(retry);
    expect((await waitForConnectError(retry)).message).toBe('UNAUTHENTICATED');
  });
});

describe('a revoked access token is refused on every path', () => {
  it('Socket.io refuses a token issued before accessRevokedAt', async () => {
    const head = await registerOwner();
    await prisma.staff.update({ where: { id: head.staffId }, data: { accessRevokedAt: new Date(Date.now() + 2000) } });
    const socket = connectClient(port, head.accessToken);
    open.push(socket);
    expect((await waitForConnectError(socket)).message).toBe('UNAUTHENTICATED');
  });

  it('optional auth treats a revoked token as anonymous', async () => {
    const ws = await adminWorkspace();
    const svc = await as(ws.admin.accessToken).post(`/api/queues/${ws.queueId}/services`, {
      serviceName: 'Intake',
      durationMinutes: 5,
    });
    const joinRes = await api()
      .post('/api/tokens')
      .set('Idempotency-Key', `idem-${Date.now()}`)
      .send({ queueId: ws.queueId, serviceIds: [svc.body.data.id], deviceIdentifier: 'dev-revoked', formData: {} });
    const tokenId = joinRes.body.data.id;
    const staffView = await as(ws.admin.accessToken).get(`/api/tokens/${tokenId}`);
    await prisma.staff.update({ where: { id: ws.admin.staffId }, data: { accessRevokedAt: new Date(Date.now() + 2000) } });
    const afterRevoke = await as(ws.admin.accessToken).get(`/api/tokens/${tokenId}`);
    // The staff view carries the raw row (organizationId, deviceId); after
    // revocation the same token only gets the anonymous customer view.
    expect(staffView.body.data.organizationId).toBe(ws.head.organizationId);
    expect(afterRevoke.status).toBe(200);
    expect(afterRevoke.body.data.organizationId).toBeUndefined();
    expect((await as(ws.admin.accessToken).get('/api/auth/me')).status).toBe(401);
  });
});

describe('revocation is exact to the millisecond', () => {
  it('a token minted moments before a suspension in the same second is refused; a fresh one after is accepted', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    // Revoke "now" — the executive's token was issued just before, very
    // likely within the same wall-clock second.
    await prisma.staff.update({ where: { id: exec.staffId }, data: { accessRevokedAt: new Date() } });
    expect((await as(exec.accessToken).get('/api/auth/me')).status).toBe(401);
    const fresh = await api().post('/api/auth/login').send({ email: exec.email, password: 'Password123' });
    expect((await as(fresh.body.data.accessToken).get('/api/auth/me')).status).toBe(200);
  });
});
