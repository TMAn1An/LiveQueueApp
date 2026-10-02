import { randomUUID } from 'node:crypto';
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
 * ADR-060: every LiveQueue email is transactional and built the same way.
 *
 * Deliverability, not decoration:
 *  - a complete HTML document *and* an equivalent text/plain part (Resend
 *    sends both as multipart/alternative) — HTML-only mail is a classic spam
 *    signal, and some clients only show text;
 *  - one primary call to action, and the destination shown once as a short,
 *    copyable fallback — never a second, differently-worded link and never a
 *    hidden destination;
 *  - plain wording: what this is, why it arrived, what to do, when it
 *    expires, what to do if it was not you. No marketing language, urgency or
 *    capitals;
 *  - `Auto-Submitted: auto-generated` (RFC 3834) so auto-responders do not
 *    reply, and a unique `X-Entity-Ref-ID` so Gmail does not collapse a
 *    resent verification email into the earlier thread, which hides the new
 *    link. Resend assigns the Message-ID itself.
 *  - No List-Unsubscribe: these are not subscriptions.
 * Sender-domain authentication (SPF/DKIM/DMARC) matters more than any of
 * this and lives in DNS — see docs/DEPLOYMENT.md §3b.
 */
export interface TransactionalEmail {
  subject: string;
  html: string;
  text: string;
}

interface EmailContent {
  heading: string;
  /** Plain sentences; escaped for HTML here. */
  paragraphs: string[];
  action?: { label: string; url: string };
  /** A one-time code shown prominently instead of (or beside) a link. */
  code?: string;
  /** Small print after the action: expiry and similar. */
  notes: string[];
  /** Why the recipient got this, and what to do if it was not them. */
  footer: string;
}

const FALLBACK_SENTENCE = "If the button doesn't work, copy and paste this link into your browser:";

function renderHtml(content: EmailContent): string {
  const p = (text: string, style: string) => `<p style="margin: 0 0 16px; ${style}">${escapeHtml(text)}</p>`;
  const body = [
    `<p style="margin: 0 0 24px; font-size: 14px; font-weight: 700; color: #0f539e;">LiveQueue</p>`,
    `<h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #1e293b;">${escapeHtml(content.heading)}</h1>`,
    ...content.paragraphs.map((text) => p(text, 'font-size: 15px; line-height: 1.5; color: #334155;')),
  ];
  if (content.code) {
    body.push(
      `<p style="margin: 8px 0 24px; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1e293b;">${escapeHtml(content.code)}</p>`,
    );
  }
  if (content.action) {
    const url = escapeHtml(content.action.url);
    body.push(
      `<p style="margin: 24px 0;"><a href="${url}" style="display: inline-block; background: #0f539e; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">${escapeHtml(content.action.label)}</a></p>`,
      // The destination appears once more as text only — the same URL, not a
      // second link — so it can be copied when the button is not clickable.
      p(FALLBACK_SENTENCE, 'font-size: 13px; color: #64748b;'),
      `<p style="margin: -8px 0 16px; font-size: 13px; color: #64748b; word-break: break-all;">${url}</p>`,
    );
  }
  body.push(...content.notes.map((text) => p(text, 'font-size: 13px; color: #64748b;')));
  body.push(
    `<p style="margin: 24px 0 0; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">${escapeHtml(content.footer)}</p>`,
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin: 0; padding: 24px; background: #ffffff; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="max-width: 480px; margin: 0 auto;">
${body.join('\n')}
</div>
</body>
</html>`;
}

function renderText(content: EmailContent): string {
  const lines = [content.heading, '', ...content.paragraphs.flatMap((text) => [text, ''])];
  if (content.code) lines.push(content.code, '');
  if (content.action) lines.push(`${content.action.label}:`, content.action.url, '');
  lines.push(...content.notes.flatMap((text) => [text, '']));
  lines.push(content.footer, '', '— LiveQueue');
  return lines.join('\n');
}

function render(subject: string, content: EmailContent): TransactionalEmail {
  return { subject, html: renderHtml(content), text: renderText(content) };
}

/** Escapes text taken from the organization or a person's own name — free
 * text someone typed, about to be placed into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  STAFF: 'Staff',
};

export function verificationEmail(verificationUrl: string): TransactionalEmail {
  return render('Verify your LiveQueue account', {
    heading: 'Verify your email address',
    paragraphs: [
      'You are receiving this because this email address was used to register an organization on LiveQueue.',
      'Verify your address to finish setting up your account.',
    ],
    action: { label: 'Verify email address', url: verificationUrl },
    notes: ['This link works once and expires in 15 minutes.'],
    footer: "If you didn't create a LiveQueue account, you can ignore this email. No account is activated without this link.",
  });
}

export function staffInvitationEmail(input: {
  name: string;
  organizationName: string;
  role: string;
  setupUrl: string;
}): TransactionalEmail {
  const role = ROLE_LABELS[input.role] ?? 'Staff';
  return render('You have been invited to LiveQueue', {
    heading: 'Set up your LiveQueue account',
    paragraphs: [
      `Hi ${input.name}, ${input.organizationName} has given you access to LiveQueue as ${role}.`,
      'Choose your own password to finish setting up your account. Nobody else will know it.',
    ],
    action: { label: 'Set up your account', url: input.setupUrl },
    notes: [
      'This link works once and expires in 7 days. After that, ask an administrator to send a new one.',
      'Once your password is set, sign in with this email address.',
    ],
    footer: "If you weren't expecting this invitation, you can ignore this email. The account cannot be used until a password is set with this link.",
  });
}

export function customerVerificationCodeEmail(input: {
  code: string;
  queueName: string;
  expiresInMinutes: number;
}): TransactionalEmail {
  return render('Your LiveQueue verification code', {
    heading: 'Your LiveQueue verification code',
    paragraphs: [`Enter this code in the LiveQueue app to join ${input.queueName}.`],
    code: input.code,
    notes: [`This code expires in ${input.expiresInMinutes} minutes. Do not share it with anyone.`],
    footer: "If you didn't request this, you can ignore this email. Nobody can join a queue as you without the code above.",
  });
}

/**
 * The one place a message reaches the provider. Never throws — a delivery
 * failure is reported back as `false`, so callers can log-and-continue rather
 * than fail an otherwise-successful database write over a provider outage.
 * Logs carry the kind of message and the provider's error, never the
 * recipient, a link, a token or a code.
 */
async function deliver(kind: string, to: string, email: TransactionalEmail): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    return false;
  }
  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Entity-Ref-ID': randomUUID(),
      },
    });
    if (error) {
      // name/message are what distinguish an operator-fixable rejection
      // (unverified sending domain, sandbox-sender restriction, bad key) from
      // a transient provider outage. None carries the API key or the link.
      logger.error(
        { name: error.name, message: error.message, from: env.EMAIL_FROM, kind },
        `Resend rejected the ${kind} email — check the sender domain and API key configuration`,
      );
      return false;
    }
    logger.info({ kind }, `${kind} email sent`);
    return true;
  } catch (err) {
    logger.error({ message: (err as Error).message, kind }, `Failed to send the ${kind} email`);
    return false;
  }
}

export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<boolean> {
  if (!getClient()) {
    // Local development without a Resend account could otherwise never
    // complete a registration. Development only: the link is a one-time
    // credential, so it must never reach production or test logs.
    if (env.NODE_ENV === 'development') {
      logger.warn(
        { verificationUrl },
        'DEV ONLY: email delivery is not configured — open this link to verify the account',
      );
    }
    return false;
  }
  return deliver('verification', to, verificationEmail(verificationUrl));
}

/**
 * The invitation a new colleague receives (ADR-035). Carries a one-time setup
 * link and nothing else that matters: no password, no temporary credential,
 * no internal ids.
 */
export function sendStaffInvitationEmail(input: {
  to: string;
  name: string;
  organizationName: string;
  role: string;
  setupUrl: string;
}): Promise<boolean> {
  return deliver('staff invitation', input.to, staffInvitationEmail(input));
}

/**
 * The verification code a customer needs to join a queue that identifies
 * people by email (ADR-037). The caller treats `false` as a hard failure and
 * deletes the challenge, because a code nobody received must not leave a
 * usable one behind. Carries the code and, at most, the queue's name.
 */
export async function sendCustomerVerificationCodeEmail(
  input: CustomerVerificationEmail,
): Promise<boolean> {
  if (customerVerificationSenderOverride) {
    return customerVerificationSenderOverride(input);
  }
  return deliver('customer verification', input.to, customerVerificationCodeEmail(input));
}
