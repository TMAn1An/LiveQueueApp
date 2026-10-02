import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { hashRefreshToken } from '../src/utils/tokens';

/**
 * ADR-058: forgot password. The Resend SDK is mocked at the boundary, so the
 * real request → email → link → reset path runs without sending anything.
 */
const sendMock = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  process.env.RESEND_API_KEY = 'test_resend_key_not_a_real_credential';
});
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const GENERIC = 'If an account exists for this email, a reset link has been sent.';

beforeEach(async () => {
  await resetDb();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: 'sent' }, error: null });
});

const requestReset = (email: string) =>
  api().post('/api/auth/password-reset/request').send({ email });

const confirm = (token: string, password: string) =>
  api().post('/api/auth/password-reset/confirm').send({ token, password });

interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

/** Only the password-reset sends — registration also emails a verification link. */
const resetEmails = (): SentEmail[] =>
  sendMock.mock.calls
    .map((call) => call[0] as SentEmail)
    .filter((mail) => mail.subject === 'Reset your LiveQueue password');

/** The request handler replies before it works, so wait for the email. */
async function emailedToken(times = 1): Promise<string> {
  await vi.waitFor(() => expect(resetEmails()).toHaveLength(times));
  const payload = resetEmails()[times - 1]!;
  const match = /reset-password\?token=([a-f0-9]+)/.exec(payload.html);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe('ADR-058 — requesting a reset', () => {
  it('answers identically for a real account and an unknown address', async () => {
    const owner = await registerOwner();
    const known = await requestReset(owner.email);
    const unknown = await requestReset('nobody@example.com');

    for (const res of [known, unknown]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { message: GENERIC } });
    }
    await emailedToken();
    // Only the real account was emailed.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(resetEmails()).toHaveLength(1);
    expect(resetEmails()[0]!.to).toBe(owner.email);
  });

  it('emails a link to the configured dashboard and stores only the hash', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();

    const html = resetEmails()[0]!.html;
    expect(html).toContain(`${env.APP_BASE_URL}/reset-password?token=${raw}`);
    const rows = await prisma.passwordResetToken.findMany({ where: { staffId: owner.staffId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashRefreshToken(raw));
    expect(rows[0]!.tokenHash).not.toBe(raw);
    const ttl = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it('sends nothing to a suspended account or a pending invitee, but answers the same', async () => {
    const owner = await registerOwner();
    const staff = await createStaffWithRole(owner.organizationId, 'STAFF');
    const staffRow = await prisma.staff.update({ where: { id: staff.staffId }, data: { status: 'SUSPENDED' } });
    const res = await requestReset(staffRow.email);
    expect(res.body.data.message).toBe(GENERIC);

    const invite = await api()
      .post('/api/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Invitee', email: 'invitee@example.com', role: 'STAFF' });
    expect(invite.status).toBe(201);
    expect((await requestReset('invitee@example.com')).body.data.message).toBe(GENERIC);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(resetEmails()).toHaveLength(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('a second request within the cooldown sends nothing more', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    await emailedToken();
    await requestReset(owner.email);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(resetEmails()).toHaveLength(1);
  });

  it('a newer link retires the older one', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const first = await emailedToken();
    // Step past the cooldown by ageing the stored row.
    await prisma.passwordResetToken.updateMany({
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    await requestReset(owner.email);
    const second = await emailedToken(2);

    expect((await confirm(first, 'NewPassword1')).status).toBe(400);
    expect((await confirm(second, 'NewPassword1')).status).toBe(200);
  });

  it('rejects a malformed email or extra fields', async () => {
    expect((await requestReset('not-an-email')).status).toBe(422);
    const extra = await api()
      .post('/api/auth/password-reset/request')
      .send({ email: 'a@example.com', staffId: 'x' });
    expect(extra.status).toBe(422);
  });
});

describe('ADR-058 — redeeming a link', () => {
  it('sets the new password: the old one stops working and the new one signs in', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();

    const valid = await api().get(`/api/auth/password-reset/validate?token=${raw}`);
    expect(valid.body.data.valid).toBe(true);

    const res = await confirm(raw, 'BrandNew123');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ reset: true });
    // No session is minted by the link itself.
    expect(res.body.data.accessToken).toBeUndefined();

    const oldLogin = await api().post('/api/auth/login').send({ email: owner.email, password: owner.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api().post('/api/auth/login').send({ email: owner.email, password: 'BrandNew123' });
    expect(newLogin.status).toBe(200);

    await vi.waitFor(async () => {
      const audit = await prisma.auditLog.findFirst({ where: { action: 'password_reset' } });
      expect(audit).toMatchObject({ staffId: owner.staffId, entityId: owner.staffId });
    });
  });

  it('signs the account out everywhere — refresh sessions and live access tokens', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();
    // Make sure the access token's iat is in an earlier second than the reset.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await confirm(raw, 'BrandNew123')).status).toBe(200);

    expect(await prisma.session.count({ where: { staffId: owner.staffId, revokedAt: null } })).toBe(0);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    const refresh = await api().post('/api/auth/refresh').send({ refreshToken: owner.refreshToken });
    expect(refresh.status).toBe(401);

    // A fresh login afterwards works normally.
    const login = await api().post('/api/auth/login').send({ email: owner.email, password: 'BrandNew123' });
    const fresh = await api().get('/api/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(fresh.status).toBe(200);
  });

  it('works once: the same link cannot be used again', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();
    expect((await confirm(raw, 'BrandNew123')).status).toBe(200);

    const again = await confirm(raw, 'Another123');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await api().get(`/api/auth/password-reset/validate?token=${raw}`)).body.data.valid).toBe(false);
  });

  it('two simultaneous submissions of one link: exactly one succeeds', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();
    const [a, b] = await Promise.all([confirm(raw, 'FirstPass1'), confirm(raw, 'SecondPass1')]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('an expired link is refused and leaves the password unchanged', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await api().get(`/api/auth/password-reset/validate?token=${raw}`)).body.data.valid).toBe(false);
    const res = await confirm(raw, 'BrandNew123');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    const login = await api().post('/api/auth/login').send({ email: owner.email, password: owner.password });
    expect(login.status).toBe(200);
  });

  it('an unknown link gets the same generic failure', async () => {
    const res = await confirm('f'.repeat(96), 'BrandNew123');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('enforces the normal password policy', async () => {
    const owner = await registerOwner();
    await requestReset(owner.email);
    const raw = await emailedToken();
    for (const weak of ['short1', 'allletters', '12345678']) {
      expect((await confirm(raw, weak)).status).toBe(422);
    }
    // A policy failure does not use the link up.
    expect((await confirm(raw, 'GoodPass123')).status).toBe(200);
  });

  it('a link for an account suspended after it was sent no longer works', async () => {
    const owner = await registerOwner();
    const staff = await createStaffWithRole(owner.organizationId, 'STAFF');
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.staffId } });
    await requestReset(row.email);
    const raw = await emailedToken();
    await prisma.staff.update({ where: { id: staff.staffId }, data: { status: 'SUSPENDED' } });
    expect((await confirm(raw, 'BrandNew123')).status).toBe(400);
  });
});
