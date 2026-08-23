import { z } from 'zod';

export const updateOrganizationSchema = {
  body: z.object({
    name: z.string().trim().min(2, 'Organization name is required.').max(120),
  }),
};

/**
 * Spec section 7.1: the UI must require the owner to type the organization
 * name to confirm deletion. Enforcing the same check server-side (not just
 * trusting the frontend confirmation dialog) means a direct API call can't
 * skip the safeguard — CLAUDE.md section 10's "never rely on frontend
 * authorization" applies equally to frontend-only confirmation UX.
 */
export const deleteOrganizationSchema = {
  body: z.object({
    confirmName: z.string().min(1, 'confirmName is required.'),
  }),
};
