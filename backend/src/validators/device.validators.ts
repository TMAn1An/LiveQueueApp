import { z } from 'zod';

export const registerDeviceSchema = {
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
  }),
};
