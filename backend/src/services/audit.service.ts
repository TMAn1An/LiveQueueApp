import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { AuditAction } from '../constants/auditActions';

/**
 * Case-insensitive substring match against metadata keys. Mirrors the
 * philosophy of src/config/logger.ts's Pino redaction paths, but stronger:
 * these rows persist in the database indefinitely, so a matching key is
 * dropped entirely rather than masked. Covers every category CLAUDE.md
 * section 10 and the Phase 7 Step 4 decision both name: passwords, hashes,
 * access/refresh/FCM tokens, API keys, and generic credential/secret/auth
 * material.
 */
const FORBIDDEN_METADATA_KEY_PATTERN =
  /password|hash|token|secret|api[-_]?key|credential|authorization|cookie/i;

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export interface AuditActor {
  staffId: string;
  organizationId: string;
  staffEmail: string;
}

/**
 * Maps the already-authenticated req.auth shape onto an AuditActor, so
 * every controller call site builds the actor the same way (Phase 7 Step
 * 5). Takes the narrow shape directly rather than Express's Request type —
 * this service layer stays framework-agnostic, matching every other service
 * in this codebase.
 */
export function actorFromAuth(auth: {
  staffId: string;
  organizationId: string;
  email: string;
}): AuditActor {
  return { staffId: auth.staffId, organizationId: auth.organizationId, staffEmail: auth.email };
}

export interface RecordAuditEventInput {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * The only place that writes an AuditLog row (CLAUDE.md: centralize
 * business-critical writes rather than scattering raw Prisma calls across
 * controllers/services). organizationId/staffId/staffEmail are written as
 * plain snapshot values, matching the schema's deliberate no-FK design —
 * this function has no dependency on the Organization/Staff rows still
 * existing at call time, and none of its callers need to either.
 *
 * Not yet called from any real controller/service — Phase 7 Step 4
 * establishes the foundation only. Wiring real write sites (staff, queue,
 * counter, token, organization-deletion, blocked-device, login/logout) is
 * Step 5.
 */
export async function recordAuditEvent(input: RecordAuditEventInput) {
  return prisma.auditLog.create({
    data: {
      organizationId: input.actor.organizationId,
      staffId: input.actor.staffId,
      staffEmail: input.actor.staffEmail,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: sanitizeMetadata(input.metadata) as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  });
}

/**
 * What every real controller call site actually calls (Phase 7 Step 5).
 * Mirrors realtime/emit.ts's `guarded()` pattern exactly: an audit-write
 * failure must never turn an already-successful business operation into a
 * failed API request (approved Step 5 decision B) — so this never throws,
 * only logs. The one deliberate exception is organization deletion, which
 * calls the throwing recordAuditEvent directly (see organization.service.ts)
 * because that record must be written before an irreversible delete, not
 * safely-after like every other action.
 */
export async function recordAuditEventSafely(input: RecordAuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (err) {
    logger.error({ err, action: input.action }, 'Audit event recording failed');
  }
}

/**
 * Tenant-scoped, paginated, newest-first — matches the existing device/staff
 * list pattern.
 *
 * Search is server-side (the table is paginated and grows without bound, so
 * client-side filtering would hide matches on other pages) and covers only
 * the four plain text columns already rendered in the dashboard table:
 * staff email, action, entity type, and entity id. `metadata` is
 * deliberately NOT searched — it is arbitrary per-action JSON, and
 * stringifying it into a search surface is exactly how sanitized-but-
 * sensitive detail leaks back out (see this file's own
 * FORBIDDEN_METADATA_KEY_PATTERN).
 *
 * `organizationId` stays a top-level (AND-ed) condition with the search
 * `OR` nested inside it, so no search term can widen the tenant scope.
 */
function buildAuditLogWhere(organizationId: string, search?: string): Prisma.AuditLogWhereInput {
  if (!search) {
    return { organizationId };
  }

  return {
    organizationId,
    OR: [
      { staffEmail: { contains: search, mode: 'insensitive' } },
      { action: { contains: search, mode: 'insensitive' } },
      { entityType: { contains: search, mode: 'insensitive' } },
      { entityId: { contains: search, mode: 'insensitive' } },
    ],
  };
}

export async function listAuditLogs(
  organizationId: string,
  page: number,
  pageSize: number,
  search?: string,
) {
  const where = buildAuditLogWhere(organizationId, search);
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    data: logs,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
