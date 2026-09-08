import { Resend } from 'resend';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * V2 Checkpoint 2 (ADR-024). Lazily initialized exactly once, mirroring
 * firebaseAdmin.ts's pattern precisely: `undefined` means "not attempted
 * yet", `null` means "attempted and unavailable" (no API key configured) —
 * email delivery is optional infrastructure here, exactly like FCM. A
 * missing RESEND_API_KEY must never crash startup or fail a request; it
 * only means the verification email itself doesn't get sent (the pending
 * account and its token still exist and work via a real key later, or the
 * raw token can be resent once one is configured).
 */
let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) {
    return client;
  }

  if (!env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is not set — verification emails are not sent.');
    client = null;
    return client;
  }

  client = new Resend(env.RESEND_API_KEY);
  return client;
}

/**
 * Test seams, mirroring sms.service.ts's setSmsProviderForTesting exactly.
 *
 * Needed because customerEmailVerification.service.ts imports these two by
 * name rather than through a namespace, so a spy on the module object would
 * not intercept them — and the suite has to be able to run the whole
 * verification flow, and capture the code, without a Resend account.
 */
let availabilityOverride: boolean | null = null;
let customerVerificationSenderOverride:
  | ((input: CustomerVerificationEmail) => Promise<boolean>)
  | null = null;

export function setEmailAvailableForTesting(available: boolean | null): void {
  availabilityOverride = available;
}

export function setCustomerVerificationSenderForTesting(
  sender: ((input: CustomerVerificationEmail) => Promise<boolean>) | null,
): void {
  customerVerificationSenderOverride = sender;
}

export function isEmailAvailable(): boolean {
  if (availabilityOverride !== null) {
    return availabilityOverride;
  }
  return getClient() !== null;
}

/** Resend's shared sandbox sender. Usable without verifying a domain, but
 * it can only deliver to the address that owns the Resend account — every
 * other recipient is rejected by the provider. */
const RESEND_SANDBOX_SENDER = 'onboarding@resend.dev';

export interface CustomerVerificationEmail {
  to: string;
  code: string;
  queueName: string;
  expiresInMinutes: number;
}

/**
 * Registration is unusable if verification email never arrives, and an
 * unverified account is deleted an hour later — so a misconfiguration here
 * is not a quiet degradation, it is a broken signup funnel. These checks
 * run once at boot and say exactly what is wrong, instead of leaving the
 * first failed registration to discover it. Deliberately warnings, not a
 * fatal exit: local development and the test suite must still start with no
 * email account at all, and a running backend serving existing customers is
 * better than one that refuses to boot.
 *
 * Never logs the API key, a sender address's credentials, or any token.
 */
export function reportEmailConfiguration(): void {
  const isProduction = env.NODE_ENV === 'production';

  if (!env.RESEND_API_KEY) {
    const message =
      'RESEND_API_KEY is not set — no verification emails can be sent, so new registrations cannot be completed.';
    if (isProduction) {
      logger.error(message);
    } else {
      logger.warn(message);
    }
    return;
  }

  if (env.EMAIL_FROM.includes(RESEND_SANDBOX_SENDER) && isProduction) {
    logger.error(
      `EMAIL_FROM still uses Resend's sandbox sender (${RESEND_SANDBOX_SENDER}), which only delivers to the Resend account owner's own address. Set EMAIL_FROM to a sender on a domain verified in Resend.`,
    );
  }

  if (isProduction && /localhost|127\.0\.0\.1/.test(env.APP_BASE_URL)) {
    logger.error(
      `APP_BASE_URL is ${env.APP_BASE_URL} — verification links will point at localhost and cannot be opened by a recipient. Set it to the dashboard's public URL.`,
    );
  }
}

/**
 * Never throws — a delivery failure is reported back as a result, matching
 * fcm.service.ts's sendNotification exactly, so callers (register/resend)
 * can log-and-continue rather than fail an otherwise-successful DB write
 * over an email provider outage.
 */
export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: 'Verify your LiveQueue account',
      html: buildVerificationEmailHtml(verificationUrl),
    });
    if (error) {
      // name/statusCode are what distinguish an operator-fixable rejection
      // (unverified sending domain, sandbox-sender restriction, bad key)
      // from a transient provider outage — the message alone often doesn't.
      // None of these fields carry the API key or the verification token.
      logger.error(
        {
          name: error.name,
          message: error.message,
          from: env.EMAIL_FROM,
        },
        'Resend rejected the verification email — check the sender domain and API key configuration',
      );
      return false;
    }
    logger.info('Verification email sent');
    return true;
  } catch (err) {
    logger.error({ message: (err as Error).message }, 'Failed to send verification email');
    return false;
  }
}

/**
 * One small, self-contained template — deliberately not a template engine
 * or a multi-email system (CLAUDE.md §11: no unnecessary abstraction for a
 * single email type). No password, token value, or organization/customer
 * detail beyond the link itself.
 */
function buildVerificationEmailHtml(verificationUrl: string): string {
  return `
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color: #1e293b;">Verify your LiveQueue account</h2>
  <p style="color: #334155;">
    Thanks for registering with LiveQueue. Click the button below to verify your email address and activate your organization.
  </p>
  <p style="margin: 24px 0;">
    <a href="${verificationUrl}" style="background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
      Verify email address
    </a>
  </p>
  <p style="color: #64748b; font-size: 13px;">This link expires in 15 minutes.</p>
  <p style="color: #94a3b8; font-size: 12px;">If you didn't create a LiveQueue account, you can safely ignore this email.</p>
</div>`.trim();
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  STAFF: 'Staff',
};

/**
 * The invitation a new colleague receives (ADR-035). Carries a one-time setup
 * link and nothing else that matters: no password, no temporary credential,
 * no token beyond the link itself, and no internal ids. Same never-throws
 * contract as sendVerificationEmail — a delivery failure is reported, not
 * raised, because the account it refers to already exists.
 */
export async function sendStaffInvitationEmail(input: {
  to: string;
  name: string;
  organizationName: string;
  role: string;
  setupUrl: string;
}): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: `You've been invited to LiveQueue`,
      html: buildStaffInvitationHtml(input),
    });
    if (error) {
      logger.error(
        { name: error.name, message: error.message, from: env.EMAIL_FROM },
        'Resend rejected the staff invitation email — check the sender domain and API key configuration',
      );
      return false;
    }
    logger.info('Staff invitation email sent');
    return true;
  } catch (err) {
    logger.error({ message: (err as Error).message }, 'Failed to send the staff invitation email');
    return false;
  }
}

/** Escapes text taken from the organization or the invitee's own name — both
 * are free text an admin typed, and they are being placed into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildStaffInvitationHtml(input: {
  name: string;
  organizationName: string;
  role: string;
  setupUrl: string;
}): string {
  const role = ROLE_LABELS[input.role] ?? 'Staff';
  return `
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color: #1e293b;">You've been invited to LiveQueue</h2>
  <p style="color: #334155;">
    Hi ${escapeHtml(input.name)}, ${escapeHtml(input.organizationName)} has given you access to
    LiveQueue as <strong>${role}</strong>.
  </p>
  <p style="color: #334155;">
    Choose a password to finish setting up your account. Nobody else knows it — not even the
    administrator who invited you.
  </p>
  <p style="margin: 24px 0;">
    <a href="${input.setupUrl}" style="background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
      Set up your account
    </a>
  </p>
  <p style="color: #64748b; font-size: 13px;">
    This link works once and expires in 7 days. After that, ask an administrator to send a new one.
  </p>
  <p style="color: #64748b; font-size: 13px;">
    You'll sign in afterwards at <a href="${env.APP_BASE_URL}/login">${env.APP_BASE_URL}/login</a>.
  </p>
  <p style="color: #94a3b8; font-size: 12px;">
    If you weren't expecting this invitation, you can ignore this email — the account cannot be used
    until someone sets a password with the link above.
  </p>
</div>`.trim();
}

/**
 * The verification code a customer needs to join a queue that identifies
 * people by email (ADR-037).
 *
 * Reuses the same Resend client, sender and never-throws contract as every
 * other message here — no second provider, no duplicated HTTP handling. The
 * caller treats `false` as a hard failure and deletes the challenge, because
 * a code nobody received must not leave a usable one behind.
 *
 * Carries the code and, at most, the queue's name. Never a national ID or
 * other form answer, never a token or device id, never the verification
 * proof, never an internal database id.
 */
export async function sendCustomerVerificationCodeEmail(
  input: CustomerVerificationEmail,
): Promise<boolean> {
  if (customerVerificationSenderOverride) {
    return customerVerificationSenderOverride(input);
  }
  const resend = getClient();
  if (!resend) {
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: 'LiveQueue verification code',
      html: buildCustomerVerificationHtml(input),
    });
    if (error) {
      // name/statusCode distinguish an operator-fixable rejection from a
      // transient outage. None of these fields carries the code or the
      // recipient.
      logger.error(
        { name: error.name, message: error.message, from: env.EMAIL_FROM },
        'Resend rejected a customer verification email — check the sender domain and API key configuration',
      );
      return false;
    }
    // Deliberately says nothing about who it went to or what was in it.
    logger.info('Customer verification email sent');
    return true;
  } catch (err) {
    logger.error(
      { message: (err as Error).message },
      'Failed to send a customer verification email',
    );
    return false;
  }
}

function buildCustomerVerificationHtml(input: {
  code: string;
  queueName: string;
  expiresInMinutes: number;
}): string {
  return `
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color: #1e293b;">Your LiveQueue verification code</h2>
  <p style="color: #334155;">
    Enter this code in the LiveQueue app to join ${escapeHtml(input.queueName)}.
  </p>
  <p style="margin: 24px 0; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1e293b;">
    ${input.code}
  </p>
  <p style="color: #64748b; font-size: 13px;">
    This code expires in ${input.expiresInMinutes} minutes. Do not share it with anyone.
  </p>
  <p style="color: #94a3b8; font-size: 12px;">
    If you didn't request this, you can ignore this email — nobody can join a queue as you without
    the code above.
  </p>
</div>`.trim();
}
