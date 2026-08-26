import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

describe('PATCH /api/auth/password', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects an incorrect current password', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ currentPassword: 'WrongPassword1', newPassword: 'NewPassword123', refreshToken: ctx.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('changes the password; the old password no longer authenticates and the new one does', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ currentPassword: ctx.password, newPassword: 'NewPassword123', refreshToken: ctx.refreshToken });
    expect(res.status).toBe(204);

    const oldLogin = await api().post('/api/auth/login').send({ email: ctx.email, password: ctx.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await api()
      .post('/api/auth/login')
      .send({ email: ctx.email, password: 'NewPassword123' });
    expect(newLogin.status).toBe(200);
  });

  it('revokes other active sessions while the calling session remains usable', async () => {
    const ctx = await registerOwner();

    // A second device/session for the same staff member.
    const secondLogin = await api().post('/api/auth/login').send({ email: ctx.email, password: ctx.password });
    expect(secondLogin.status).toBe(200);
    const otherRefreshToken = secondLogin.body.data.refreshToken as string;

    const changeRes = await api()
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ currentPassword: ctx.password, newPassword: 'NewPassword123', refreshToken: ctx.refreshToken });
    expect(changeRes.status).toBe(204);

    const currentSessionRefresh = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: ctx.refreshToken });
    expect(currentSessionRefresh.status).toBe(200);

    const otherSessionRefresh = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: otherRefreshToken });
    expect(otherSessionRefresh.status).toBe(401);
  });

  it('rejects extra fields such as staffId or role (privilege-escalation guard)', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        currentPassword: ctx.password,
        newPassword: 'NewPassword123',
        refreshToken: ctx.refreshToken,
        role: 'OWNER',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const res = await api()
      .patch('/api/auth/password')
      .send({ currentPassword: 'x', newPassword: 'NewPassword123', refreshToken: 'y' });

    expect(res.status).toBe(401);
  });
});
