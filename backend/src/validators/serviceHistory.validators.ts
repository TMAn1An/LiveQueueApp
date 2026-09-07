import { z } from 'zod';
import { SERVICE_HISTORY_STATUSES } from '../services/serviceHistory.service';

export const listServiceHistorySchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    // Same shape the management-search checkpoint established: trimmed, so
    // surrounding whitespace never counts as a search, and an empty result
    // is falsy and treated as "no search" by the service layer.
    search: z.string().trim().max(200).optional(),
    queueId: z.string().uuid('queueId must be a valid id.').optional(),
    // Absent means COMPLETED only — a cancelled or skipped visit is never
    // counted as service given unless it is asked for by name.
    status: z.enum(SERVICE_HISTORY_STATUSES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
};
