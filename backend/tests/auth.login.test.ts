import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('logs in with valid credentials and updates lastLoginAt', async () => {
    const ctx = await registerOwner({ email: 'login@example.com', password: 'Password123' });

    const res = await api().post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.staff.id).toBe(ctx.staffId);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.staff.lastLoginAt).not.toBeNull();
  });

  it('rejects an incorrect password with 401 and a generic message', async () => {
    await registerOwner({ email: 'wrongpw@example.com', password: 'Password123' });

    const res = await api().post('/api/auth/login').send({
      email: 'wrongpw@example.com',
      password: 'WrongPassword1',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a non-existent email with the same generic 401', async () => {
    const res = await api().post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login for a suspended staff account', async () => {
    const ctx = await registerOwner({ email: 'suspended@example.com', password: 'Password123' });
    await prisma.staff.update({ where: { id: ctx.staffId }, data: { status: 'SUSPENDED' } });

    const res = await api().post('/api/auth/login').send({
      email: 'suspended@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects login when the organization is suspended', async () => {
    const ctx = await registerOwner({ email: 'orgsuspended@example.com', password: 'Password123' });
    await prisma.organization.update({
      where: { id: ctx.organizationId },
      data: { status: 'SUSPENDED' },
    });

    const res = await api().post('/api/auth/login').send({
      email: 'orgsuspended@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORGANIZATION_SUSPENDED');
  });
});
