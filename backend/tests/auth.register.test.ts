import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './helpers/app';
import { resetDb } from './helpers/db';

describe('POST /api/auth/register', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates an organization and an OWNER staff account with full permissions', async () => {
    const res = await api().post('/api/auth/register').send({
      organizationName: 'Acme Clinic',
      email: 'Owner@Example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.organization.name).toBe('Acme Clinic');
    expect(res.body.data.staff.role).toBe('OWNER');
    expect(res.body.data.staff.email).toBe('owner@example.com');
    expect(res.body.data.permissions).toContain('manage_staff');
    expect(res.body.data.permissions).toContain('operate_tokens');
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.staff.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email with 409', async () => {
    await api().post('/api/auth/register').send({
      organizationName: 'Acme Clinic',
      email: 'dup@example.com',
      password: 'Password123',
    });

    const res = await api().post('/api/auth/register').send({
      organizationName: 'Other Org',
      email: 'dup@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a weak password with 422', async () => {
    const res = await api().post('/api/auth/register').send({
      organizationName: 'Acme Clinic',
      email: 'weak@example.com',
      password: 'short',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing organization name with 422', async () => {
    const res = await api().post('/api/auth/register').send({
      organizationName: '',
      email: 'noorg@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(422);
  });

  it('rejects an invalid email with 422', async () => {
    const res = await api().post('/api/auth/register').send({
      organizationName: 'Acme Clinic',
      email: 'not-an-email',
      password: 'Password123',
    });

    expect(res.status).toBe(422);
  });
});
