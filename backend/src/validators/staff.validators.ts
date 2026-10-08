import { z } from 'zod';
import {
  LATIN_NAME_MESSAGE,
  LATIN_NAME_PATTERN,
  LATIN_TEXT_MESSAGE,
  LATIN_TEXT_PATTERN,
} from './latinText';
import { emailSchema, passwordSchema } from './auth.validators';

// OWNER is deliberately excluded — an organization has exactly one owner,
// created only at registration (ADR-005/spec 4.1). Staff management creates
// and edits ADMIN/STAFF staff, never a second OWNER.
// ADR-069: MANAGER (Organization Manager) joins — who may grant which role
// is decided in staff.service (only the Organization Head grants ADMIN or
// MANAGER).
const manageableRole = z.enum(['ADMIN', 'STAFF', 'MANAGER']);
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
    /** ADR-069: Head/Manager filter to one Admin's workspace. */
    adminId: z.string().uuid('adminId must be a valid id.').optional(),
  }),
};

// ADR-035: no password here. The invitee sets their own through the emailed
// setup link, so an administrator never chooses — or learns — a colleague's
// password. Update still accepts one, for the separate case of an admin
// resetting an account somebody has lost access to.
export const createStaffSchema = {
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required.')
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE),
    email: emailSchema,
    role: manageableRole,
    /** ADR-069/071 D13: for an Executive invited by the Organization Head —
     * the Admin workspace they join (required). An Admin's invitations always
     * go into their own workspace. */
    workspaceAdminId: z.string().uuid('workspaceAdminId must be a valid id.').optional(),
  }),
};

/** ADR-069 D3: the Head moves an Executive to an Admin workspace (or null). */
export const setExecutiveWorkspaceSchema = {
  params: z.object({ staffId: z.string().uuid('staffId must be a valid id.') }),
  body: z.object({ adminId: z.string().uuid('adminId must be a valid id.').nullable() }),
};

export const updateStaffSchema = {
  params: staffIdParams,
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE)
      .optional(),
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    role: manageableRole.optional(),
    status: staffStatus.optional(),
    /** ADR-071: the destination Admin workspace when making someone an
     * Executive (required then, refused otherwise). */
    workspaceAdminId: z.string().uuid('workspaceAdminId must be a valid id.').optional(),
  }),
};

export const staffIdOnlySchema = {
  params: staffIdParams,
};

/** ADR-035: redeeming an emailed invitation. The token is the credential, so
 * there is no session and no email address here — the token identifies the
 * account on its own. */
export const acceptInvitationSchema = {
  body: z.object({
    token: z.string().trim().min(1, 'An invitation token is required.'),
    password: passwordSchema,
  }),
};

/** ADR-057: membership-removal requests. The request type is derived by the
 * server from who is asking about whom, so the client never sends it. */
const optionalNote = z.string().trim().max(500).regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE).optional();

export const removalRequestIdParams = z.object({
  requestId: z.string().uuid('requestId must be a valid id.'),
});

export const createRemovalRequestSchema = {
  body: z
    .object({
      targetStaffId: z.string().uuid('targetStaffId must be a valid id.'),
      reason: optionalNote,
    })
    .strict(),
};

export const listRemovalRequestsSchema = {
  query: z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  }),
};

export const reviewRemovalRequestSchema = {
  params: removalRequestIdParams,
  body: z.object({ reviewNote: optionalNote }).strict(),
};

export const removalRequestIdOnlySchema = {
  params: removalRequestIdParams,
};

/** ADR-071: handing an Admin's workspace to a replacement Admin. */
export const workspaceTransferSchema = {
  params: staffIdParams,
  body: z
    .object({
      replacementStaffId: z.string().uuid('replacementStaffId must be a valid id.'),
      outcome: z.enum(['MANAGER', 'EXECUTIVE', 'REMOVE']),
      reason: z
        .string()
        .trim()
        .min(3, 'Say briefly why the workspace is being handed over.')
        .max(200)
        .regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE),
      note: optionalNote,
    })
    .strict(),
};
