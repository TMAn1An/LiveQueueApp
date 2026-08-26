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

export function isEmailAvailable(): boolean {
  return getClient() !== null;
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
      logger.error({ message: error.message }, 'Resend reported an error sending the verification email');
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
