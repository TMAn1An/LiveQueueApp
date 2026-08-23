import type { Organization } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

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
 */
export async function deleteOrganization(
  organizationId: string,
  role: string,
  confirmName: string,
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

  await prisma.organization.delete({ where: { id: organizationId } });
}
