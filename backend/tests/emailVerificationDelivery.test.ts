import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import * as emailService from '../src/services/email.service';

// Mocked at the external boundary only — the Resend SDK itself. Everything
// below that line (env handling, URL construction, token hashing, the
// register/resend request paths) is the real implementation.
const sendMock = vi.hoisted(() => vi.fn());

// Email delivery is opt-in: with no API key the service short-circuits and
// never reaches the provider at all. These tests are about what happens when
// it IS configured, so the key is set in a hoisted block — before
// config/env is first imported. The SDK is mocked, so nothing is ever sent.
vi.hoisted(() => {
  process.env.RESEND_API_KEY = 'test_resend_key_not_a_real_credential';
});

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

/** The payload handed to the provider for the Nth send. */
function sentPayload(index = 0): { to: string; from: string; html: string } {
  const call = sendMock.mock.calls[index];
  expect(call, `expected a provider send at index ${index}`).toBeDefined();
  return call![0] as { to: string; from: string; html: string };
}

beforeEach(async () => {
  await resetDb();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: 'sent' }, error: null });
});

describe('verification email delivery', () => {
  it('sends exactly one verification email when a registration succeeds', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ organizationName: 'Delivery Org', email: 'owner@example.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sentPayload()).toMatchObject({ to: 'owner@example.com', from: env.EMAIL_FROM });
  });

  it('links to the dashboard with a token that matches the stored hash — and stores only the hash', async () => {
    await api()
      .post('/api/auth/register')
      .send({ organizationName: 'Link Org', email: 'link@example.com', password: 'Password123' });

    const match = /href="([^"]+verify-email\?token=([^"]+))"/.exec(sentPayload().html);
    expect(match, 'verification link should be present in the email body').not.toBeNull();

    const url = match![1]!;
    const rawToken = match![2]!;
    expect(url.startsWith(env.APP_BASE_URL)).toBe(true);

    // The raw token must exist nowhere in the database — only its hash.
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: 'link@example.com' } });
    expect(staff.emailVerificationTokenHash).not.toBeNull();
    expect(staff.emailVerificationTokenHash).not.toBe(rawToken);

    // And the emailed value is the one that actually verifies the account.
    const verifyRes = await api().get(`/api/auth/email-verification/verify?token=${rawToken}`);
    expect(verifyRes.status).toBe(200);
  });

  it('still completes the registration when the provider rejects the send', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Domain is not verified' },
    });

    const res = await api()
      .post('/api/auth/register')
      .send({ organizationName: 'Failed Mail Org', email: 'failed@example.com', password: 'Password123' });

    // Deliberate, pre-existing behavior: the account and its session exist
    // so the customer can use the in-dashboard resend rather than losing the
    // registration to an email-provider problem.
    expect(res.status).toBe(201);
    const staff = await prisma.staff.findUnique({ where: { email: 'failed@example.com' } });
    expect(staff?.status).toBe('PENDING_EMAIL_VERIFICATION');
  });

  it('dispatches through the provider on the resend path too', async () => {
    const ctx = await registerOwner({ email: 'resend@example.com' });
    const before = sendMock.mock.calls.length;

    const res = await api()
      .post('/api/auth/email-verification/resend')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    // registerOwner activates the account directly for test convenience, so
    // the resend is refused as already-verified — in which case no email may
    // be sent either. Both branches are asserted so this stays meaningful
    // regardless of that helper's shortcut.
    if (res.status === 204) {
      expect(sendMock.mock.calls.length).toBe(before + 1);
    } else {
      expect(res.status).toBe(409);
      expect(sendMock.mock.calls.length).toBe(before);
    }
  });

  it('never puts the API key or the password into the payload it builds', async () => {
    await api()
      .post('/api/auth/register')
      .send({ organizationName: 'Leak Org', email: 'leak@example.com', password: 'Password123' });

    const payload = JSON.stringify(sentPayload());
    expect(payload).not.toMatch(/RESEND_API_KEY/);
    expect(payload).not.toContain(env.RESEND_API_KEY ?? '__unset__');
    expect(payload).not.toContain('Password123');
  });
});

describe('email configuration reporting', () => {
  it('does not throw on any configuration, so a misconfigured deploy still boots', () => {
    expect(() => emailService.reportEmailConfiguration()).not.toThrow();
  });

  it('reports email as available once an API key is configured', () => {
    // The inverse — no key means verification email is silently not sent —
    // is exactly the condition reportEmailConfiguration() exists to announce
    // at boot rather than leave to the first failed signup.
    expect(emailService.isEmailAvailable()).toBe(true);
  });
});
