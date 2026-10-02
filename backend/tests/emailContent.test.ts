import { inspect } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';
import * as emailService from '../src/services/email.service';

/**
 * ADR-060: every transactional email — verification, staff invitation,
 * customer verification code — is concise, has one call to action, a real
 * plain-text twin, safe headers, and leaks nothing into logs. The Resend SDK
 * is mocked at the boundary; everything above it is real.
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

interface Sent {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  replyTo?: string;
}
const sent = (i = 0) => sendMock.mock.calls[i]![0] as Sent;

beforeEach(async () => {
  await resetDb();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: 'sent' }, error: null });
});

function register(email = 'owner@example.com') {
  // Organization names are unique, so each registration gets its own.
  return api()
    .post('/api/auth/register')
    .send({ organizationName: `Org ${email.split('@')[0]}`, email, password: 'Password123' });
}

/** Shared shape every transactional email must have. */
function expectTransactional(mail: Sent, opts: { links: number }) {
  expect(mail.from).toBe(env.EMAIL_FROM);
  expect(mail.html.startsWith('<!doctype html>')).toBe(true);
  expect(mail.html).toContain('<html lang="en">');
  // Exactly the expected number of anchors — one call to action at most.
  expect(mail.html.match(/<a\b/g) ?? []).toHaveLength(opts.links);
  // A real text/plain part, not HTML in disguise.
  expect(mail.text.length).toBeGreaterThan(40);
  expect(mail.text).not.toMatch(/<\/?(p|a|div|br|h1|h2|strong|span|html|body)\b/i);
  expect(mail.text).toContain('— LiveQueue');
  // Transactional headers only: auto-generated, unique per message, and no
  // marketing headers.
  expect(mail.headers['Auto-Submitted']).toBe('auto-generated');
  expect(mail.headers['X-Entity-Ref-ID']).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(mail.headers).map((h) => h.toLowerCase())).not.toContain('list-unsubscribe');
  // No shouting and no marketing language.
  for (const body of [mail.html, mail.text]) {
    expect(body).not.toMatch(/\b(FREE|URGENT|ACT NOW|CLICK HERE)\b/);
    expect(body).not.toMatch(/!{2,}/);
  }
}

describe('ADR-060 — verification email', () => {
  it('uses the agreed subject, sender and one link to the configured dashboard', async () => {
    await register();
    const mail = sent();
    expect(mail.to).toBe('owner@example.com');
    expect(mail.subject).toBe('Verify your LiveQueue account');
    expectTransactional(mail, { links: 1 });

    const url = /href="([^"]+)"/.exec(mail.html)![1]!;
    expect(url.startsWith(`${env.APP_BASE_URL}/verify-email?token=`)).toBe(true);
    // The fallback says what to do and shows the same URL once, as text.
    expect(mail.html).toContain("If the button doesn&#39;t work".replace('&#39;', "'"));
    expect(mail.html.split(url)).toHaveLength(3);
    // The text part carries the same link exactly once.
    expect(mail.text.split(url)).toHaveLength(2);
    expect(mail.text).toContain('expires in 15 minutes');
  });

  it('uses a short, URL-safe token (43 base64url characters) that really verifies the account', async () => {
    await register('short@example.com');
    const token = /verify-email\?token=([^"&\s]+)/.exec(sent().html)![1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const res = await api().get('/api/auth/email-verification/verify').query({ token });
    expect(res.status).toBe(200);
  });

  it('every send is a separate message (no shared reference id)', async () => {
    await register('a@example.com');
    await register('b@example.com');
    expect(sent(0).headers['X-Entity-Ref-ID']).not.toBe(sent(1).headers['X-Entity-Ref-ID']);
  });
});

describe('ADR-060 — resend cannot flood an inbox', () => {
  it('refuses a second verification email within the cooldown, then allows it', async () => {
    const reg = await register('cool@example.com');
    const token = reg.body.data.accessToken as string;
    const resend = () =>
      api().post('/api/auth/email-verification/resend').set('Authorization', `Bearer ${token}`);

    const tooSoon = await resend();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('VERIFICATION_RESEND_TOO_SOON');
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Step past the cooldown by ageing the stored send time.
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: 'cool@example.com' } });
    await prisma.staff.update({
      where: { id: staff.id },
      data: { emailVerificationExpiresAt: new Date(staff.emailVerificationExpiresAt!.getTime() - 61_000) },
    });
    expect((await resend()).status).toBe(204);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe('ADR-060 — staff invitation email', () => {
  it('has one link, escapes free text, and no second link to the login page', async () => {
    await emailService.sendStaffInvitationEmail({
      to: 'new@example.com',
      name: 'Nadia',
      organizationName: 'Acme <Clinic>',
      role: 'ADMIN',
      setupUrl: 'https://dash.example.com/accept-invitation?token=abc',
    });
    const mail = sent();
    expect(mail.subject).toBe('You have been invited to LiveQueue');
    expectTransactional(mail, { links: 1 });
    expect(mail.html).toContain('href="https://dash.example.com/accept-invitation?token=abc"');
    expect(mail.html).not.toContain('/login');
    expect(mail.html).toContain('Acme &lt;Clinic&gt;');
    expect(mail.text).toContain('Acme <Clinic> has given you access to LiveQueue as Administrator.');
    expect(mail.text).toContain('expires in 7 days');
  });

  it('a real invitation carries a short token', async () => {
    const reg = await register('inviter@example.com');
    const owner = await prisma.staff.findUniqueOrThrow({ where: { email: 'inviter@example.com' } });
    await prisma.staff.update({ where: { id: owner.id }, data: { status: 'ACTIVE' } });
    sendMock.mockClear();
    await api()
      .post('/api/staff')
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
      .send({ name: 'Colleague', email: 'colleague@example.com', role: 'STAFF' });
    const token = /accept-invitation\?token=([^"&\s]+)/.exec(sent().html)![1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('ADR-060 — customer verification code email', () => {
  it('shows the code, no link at all, and a plain-text twin', async () => {
    await emailService.sendCustomerVerificationCodeEmail({
      to: 'person@example.com',
      code: '482913',
      queueName: 'Pharmacy',
      expiresInMinutes: 5,
    });
    const mail = sent();
    expect(mail.subject).toBe('Your LiveQueue verification code');
    expectTransactional(mail, { links: 0 });
    expect(mail.html).toContain('482913');
    expect(mail.text).toContain('482913');
    expect(mail.text).toContain('Pharmacy');
  });
});

describe('ADR-060 — nothing sensitive reaches the logs', () => {
  it('a provider rejection logs the error and kind, never the recipient, link or token', async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Domain not verified' } });
    const spies = [vi.spyOn(logger, 'error'), vi.spyOn(logger, 'warn'), vi.spyOn(logger, 'info')];
    await register('secret-person@example.com');
    const url = /href="([^"]+)"/.exec(sent().html)![1]!;
    const token = url.split('token=')[1]!;

    // Only the email layer's own calls: the HTTP request logger's raw req/res
    // objects are redacted by pino at serialization, which a spy sees before.
    const emailCalls = spies
      .flatMap((spy) => spy.mock.calls)
      .filter((args) => !(typeof args[0] === 'object' && args[0] !== null && ('req' in args[0] || 'res' in args[0])));
    const logged = inspect(emailCalls, { depth: 6 });
    expect(logged).toContain('Domain not verified');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('secret-person@example.com');
    for (const spy of spies) spy.mockRestore();
  });
});
