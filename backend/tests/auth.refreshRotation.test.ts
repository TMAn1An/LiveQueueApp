import { beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { hashRefreshToken } from '../src/utils/tokens';
import { REFRESH_REUSE_LEEWAY_MS } from '../src/services/session.service';

/**
 * ADR-052. Refresh tokens rotate, and presenting one that was already rotated
 * is the theft indicator: every session is revoked. That rule is kept — but
 * one browser can legitimately present the same token twice at once, and that
 * must neither sign the user out nor weaken the rule for anyone else.
 */

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) Dashboard-Test';

function refresh(refreshToken: string, userAgent: string = BROWSER) {
  return api().post('/api/auth/refresh').set('User-Agent', userAgent).send({ refreshToken });
}

function login(email: string, password: string, userAgent: string = BROWSER) {
  return api().post('/api/auth/login').set('User-Agent', userAgent).send({ email, password });
}

function activeSessions(staffId: string) {
  return prisma.session.count({ where: { staffId, revokedAt: null } });
}

/** Moves a token's rotation into the past, beyond the duplicate leeway. */
async function ageRotation(rawRefreshToken: string) {
  await prisma.session.update({
    where: { refreshTokenHash: hashRefreshToken(rawRefreshToken) },
    data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_LEEWAY_MS - 1_000) },
  });
}

/** A signed-in browser: registered, then logged in with a real user agent. */
async function signedInBrowser() {
  const owner = await registerOwner();
  const res = await login(owner.email, owner.password);
  expect(res.status).toBe(200);
  return {
    ...owner,
    accessToken: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
    /** registerOwner's own session — stands in for "another device". */
    otherDeviceRefreshToken: owner.refreshToken,
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('C. normal rotation', () => {
  it('replaces the token each time and keeps exactly one session alive for that browser', async () => {
    const browser = await signedInBrowser();
    const before = await activeSessions(browser.staffId);

    const first = await refresh(browser.refreshToken);
    expect(first.status).toBe(200);
    const second = await refresh(first.body.data.refreshToken);
    expect(second.status).toBe(200);
    const third = await refresh(second.body.data.refreshToken);
    expect(third.status).toBe(200);

    const tokens = [
      browser.refreshToken,
      first.body.data.refreshToken,
      second.body.data.refreshToken,
      third.body.data.refreshToken,
    ];
    expect(new Set(tokens).size).toBe(4);
    // Rotation replaces; it never accumulates live sessions.
    expect(await activeSessions(browser.staffId)).toBe(before);

    const rotatedAway = await prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: hashRefreshToken(browser.refreshToken) },
    });
    const successor = await prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: hashRefreshToken(first.body.data.refreshToken) },
    });
    expect(rotatedAway.revokedAt).not.toBeNull();
    expect(rotatedAway.replacedBySessionId).toBe(successor.id);
  });
});

describe('A. simultaneous legitimate refresh attempts', () => {
  it('lets exactly one of two simultaneous requests rotate, and signs nobody out', async () => {
    const browser = await signedInBrowser();
    const before = await activeSessions(browser.staffId);

    const [a, b] = await Promise.all([refresh(browser.refreshToken), refresh(browser.refreshToken)]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(loser.body.error.code).toBe('REFRESH_TOKEN_SUPERSEDED');
    // The duplicate is told to step aside; it is not handed credentials.
    expect(loser.body.data).toBeUndefined();

    // One successor, not two: the session did not fork.
    expect(await activeSessions(browser.staffId)).toBe(before);
    // The winner's token works, and so does the other device's session.
    expect((await refresh(winner.body.data.refreshToken)).status).toBe(200);
    expect((await refresh(browser.otherDeviceRefreshToken)).status).toBe(200);
  });

  it('holds under repeated races and wider fan-out: one winner every time, never a fork', async () => {
    const browser = await signedInBrowser();
    const before = await activeSessions(browser.staffId);

    let current = browser.refreshToken;
    for (let round = 0; round < 8; round += 1) {
      const fanOut = round % 2 === 0 ? 2 : 5;
      const responses = await Promise.all(Array.from({ length: fanOut }, () => refresh(current)));
      const winners = responses.filter((res) => res.status === 200);
      const superseded = responses.filter((res) => res.status === 409);

      expect(winners).toHaveLength(1);
      expect(superseded).toHaveLength(fanOut - 1);
      for (const res of superseded) expect(res.body.error.code).toBe('REFRESH_TOKEN_SUPERSEDED');
      expect(await activeSessions(browser.staffId)).toBe(before);

      current = winners[0]!.body.data.refreshToken as string;
    }

    expect((await refresh(current)).status).toBe(200);
  });

  it('tolerates a duplicate that arrives just after the rotation finished (requests sent together, received apart)', async () => {
    const browser = await signedInBrowser();

    const winner = await refresh(browser.refreshToken);
    expect(winner.status).toBe(200);
    const late = await refresh(browser.refreshToken);

    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('REFRESH_TOKEN_SUPERSEDED');
    expect((await refresh(winner.body.data.refreshToken)).status).toBe(200);
    expect((await refresh(browser.otherDeviceRefreshToken)).status).toBe(200);
  });
});

describe('B. genuine reuse of an older rotated token', () => {
  it('revokes every session when a token rotated a while ago is presented again', async () => {
    const browser = await signedInBrowser();
    const rotated = await refresh(browser.refreshToken);
    expect(rotated.status).toBe(200);
    await ageRotation(browser.refreshToken);

    const replay = await refresh(browser.refreshToken);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(await activeSessions(browser.staffId)).toBe(0);
    // The legitimately rotated token and the other device are both cut off.
    expect((await refresh(rotated.body.data.refreshToken)).status).toBe(401);
    expect((await refresh(browser.otherDeviceRefreshToken)).status).toBe(401);
  });

  it('revokes every session when a just-rotated token is replayed from a different client', async () => {
    const browser = await signedInBrowser();
    const rotated = await refresh(browser.refreshToken);
    expect(rotated.status).toBe(200);

    // Well inside the leeway — but not the browser that rotated it.
    const replay = await refresh(browser.refreshToken, 'curl/8.4.0');

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(await activeSessions(browser.staffId)).toBe(0);
    expect((await refresh(rotated.body.data.refreshToken)).status).toBe(401);
  });

  it('detects the thief who rotates first: the owner presenting the same token later revokes everything', async () => {
    const browser = await signedInBrowser();

    const thief = await refresh(browser.refreshToken, 'curl/8.4.0');
    expect(thief.status).toBe(200);
    await ageRotation(browser.refreshToken);
    const owner = await refresh(browser.refreshToken);

    expect(owner.status).toBe(401);
    expect(owner.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    // The thief's freshly minted session does not survive.
    expect((await refresh(thief.body.data.refreshToken, 'curl/8.4.0')).status).toBe(401);
    expect(await activeSessions(browser.staffId)).toBe(0);
  });

  it('never hands tokens to a replay, inside the leeway or outside it', async () => {
    const browser = await signedInBrowser();
    await refresh(browser.refreshToken);

    const inside = await refresh(browser.refreshToken);
    expect(inside.status).toBe(409);
    expect(JSON.stringify(inside.body)).not.toMatch(/accessToken|refreshToken"/);

    await ageRotation(browser.refreshToken);
    const outside = await refresh(browser.refreshToken);
    expect(outside.status).toBe(401);
    expect(JSON.stringify(outside.body)).not.toMatch(/accessToken|refreshToken"/);
  });

  it('does not extend the leeway to a token whose successor has since been revoked', async () => {
    const browser = await signedInBrowser();
    const rotated = await refresh(browser.refreshToken);
    const loggedOut = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${rotated.body.data.accessToken}`)
      .send({ refreshToken: rotated.body.data.refreshToken });
    expect(loggedOut.status).toBe(204);

    const replay = await refresh(browser.refreshToken);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });
});

describe('D. logout and session revocation', () => {
  it('logout ends only that session: the token stops working, other devices keep theirs', async () => {
    const browser = await signedInBrowser();

    const loggedOut = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${browser.accessToken}`)
      .send({ refreshToken: browser.refreshToken });
    expect(loggedOut.status).toBe(204);

    const session = await prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: hashRefreshToken(browser.refreshToken) },
    });
    expect(session.revokedAt).not.toBeNull();
    expect(session.replacedBySessionId).toBeNull();
    expect(await activeSessions(browser.staffId)).toBe(1);
  });

  it('a logged-out token is never treated as a concurrent duplicate, however soon it is presented', async () => {
    const browser = await signedInBrowser();
    await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${browser.accessToken}`)
      .send({ refreshToken: browser.refreshToken });

    // Immediately, from the very same browser: still not a "duplicate".
    const replay = await refresh(browser.refreshToken);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('a password change revokes the other sessions, and their tokens get no leeway', async () => {
    const browser = await signedInBrowser();

    const changed = await api()
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${browser.accessToken}`)
      .send({
        currentPassword: browser.password,
        newPassword: 'NewPassword456',
        refreshToken: browser.refreshToken,
      });
    expect(changed.status).toBe(204);

    // The session that changed the password survives and still rotates...
    expect(await activeSessions(browser.staffId)).toBe(1);
    // ...while the other device's token is dead, with no benign answer.
    const other = await refresh(browser.otherDeviceRefreshToken);
    expect(other.status).toBe(401);
    expect(other.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('an unknown token is still simply invalid', async () => {
    const res = await refresh('deadbeef'.repeat(12));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});
