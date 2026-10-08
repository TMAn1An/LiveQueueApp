import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createStaffWithRole, registerOwner, type RegisteredContext } from './helpers/app';
import { resetDb } from './helpers/db';
import { addService, adminWorkspace, as, executiveCounter, executiveOf, join } from './helpers/workspace';
import { prisma } from '../src/config/prisma';
import * as emailService from '../src/services/email.service';

/**
 * ADR-071: handing over the Organization Head role — password + emailed code
 * from the current Head, a one-time 72-hour link to the successor, explicit
 * acceptance, and one atomic handover that deletes the former Head's account.
 */

let codes: string[];
let links: string[];
let outcomes: { to: string; outcome: string }[];

beforeEach(async () => {
  await resetDb();
  codes = [];
  links = [];
  outcomes = [];
  vi.spyOn(emailService, 'sendHeadSuccessionCodeEmail').mockImplementation(async (input) => {
    codes.push(input.code);
    return true;
  });
  vi.spyOn(emailService, 'sendHeadSuccessorInvitationEmail').mockImplementation(async (input) => {
    links.push(new URL(input.acceptUrl).searchParams.get('token')!);
    return true;
  });
  vi.spyOn(emailService, 'sendHeadSuccessionOutcomeEmail').mockImplementation(async (input) => {
    outcomes.push({ to: input.to, outcome: input.outcome });
    return true;
  });
});

const PASSWORD = 'Password123';

function start(head: RegisteredContext, body: Record<string, unknown>) {
  return as(head.accessToken).post('/api/organizations/me/leadership-transfers', {
    reason: 'RETIREMENT',
    currentPassword: head.password,
    ...body,
  });
}

/** Starts and verifies a handover; returns its id and the successor's raw token. */
async function readyForAcceptance(head: RegisteredContext, body: Record<string, unknown>) {
  const started = await start(head, body);
  if (started.status !== 201) throw new Error(`start: ${started.status} ${JSON.stringify(started.body)}`);
  const id = started.body.data.id as string;
  const verified = await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/verify`, {
    code: codes.at(-1),
  });
  if (verified.status !== 200) throw new Error(`verify: ${verified.status} ${JSON.stringify(verified.body)}`);
  return { id, token: links.at(-1)! };
}

const accept = (token: string, password = PASSWORD, acknowledged: unknown = true) =>
  api().post('/api/auth/leadership-handover/accept').send({ token, password, acknowledged });

const validate = (token: string) => api().get(`/api/auth/leadership-handover/validate?token=${encodeURIComponent(token)}`);

describe('tenure history', () => {
  it('registration starts the founding Head tenure in the same transaction', async () => {
    const head = await registerOwner();
    const tenures = await prisma.organizationHeadTenure.findMany({ where: { organizationId: head.organizationId } });
    expect(tenures).toHaveLength(1);
    expect(tenures[0]).toMatchObject({ staffId: head.staffId, email: head.email, startType: 'FOUNDING', endedAt: null });
    const res = await as(head.accessToken).get('/api/organizations/me/leadership');
    expect(res.body.data.current).toMatchObject({ name: tenures[0]!.name });
    expect(res.body.data.previous).toEqual([]);
  });

  it('history rows cannot be edited or deleted while the organization exists', async () => {
    const head = await registerOwner();
    const tenure = await prisma.organizationHeadTenure.findFirstOrThrow({ where: { organizationId: head.organizationId } });
    await expect(prisma.organizationHeadTenure.update({ where: { id: tenure.id }, data: { name: 'Someone else' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.organizationHeadTenure.delete({ where: { id: tenure.id } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.organizationHeadTenure.create({
        data: { organizationId: head.organizationId, name: 'Second', email: 'x@example.com', startType: 'BACKFILL' },
      }),
    ).rejects.toThrow();
  });
});

describe('starting a handover', () => {
  it('requires the current Head’s password and an Other reason to be explained', async () => {
    const head = await registerOwner();
    const wrong = await start(head, { successorEmail: 'next@example.com', successorName: 'Next Head', currentPassword: 'wrong-pass1' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    // A wrong re-entered password never ends the session.
    expect((await as(head.accessToken).get('/api/auth/me')).status).toBe(200);
    const other = await start(head, { successorEmail: 'next@example.com', successorName: 'Next Head', reason: 'OTHER', note: 'short' });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('SUCCESSION_NOTE_REQUIRED');
    const noName = await start(head, { successorEmail: 'next@example.com' });
    expect(noName.body.error.code).toBe('SUCCESSOR_NAME_REQUIRED');
    expect(codes).toHaveLength(0);
  });

  it('only the Organization Head may start, verify or cancel', async () => {
    const ws = await adminWorkspace();
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    for (const token of [manager.accessToken, ws.admin.accessToken]) {
      const res = await as(token).post('/api/organizations/me/leadership-transfers', {
        successorEmail: 'x@example.com',
        successorName: 'X Person',
        reason: 'RETIREMENT',
        currentPassword: PASSWORD,
      });
      expect(res.status).toBe(403);
    }
  });

  it('emails a code and records only its hash; nothing changes yet', async () => {
    const head = await registerOwner();
    const res = await start(head, { successorEmail: 'Next@Example.com', successorName: 'Next Head' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'AWAITING_VERIFICATION', successor: { email: 'next@example.com' } });
    expect(codes).toHaveLength(1);
    const row = await prisma.headSuccession.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.verificationCodeHash).not.toContain(codes[0]);
    expect(JSON.stringify(row)).not.toContain(codes[0]!);
    expect(await prisma.staff.findUnique({ where: { email: 'next@example.com' } })).toBeNull();
    expect(links).toHaveLength(0);
  });

  it('only one handover may be open at a time', async () => {
    const head = await registerOwner();
    expect((await start(head, { successorEmail: 'a@example.com', successorName: 'A Person' })).status).toBe(201);
    const second = await start(head, { successorEmail: 'b@example.com', successorName: 'B Person' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('HEAD_SUCCESSION_ALREADY_PENDING');
  });

  it('refuses ineligible successors: Admin with a queue, invitee, suspended, another organization, the Head', async () => {
    const ws = await adminWorkspace();
    const invited = await as(ws.head.accessToken).post('/api/staff', {
      name: 'Invited Manager',
      email: `invited-${Date.now()}@example.com`,
      role: 'MANAGER',
    });
    const suspended = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    await prisma.staff.update({ where: { id: suspended.staffId }, data: { status: 'SUSPENDED' } });
    const outsider = await registerOwner();
    for (const email of [ws.admin.email, invited.body.data.email, suspended.email, outsider.email, ws.head.email]) {
      const res = await start(ws.head, { successorEmail: email, successorName: 'Someone' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('HEAD_SUCCESSOR_NOT_ELIGIBLE');
    }
  });
});

describe('verifying the code', () => {
  it('a wrong code counts down; five wrong codes end the handover', async () => {
    const head = await registerOwner();
    const started = await start(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const id = started.body.data.id;
    const wrongCode = codes[0] === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left--) {
      const res = await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/verify`, { code: wrongCode });
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual({ attemptsLeft: left });
    }
    const last = await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/verify`, { code: wrongCode });
    expect(last.status).toBe(429);
    expect((await prisma.headSuccession.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRED');
    // Even the right code no longer works, and a new handover may start.
    const late = await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/verify`, { code: codes[0] });
    expect(late.status).toBe(409);
    expect((await start(head, { successorEmail: 'n@example.com', successorName: 'N Person' })).status).toBe(201);
  });

  it('an expired code ends the handover', async () => {
    const head = await registerOwner();
    const started = await start(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    await prisma.headSuccession.update({
      where: { id: started.body.data.id },
      data: { verificationExpiresAt: new Date(Date.now() - 1000) },
    });
    const res = await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${started.body.data.id}/verify`, {
      code: codes[0],
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('HEAD_SUCCESSION_EXPIRED');
  });

  it('the right code sends the successor a one-time link (hash stored only)', async () => {
    const head = await registerOwner();
    const { id, token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const row = await prisma.headSuccession.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('AWAITING_ACCEPTANCE');
    expect(row.successorTokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    const expiresInHours = (row.successorTokenExpiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(expiresInHours).toBeGreaterThan(71.9);
    expect(expiresInHours).toBeLessThanOrEqual(72);
  });
});

describe('the successor accepts', () => {
  it('a new external successor becomes Head; the former Head loses everything at once', async () => {
    const head = await registerOwner({ organizationName: 'Handover Clinic' });
    await prisma.staff.update({ where: { id: head.staffId }, data: { name: 'Founding Head' } });
    const { id, token } = await readyForAcceptance(head, {
      successorEmail: 'new.head@example.com',
      successorName: 'New Head',
      reason: 'PERSONAL_REASONS',
      note: 'Private family matter, moving abroad',
    });

    const check = await validate(token);
    expect(check.body.data).toMatchObject({
      valid: true,
      organizationName: 'Handover Clinic',
      currentHeadName: 'Founding Head',
      reason: 'PERSONAL_REASONS',
      existingMember: false,
    });
    expect(check.body.data.acceptanceStatement).toContain('Organization Head of Handover Clinic');

    expect((await accept(token, PASSWORD, false)).status).toBe(422);
    expect((await accept(token, 'short')).status).toBe(422);
    const res = await accept(token);
    expect(res.status).toBe(200);

    // The former Head: account gone, every credential dead.
    expect(await prisma.staff.findUnique({ where: { id: head.staffId } })).toBeNull();
    expect((await as(head.accessToken).get('/api/auth/me')).status).toBe(401);
    expect((await api().post('/api/auth/refresh').send({ refreshToken: head.refreshToken })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: head.email, password: head.password })).status).toBe(401);
    // The successor: the only Head, signs in with the chosen password.
    const owners = await prisma.staff.findMany({ where: { organizationId: head.organizationId, role: 'OWNER' } });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ email: 'new.head@example.com', status: 'ACTIVE' });
    const login = await api().post('/api/auth/login').send({ email: 'new.head@example.com', password: PASSWORD });
    expect(login.status).toBe(200);

    // Tenures: the founding one closed with the reason; a new current one.
    const tenures = await prisma.organizationHeadTenure.findMany({
      where: { organizationId: head.organizationId },
      orderBy: { startedAt: 'asc' },
    });
    expect(tenures).toHaveLength(2);
    expect(tenures[0]).toMatchObject({ email: head.email, endReason: 'PERSONAL_REASONS', startType: 'FOUNDING' });
    expect(tenures[0]!.endedAt).not.toBeNull();
    expect(tenures[1]).toMatchObject({
      email: 'new.head@example.com',
      endedAt: null,
      startType: 'SUCCESSION',
      predecessorTenureId: tenures[0]!.id,
      successionId: id,
    });
    // Audit trail, written in the handover's transaction.
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: head.organizationId } })).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'head_succession_started',
        'head_succession_verified',
        'head_succession_completed',
        'head_tenure_ended',
        'head_tenure_started',
        'staff_sessions_revoked',
      ]),
    );
    // The link is spent, the record is final.
    expect((await validate(token)).body.data).toEqual({ valid: false });
    expect((await accept(token)).status).toBe(400);
    await expect(prisma.headSuccession.update({ where: { id }, data: { note: 'edited' } })).rejects.toThrow(/finished/);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['COMPLETED_FORMER', 'COMPLETED_NEW']);
    // The former Head's email is free again.
    const again = await api().post('/api/auth/register').send({
      organizationName: 'Second Venture',
      email: head.email,
      password: PASSWORD,
    });
    expect(again.status).toBe(201);
  });

  it('an existing Manager proves who they are with their own password', async () => {
    const head = await registerOwner();
    const manager = await createStaffWithRole(head.organizationId, 'MANAGER');
    const { token } = await readyForAcceptance(head, { successorEmail: manager.email });
    expect((await validate(token)).body.data.existingMember).toBe(true);
    const wrong = await accept(token, 'not-their-password1');
    expect(wrong.status).toBe(403);
    expect((await validate(token)).body.data.valid).toBe(true);
    const res = await accept(token, PASSWORD);
    expect(res.status).toBe(200);
    const promoted = await prisma.staff.findUniqueOrThrow({ where: { id: manager.staffId } });
    expect(promoted.role).toBe('OWNER');
    // Their existing session now carries Head authority.
    expect((await as(manager.accessToken).get('/api/organizations/me/leadership')).body.data.previous).toHaveLength(1);
    expect(await prisma.staff.count({ where: { email: manager.email } })).toBe(1);
  });

  it('an existing Executive becomes Head; their counter is released', async () => {
    const ws = await adminWorkspace();
    const { counterId, operator } = await executiveCounter(ws, 'Desk 2');
    const { token } = await readyForAcceptance(ws.head, { successorEmail: operator.email });
    expect((await accept(token, PASSWORD)).status).toBe(200);
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: operator.staffId } })).toMatchObject({
      role: 'OWNER',
      workspaceAdminId: null,
    });
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: counterId } })).staffId).toBeNull();
  });

  it('refuses if the successor no longer qualifies when they accept', async () => {
    const ws = await adminWorkspace();
    const exec = await executiveOf(ws);
    const { token } = await readyForAcceptance(ws.head, { successorEmail: exec.email });
    await prisma.staff.update({ where: { id: exec.staffId }, data: { status: 'SUSPENDED' } });
    const res = await accept(token, PASSWORD);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HEAD_SUCCESSOR_NOT_ELIGIBLE');
    expect(await prisma.staff.findUnique({ where: { id: ws.head.staffId } })).not.toBeNull();
  });

  it('refuses while the former Head is serving someone — nothing changes', async () => {
    const head = await registerOwner();
    const svcWs = await adminWorkspace(head);
    const svc = await addService(svcWs.admin.accessToken, svcWs.queueId, 'Desk');
    // Give the Head a counter of their own and someone in service there.
    await prisma.counter.update({ where: { id: svcWs.firstCounterId }, data: { staffId: null, status: 'OFFLINE' } });
    await prisma.counter.update({ where: { id: svcWs.firstCounterId }, data: { staffId: head.staffId, status: 'ACTIVE' } });
    await join(svcWs.queueId, [svc]);
    const serving = await prisma.token.findFirstOrThrow({ where: { queueId: svcWs.queueId } });
    await prisma.token.update({ where: { id: serving.id }, data: { status: 'IN_PROGRESS', counterId: svcWs.firstCounterId } });
    const { token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const res = await accept(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_HAS_ACTIVE_SERVICE');
    expect(await prisma.staff.findUnique({ where: { id: head.staffId } })).not.toBeNull();
    expect((await prisma.headSuccession.findFirstOrThrow()).status).toBe('AWAITING_ACCEPTANCE');
  });

  it('two simultaneous acceptances: exactly one succeeds', async () => {
    const head = await registerOwner();
    const { token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const results = await Promise.all([accept(token), accept(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.staff.count({ where: { organizationId: head.organizationId, role: 'OWNER' } })).toBe(1);
    expect(await prisma.organizationHeadTenure.count({ where: { organizationId: head.organizationId, endedAt: null } })).toBe(1);
  });

  it('cancel and accept at once: exactly one wins, never both', async () => {
    const head = await registerOwner();
    const { id, token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const [cancelled, accepted] = await Promise.all([
      as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/cancel`),
      accept(token),
    ]);
    const row = await prisma.headSuccession.findUniqueOrThrow({ where: { id } });
    if (accepted.status === 200) {
      expect(row.status).toBe('COMPLETED');
      expect(cancelled.status).not.toBe(200);
    } else {
      expect(cancelled.status).toBe(200);
      expect(row.status).toBe('CANCELLED');
      expect(await prisma.staff.findUnique({ where: { id: head.staffId } })).not.toBeNull();
    }
  });
});

describe('cancel, decline and expiry', () => {
  it('the Head can cancel before acceptance; the link stops working', async () => {
    const head = await registerOwner();
    const { id, token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const res = await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await validate(token)).body.data.valid).toBe(false);
    expect((await accept(token)).status).toBe(400);
    expect((await as(head.accessToken).post(`/api/organizations/me/leadership-transfers/${id}/cancel`)).status).toBe(409);
  });

  it('the successor can decline; the Head is told', async () => {
    const head = await registerOwner();
    const { id, token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const res = await api().post('/api/auth/leadership-handover/decline').send({ token });
    expect(res.status).toBe(200);
    expect((await prisma.headSuccession.findUniqueOrThrow({ where: { id } })).status).toBe('DECLINED');
    expect(outcomes).toEqual([{ to: head.email, outcome: 'DECLINED' }]);
    expect((await accept(token)).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'head_succession_declined' } })).toBe(1);
  });

  it('a lapsed link is unusable and the handover expires', async () => {
    const head = await registerOwner();
    const { id, token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    await prisma.headSuccession.update({ where: { id }, data: { successorTokenExpiresAt: new Date(Date.now() - 1000) } });
    expect((await validate(token)).body.data.valid).toBe(false);
    const res = await accept(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('HEAD_SUCCESSION_INVALID');
    expect((await prisma.headSuccession.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRED');
    expect(await prisma.staff.findUnique({ where: { id: head.staffId } })).not.toBeNull();
  });

  it('unknown links say nothing about why', async () => {
    expect((await validate('made-up-token')).body.data).toEqual({ valid: false });
    const res = await accept('made-up-token');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('This handover link has expired or is no longer valid.');
  });

  it('deleting the organization during a pending handover removes it cleanly', async () => {
    const head = await registerOwner({ organizationName: 'Going Away' });
    const other = await registerOwner({ organizationName: 'Staying Here' });
    const otherAudit = await prisma.auditLog.count({ where: { organizationId: other.organizationId } });
    const { token } = await readyForAcceptance(head, { successorEmail: 'n@example.com', successorName: 'N Person' });
    const res = await as(head.accessToken).delete('/api/organizations/me', { confirmName: 'Going Away' });
    expect(res.status).toBe(204);
    expect((await validate(token)).body.data.valid).toBe(false);
    expect(await prisma.headSuccession.count({ where: { organizationId: head.organizationId } })).toBe(0);
    expect(await prisma.organizationHeadTenure.count({ where: { organizationId: head.organizationId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: head.organizationId } })).toBe(0);
    // Only the minimal receipt remains — and nothing of the other organization changed.
    const receipts = await prisma.organizationDeletionReceipt.findMany({ where: { organizationId: head.organizationId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ organizationName: 'Going Away', deletedByStaffId: head.staffId, deletedByEmail: head.email });
    expect(await prisma.auditLog.count({ where: { organizationId: other.organizationId } })).toBe(otherAudit);
    expect(await prisma.organizationHeadTenure.count({ where: { organizationId: other.organizationId } })).toBe(1);
    await expect(
      prisma.organizationDeletionReceipt.update({ where: { id: receipts[0]!.id }, data: { organizationName: 'x' } }),
    ).rejects.toThrow(/permanent/);
  });
});

describe('who sees the leadership history (D5)', () => {
  it('the Head sees reasons and private notes; a Manager sees reasons only; others see the current Head only', async () => {
    const head = await registerOwner();
    const manager = await createStaffWithRole(head.organizationId, 'MANAGER');
    const admin = await createStaffWithRole(head.organizationId, 'ADMIN');
    const { token } = await readyForAcceptance(head, {
      successorEmail: 'n@example.com',
      successorName: 'N Person',
      reason: 'PERSONAL_REASONS',
      note: 'Private family matter, moving abroad',
    });
    expect((await accept(token)).status).toBe(200);
    const newHead = await api().post('/api/auth/login').send({ email: 'n@example.com', password: PASSWORD });

    const asHead = await as(newHead.body.data.accessToken).get('/api/organizations/me/leadership');
    expect(asHead.body.data.current.name).toBe('N Person');
    expect(asHead.body.data.previous[0]).toMatchObject({ reason: 'PERSONAL_REASONS', note: 'Private family matter, moving abroad' });

    const asManager = await as(manager.accessToken).get('/api/organizations/me/leadership');
    expect(asManager.body.data.previous[0].reason).toBe('PERSONAL_REASONS');
    expect(asManager.body.data.previous[0]).not.toHaveProperty('note');
    expect(asManager.body.data.succession).toBeNull();

    const asAdmin = await as(admin.accessToken).get('/api/organizations/me/leadership');
    expect(asAdmin.body.data).toEqual({ current: { name: 'N Person', since: expect.any(String) }, previous: null, succession: null });
  });
});
