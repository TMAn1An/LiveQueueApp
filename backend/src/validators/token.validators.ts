import { z } from 'zod';
import { queueIdParams } from './queue.validators';

export const tokenIdParams = z.object({
  tokenId: z.string().uuid('tokenId must be a valid id.'),
});

export const createTokenSchema = {
  body: z.object({
    queueId: z.string().uuid('queueId must be a valid id.'),
    serviceId: z.string().uuid('serviceId must be a valid id.'),
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
    formData: z.record(z.string(), z.unknown()).default({}),
  }),
};

export const tokenIdOnlySchema = {
  params: tokenIdParams,
};

export const callTokenSchema = {
  params: tokenIdParams,
  body: z.object({
    counterId: z.string().uuid('counterId must be a valid id.'),
  }),
};

export const nextTokenSchema = {
  params: queueIdParams,
  body: z.object({
    counterId: z.string().uuid('counterId must be a valid id.'),
  }),
};
