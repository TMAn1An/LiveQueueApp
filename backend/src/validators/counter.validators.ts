import { z } from 'zod';
import { queueIdParams } from './queue.validators';

const counterStatus = z.enum(['ACTIVE', 'ON_BREAK', 'OFFLINE']);

export const counterIdParams = z.object({
  counterId: z.string().uuid('counterId must be a valid id.'),
});

export const listCountersSchema = {
  params: queueIdParams,
};

export const createCounterSchema = {
  params: queueIdParams,
  body: z.object({
    name: z.string().trim().min(1, 'Counter name is required.').max(120),
  }),
};

export const updateCounterSchema = {
  params: counterIdParams,
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
  }),
};

export const updateCounterStatusSchema = {
  params: counterIdParams,
  body: z.object({
    status: counterStatus,
  }),
};

export const assignCounterSchema = {
  params: counterIdParams,
  body: z.object({
    staffId: z.string().uuid('staffId must be a valid id.'),
  }),
};

export const counterIdOnlySchema = {
  params: counterIdParams,
};
