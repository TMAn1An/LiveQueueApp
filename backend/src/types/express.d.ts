import type { StaffRole, StaffStatus } from '@prisma/client';
import type { Permission } from '../constants/permissions';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        staffId: string;
        organizationId: string;
        email: string;
        role: StaffRole;
        status: StaffStatus;
        permissions: Permission[];
        /** ADR-069: an Executive's Admin workspace (null otherwise). */
        workspaceAdminId: string | null;
      };
    }
  }
}

export {};
