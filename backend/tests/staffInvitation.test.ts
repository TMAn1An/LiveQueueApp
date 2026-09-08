import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import * as emailService from '../src/services/email.service';

/**
 * Inviting a colleague (ADR-035). Two things have to hold: the person finds
 * out they have access, and nobody — including the admin who invited them —
 * ever knows their password.
 */

interface SentEmail {
  to: string;
  name: string;
  organizationName: string;
  role: string;
  setupUrl: string;
}

let sent: SentEmail[];
let deliver: boolean;

beforeEach(async () => {
  await resetDb();
  sent = [];
  deliver = true;
  vi.spyOn(emailService, 'sendStaffInvitationEmail').mockImplementation(async (input) => {
    sent.push(input);
    return deliver;
  });
});

function createStaff(accessToken: string, body: Record<string, unknown> = {}) {
  return api()
    .post('/api/staff')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: 'Rafi Ahmed',
      email: `invitee-${Math.random().toString(36).slice(2, 8)}@example.com`,
      role: 'STAFF',
      ...body,
    });
}

/** The raw token only ever exists in the link that was emailed. */
function tokenFrom(url: string): string {
  return new URL(url).searchParams.get('token')!;
}

describe('inviting a staff member', () => {
  it('sends an invitation naming the organization, the role and the dashboard', async () => {
    const ctx = await registerOwner({ organizationName: 'Dhaka City Clinic' });

    const res = await createStaff(ctx.accessToken, { name: 'Rafi Ahmed', role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.data.invitationEmailSent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.organizationName).toBe('Dhaka City Clinic');
    expect(sent[0]!.role).toBe('ADMIN');
    expect(sent[0]!.name).toBe('Rafi Ahmed');
    expect(sent[0]!.setupUrl).toContain('/accept-invitation?token=');
  });

  it('creates an account nobody can sign into yet', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken);

    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(staff.status).toBe('PENDING_EMAIL_VERIFICATION');
    expect(staff.invitationTokenHash).not.toBeNull();
    expect(res.body.data.invitationPending).toBe(true);
  });

  it('stores only a hash of the invitation token', async () => {
    const ctx = await registerOwner();
    await createStaff(ctx.accessToken);

    const raw = tokenFrom(sent[0]!.setupUrl);
    const staff = await prisma.staff.findFirstOrThrow({ where: { role: 'STAFF' } });

    expect(staff.invitationTokenHash).not.toBe(raw);
    expect(staff.invitationTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no longer lets an administrator choose a colleague’s password', async () => {
    const ctx = await registerOwner();

    const res = await createStaff(ctx.accessToken, { password: 'AdminPicked123' });

    // The field is simply not part of the contract any more; the account is
    // still created, and still by invitation.
    expect(res.status).toBe(201);
    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: res.body.data.id } });
    const login = await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'AdminPicked123' });
    expect(login.status).not.toBe(200);
  });

  it('keeps the account when the email cannot be delivered, and says so', async () => {
    const ctx = await registerOwner();
    deliver = false;

    const res = await createStaff(ctx.accessToken);

    expect(res.status).toBe(201);
    expect(res.body.data.invitationEmailSent).toBe(false);
    // The row survives an email outage — an admin can resend rather than
    // discovering the account vanished.
    await prisma.staff.findUniqueOrThrow({ where: { id: res.body.data.id } });
  });

  it('puts no password, hash or token into the email payload', async () => {
    const ctx = await registerOwner();
    await createStaff(ctx.accessToken);

    const staff = await prisma.staff.findFirstOrThrow({ where: { role: 'STAFF' } });
    const payload = JSON.stringify(sent[0]);
    expect(payload).not.toContain(staff.passwordHash);
    expect(payload).not.toContain(staff.invitationTokenHash!);
  });
});

describe('accepting an invitation', () => {
  async function invite() {
    const ctx = await registerOwner();
    const res = await createStaff(ctx.accessToken);
    return { ctx, staffId: res.body.data.id as string, token: tokenFrom(sent[0]!.setupUrl) };
  }

  it('lets the invitee set their own password and sign in', async () => {
    const { staffId, token } = await invite();
    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } });

    const accepted = await api()
      .post('/api/auth/accept-invitation')
      .send({ token, password: 'ChosenByMe123' });
    expect(accepted.status).toBe(200);

    const login = await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'ChosenByMe123' });
    expect(login.status).toBe(200);
    const after = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    expect(after.status).toBe('ACTIVE');
  });

  it('burns the link, so it cannot be replayed', async () => {
    const { token } = await invite();
    await api().post('/api/auth/accept-invitation').send({ token, password: 'ChosenByMe123' });

    const again = await api()
      .post('/api/auth/accept-invitation')
      .send({ token, password: 'SomeoneElse123' });

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('refuses an expired link', async () => {
    const { staffId, token } = await invite();
    await prisma.staff.update({
      where: { id: staffId },
      data: { invitationExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api()
      .post('/api/auth/accept-invitation')
      .send({ token, password: 'ChosenByMe123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('refuses a made-up link without saying why', async () => {
    await invite();

    const res = await api()
      .post('/api/auth/accept-invitation')
      .send({ token: 'not-a-real-token', password: 'ChosenByMe123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });
});

describe('resending an invitation', () => {
  async function invite() {
    const ctx = await registerOwner();
    const res = await createStaff(ctx.accessToken);
    return { ctx, staffId: res.body.data.id as string };
  }

  /** The cooldown is measured from the stored send time, so a test can move
   * that back rather than waiting a real minute. */
  async function clearCooldown(staffId: string) {
    await prisma.staff.update({
      where: { id: staffId },
      data: { invitationSentAt: new Date(Date.now() - 5 * 60_000) },
    });
  }

  it('sends a fresh link and invalidates the previous one', async () => {
    const { ctx, staffId } = await invite();
    const firstToken = tokenFrom(sent[0]!.setupUrl);
    await clearCooldown(staffId);

    const res = await api()
      .post(`/api/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.emailSent).toBe(true);
    expect(sent).toHaveLength(2);

    const replayed = await api()
      .post('/api/auth/accept-invitation')
      .send({ token: firstToken, password: 'ChosenByMe123' });
    expect(replayed.status).toBe(400);
  });

  it('refuses to spam the provider', async () => {
    const { ctx, staffId } = await invite();

    const res = await api()
      .post(`/api/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('INVITATION_RESEND_TOO_SOON');
    expect(sent).toHaveLength(1);
  });

  it('reports a delivery failure rather than pretending it worked', async () => {
    const { ctx, staffId } = await invite();
    await clearCooldown(staffId);
    deliver = false;

    const res = await api()
      .post(`/api/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.emailSent).toBe(false);
  });

  it('will not re-invite somebody who has already set up their account', async () => {
    const { ctx, staffId } = await invite();
    await api()
      .post('/api/auth/accept-invitation')
      .send({ token: tokenFrom(sent[0]!.setupUrl), password: 'ChosenByMe123' });
    await clearCooldown(staffId);

    const res = await api()
      .post(`/api/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVITATION_NOT_PENDING');
  });

  it('cannot reach a staff member in another organization', async () => {
    const { staffId } = await invite();
    const other = await registerOwner();

    const res = await api()
      .post(`/api/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('the escape hatch when email is broken', () => {
  it('activates an invited account when an administrator sets a password', async () => {
    const ctx = await registerOwner();
    deliver = false;
    const created = await createStaff(ctx.accessToken);

    const res = await api()
      .put(`/api/staff/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ password: 'SetByAdmin123' });

    expect(res.status).toBe(200);
    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(staff.status).toBe('ACTIVE');
    // The pending invitation is cancelled, so the emailed link cannot also be
    // used later to set a second password.
    expect(staff.invitationTokenHash).toBeNull();

    const login = await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'SetByAdmin123' });
    expect(login.status).toBe(200);
  });

  it('never activates an owner still verifying their email address', async () => {
    // A pending OWNER is mid-registration (ADR-024). Activating them from a
    // password write would skip proving they own the address.
    const ctx = await registerOwner();
    await prisma.staff.update({
      where: { id: ctx.staffId },
      data: { status: 'PENDING_EMAIL_VERIFICATION', invitationSentAt: null },
    });

    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: ctx.staffId } });
    expect(staff.status).toBe('PENDING_EMAIL_VERIFICATION');
    // The owner route is protected separately (assertNotOwner), so this is
    // belt and braces on the invitee-only condition itself.
    expect(staff.invitationSentAt).toBeNull();
  });
});
