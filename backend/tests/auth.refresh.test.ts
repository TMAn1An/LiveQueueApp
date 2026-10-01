import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { hashRefreshToken } from '../src/utils/tokens';
import { REFRESH_REUSE_LEEWAY_MS } from '../src/services/session.service';

/** Moves a token's rotation into the past, beyond the duplicate leeway. */
async function ageRotation(rawRefreshToken: string) {
  await prisma.session.update({
    where: { refreshTokenHash: hashRefreshToken(rawRefreshToken) },
    data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_LEEWAY_MS - 1_000) },
  });
}

describe('POST /api/auth/refresh', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rotates the refresh token and issues a new access token', async () => {
    const ctx = await registerOwner();

    const res = await api().post('/api/auth/refresh').send({ refreshToken: ctx.refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.refreshToken).not.toBe(ctx.refreshToken);
  });

  it('rejects an unknown refresh token with 401', async () => {
    const res = await api()
      .post('/api/auth/refresh')
      .send({ refreshToken: 'deadbeef'.repeat(12) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects reuse of an already-rotated refresh token and revokes the session chain', async () => {
    const ctx = await registerOwner();

    const first = await api().post('/api/auth/refresh').send({ refreshToken: ctx.refreshToken });
    expect(first.status).toBe(200);
    const rotatedToken = first.body.data.refreshToken as string;

    // The rotation happened a while ago — outside the short leeway in which
    // the same client's own duplicate request is tolerated (ADR-052; the
    // leeway itself is covered in auth.refreshRotation.test.ts).
    await ageRotation(ctx.refreshToken);

    // Reusing the original (now-rotated-away) token must fail...
    const reuse = await api().post('/api/auth/refresh').send({ refreshToken: ctx.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // ...and must have revoked the legitimately-rotated session too, as a precaution.
    const afterReuse = await api().post('/api/auth/refresh').send({ refreshToken: rotatedToken });
    expect(afterReuse.status).toBe(401);
  });
});
