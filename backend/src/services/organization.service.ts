import type { Organization } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
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
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
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
export async function updateOrganization(organizationId: string, role: string, name: string) {
  requireOwner(role);
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { name },
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
