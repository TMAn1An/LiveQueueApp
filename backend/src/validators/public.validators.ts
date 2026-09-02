import { z } from 'zod';

export const publicQueueConfigSchema = {
  params: z.object({
    queueId: z.string().uuid('queueId must be a valid id.'),
  }),
};

// V2 Checkpoint 9 (ADR-031): Android only for now — see
// appVersionPolicy.service.ts's doc comment for why.
export const appVersionPolicySchema = {
  query: z.object({
    platform: z.enum(['android']),
  }),
};
