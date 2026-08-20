import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

describe('POST /api/auth/logout', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('revokes the current session so the refresh token can no longer be used', async () => {
    const ctx = await registerOwner();

    const logoutRes = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ refreshToken: ctx.refreshToken });

    expect(logoutRes.status).toBe(204);

    const refreshRes = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: ctx.refreshToken });
    expect(refreshRes.status).toBe(401);
  });

  it('is idempotent when called twice with the same refresh token', async () => {
    const ctx = await registerOwner();

    const first = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ refreshToken: ctx.refreshToken });
    expect(first.status).toBe(204);

    const second = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ refreshToken: ctx.refreshToken });
    expect(second.status).toBe(204);
  });

  it('requires authentication', async () => {
    const res = await api().post('/api/auth/logout').send({ refreshToken: 'whatever' });
    expect(res.status).toBe(401);
  });
});
