import type { StaffRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { Permission } from '../constants/permissions';
import { verifyAccessToken } from './tokens';

export interface AuthContext {
  staffId: string;
  organizationId: string;
  email: string;
  role: StaffRole;
  permissions: Permission[];
}

/**
 * Verifies a raw JWT and loads staff + organization fresh from the database
 * (CLAUDE.md Rule 4 — never trust claims embedded in the token). Returns
 * null for any invalid/expired token or inactive staff/organization; callers
 * decide whether that's fatal (authenticate) or just means "anonymous"
 * (optionalAuthenticate, used by customer-facing token endpoints).
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

  return {
    staffId: staff.id,
    organizationId: staff.organizationId,
    email: staff.email,
    role: staff.role,
    permissions: staff.permissions as Permission[],
  };
}
