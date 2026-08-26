import { z } from 'zod';

const PASSWORD_MIN_LENGTH = 8;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

export const emailSchema = z.string().trim().toLowerCase().email('A valid email is required.');

export const registerSchema = {
  body: z.object({
    organizationName: z.string().trim().min(2, 'Organization name is required.').max(120),
    email: emailSchema,
    password: passwordSchema,
  }),
};

export const loginSchema = {
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required.'),
  }),
};

export const refreshSchema = {
  body: z.object({
    refreshToken: z.string().min(1, 'refreshToken is required.'),
  }),
};

export const logoutSchema = {
  body: z.object({
    refreshToken: z.string().min(1, 'refreshToken is required.'),
  }),
};

// .strict() rejects any extra field (e.g. a client-supplied staffId or role)
// outright rather than silently ignoring it — this endpoint's identity comes
// only from req.auth, never the body (V2 Checkpoint 1 / ADR-022).
export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1, 'Current password is required.'),
      newPassword: passwordSchema,
      refreshToken: z.string().min(1, 'refreshToken is required.'),
    })
    .strict(),
};

// V2 Checkpoint 2: the raw token from the emailed verification link.
export const verifyEmailSchema = {
  query: z.object({
    token: z.string().min(1, 'token is required.'),
  }),
};
