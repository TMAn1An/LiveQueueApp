import { z } from 'zod';

export const listAuditLogsSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    // Trimmed so surrounding whitespace never counts as a search; an empty
    // result is falsy and treated as "no search" by the service layer.
    search: z.string().trim().max(200).optional(),
  }),
};
