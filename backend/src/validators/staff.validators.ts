import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth.validators';

// OWNER is deliberately excluded — an organization has exactly one owner,
// created only at registration (ADR-005/spec 4.1). Staff management creates
// and edits ADMIN/STAFF staff, never a second OWNER.
const manageableRole = z.enum(['ADMIN', 'STAFF']);
const staffStatus = z.enum(['ACTIVE', 'SUSPENDED']);

export const staffIdParams = z.object({
  staffId: z.string().uuid('staffId must be a valid id.'),
});

export const listStaffSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    // Trimmed so surrounding whitespace never counts as a search; an empty
    // result is falsy and treated as "no search" by the service layer.
    search: z.string().trim().max(200).optional(),
  }),
};

export const createStaffSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Name is required.').max(120),
    email: emailSchema,
    password: passwordSchema,
    role: manageableRole,
  }),
};

export const updateStaffSchema = {
  params: staffIdParams,
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    role: manageableRole.optional(),
    status: staffStatus.optional(),
  }),
};

export const staffIdOnlySchema = {
  params: staffIdParams,
};
