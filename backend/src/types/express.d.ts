import type { StaffRole } from '@prisma/client';
import type { Permission } from '../constants/permissions';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        staffId: string;
        organizationId: string;
        role: StaffRole;
        permissions: Permission[];
      };
    }
  }
}

export {};
