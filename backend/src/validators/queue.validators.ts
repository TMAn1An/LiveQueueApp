import { z } from 'zod';

const queueStatus = z.enum(['ACTIVE', 'PAUSED', 'INACTIVE']);

export const queueIdParams = z.object({
  queueId: z.string().uuid('queueId must be a valid id.'),
});

export const createQueueSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Queue name is required.').max(120),
    description: z.string().trim().max(1000).optional(),
    clientTerminology: z.string().trim().max(60).optional(),
    tokenPrefix: z.string().trim().min(1, 'Token prefix is required.').max(10),
    startingNumber: z.number().int().positive().default(1),
    baseTimeMinutes: z.number().int().positive().default(5),
    defaultNotificationMinutes: z.number().int().positive().default(10),
    status: queueStatus.default('ACTIVE'),
  }),
};

export const updateQueueSchema = {
  params: queueIdParams,
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    clientTerminology: z.string().trim().max(60).optional(),
    tokenPrefix: z.string().trim().min(1).max(10).optional(),
    startingNumber: z.number().int().positive().optional(),
    baseTimeMinutes: z.number().int().positive().optional(),
    defaultNotificationMinutes: z.number().int().positive().optional(),
  }),
};

export const queueIdOnlySchema = {
  params: queueIdParams,
};

export const updateQueueStatusSchema = {
  params: queueIdParams,
  body: z.object({
    status: queueStatus,
  }),
};
