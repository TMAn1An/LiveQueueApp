import type { StaffRole, StaffStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { getEffectivePermissions, type Permission } from '../constants/permissions';
import { verifyAccessToken } from './tokens';

export interface AuthContext {
  staffId: string;
  organizationId: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  permissions: Permission[];
  /** ADR-069: the Admin workspace an Executive belongs to (null for every
   * other role, and for organization-level Executives). */
  workspaceAdminId: string | null;
}

/**
 * ADR-058/ADR-071: an access token issued before the account's
 * `accessRevokedAt` is refused everywhere — REST, optional auth and
 * Socket.io alike — even though its JWT lifetime has not run out. `iat` is
 * in whole seconds, so a token minted in the same second as the revocation
 * (the fresh sign-in that follows it) is still accepted.
 */
export function isAccessRevoked(
  staff: { accessRevokedAt: Date | null },
  payload: { iat?: number },
): boolean {
  return (
    staff.accessRevokedAt !== null &&
    typeof payload.iat === 'number' &&
    payload.iat < Math.floor(staff.accessRevokedAt.getTime() / 1000)
  );
}

/**
 * Verifies a raw JWT and loads staff + organization fresh from the database
 * (CLAUDE.md Rule 4 — never trust claims embedded in the token). Returns
 * null for any invalid/expired/revoked token or inactive staff/organization;
 * callers decide whether that's fatal (socket handshake) or just means
 * "anonymous" (optionalAuthenticate, used by customer-facing token endpoints).
 */
export async function resolveAuthContext(rawToken: string): Promise<AuthContext | null> {
  let payload;
  try {
    payload = verifyAccessToken(rawToken);
  } catch {
    return null;
  }

  const staff = await prisma.staff.findUnique({
    where: { id: payload.sub },
    include: { organization: true },
  });

  if (!staff || staff.status !== 'ACTIVE' || staff.organization.status !== 'ACTIVE') {
    return null;
  }
  if (isAccessRevoked(staff, payload)) {
    return null;
  }

  return {
    staffId: staff.id,
    organizationId: staff.organizationId,
    email: staff.email,
    role: staff.role,
    // Always 'ACTIVE' here in practice — the guard above already rejects
    // any other status — carried through only to satisfy the shared
    // Request.auth shape (V2 Checkpoint 2, ADR-024).
    status: staff.status,
    permissions: getEffectivePermissions(staff.role),
    workspaceAdminId: staff.workspaceAdminId,
  };
}
