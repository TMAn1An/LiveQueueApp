import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { hashRefreshToken } from '../src/utils/tokens';
import * as emailService from '../src/services/email.service';
import { cleanupExpiredPendingRegistrations } from '../src/services/emailVerification.service';

/** Extracts the raw verification token from the URL passed to sendVerificationEmail. */
function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

async function rawRegister(overrides: Partial<{ organizationName: string; email: string; password: string }> = {}) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const res = await api()
    .post('/api/auth/register')
    .send({
      organizationName: overrides.organizationName ?? `EV Org ${suffix}`,
      email: overrides.email ?? `ev-${suffix}@example.com`,
      password: overrides.password ?? 'Password123',
    });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

describe('V2 Checkpoint 2 — email verification', () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  it('registration creates a PENDING_EMAIL_VERIFICATION owner and triggers a verification email', async () => {
    const send = vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);

    const res = await rawRegister();

    expect(res.body.data.staff.status).toBe('PENDING_EMAIL_VERIFICATION');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(res.body.data.staff.email);
  });

  it('stores the verification token hashed, never in plaintext', async () => {
    const send = vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);
    const res = await rawRegister();
    const rawToken = tokenFromUrl(send.mock.calls[0]![1]);

    const staff = await prisma.staff.findUnique({ where: { id: res.body.data.staff.id } });

    expect(staff!.emailVerificationTokenHash).not.toBe(rawToken);
    expect(staff!.emailVerificationTokenHash).toBe(hashRefreshToken(rawToken));
  });

  it('a valid token successfully verifies the account', async () => {
    const send = vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);
    const res = await rawRegister();
    const rawToken = tokenFromUrl(send.mock.calls[0]![1]);

    const verifyRes = await api().get('/api/auth/email-verification/verify').query({ token: rawToken });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.verified).toBe(true);

    const staff = await prisma.staff.findUnique({ where: { id: res.body.data.staff.id } });
    expect(staff!.status).toBe('ACTIVE');
    expect(staff!.emailVerificationTokenHash).toBeNull();
    expect(staff!.emailVerificationExpiresAt).toBeNull();
    expect(staff!.registrationExpiresAt).toBeNull();
  });

  it('rejects an unknown token', async () => {
    const res = await api()
      .get('/api/auth/email-verification/verify')
      .query({ token: 'deadbeef'.repeat(12) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects a token past its 15-minute expiry and leaves the account pending', async () => {
    const send = vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);
    const res = await rawRegister();
    const rawToken = tokenFromUrl(send.mock.calls[0]![1]);

    await prisma.staff.update({
      where: { id: res.body.data.staff.id },
      data: { emailVerificationExpiresAt: new Date(Date.now() - 1000) },
    });

    const verifyRes = await api().get('/api/auth/email-verification/verify').query({ token: rawToken });
    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    const staff = await prisma.staff.findUnique({ where: { id: res.body.data.staff.id } });
    expect(staff!.status).toBe('PENDING_EMAIL_VERIFICATION');
  });

  it('resend invalidates the previous token and issues a fresh one, without touching the 1-hour deadline', async () => {
    const send = vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);
    const res = await rawRegister();
    const firstToken = tokenFromUrl(send.mock.calls[0]![1]);
    const accessToken = res.body.data.accessToken as string;

    const before = await prisma.staff.findUnique({ where: { id: res.body.data.staff.id } });

    const resendRes = await api()
      .post('/api/auth/email-verification/resend')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(resendRes.status).toBe(204);
    expect(send).toHaveBeenCalledTimes(2);
    const secondToken = tokenFromUrl(send.mock.calls[1]![1]);
    expect(secondToken).not.toBe(firstToken);

    const after = await prisma.staff.findUnique({ where: { id: res.body.data.staff.id } });
    expect(after!.registrationExpiresAt).toEqual(before!.registrationExpiresAt);

    const oldTokenAttempt = await api()
      .get('/api/auth/email-verification/verify')
      .query({ token: firstToken });
    expect(oldTokenAttempt.status).toBe(400);

    const newTokenAttempt = await api()
      .get('/api/auth/email-verification/verify')
      .query({ token: secondToken });
    expect(newTokenAttempt.status).toBe(200);
  });

  it('resend on an already-verified account is rejected', async () => {
    const owner = await registerOwner(); // helper auto-verifies

    const res = await api()
      .post('/api/auth/email-verification/resend')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_VERIFIED');
  });

  it('blocks an unverified owner from queue-management functionality', async () => {
    const res = await rawRegister();
    const accessToken = res.body.data.accessToken as string;

    const createQueue = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Should Be Blocked', tokenPrefix: 'X' });

    expect(createQueue.status).toBe(403);
    expect(createQueue.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('keeps /me, /logout, and resend reachable for a pending account', async () => {
    const res = await rawRegister();
    const accessToken = res.body.data.accessToken as string;
    const refreshToken = res.body.data.refreshToken as string;

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.staff.status).toBe('PENDING_EMAIL_VERIFICATION');

    const resend = await api()
      .post('/api/auth/email-verification/resend')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(resend.status).toBe(204);

    const logout = await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(logout.status).toBe(204);
  });

  it('cleanup deletes a pending organization + owner once the 1-hour window has lapsed', async () => {
    const res = await rawRegister();
    const staffId = res.body.data.staff.id as string;
    const organizationId = res.body.data.organization.id as string;

    await prisma.staff.update({
      where: { id: staffId },
      data: { registrationExpiresAt: new Date(Date.now() - 1000) },
    });

    const { deletedCount } = await cleanupExpiredPendingRegistrations();
    expect(deletedCount).toBe(1);

    expect(await prisma.staff.findUnique({ where: { id: staffId } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: organizationId } })).toBeNull();
  });

  it('cleanup never deletes a verified account or a still-fresh pending registration', async () => {
    const verifiedOwner = await registerOwner(); // auto-verified, ACTIVE
    const freshPending = await rawRegister(); // registrationExpiresAt ~1h in the future

    const { deletedCount } = await cleanupExpiredPendingRegistrations();
    expect(deletedCount).toBe(0);

    expect(await prisma.organization.findUnique({ where: { id: verifiedOwner.organizationId } })).not.toBeNull();
    expect(
      await prisma.organization.findUnique({ where: { id: freshPending.body.data.organization.id } }),
    ).not.toBeNull();
  });
});
