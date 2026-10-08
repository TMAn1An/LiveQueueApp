import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma, type HeadSuccession, type HeadSuccessionReason, type Staff, type StaffRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getEffectivePermissions } from '../constants/permissions';
import { AppError } from '../utils/AppError';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateEmailLinkToken, hashRefreshToken } from '../utils/tokens';
import { passwordSchema } from '../validators/auth.validators';
import { loadActorSnapshot, personSnapshot, recordGovernanceEvent, type AuditActor } from './audit.service';
import { assertNoActiveServiceForStaff } from './counterAccess.service';
import { releaseOperatorCounter } from './counter.service';
import * as emailService from './email.service';
import { lockOrganization, lockStaffRows } from './governance.service';

/**
 * ADR-071: handing over the Organization Head role.
 *
 *  1. The current Head starts it — successor, reason, note — and re-enters
 *     their password. A 6-digit code is emailed to them (HMAC stored, 10
 *     minutes, 5 attempts). Status AWAITING_VERIFICATION.
 *  2. The Head enters the code. A one-time link (only its SHA-256 stored,
 *     72 hours) is emailed to the successor. Status AWAITING_ACCEPTANCE.
 *  3. The successor opens the link (validated before anything is shown),
 *     proves who they are — a new person chooses a password, an existing
 *     member re-enters theirs — and explicitly accepts responsibility.
 *  4. In ONE transaction, under the organization lock: the link is consumed
 *     by a conditional update, both people are re-checked, the current
 *     tenure ends, the former Head's account is deleted (sessions, reset
 *     links and access go with it — their email becomes free), the successor
 *     becomes the only OWNER, a new tenure starts, and every step is audited.
 *
 * Nothing changes merely because an email was sent. At most one handover is
 * open per organization (partial unique index). Cancel, decline, expiry and
 * acceptance are all conditional state transitions, so exactly one wins.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const LINK_TTL_MS = 72 * 60 * 60 * 1000;
const RESEND_LINK_COOLDOWN_MS = 60 * 1000;
const OPEN_STATUSES = ['AWAITING_VERIFICATION', 'AWAITING_ACCEPTANCE'] as const;

export const ACCEPTANCE_STATEMENT =
  'I accept responsibility as the Organization Head of {organization}. I understand that the current Organization Head will lose access when this handover is completed.';

export interface HeadActor {
  staffId: string;
  organizationId: string;
  role: StaffRole;
  email: string;
}

export interface StartSuccessionInput {
  successorEmail: string;
  successorName?: string;
  reason: HeadSuccessionReason;
  note?: string;
  currentPassword: string;
}

function codeHash(successionId: string, code: string): string {
  return createHmac('sha256', env.OTP_SECRET).update(`head-succession\0${successionId}\0${code}`).digest('hex');
}

function codeMatches(successionId: string, code: string, stored: string): boolean {
  const a = Buffer.from(codeHash(successionId, code));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function acceptUrl(rawToken: string): string {
  return `${env.APP_BASE_URL}/accept-leadership?token=${rawToken}`;
}

function invalidLink(): AppError {
  return new AppError(
    400,
    'HEAD_SUCCESSION_INVALID',
    'This handover link has expired or is no longer valid.',
  );
}

function notEligible(message: string): AppError {
  return new AppError(409, 'HEAD_SUCCESSOR_NOT_ELIGIBLE', message);
}

function requireHead(actor: HeadActor): void {
  if (actor.role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Only the Organization Head can hand over leadership.');
  }
}

function auditActorFor(staff: { id: string; email: string; organizationId: string; role?: string }): AuditActor {
  return { staffId: staff.id, staffEmail: staff.email, organizationId: staff.organizationId, role: staff.role };
}

/**
 * Who may become Head (ADR-071 D7): a new person (an email not in use
 * anywhere), or an ACTIVE Organization Manager or Executive of this
 * organization. An Admin qualifies only once they have no live queue and no
 * Executives — their workspace is handed over first. Never a pending
 * invitee, a suspended account, a member of another organization, or the
 * current Head.
 */
async function resolveSuccessor(
  client: Prisma.TransactionClient,
  organizationId: string,
  email: string,
): Promise<Staff | null> {
  const existing = await client.staff.findUnique({ where: { email } });
  if (!existing) return null;
  if (existing.organizationId !== organizationId) {
    throw notEligible('This email belongs to an account that cannot take over this organization.');
  }
  if (existing.role === 'OWNER') {
    throw notEligible('You are already the Organization Head.');
  }
  if (existing.status === 'PENDING_EMAIL_VERIFICATION') {
    throw notEligible(`${existing.name} has not accepted their invitation yet.`);
  }
  if (existing.status !== 'ACTIVE') {
    throw notEligible(`${existing.name}'s account is suspended.`);
  }
  if (existing.role === 'ADMIN') {
    const [queue, executives] = await Promise.all([
      client.queue.findFirst({ where: { adminId: existing.id, deletedAt: null }, select: { name: true } }),
      client.staff.count({ where: { workspaceAdminId: existing.id } }),
    ]);
    if (queue || executives > 0) {
      throw notEligible(
        `${existing.name} manages ${queue ? queue.name : 'an Admin workspace'}. Hand their workspace to another Admin first.`,
      );
    }
  }
  return existing;
}

/** Marks every open handover of this organization whose code or link has
 * lapsed as EXPIRED (lazy cleanup; the scheduler does the same). */
async function expireLapsed(client: Prisma.TransactionClient, organizationId?: string): Promise<number> {
  const now = new Date();
  const result = await client.headSuccession.updateMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      OR: [
        { status: 'AWAITING_VERIFICATION', verificationExpiresAt: { lt: now } },
        { status: 'AWAITING_ACCEPTANCE', successorTokenExpiresAt: { lt: now } },
      ],
    },
    data: { status: 'EXPIRED', expiredAt: now, verificationCodeHash: null, successorTokenHash: null },
  });
  return result.count;
}

/** Scheduler entry point: expire lapsed handovers everywhere. */
export async function expireLapsedSuccessions(): Promise<number> {
  return expireLapsed(prisma);
}

function serializeSuccession(s: HeadSuccession) {
  return {
    id: s.id,
    status: s.status,
    successor: { name: s.successorName, email: s.successorEmail, existingMember: s.successorStaffId !== null },
    reason: s.reason,
    note: s.note,
    initiatedBy: { id: s.initiatedByStaffId, name: s.initiatedByName },
    verificationExpiresAt: s.verificationExpiresAt,
    attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - s.verificationAttempts),
    successorLinkExpiresAt: s.successorTokenExpiresAt,
    verifiedAt: s.verifiedAt,
    acceptedAt: s.acceptedAt,
    declinedAt: s.declinedAt,
    cancelledAt: s.cancelledAt,
    expiredAt: s.expiredAt,
    createdAt: s.createdAt,
  };
}

// ---------------------------------------------------------------------------
// 1. Start
// ---------------------------------------------------------------------------

export async function startSuccession(actor: HeadActor, input: StartSuccessionInput, ipAddress?: string) {
  requireHead(actor);
  if (input.reason === 'OTHER' && (input.note?.trim().length ?? 0) < 10) {
    throw new AppError(422, 'SUCCESSION_NOTE_REQUIRED', 'Describe the reason in at least 10 characters when choosing Other.');
  }
  const head = await prisma.staff.findUnique({ where: { id: actor.staffId } });
  if (!head || head.role !== 'OWNER') throw new AppError(403, 'FORBIDDEN', 'Only the Organization Head can hand over leadership.');
  if (!(await verifyPassword(input.currentPassword, head.passwordHash))) {
    // 403, not 401: a wrong re-entered password must not end the session.
    throw new AppError(403, 'CURRENT_PASSWORD_INCORRECT', 'That password is not correct.');
  }
  const successorEmail = input.successorEmail.trim().toLowerCase();
  if (successorEmail === head.email.toLowerCase()) {
    throw notEligible('You are already the Organization Head.');
  }

  const code = newCode();
  let created: HeadSuccession;
  try {
    created = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, actor.organizationId);
      await expireLapsed(tx, actor.organizationId);
      const open = await tx.headSuccession.findFirst({
        where: { organizationId: actor.organizationId, status: { in: [...OPEN_STATUSES] } },
      });
      if (open) throw alreadyPending();
      const existing = await resolveSuccessor(tx, actor.organizationId, successorEmail);
      const successorName = existing?.name ?? input.successorName?.trim();
      if (!successorName) {
        throw new AppError(422, 'SUCCESSOR_NAME_REQUIRED', "Enter the successor's name.");
      }
      const row = await tx.headSuccession.create({
        data: {
          organizationId: actor.organizationId,
          initiatedByStaffId: head.id,
          initiatedByName: head.name,
          initiatedByEmail: head.email,
          successorEmail,
          successorName,
          successorStaffId: existing?.id ?? null,
          reason: input.reason,
          note: input.note?.trim() || null,
          verificationExpiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });
      const withCode = await tx.headSuccession.update({
        where: { id: row.id },
        data: { verificationCodeHash: codeHash(row.id, code) },
      });
      await recordGovernanceEvent(tx, {
        actor: auditActorFor(head),
        actorSnapshot: personSnapshot(head),
        action: 'head_succession_started',
        entityType: 'head_succession',
        entityId: row.id,
        metadata: {
          successor: { name: successorName, email: successorEmail, staffId: existing?.id ?? null },
          reason: input.reason,
          passwordConfirmed: true,
        },
        workspaceAdminId: null,
        ipAddress,
      });
      return withCode;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw alreadyPending();
    throw err;
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: { name: true },
  });
  const emailSent = await emailService.sendHeadSuccessionCodeEmail({
    to: head.email,
    name: head.name,
    organizationName: organization.name,
    successorName: created.successorName,
    code,
    expiresInMinutes: CODE_TTL_MS / 60_000,
  });
  if (!emailSent) logger.warn({ successionId: created.id }, 'Leadership handover code email was not delivered');
  return { ...serializeSuccession(created), codeEmailSent: emailSent };
}

function alreadyPending(): AppError {
  return new AppError(
    409,
    'HEAD_SUCCESSION_ALREADY_PENDING',
    'A leadership handover is already in progress. Cancel it before starting another.',
  );
}

/** Locks and returns this organization's open handover with that id. */
async function lockOpenSuccession(tx: Prisma.TransactionClient, organizationId: string, successionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM head_successions WHERE id = ${successionId} AND organization_id = ${organizationId} FOR UPDATE
  `;
  const succession = rows[0] ? await tx.headSuccession.findUnique({ where: { id: rows[0].id } }) : null;
  if (!succession) throw new AppError(404, 'HEAD_SUCCESSION_NOT_FOUND', 'Leadership handover not found.');
  return succession;
}

// ---------------------------------------------------------------------------
// 2. Verify the emailed code
// ---------------------------------------------------------------------------

export async function verifySuccession(actor: HeadActor, successionId: string, code: string, ipAddress?: string) {
  requireHead(actor);
  const rawToken = generateEmailLinkToken();
  const outcome = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor.organizationId);
    const s = await lockOpenSuccession(tx, actor.organizationId, successionId);
    if (s.initiatedByStaffId !== actor.staffId) {
      throw new AppError(404, 'HEAD_SUCCESSION_NOT_FOUND', 'Leadership handover not found.');
    }
    if (s.status !== 'AWAITING_VERIFICATION') {
      throw new AppError(409, 'HEAD_SUCCESSION_INVALID', 'This handover is not waiting for a code.');
    }
    const now = new Date();
    if (!s.verificationExpiresAt || s.verificationExpiresAt < now || !s.verificationCodeHash) {
      await tx.headSuccession.update({
        where: { id: s.id },
        data: { status: 'EXPIRED', expiredAt: now, verificationCodeHash: null },
      });
      await auditSimple(tx, actor, s, 'head_succession_expired', { stage: 'verification' }, ipAddress);
      return { kind: 'expired' as const };
    }
    if (!codeMatches(s.id, code, s.verificationCodeHash)) {
      const attempts = s.verificationAttempts + 1;
      const exhausted = attempts >= CODE_MAX_ATTEMPTS;
      await tx.headSuccession.update({
        where: { id: s.id },
        data: exhausted
          ? { verificationAttempts: attempts, status: 'EXPIRED', expiredAt: now, verificationCodeHash: null }
          : { verificationAttempts: attempts },
      });
      if (exhausted) {
        await auditSimple(tx, actor, s, 'head_succession_expired', { stage: 'verification', reason: 'attempts' }, ipAddress);
      }
      return { kind: exhausted ? ('exhausted' as const) : ('wrong' as const), attemptsLeft: CODE_MAX_ATTEMPTS - attempts };
    }
    // The successor may have changed since the start (left, been suspended,
    // taken a queue): checked again before anything is sent.
    const successor = await resolveSuccessor(tx, actor.organizationId, s.successorEmail);
    const updated = await tx.headSuccession.update({
      where: { id: s.id },
      data: {
        status: 'AWAITING_ACCEPTANCE',
        verifiedAt: now,
        verificationCodeHash: null,
        successorStaffId: successor?.id ?? null,
        successorTokenHash: hashRefreshToken(rawToken),
        successorTokenExpiresAt: new Date(now.getTime() + LINK_TTL_MS),
      },
    });
    await auditSimple(tx, actor, s, 'head_succession_verified', { emailCodeConfirmed: true }, ipAddress);
    return { kind: 'verified' as const, succession: updated };
  });

  if (outcome.kind === 'expired') {
    throw new AppError(410, 'HEAD_SUCCESSION_EXPIRED', 'The code has expired. Start the handover again.');
  }
  if (outcome.kind === 'exhausted') {
    throw new AppError(429, 'HEAD_SUCCESSION_EXPIRED', 'Too many incorrect codes. Start the handover again.');
  }
  if (outcome.kind !== 'verified') {
    throw new AppError(422, 'HEAD_SUCCESSION_CODE_INCORRECT', 'That code is not correct.', {
      attemptsLeft: outcome.attemptsLeft,
    });
  }
  const emailSent = await sendSuccessorLink(outcome.succession, rawToken);
  return { ...serializeSuccession(outcome.succession), successorEmailSent: emailSent };
}

async function sendSuccessorLink(s: HeadSuccession, rawToken: string): Promise<boolean> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: s.organizationId },
    select: { name: true },
  });
  const sent = await emailService.sendHeadSuccessorInvitationEmail({
    to: s.successorEmail,
    successorName: s.successorName,
    organizationName: organization.name,
    currentHeadName: s.initiatedByName,
    reasonLabel: emailService.SUCCESSION_REASON_LABELS[s.reason] ?? 'Other',
    acceptUrl: acceptUrl(rawToken),
    expiresInHours: LINK_TTL_MS / 3_600_000,
  });
  if (!sent) logger.warn({ successionId: s.id }, 'Leadership handover link email was not delivered');
  return sent;
}

async function auditSimple(
  tx: Prisma.TransactionClient,
  actor: HeadActor,
  s: HeadSuccession,
  action: 'head_succession_verified' | 'head_succession_cancelled' | 'head_succession_expired',
  metadata: Record<string, unknown>,
  ipAddress?: string,
) {
  await recordGovernanceEvent(tx, {
    actor: { staffId: actor.staffId, staffEmail: actor.email, organizationId: actor.organizationId, role: actor.role },
    actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
    action,
    entityType: 'head_succession',
    entityId: s.id,
    metadata: { successor: { name: s.successorName, email: s.successorEmail }, ...metadata },
    workspaceAdminId: null,
    ipAddress,
  });
}

/** A fresh successor link (the previous one stops working), for when the
 * first email did not arrive. */
export async function resendSuccessorLink(actor: HeadActor, successionId: string) {
  requireHead(actor);
  const rawToken = generateEmailLinkToken();
  const updated = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor.organizationId);
    const s = await lockOpenSuccession(tx, actor.organizationId, successionId);
    if (s.status !== 'AWAITING_ACCEPTANCE' || s.initiatedByStaffId !== actor.staffId) {
      throw new AppError(409, 'HEAD_SUCCESSION_INVALID', 'This handover is not waiting for the successor.');
    }
    if (Date.now() - s.updatedAt.getTime() < RESEND_LINK_COOLDOWN_MS) {
      throw new AppError(429, 'HEAD_SUCCESSION_RESEND_TOO_SOON', 'Please wait a minute before sending the link again.');
    }
    return tx.headSuccession.update({
      where: { id: s.id },
      data: {
        successorTokenHash: hashRefreshToken(rawToken),
        successorTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS),
      },
    });
  });
  const emailSent = await sendSuccessorLink(updated, rawToken);
  return { ...serializeSuccession(updated), successorEmailSent: emailSent };
}

// ---------------------------------------------------------------------------
// Cancel (current Head, before acceptance)
// ---------------------------------------------------------------------------

export async function cancelSuccession(actor: HeadActor, successionId: string, ipAddress?: string) {
  requireHead(actor);
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor.organizationId);
    const s = await lockOpenSuccession(tx, actor.organizationId, successionId);
    if (!(OPEN_STATUSES as readonly string[]).includes(s.status)) {
      throw new AppError(409, 'HEAD_SUCCESSION_INVALID', 'This handover has already ended.');
    }
    const now = new Date();
    // Conditional on still being open: a concurrent acceptance holding the
    // same locks either finished first (and this finds it closed) or waits.
    const updated = await tx.headSuccession.update({
      where: { id: s.id },
      data: { status: 'CANCELLED', cancelledAt: now, verificationCodeHash: null, successorTokenHash: null },
    });
    await auditSimple(tx, actor, s, 'head_succession_cancelled', {}, ipAddress);
    return serializeSuccession(updated);
  });
}

// ---------------------------------------------------------------------------
// Reading (Head, Manager; others see the current Head only)
// ---------------------------------------------------------------------------

export async function getLeadership(actor: HeadActor) {
  const tenures = await prisma.organizationHeadTenure.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { startedAt: 'desc' },
  });
  const current = tenures.find((t) => t.endedAt === null) ?? null;
  const currentView = current ? { name: current.name, since: current.startedAt } : null;
  if (actor.role !== 'OWNER' && actor.role !== 'MANAGER') {
    // ADR-071 D5: Admins and Executives see who leads, nothing more.
    return { current: currentView, previous: null, succession: null };
  }
  const isHead = actor.role === 'OWNER';
  const previous = tenures
    .filter((t) => t.endedAt !== null)
    .map((t) => ({
      name: t.name,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      startType: t.startType,
      reason: t.endReason,
      // Private to the Organization Head (D5/D10).
      ...(isHead ? { note: t.endNote, email: t.email } : {}),
    }));
  let succession = null;
  if (isHead) {
    await expireLapsed(prisma, actor.organizationId);
    const latest = await prisma.headSuccession.findFirst({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    succession = latest ? serializeSuccession(latest) : null;
  }
  return { current: currentView, previous, succession };
}

// ---------------------------------------------------------------------------
// 3–4. The successor: validate, accept, decline (public; the link is the
// credential)
// ---------------------------------------------------------------------------

async function findByToken(rawToken: string) {
  if (!rawToken) return null;
  return prisma.headSuccession.findUnique({ where: { successorTokenHash: hashRefreshToken(rawToken) } });
}

/**
 * Says only whether the link can be used, plus what the successor needs to
 * decide — never why an unusable link is unusable (missing, expired, used,
 * cancelled and declined all look the same).
 */
export async function validateSuccessorLink(rawToken: string) {
  const s = await findByToken(rawToken);
  if (!s || s.status !== 'AWAITING_ACCEPTANCE' || !s.successorTokenExpiresAt || s.successorTokenExpiresAt < new Date()) {
    return { valid: false as const };
  }
  const organization = await prisma.organization.findUnique({
    where: { id: s.organizationId },
    select: { name: true, status: true },
  });
  if (!organization || organization.status !== 'ACTIVE') return { valid: false as const };
  return {
    valid: true as const,
    organizationName: organization.name,
    currentHeadName: s.initiatedByName,
    reason: s.reason,
    successorName: s.successorName,
    successorEmail: s.successorEmail,
    /** A new person chooses a password; an existing member re-enters theirs. */
    existingMember: s.successorStaffId !== null,
    acceptanceStatement: ACCEPTANCE_STATEMENT.replace('{organization}', organization.name),
  };
}

export async function acceptSuccession(
  rawToken: string,
  input: { password: string; acknowledged: boolean },
  ipAddress?: string,
) {
  if (input.acknowledged !== true) {
    throw new AppError(422, 'ACKNOWLEDGEMENT_REQUIRED', 'Confirm that you accept responsibility as Organization Head.');
  }
  const found = await findByToken(rawToken);
  if (!found) throw invalidLink();
  const tokenHash = hashRefreshToken(rawToken);
  // Hashing a new password is slow; do it before taking any lock. Only used
  // when the successor is a new person.
  if (!found.successorStaffId) {
    const strong = passwordSchema.safeParse(input.password);
    if (!strong.success) {
      throw new AppError(422, 'VALIDATION_ERROR', strong.error.issues[0]?.message ?? 'Choose a stronger password.');
    }
  }
  const newPasswordHash = found.successorStaffId ? null : await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockOrganization(tx, found.organizationId))) throw invalidLink();
    const s = await lockOpenSuccession(tx, found.organizationId, found.id).catch(() => {
      throw invalidLink();
    });
    const now = new Date();
    if (s.status !== 'AWAITING_ACCEPTANCE' || s.successorTokenHash !== tokenHash) throw invalidLink();
    if (!s.successorTokenExpiresAt || s.successorTokenExpiresAt < now) {
      await tx.headSuccession.update({
        where: { id: s.id },
        data: { status: 'EXPIRED', expiredAt: now, successorTokenHash: null },
      });
      return { kind: 'expired' as const };
    }
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
    if (organization.status !== 'ACTIVE') throw invalidLink();

    // The person who started it must still be the Head.
    const formerHead = await tx.staff.findFirst({
      where: { id: s.initiatedByStaffId, organizationId: s.organizationId, role: 'OWNER' },
    });
    if (!formerHead) throw invalidLink();

    // The successor must still qualify — and must be who the link was for.
    const existing = await resolveSuccessor(tx, s.organizationId, s.successorEmail);
    if ((existing?.id ?? null) !== (s.successorStaffId ?? null)) {
      // Became a member, or left, since the link was sent: the Head starts again.
      throw notEligible('This handover no longer matches the successor’s account. Ask for a new handover.');
    }
    if (existing) {
      await lockStaffRows(tx, s.organizationId, [existing.id, formerHead.id]);
      if (!(await verifyPassword(input.password, existing.passwordHash))) {
        throw new AppError(403, 'CURRENT_PASSWORD_INCORRECT', 'That password is not correct.');
      }
    }

    // The former Head may still hold a counter (legacy queues): never strand
    // someone they are serving.
    await assertNoActiveServiceForStaff(tx, formerHead.id);
    await releaseOperatorCounter(tx, formerHead.id);

    // Close the current tenure.
    const currentTenure = await tx.organizationHeadTenure.findFirst({
      where: { organizationId: s.organizationId, endedAt: null },
    });
    if (currentTenure) {
      await tx.organizationHeadTenure.update({
        where: { id: currentTenure.id },
        data: { endedAt: now, endReason: s.reason, endNote: s.note },
      });
    }

    // Consume the link — conditional, so exactly one acceptance wins.
    const consumed = await tx.headSuccession.updateMany({
      where: { id: s.id, status: 'AWAITING_ACCEPTANCE', successorTokenHash: tokenHash },
      data: { status: 'COMPLETED', acceptedAt: now, successorTokenHash: null },
    });
    if (consumed.count !== 1) throw invalidLink();

    // The former Head's account goes: sessions, reset links and counters with
    // it (foreign-key cascades), and their email becomes free.
    await tx.staff.delete({ where: { id: formerHead.id } });

    const successor = existing
      ? await tx.staff.update({
          where: { id: existing.id },
          data: { role: 'OWNER', permissions: getEffectivePermissions('OWNER'), workspaceAdminId: null },
        })
      : await tx.staff.create({
          data: {
            organizationId: s.organizationId,
            name: s.successorName,
            email: s.successorEmail,
            passwordHash: newPasswordHash!,
            role: 'OWNER',
            permissions: getEffectivePermissions('OWNER'),
            // The link proved the mailbox; the password was chosen now.
            status: 'ACTIVE',
          },
        });
    if (existing) {
      // A Head operates no Admin's queue; their counter (if any) is released.
      await releaseOperatorCounter(tx, successor.id, { keepIfEligible: true });
    }

    const newTenure = await tx.organizationHeadTenure.create({
      data: {
        organizationId: s.organizationId,
        staffId: successor.id,
        name: successor.name,
        email: successor.email,
        startedAt: now,
        startType: 'SUCCESSION',
        predecessorTenureId: currentTenure?.id ?? null,
        successionId: s.id,
      },
    });

    const actor = auditActorFor(successor);
    const actorSnapshot = personSnapshot(successor);
    const base = { actor, actorSnapshot, workspaceAdminId: null, ipAddress } as const;
    await recordGovernanceEvent(tx, {
      ...base,
      action: 'head_succession_completed',
      entityType: 'head_succession',
      entityId: s.id,
      metadata: {
        formerHead: personSnapshot(formerHead),
        newHead: personSnapshot(successor),
        successorWasMember: existing !== null,
        previousRole: existing?.role ?? null,
        reason: s.reason,
        acknowledged: true,
      },
    });
    await recordGovernanceEvent(tx, {
      ...base,
      action: 'head_tenure_ended',
      entityType: 'organization_head_tenure',
      entityId: currentTenure?.id,
      metadata: { head: personSnapshot(formerHead), reason: s.reason },
    });
    await recordGovernanceEvent(tx, {
      ...base,
      action: 'head_tenure_started',
      entityType: 'organization_head_tenure',
      entityId: newTenure.id,
      metadata: { head: personSnapshot(successor), predecessorTenureId: currentTenure?.id ?? null },
    });
    await recordGovernanceEvent(tx, {
      ...base,
      action: 'staff_sessions_revoked',
      entityType: 'staff',
      entityId: formerHead.id,
      metadata: { target: personSnapshot(formerHead), cause: 'head_succession', accountDeleted: true },
    });

    return {
      kind: 'completed' as const,
      organizationName: organization.name,
      formerHead: { id: formerHead.id, name: formerHead.name, email: formerHead.email },
      newHead: { id: successor.id, name: successor.name, email: successor.email },
      successorWasMember: existing !== null,
    };
  });

  if (result.kind === 'expired') throw invalidLink();

  await Promise.all([
    emailService.sendHeadSuccessionOutcomeEmail({
      to: result.formerHead.email,
      name: result.formerHead.name,
      organizationName: result.organizationName,
      outcome: 'COMPLETED_FORMER',
      otherName: result.newHead.name,
    }),
    emailService.sendHeadSuccessionOutcomeEmail({
      to: result.newHead.email,
      name: result.newHead.name,
      organizationName: result.organizationName,
      outcome: 'COMPLETED_NEW',
      otherName: result.formerHead.name,
    }),
  ]);
  return result;
}

export async function declineSuccession(rawToken: string, ipAddress?: string) {
  const found = await findByToken(rawToken);
  if (!found) throw invalidLink();
  const tokenHash = hashRefreshToken(rawToken);
  const declined = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, found.organizationId);
    const now = new Date();
    const updated = await tx.headSuccession.updateMany({
      where: {
        id: found.id,
        status: 'AWAITING_ACCEPTANCE',
        successorTokenHash: tokenHash,
        successorTokenExpiresAt: { gt: now },
      },
      data: { status: 'DECLINED', declinedAt: now, successorTokenHash: null },
    });
    if (updated.count !== 1) throw invalidLink();
    const s = await tx.headSuccession.findUniqueOrThrow({ where: { id: found.id } });
    await recordGovernanceEvent(tx, {
      // The person declining may have no account here; they are recorded by
      // the email the link was sent to.
      actor: {
        staffId: s.successorStaffId ?? `successor:${s.id}`,
        staffEmail: s.successorEmail,
        organizationId: s.organizationId,
      },
      action: 'head_succession_declined',
      entityType: 'head_succession',
      entityId: s.id,
      metadata: { successor: { name: s.successorName, email: s.successorEmail }, initiatedBy: s.initiatedByName },
      workspaceAdminId: null,
      ipAddress,
    });
    return s;
  });
  const organization = await prisma.organization.findUnique({
    where: { id: declined.organizationId },
    select: { name: true },
  });
  await emailService.sendHeadSuccessionOutcomeEmail({
    to: declined.initiatedByEmail,
    name: declined.initiatedByName,
    organizationName: organization?.name ?? '',
    outcome: 'DECLINED',
    otherName: declined.successorName,
  });
  return { declined: true };
}
