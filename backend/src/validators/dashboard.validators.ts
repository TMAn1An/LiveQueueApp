import { z } from 'zod';

export const liveQueueTableSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    // Each queue is its own line (ADR-036). Without this the table mixes
    // every queue in the organization together, which is a view no member of
    // staff actually works from: they stand at one queue.
    queueId: z.string().uuid('queueId must be a valid id.').optional(),
  }),
};
