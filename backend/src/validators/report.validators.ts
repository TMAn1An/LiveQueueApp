import { z } from 'zod';

const reportQueryBase = z.object({
  range: z.enum(['today', 'yesterday', 'last7', 'last30', 'custom']).default('today'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** ADR-069: Head/Manager filter to one Admin's workspace. */
  adminId: z.string().uuid('adminId must be a valid id.').optional(),
});

const reportQuery = reportQueryBase.superRefine((value, ctx) => {
  if (value.range === 'custom' && (!value.from || !value.to)) {
    ctx.addIssue({
      code: 'custom',
      message: 'from and to are required when range is custom.',
      path: ['from'],
    });
  }
});

export const getReportSchema = {
  query: reportQuery,
};

export const exportReportSchema = {
  query: reportQuery,
};
