import { z } from 'zod';
import { LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE } from './latinText';
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
    name: z
      .string()
      .trim()
      .min(1, 'Counter name is required.')
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE),
  }),
};

export const updateCounterSchema = {
  params: counterIdParams,
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE)
      .optional(),
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
    // Null clears the assignment — the same endpoint both assigns and
    // unassigns, so the dashboard's one dropdown maps to one call.
    staffId: z.string().uuid('staffId must be a valid id.').nullable(),
    // ADR-064: an operator already on another counter is moved here only
    // when this says so; otherwise the request is refused.
    move: z.boolean().optional(),
  }),
};

export const assignableStaffSchema = {
  params: counterIdParams,
};

export const counterIdOnlySchema = {
  params: counterIdParams,
};
