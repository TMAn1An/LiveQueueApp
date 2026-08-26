import { beforeEach, describe, expect, it } from 'vitest';
import { api, createRestrictedStaff, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { STAFF_PERMISSIONS, ADMIN_PERMISSIONS } from '../src/constants/permissions';

beforeEach(async () => {
  await resetDb();
});

async function createStaff(
  accessToken: string,
  overrides: Record<string, unknown> = {},
) {
  return api()
    .post('/api/staff')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: overrides.name ?? 'Jane Staff',
      email: overrides.email ?? `staff-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: overrides.password ?? 'Password123',
      role: overrides.role ?? 'ADMIN',
      ...overrides,
    });
}

describe('POST /api/staff', () => {
  it('creates a staff member and never returns a password hash', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, { email: 'new-staff@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('new-staff@example.com');
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate email (global uniqueness, ADR-005)', async () => {
    const ctx = await registerOwner();
    await createStaff(ctx.accessToken, { email: 'dup@example.com' });

    const res = await createStaff(ctx.accessToken, { email: 'dup@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects creating a second OWNER', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, { role: 'OWNER' });

    expect(res.status).toBe(422);
  });

  it('rejects a weak password', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, { password: 'short' });

    expect(res.status).toBe(422);
  });

  it('requires manage_staff permission (STAFF does not have it)', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await createStaff(restricted.accessToken);

    expect(res.status).toBe(403);
  });

  it('creates staff with the full role-derived permission set, ignoring any client-supplied permissions field', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, {
      role: 'STAFF',
      permissions: ['manage_organization', 'manage_staff'],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('STAFF');
    expect(res.body.data.permissions.sort()).toEqual([...STAFF_PERMISSIONS].sort());
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().post('/api/staff').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/staff', () => {
  it('lists staff for the organization, paginated', async () => {
    const ctx = await registerOwner();
    await createStaff(ctx.accessToken);
    await createStaff(ctx.accessToken);

    const res = await api().get('/api/staff').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    // Owner + 2 created staff
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 20, total: 3 });
  });

  it('any authenticated staff member may list (read-only convention)', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api().get('/api/staff').set('Authorization', `Bearer ${restricted.accessToken}`);

    expect(res.status).toBe(200);
  });

  it("does not leak another organization's staff", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    await createStaff(orgB.accessToken);

    const res = await api().get('/api/staff').set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1); // only Org A's owner
  });
});

describe('GET /api/staff/:staffId', () => {
  it("rejects direct-id access to another organization's staff", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const created = await createStaff(orgB.accessToken);

    const res = await api()
      .get(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/staff/:staffId', () => {
  it('updates name and status, and re-derives permissions when role changes (frozen RBAC policy)', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken, { role: 'ADMIN' });

    const res = await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed', role: 'STAFF', status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
    expect(res.body.data.role).toBe('STAFF');
    expect(res.body.data.permissions.sort()).toEqual([...STAFF_PERMISSIONS].sort());
    expect(res.body.data.status).toBe('SUSPENDED');
  });

  it('ADMIN -> STAFF role change leaves no stale Admin-only access behind', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken, { role: 'ADMIN' });
    const password = 'Password123';
    await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ password });

    await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ role: 'STAFF' });

    const loginRes = await api()
      .post('/api/auth/login')
      .send({ email: created.body.data.email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.permissions.sort()).toEqual([...STAFF_PERMISSIONS].sort());

    const staffRes = await api()
      .post('/api/staff')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .send({ name: 'X', email: 'blocked@example.com', password: 'Password123', role: 'STAFF' });
    expect(staffRes.status).toBe(403);
  });

  it('STAFF -> ADMIN role change grants the complete Admin permission set', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken, { role: 'STAFF' });
    const password = 'Password123';
    await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ password });

    await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ role: 'ADMIN' });

    const loginRes = await api()
      .post('/api/auth/login')
      .send({ email: created.body.data.email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.permissions.sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });

  it('suspended staff cannot log in after being suspended via this endpoint', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken, {
      email: 'to-suspend@example.com',
      password: 'Password123',
    });

    await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'SUSPENDED' });

    const loginRes = await api()
      .post('/api/auth/login')
      .send({ email: 'to-suspend@example.com', password: 'Password123' });

    expect(loginRes.status).toBe(403);
    expect(loginRes.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('requires manage_staff permission (STAFF does not have it)', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ name: 'X' });

    expect(res.status).toBe(403);
  });

  it("rejects updating another organization's staff by id", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const created = await createStaff(orgB.accessToken);

    const res = await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
  });

  it('rejects changing email to one already used by another staff member', async () => {
    const ctx = await registerOwner();
    const first = await createStaff(ctx.accessToken, { email: 'first@example.com' });
    const second = await createStaff(ctx.accessToken, { email: 'second@example.com' });

    const res = await api()
      .put(`/api/staff/${second.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ email: 'first@example.com' });

    expect(res.status).toBe(409);
    void first;
  });
});

describe('Permission escalation (frozen RBAC policy — permissions are role-derived, not client-suppliable)', () => {
  it('POST /api/staff ignores a client-supplied permissions field entirely — role alone determines the result', async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'STAFF');

    // STAFF lacks manage_staff, so this is rejected at the route layer
    // regardless of what's in the body — but even an OWNER-issued create
    // with a rigged permissions array (below) cannot escalate a role.
    const deniedRes = await createStaff(limited.accessToken, {
      email: 'backdoor@example.com',
      permissions: ['manage_organization'],
    });
    expect(deniedRes.status).toBe(403);

    const res = await createStaff(ctx.accessToken, {
      email: 'legit-hire@example.com',
      role: 'STAFF',
      permissions: ['manage_organization', 'manage_staff'],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('STAFF');
    expect(res.body.data.permissions.sort()).toEqual([...STAFF_PERMISSIONS].sort());
  });

  it('PUT /api/staff/:staffId ignores a caller granting themselves an out-of-role permission', async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'STAFF');

    // STAFF lacks manage_staff, so this self-edit is rejected before
    // any permissions field would even be considered.
    const res = await api()
      .put(`/api/staff/${limited.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ permissions: ['manage_staff', 'manage_organization'] });

    expect(res.status).toBe(403);

    const check = await api()
      .get(`/api/staff/${limited.staffId}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(check.body.data.permissions.sort()).toEqual([...STAFF_PERMISSIONS].sort());
  });

  it('PUT /api/staff/:staffId ignores a permissions field even from a caller who holds manage_staff (ADMIN)', async () => {
    const ctx = await registerOwner();
    const admin = await createStaffWithRole(ctx.organizationId, 'ADMIN');
    const target = await createStaff(ctx.accessToken, { role: 'STAFF' });

    const res = await api()
      .put(`/api/staff/${target.body.data.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ permissions: ['manage_organization', 'manage_staff'], name: 'Still An Accountant' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Still An Accountant');
    expect(res.body.data.role).toBe('STAFF');
    // The supplied permissions array is silently ignored — role is authoritative.
    expect(res.body.data.permissions.sort()).toEqual([...STAFF_PERMISSIONS].sort());
  });

  it('the owner retains the full permission set regardless of any request body content', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, {
      email: 'full-grant@example.com',
      role: 'ADMIN',
      permissions: ['operate_tokens'],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.data.permissions.sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });
});

describe('Owner protection on update — ADMIN must never demote/modify the OWNER', () => {
  it('rejects an STAFF reaching the owner at all (no manage_staff)', async () => {
    const ctx = await registerOwner();
    const accountant = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
  });

  it('rejects an ADMIN (full manage_staff) suspending the owner via PUT', async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it('rejects a normal staff member demoting the owner\'s role via PUT', async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it("rejects a normal staff member stripping the owner's permissions via PUT", async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ permissions: [] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it('rejects even a benign field (name) change to the owner via PUT — the whole operation is blocked', async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ name: 'Hijacked Name' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it("leaves the owner's record completely unchanged in the database after a blocked attempt", async () => {
    const ctx = await registerOwner();
    const limited = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ status: 'SUSPENDED', role: 'ADMIN', permissions: [], name: 'Hijacked' });

    const check = await api()
      .get(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(check.body.data.status).toBe('ACTIVE');
    expect(check.body.data.role).toBe('OWNER');

    // The owner can still log in normally — proof the attempted suspension never took effect.
    const loginRes = await api().post('/api/auth/login').send({ email: ctx.email, password: ctx.password });
    expect(loginRes.status).toBe(200);
  });

  it('an org B staff member cannot reach org A\'s owner at all (tenant isolation still intact)', async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });

    const res = await api()
      .put(`/api/staff/${orgA.staffId}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ status: 'SUSPENDED' });

    // 404, not 403 — tenant scoping happens before the owner check, so a
    // cross-org caller never learns the target is even an owner.
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/staff/:staffId', () => {
  it('deletes a non-owner staff member', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken);

    const res = await api()
      .delete(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(204);

    const getRes = await api()
      .get(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(getRes.status).toBe(404);
  });

  it('rejects deleting the organization owner (spec 7.3)', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .delete(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_DELETE_OWNER');
  });

  it('rejects an ADMIN (full manage_staff) deleting the OWNER', async () => {
    const ctx = await registerOwner();
    const admin = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await api()
      .delete(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_DELETE_OWNER');

    const stillThere = await api()
      .get(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data.role).toBe('OWNER');
  });

  it('requires manage_staff permission (STAFF does not have it)', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .delete(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${restricted.accessToken}`);

    expect(res.status).toBe(403);
  });

  it("rejects deleting another organization's staff by id", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const created = await createStaff(orgB.accessToken);

    const res = await api()
      .delete(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(404);
  });
});
