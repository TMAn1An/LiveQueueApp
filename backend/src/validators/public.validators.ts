import { z } from 'zod';

export const publicQueueConfigSchema = {
  params: z.object({
    queueId: z.string().uuid('queueId must be a valid id.'),
  }),
};
