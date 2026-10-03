import { Prisma, type Organization } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { isValidTimezone } from '../utils/customerIdentity';
import { organizationNameKey } from '../utils/organizationName';
import { recordAuditEvent } from './audit.service';

function requireOwner(role: string): void {
  if (role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Only the organization owner can perform this action.');
  }
}

function serializeOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    status: organization.status,
    /// ADR-035: the clock every queue inherits unless it overrides one.
    timezone: organization.timezone,
    /// V2 Product Completion checkpoint, Part C: null is the trigger for
    /// the dashboard to show the first-time tutorial.
    onboardingCompletedAt: organization.onboardingCompletedAt,
    // ADR-068: the code in the organization's one public QR (/visit/{code}).
    publicCode: organization.publicCode,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

const NAME_TAKEN_MESSAGE = 'That organization name is already taken. Please choose another.';

export function organizationNameTakenError(): AppError {
  return new AppError(409, 'ORGANIZATION_NAME_TAKEN', NAME_TAKEN_MESSAGE);
}

/** A name held only by a sign-up that was never verified and whose hour has
 * run out — exactly what the pending-registration cleanup deletes. */
async function isLapsedPendingRegistration(organizationId: string): Promise<boolean> {
  const staff = await prisma.staff.findMany({
    where: { organizationId },
    select: { role: true, status: true, registrationExpiresAt: true },
  });
  return (
    staff.length > 0 &&
    staff.every(
      (s) =>
        s.role === 'OWNER' &&
        s.status === 'PENDING_EMAIL_VERIFICATION' &&
        s.registrationExpiresAt != null &&
        s.registrationExpiresAt.getTime() <= Date.now(),
    )
  );
}

/**
 * Whether a name can be used (case-insensitively, like a username). A lapsed,
 * never-verified sign-up does not hold its name: it reads as available here,
 * and `claimOrganizationName` frees it for whoever registers next. Never
 * reports anything about the organization holding a taken name.
 */
export async function isOrganizationNameAvailable(name: string, exceptOrganizationId?: string): Promise<boolean> {
  const holder = await prisma.organization.findUnique({
    where: { nameKey: organizationNameKey(name) },
    select: { id: true },
  });
  if (!holder || holder.id === exceptOrganizationId) return true;
  return isLapsedPendingRegistration(holder.id);
}

/**
 * Called before creating or renaming an organization: frees a name held only
 * by a lapsed sign-up, otherwise refuses a taken one. The unique index on
 * name_key remains the final guard against two simultaneous claims.
 */
export async function claimOrganizationName(name: string, exceptOrganizationId?: string): Promise<string> {
  const nameKey = organizationNameKey(name);
  const holder = await prisma.organization.findUnique({ where: { nameKey }, select: { id: true } });
  if (holder && holder.id !== exceptOrganizationId) {
    if (!(await isLapsedPendingRegistration(holder.id))) {
      throw organizationNameTakenError();
    }
    await prisma.organization.deleteMany({ where: { id: holder.id } });
  }
  return nameKey;
}

/** Turns the unique-index violation on name_key into the friendly 409. */
export function isOrganizationNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes('name_key') || target.includes('nameKey') : String(target).includes('name_key');
}

/** Any authenticated staff member may view their own organization's info. */
export async function getOrganization(organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
  }
  return serializeOrganization(organization);
}

/**
 * Spec 7.1 scopes organization editing to the owner. Only `name` is mutable
 * here — the schema has no organization-level customer-terminology or
 * default-queue-settings columns (those already exist per-queue since Phase
 * 2's `Queue.clientTerminology`/`baseTimeMinutes`/`defaultNotificationMinutes`
 * — see ADR-019 for why Phase 6 does not add organization-wide duplicates of
 * those fields).
 */
export async function updateOrganization(
  organizationId: string,
  role: string,
  input: { name?: string; timezone?: string | null },
) {
  requireOwner(role);
  // ADR-035: an unrecognized zone is refused rather than stored, because
  // every later date calculation would fail on it instead.
  if (input.timezone && !isValidTimezone(input.timezone)) {
    throw new AppError(422, 'INVALID_TIMEZONE', 'That is not a recognized timezone.');
  }
  // A rename must not take a name another organization already holds;
  // renaming to a different capitalisation of its own name is always fine.
  const nameKey =
    input.name !== undefined ? await claimOrganizationName(input.name, organizationId) : undefined;
  try {
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name, nameKey } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone || null } : {}),
      },
    });
    return serializeOrganization(organization);
  } catch (err) {
    if (isOrganizationNameConflict(err)) throw organizationNameTakenError();
    throw err;
  }
}

/**
 * V2 Product Completion checkpoint, Part C. Owner-only, matching every other
 * mutation on this row (requireOwner) — the tutorial is specifically the
 * *owner's* setup walkthrough, so an ADMIN completing or restarting it on
 * the owner's behalf would be a stranger deciding someone else's onboarding
 * state. Idempotent: completing an already-completed tutorial just refreshes
 * the timestamp rather than erroring.
 */
export async function completeOnboarding(organizationId: string, role: string) {
  requireOwner(role);
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { onboardingCompletedAt: new Date() },
  });
  return serializeOrganization(organization);
}

/**
 * Clears the completion marker so the dashboard shows the tutorial again on
 * next load — nothing else about the organization changes. This is the only
 * way `onboardingCompletedAt` ever goes from non-null back to null after the
 * backfill migration; a fresh organization starts null on its own.
 */
export async function restartOnboarding(organizationId: string, role: string) {
  requireOwner(role);
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { onboardingCompletedAt: null },
  });
  return serializeOrganization(organization);
}

/**
 * Destructive. The UI confirmation (spec 7.1: type the organization name)
 * is re-verified server-side, not trusted as frontend-only (CLAUDE.md
 * section 10). Deletion itself is a single Prisma delete — every dependent
 * row (Staff, Session, Queue, QueueService, Counter, QueueFormField, Token)
 * cascades at the database level via the existing `onDelete: Cascade`
 * relations already defined in the schema; Device rows are deliberately left
 * untouched (ADR-011 — a device is a global identity, not organization-owned).
 *
 * The audit write (Phase 7 Step 5) is deliberately the one exception to this
 * codebase's "audit failures never break the business operation" rule
 * (recordAuditEventSafely, used everywhere else): it happens here, before
 * the delete, using the throwing recordAuditEvent — if it fails, deletion
 * aborts entirely rather than silently destroying the organization with no
 * surviving evidence that it happened. AuditLog has no FK to Organization
 * (Phase 7 Step 4), so the row survives the cascade below regardless.
 */
export async function deleteOrganization(
  organizationId: string,
  role: string,
  confirmName: string,
  actor: { staffId: string; staffEmail: string },
  ipAddress?: string,
) {
  requireOwner(role);

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
  }

  if (confirmName !== organization.name) {
    throw new AppError(
      422,
      'ORGANIZATION_NAME_MISMATCH',
      'The typed organization name does not match. Deletion was not performed.',
    );
  }

  await recordAuditEvent({
    actor: { staffId: actor.staffId, organizationId, staffEmail: actor.staffEmail },
    action: 'organization_deletion_requested',
    entityType: 'organization',
    entityId: organizationId,
    metadata: { organizationName: organization.name },
    ipAddress,
  });

  await prisma.organization.delete({ where: { id: organizationId } });
}
