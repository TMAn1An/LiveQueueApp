import { z } from 'zod';
import {
  LATIN_NAME_PATTERN,
  LATIN_NAME_MESSAGE,
  LATIN_TEXT_PATTERN,
  LATIN_TEXT_MESSAGE,
} from './latinText';
import { queueIdParams } from './queue.validators';

export const serviceIdParams = z.object({
  serviceId: z.string().uuid('serviceId must be a valid id.'),
});

export const createServiceSchema = {
  params: queueIdParams,
  body: z.object({
    serviceName: z
      .string()
      .trim()
      .min(1, 'Service name is required.')
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE),
    description: z
      .string()
      .trim()
      .max(1000)
      .regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE)
      .optional(),
    durationMinutes: z.number().int().positive('durationMinutes must be a positive integer.'),
    isActive: z.boolean().default(true),
  }),
};

export const updateServiceSchema = {
  params: serviceIdParams,
  body: z.object({
    serviceName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(LATIN_NAME_PATTERN, LATIN_NAME_MESSAGE)
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000)
      .regex(LATIN_TEXT_PATTERN, LATIN_TEXT_MESSAGE)
      .optional(),
    durationMinutes: z.number().int().positive().optional(),
  }),
};

export const updateServiceStatusSchema = {
  params: serviceIdParams,
  body: z.object({
    isActive: z.boolean(),
  }),
};

export const serviceIdOnlySchema = {
  params: serviceIdParams,
};
