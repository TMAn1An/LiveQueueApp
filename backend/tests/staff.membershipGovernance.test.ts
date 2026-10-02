import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * ADR-057: who may end whose membership. Nobody removes themselves; the owner
 * removes admins and staff directly; an admin removes staff directly and asks
 * the owner about admins (including themselves); staff may only ask to leave.
 */

beforeEach(async () => {
  await resetDb();
});

async function setup() {
  const owner = await registerOwner();
  const admin = await createStaffWithRole(owner.organizationId, 'ADMIN');
  const admin2 = await createStaffWithRole(owner.organizationId, 'ADMIN');
  const staff = await createStaffWithRole(owner.organizationId, 'STAFF');
  const staff2 = await createStaffWithRole(owner.organizationId, 'STAFF');
  return { owner, admin, admin2, staff, staff2 };
}

const remove = (accessToken: string, staffId: string) =>
  api().delete(`/api/staff/${staffId}`).set('Authorization', `Bearer ${accessToken}`);

const request = (accessToken: string, targetStaffId: string, reason?: string) =>
  api()
    .post('/api/staff/removal-requests')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ targetStaffId, ...(reason ? { reason } : {}) });

const review = (accessToken: string, requestId: string, decision: 'approve' | 'reject' | 'cancel', body = {}) =>
  api()
    .post(`/api/staff/removal-requests/${requestId}/${decision}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const exists = async (staffId: string) => (await prisma.staff.count({ where: { id: staffId } })) === 1;

describe('ADR-057 — nobody removes themselves directly', () => {
  it('owner, admin and staff are each refused with CANNOT_REMOVE_SELF or FORBIDDEN', async () => {
    const { owner, admin, staff } = await setup();

    const o = await remove(owner.accessToken, owner.staffId);
    expect(o.status).toBe(403);
    expect(o.body.error.code).toBe('CANNOT_REMOVE_SELF');

    const a = await remove(admin.accessToken, admin.staffId);
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe('CANNOT_REMOVE_SELF');

    // STAFF lacks manage_staff altogether.
    const s = await remove(staff.accessToken, staff.staffId);
    expect(s.status).toBe(403);

    for (const id of [owner.staffId, admin.staffId, staff.staffId]) {
      expect(await exists(id)).toBe(true);
    }
  });
});

describe('ADR-057 — direct removal', () => {
  it('the owner removes an admin and a staff member', async () => {
    const { owner, admin, staff } = await setup();
    expect((await remove(owner.accessToken, admin.staffId)).status).toBe(204);
    expect((await remove(owner.accessToken, staff.staffId)).status).toBe(204);
    expect(await exists(admin.staffId)).toBe(false);
    expect(await exists(staff.staffId)).toBe(false);
  });

  it('an admin removes a staff member', async () => {
    const { admin, staff } = await setup();
    expect((await remove(admin.accessToken, staff.staffId)).status).toBe(204);
    expect(await exists(staff.staffId)).toBe(false);
  });

  it('an admin cannot directly remove another admin, or the owner', async () => {
    const { owner, admin, admin2 } = await setup();
    const res = await remove(admin.accessToken, admin2.staffId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REMOVAL_REQUIRES_OWNER_APPROVAL');
    expect(await exists(admin2.staffId)).toBe(true);

    const ownerRes = await remove(admin.accessToken, owner.staffId);
    expect(ownerRes.status).toBe(403);
    expect(ownerRes.body.error.code).toBe('CANNOT_DELETE_OWNER');
  });

  it('staff cannot remove anyone', async () => {
    const { staff, staff2 } = await setup();
    expect((await remove(staff.accessToken, staff2.staffId)).status).toBe(403);
    expect(await exists(staff2.staffId)).toBe(true);
  });

  it('a removed member is signed out everywhere at once — access and refresh', async () => {
    const { owner, staff } = await setup();
    const login = await api()
      .post('/api/auth/login')
      .send({ email: (await prisma.staff.findUniqueOrThrow({ where: { id: staff.staffId } })).email, password: 'Password123' });
    expect(login.status).toBe(200);
    expect(await prisma.session.count({ where: { staffId: staff.staffId } })).toBeGreaterThan(0);

    expect((await remove(owner.accessToken, staff.staffId)).status).toBe(204);

    expect(await prisma.session.count({ where: { staffId: staff.staffId } })).toBe(0);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(me.status).toBe(401);
    const refresh = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('is audited as staff_removed', async () => {
    const { owner, staff } = await setup();
    await remove(owner.accessToken, staff.staffId);
    // The audit row is written after the response is sent, so wait for it.
    const row = await vi.waitFor(async () => {
      const found = await prisma.auditLog.findFirst({ where: { action: 'staff_removed', entityId: staff.staffId } });
      expect(found).not.toBeNull();
      return found!;
    });
    expect(row.staffId).toBe(owner.staffId);
  });
});

describe('ADR-057 — removal and leave requests', () => {
  it('an admin may request to leave, and may request removal of another admin', async () => {
    const { admin, admin2 } = await setup();
    const leave = await request(admin.accessToken, admin.staffId, 'Moving on');
    expect(leave.status).toBe(201);
    expect(leave.body.data).toMatchObject({ requestType: 'SELF_LEAVE', status: 'PENDING', reason: 'Moving on' });

    const other = await request(admin.accessToken, admin2.staffId);
    expect(other.status).toBe(201);
    expect(other.body.data.requestType).toBe('ADMIN_REMOVAL_REQUEST');
    expect(other.body.data.target).toMatchObject({ id: admin2.staffId, role: 'ADMIN' });
  });

  it('staff may request to leave, and nothing else', async () => {
    const { owner, admin, staff, staff2 } = await setup();
    const leave = await request(staff.accessToken, staff.staffId);
    expect(leave.status).toBe(201);
    expect(leave.body.data.requestType).toBe('SELF_LEAVE');

    for (const target of [staff2.staffId, admin.staffId]) {
      const res = await request(staff.accessToken, target);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const ownerRes = await request(staff.accessToken, owner.staffId);
    expect(ownerRes.status).toBe(403);
  });

  it('nobody may request removal of the owner', async () => {
    const { owner, admin } = await setup();
    const res = await request(admin.accessToken, owner.staffId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_REQUEST_OWNER_REMOVAL');
  });

  it('an admin asking about a staff member is told to remove them directly', async () => {
    const { admin, staff } = await setup();
    const res = await request(admin.accessToken, staff.staffId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REMOVAL_REQUEST_NOT_NEEDED');
  });

  it('the owner never files requests — they remove directly, and cannot leave', async () => {
    const { owner, admin } = await setup();
    expect((await request(owner.accessToken, admin.staffId)).body.error.code).toBe('OWNER_REMOVES_DIRECTLY');
    expect((await request(owner.accessToken, owner.staffId)).body.error.code).toBe('CANNOT_REMOVE_SELF');
  });

  it('only one request per target and type may be pending', async () => {
    const { admin, admin2, staff } = await setup();
    expect((await request(staff.accessToken, staff.staffId)).status).toBe(201);
    const dup = await request(staff.accessToken, staff.staffId);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REMOVAL_REQUEST_ALREADY_PENDING');

    // Two admins asking about the same admin share one pending slot.
    const first = await request(admin.accessToken, admin2.staffId);
    expect(first.status).toBe(201);
    const third = await createStaffWithRole(admin.organizationId, 'ADMIN');
    expect((await request(third.accessToken, admin2.staffId)).status).toBe(409);
  });

  it('a request cannot target another organization', async () => {
    const { admin } = await setup();
    const other = await registerOwner();
    const outsider = await createStaffWithRole(other.organizationId, 'ADMIN');
    expect((await request(admin.accessToken, outsider.staffId)).status).toBe(404);
  });

  it('the type is derived by the server — a client-supplied type is refused', async () => {
    const { staff } = await setup();
    const res = await api()
      .post('/api/staff/removal-requests')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ targetStaffId: staff.staffId, requestType: 'ADMIN_REMOVAL_REQUEST' });
    expect(res.status).toBe(422);
  });

  it('rejects a non-Latin reason (ADR-056)', async () => {
    const { staff } = await setup();
    expect((await request(staff.accessToken, staff.staffId, 'ছুটি')).status).toBe(422);
  });
});

describe('ADR-057 — owner review', () => {
  it('approving removes the member transactionally, revokes their sessions and audits both', async () => {
    const { owner, admin, admin2 } = await setup();
    const created = await request(admin.accessToken, admin2.staffId, 'Left the company');

    const res = await review(owner.accessToken, created.body.data.id, 'approve', { reviewNote: 'Confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'APPROVED',
      reviewNote: 'Confirmed',
      reviewedBy: { id: owner.staffId },
    });
    expect(await exists(admin2.staffId)).toBe(false);
    expect(await prisma.session.count({ where: { staffId: admin2.staffId } })).toBe(0);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${admin2.accessToken}`);
    expect(me.status).toBe(401);

    await vi.waitFor(async () => {
      const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining(['membership_request_created', 'membership_request_approved', 'staff_removed']),
      );
    });
  });

  it('approving a self-leave removes the requester', async () => {
    const { owner, staff } = await setup();
    const created = await request(staff.accessToken, staff.staffId);
    expect((await review(owner.accessToken, created.body.data.id, 'approve')).status).toBe(200);
    expect(await exists(staff.staffId)).toBe(false);
  });

  it('rejecting keeps the member and closes the request', async () => {
    const { owner, staff } = await setup();
    const created = await request(staff.accessToken, staff.staffId);
    const res = await review(owner.accessToken, created.body.data.id, 'reject', { reviewNote: 'Please stay' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect(await exists(staff.staffId)).toBe(true);

    // The slot is free again: a new request can be made.
    expect((await request(staff.accessToken, staff.staffId)).status).toBe(201);
  });

  it('only the owner may approve or reject', async () => {
    const { admin, admin2, staff } = await setup();
    const created = await request(staff.accessToken, staff.staffId);
    for (const actor of [admin, admin2, staff]) {
      for (const decision of ['approve', 'reject'] as const) {
        const res = await review(actor.accessToken, created.body.data.id, decision);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('OWNER_ONLY');
      }
    }
    expect(await exists(staff.staffId)).toBe(true);
  });

  it('a closed request cannot be decided again', async () => {
    const { owner, staff } = await setup();
    const created = await request(staff.accessToken, staff.staffId);
    await review(owner.accessToken, created.body.data.id, 'reject');
    const again = await review(owner.accessToken, created.body.data.id, 'approve');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REMOVAL_REQUEST_NOT_PENDING');
    expect(await exists(staff.staffId)).toBe(true);
  });

  it('concurrent approve and reject: exactly one decision wins', async () => {
    const { owner, staff } = await setup();
    const created = await request(staff.accessToken, staff.staffId);
    const [a, b] = await Promise.all([
      review(owner.accessToken, created.body.data.id, 'approve'),
      review(owner.accessToken, created.body.data.id, 'reject'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('the requester may withdraw a pending request; nobody else may', async () => {
    const { admin, admin2 } = await setup();
    const created = await request(admin.accessToken, admin.staffId);
    expect((await review(admin2.accessToken, created.body.data.id, 'cancel')).status).toBe(403);
    const res = await review(admin.accessToken, created.body.data.id, 'cancel');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('removing someone directly closes their open requests as moot', async () => {
    const { owner, admin, staff } = await setup();
    const created = await request(staff.accessToken, staff.staffId);
    expect((await remove(admin.accessToken, staff.staffId)).status).toBe(204);
    const row = await prisma.membershipRemovalRequest.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row.status).toBe('CANCELLED');
    expect((await review(owner.accessToken, created.body.data.id, 'approve')).status).toBe(409);
  });

  it('the owner sees every request; others see only their own and those about them', async () => {
    const { owner, admin, admin2, staff } = await setup();
    await request(staff.accessToken, staff.staffId);
    await request(admin.accessToken, admin2.staffId);

    const list = (token: string) =>
      api().get('/api/staff/removal-requests').set('Authorization', `Bearer ${token}`);
    expect((await list(owner.accessToken)).body.data).toHaveLength(2);
    expect((await list(staff.accessToken)).body.data).toHaveLength(1);
    expect((await list(admin2.accessToken)).body.data).toHaveLength(1);
    const pending = await api()
      .get('/api/staff/removal-requests?status=REJECTED')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(pending.body.data).toHaveLength(0);
  });
});
