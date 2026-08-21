import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { hashRefreshToken } from '../src/utils/tokens';
import { env } from '../src/config/env';

describe('Cross-staff session revocation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not let Staff A revoke Staff B's session, which remains active and refreshable", async () => {
    const staffA = await registerOwner({ organizationName: 'Org A' });
    const staffB = await registerOwner({ organizationName: 'Org B' });

    // Staff A is authenticated with their own access token but supplies
    // Staff B's refresh token in the logout body.
    const attempt = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${staffA.accessToken}`)
      .send({ refreshToken: staffB.refreshToken });

    // revokeSession() no-ops when the presented session doesn't belong to the
    // authenticated caller, so the endpoint still answers 204 — but nothing
    // about Staff B's session actually changed.
    expect(attempt.status).toBe(204);

    const staffBSession = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(staffB.refreshToken) },
    });
    expect(staffBSession).not.toBeNull();
    expect(staffBSession?.staffId).toBe(staffB.staffId);
    expect(staffBSession?.revokedAt).toBeNull();

    const refreshRes = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: staffB.refreshToken });
    expect(refreshRes.status).toBe(200);
  });
});

describe('Refresh token storage (database assertions)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('stores only a SHA-256 hash of the refresh token after login, never the raw value', async () => {
    const email = `dbcheck-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'Password123';
    const registered = await registerOwner({ email, password });

    const loginRes = await api().post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    const rawRefreshToken = loginRes.body.data.refreshToken as string;

    const expectedHash = hashRefreshToken(rawRefreshToken);
    const session = await prisma.session.findUnique({ where: { refreshTokenHash: expectedHash } });

    expect(session).not.toBeNull();
    expect(session?.staffId).toBe(registered.staffId);
    // The stored value is exactly the SHA-256 hash of the raw token...
    expect(session?.refreshTokenHash).toBe(expectedHash);
    // ...and is provably not the raw token itself.
    expect(session?.refreshTokenHash).not.toBe(rawRefreshToken);

    // Query the database directly for the raw token value: it must not
    // exist anywhere in the Session table's refreshTokenHash column.
    const rowsMatchingRawToken = await prisma.session.findMany({
      where: { refreshTokenHash: rawRefreshToken },
    });
    expect(rowsMatchingRawToken).toHaveLength(0);
  });
});

describe('Logout revocation (database assertions)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('leaves the session row in place with revokedAt set, and blocks further refresh', async () => {
    const ctx = await registerOwner();
    const refreshTokenHash = hashRefreshToken(ctx.refreshToken);

    const logoutRes = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ refreshToken: ctx.refreshToken });
    expect(logoutRes.status).toBe(204);

    const session = await prisma.session.findUnique({ where: { refreshTokenHash } });
    expect(session).not.toBeNull();
    expect(session?.staffId).toBe(ctx.staffId);
    expect(session?.revokedAt).not.toBeNull();

    const refreshRes = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: ctx.refreshToken });
    expect(refreshRes.status).toBe(401);
  });
});

describe('Access token behavior after logout (ADR-013)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('keeps the existing access token valid after logout, since access tokens are stateless', async () => {
    const ctx = await registerOwner();

    const logoutRes = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ refreshToken: ctx.refreshToken });
    expect(logoutRes.status).toBe(204);

    // The refresh session is revoked, but the already-issued access token is
    // a self-contained JWT that logout cannot invalidate (ADR-013). It must
    // keep working until it naturally expires.
    const meRes = await api().get('/api/auth/me').set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.staff.id).toBe(ctx.staffId);
  });

  it('documents the current default access-token lifetime of 15 minutes (ADR-013)', () => {
    // Pins the configured default so an unintentional change to
    // JWT_EXPIRES_IN is caught here rather than silently widening or
    // narrowing the post-logout access-token exposure window described above.
    expect(env.JWT_EXPIRES_IN).toBe('15m');
  });
});
