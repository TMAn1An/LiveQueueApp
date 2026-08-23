import { beforeEach, describe, expect, it } from 'vitest';
import { api, createRestrictedStaff, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

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
      permissions: overrides.permissions ?? ['operate_tokens'],
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

  it('rejects an invalid permission string', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, { permissions: ['not_a_real_permission'] });

    expect(res.status).toBe(422);
  });

  it('rejects a weak password', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, { password: 'short' });

    expect(res.status).toBe(422);
  });

  it('requires manage_staff permission', async () => {
    const ctx = await registerOwner();
    const restricted = await createRestrictedStaff(ctx.organizationId, ['operate_tokens']);

    const res = await createStaff(restricted.accessToken);

    expect(res.status).toBe(403);
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
    const restricted = await createRestrictedStaff(ctx.organizationId, []);

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
  it('updates name, role, permissions, and status', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken);

    const res = await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed', role: 'ACCOUNTANT', permissions: ['view_reports'], status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
    expect(res.body.data.role).toBe('ACCOUNTANT');
    expect(res.body.data.permissions).toEqual(['view_reports']);
    expect(res.body.data.status).toBe('SUSPENDED');
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

  it('requires manage_staff permission', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId, []);

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

describe('Permission escalation (Phase 6 pre-commit review finding)', () => {
  it('POST /api/staff rejects granting a permission the caller does not have', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

    const res = await createStaff(limited.accessToken, {
      email: 'backdoor@example.com',
      permissions: ['manage_organization'],
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_ESCALATION_DENIED');
  });

  it('POST /api/staff allows granting only permissions the caller already has', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff', 'operate_tokens']);

    const res = await createStaff(limited.accessToken, {
      email: 'legit-hire@example.com',
      permissions: ['operate_tokens'],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual(['operate_tokens']);
  });

  it('PUT /api/staff/:staffId rejects a caller granting themselves a permission they do not have', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

    const res = await api()
      .put(`/api/staff/${limited.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ permissions: ['manage_staff', 'manage_organization'] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_ESCALATION_DENIED');

    const check = await api()
      .get(`/api/staff/${limited.staffId}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(check.body.data.permissions).toEqual(['manage_staff']);
  });

  it('PUT /api/staff/:staffId rejects a caller granting another staff member a permission the caller lacks', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);
    const target = await createStaff(ctx.accessToken, { permissions: ['operate_tokens'] });

    const res = await api()
      .put(`/api/staff/${target.body.data.id}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ permissions: ['operate_tokens', 'export_reports'] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_ESCALATION_DENIED');
  });

  it('PUT /api/staff/:staffId allows a caller to grant a subset of their own permissions to another staff member', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, [
      'manage_staff',
      'operate_tokens',
      'view_reports',
    ]);
    const target = await createStaff(ctx.accessToken, { permissions: [] });

    const res = await api()
      .put(`/api/staff/${target.body.data.id}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ permissions: ['operate_tokens'] });

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual(['operate_tokens']);
  });

  it('PUT /api/staff/:staffId allows updates that do not touch permissions, regardless of the caller\'s own permission set', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);
    const target = await createStaff(ctx.accessToken, { permissions: ['manage_organization'] });

    const res = await api()
      .put(`/api/staff/${target.body.data.id}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ name: 'Renamed By Limited Admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed By Limited Admin');
    // The untouched permissions field is unaffected — this was never a grant.
    expect(res.body.data.permissions).toEqual(['manage_organization']);
  });

  it('the owner (holding every permission) can still grant any permission — no regression', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, {
      email: 'full-grant@example.com',
      permissions: ['manage_organization', 'manage_staff', 'manage_blocked_devices', 'export_reports'],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual([
      'manage_organization',
      'manage_staff',
      'manage_blocked_devices',
      'export_reports',
    ]);
  });
});

describe('Owner protection on update (Phase 6 pre-commit review finding)', () => {
  it('rejects a normal staff member suspending the owner via PUT', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it('rejects a normal staff member demoting the owner\'s role via PUT', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it("rejects a normal staff member stripping the owner's permissions via PUT", async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ permissions: [] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it('rejects even a benign field (name) change to the owner via PUT — the whole operation is blocked', async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

    const res = await api()
      .put(`/api/staff/${ctx.staffId}`)
      .set('Authorization', `Bearer ${limited.accessToken}`)
      .send({ name: 'Hijacked Name' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it("leaves the owner's record completely unchanged in the database after a blocked attempt", async () => {
    const ctx = await registerOwner();
    const limited = await createRestrictedStaff(ctx.organizationId, ['manage_staff']);

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

  it('requires manage_staff permission', async () => {
    const ctx = await registerOwner();
    const created = await createStaff(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId, []);

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
