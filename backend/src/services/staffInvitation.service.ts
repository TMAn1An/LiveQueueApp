import { randomBytes } from 'node:crypto';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { generateRefreshToken, hashRefreshToken } from '../utils/tokens';
import { hashPassword } from '../utils/password';
import * as emailService from './email.service';

/**
 * Getting a new colleague into the dashboard (ADR-035).
 *
 * Before this, creating a staff member wrote a row with a password the admin
 * had chosen, and told nobody. The person being given access learned about it
 * only if their admin messaged them separately — and their password was one
 * somebody else knew.
 *
 * The invitation replaces both halves: the account is created with no usable
 * password at all, and an email carries a one-time link the new member uses
 * to set their own. The token machinery is deliberately the same shape as
 * ADR-024's email verification — high-entropy raw value, only its SHA-256
 * hash stored, short expiry, single use — because that pattern is already
 * proven here and a second, subtly different one would be worse than reusing
 * this one.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Long enough to stop an impatient double-click becoming two emails, short
 * enough that a genuine "it never arrived" is not a five-minute wait. */
const RESEND_COOLDOWN_MS = 60 * 1000;

export interface InvitationToken {
  raw: string;
  hash: string;
  expiresAt: Date;
}

export function generateInvitationToken(): InvitationToken {
  const raw = generateRefreshToken();
  return { raw, hash: hashRefreshToken(raw), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) };
}

/**
 * A password nobody holds, not even briefly.
 *
 * The column is NOT NULL and every login path compares against it, so the
 * safest value is a real hash of something unguessable that is then thrown
 * away — an invited account fails password comparison like any wrong
 * password, with no special case in the login path to get wrong later.
 */
export async function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString('hex'));
}

export function invitationUrl(rawToken: string): string {
  return `${env.APP_BASE_URL}/accept-invitation?token=${rawToken}`;
}

/**
 * Sends the invitation and records that it went out. Never throws: the staff
 * account already exists by this point, and losing it because an email
 * provider had a bad minute would be a worse outcome than an admin pressing
 * Resend. The boolean is what the API reports back, so the dashboard can say
 * plainly that the account exists but the email did not arrive.
 */
export async function dispatchInvitation(staff: {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationName: string;
  rawToken: string;
}): Promise<boolean> {
  try {
    const sent = await emailService.sendStaffInvitationEmail({
      to: staff.email,
      name: staff.name,
      organizationName: staff.organizationName,
      role: staff.role,
      setupUrl: invitationUrl(staff.rawToken),
    });
    if (!sent) {
      // No address, no token, no link — an operator needs to know delivery
      // failed, not who it was for.
      logger.warn({ staffId: staff.id }, 'Staff invitation email was not delivered');
    }
    return sent;
  } catch (err) {
    logger.error({ err, staffId: staff.id }, 'Unexpected error dispatching a staff invitation');
    return false;
  }
}

/**
 * Issues a fresh invitation for someone who has not accepted yet.
 *
 * Writing a new hash is what invalidates the previous link: there is only one
 * slot, so the older raw value stops matching anything. The cooldown is
 * enforced on the stored send time rather than in memory, so it survives a
 * restart and cannot be sidestepped by a second dashboard tab.
 */
export async function resendInvitation(
  organizationId: string,
  staffId: string,
): Promise<{ emailSent: boolean }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, organizationId },
    include: { organization: { select: { name: true } } },
  });
  if (!staff) {
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');
  }
  if (staff.status !== 'PENDING_EMAIL_VERIFICATION' || !staff.invitationSentAt) {
    throw new AppError(
      409,
      'INVITATION_NOT_PENDING',
      'This staff member has already set up their account.',
    );
  }

  const waited = Date.now() - staff.invitationSentAt.getTime();
  if (waited < RESEND_COOLDOWN_MS) {
    throw new AppError(
      429,
      'INVITATION_RESEND_TOO_SOON',
      `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - waited) / 1000)} seconds before sending another invitation.`,
    );
  }

  const token = generateInvitationToken();
  await prisma.staff.update({
    where: { id: staff.id },
    data: {
      invitationTokenHash: token.hash,
      invitationExpiresAt: token.expiresAt,
      invitationSentAt: new Date(),
    },
  });

  const emailSent = await dispatchInvitation({
    id: staff.id,
    email: staff.email,
    name: staff.name,
    role: staff.role,
    organizationName: staff.organization.name,
    rawToken: token.raw,
  });

  return { emailSent };
}

/**
 * Redeems the link and sets the password the new member chose.
 *
 * Public and anonymous, exactly like email verification: possession of the
 * high-entropy value is the whole credential, and looking the account up by
 * token hash means no email address or id ever appears in the URL. One
 * generic failure covers "no such token", "expired" and "already used" —
 * the difference helps nobody but an attacker.
 */
export async function acceptInvitation(
  rawToken: string,
  password: string,
): Promise<{ id: string; email: string; organizationId: string }> {
  const hash = hashRefreshToken(rawToken);
  const staff = await prisma.staff.findFirst({
    where: { invitationTokenHash: hash, status: 'PENDING_EMAIL_VERIFICATION' },
  });

  if (!staff || !staff.invitationExpiresAt || staff.invitationExpiresAt < new Date()) {
    throw new AppError(
      400,
      'INVALID_OR_EXPIRED_TOKEN',
      'This invitation link is invalid or has expired. Ask an administrator to send a new one.',
    );
  }

  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: {
      passwordHash: await hashPassword(password),
      status: 'ACTIVE',
      // Single use: the slot is emptied, so the link cannot be replayed.
      invitationTokenHash: null,
      invitationExpiresAt: null,
    },
  });

  return { id: updated.id, email: updated.email, organizationId: updated.organizationId };
}
