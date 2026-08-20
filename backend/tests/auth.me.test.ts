import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

describe('GET /api/auth/me', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns the authenticated staff, organization, and permissions', async () => {
    const ctx = await registerOwner();

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.staff.id).toBe(ctx.staffId);
    expect(res.body.data.organization.id).toBe(ctx.organizationId);
    expect(res.body.data.permissions).toContain('manage_queues');
  });

  it('rejects a missing Authorization header with 401', async () => {
    const res = await api().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed token with 401', async () => {
    const res = await api().get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired token with 401 TOKEN_EXPIRED', async () => {
    const ctx = await registerOwner();
    const expiredToken = jwt.sign(
      { sub: ctx.staffId, organizationId: ctx.organizationId, role: 'OWNER' },
      process.env.JWT_SECRET as string,
      { expiresIn: -10 },
    );

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects tokens for a suspended staff account', async () => {
    const ctx = await registerOwner();
    await prisma.staff.update({ where: { id: ctx.staffId }, data: { status: 'SUSPENDED' } });

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(401);
  });
});
