import { z } from 'zod';

export const registerDeviceSchema = {
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
  }),
};

export const deviceIdParams = z.object({
  deviceId: z.string().uuid('deviceId must be a valid id.'),
});

export const listDevicesSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
    // Trimmed so surrounding whitespace never counts as a search; an empty
    // result is falsy and treated as "no search" by the service layer.
    search: z.string().trim().max(200).optional(),
  }),
};

export const deviceBlockActionSchema = {
  params: deviceIdParams,
};

export const registerFcmTokenSchema = {
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
    fcmToken: z.string().trim().min(1, 'fcmToken is required.').max(4096),
  }),
};
