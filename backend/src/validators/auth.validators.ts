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
