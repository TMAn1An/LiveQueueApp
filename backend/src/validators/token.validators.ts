import { z } from 'zod';
import { queueIdParams } from './queue.validators';

export const tokenIdParams = z.object({
  tokenId: z.string().uuid('tokenId must be a valid id.'),
});

// V2 Checkpoint 5 (ADR-027): multi-service selection. Accepts EITHER the
// legacy singular `serviceId` OR the new `serviceIds` array — never both,
// never neither — so an already-installed V1 mobile app (which only ever
// sends `serviceId`) keeps working against this backend unmodified. Both
// forms are canonicalized here into one shape (`serviceIds: string[]`)
// before the controller/service layer ever sees the request, so nothing
// downstream needs to know two request shapes exist.
export const createTokenSchema = {
  body: z
    .object({
      queueId: z.string().uuid('queueId must be a valid id.'),
      serviceId: z.string().uuid('serviceId must be a valid id.').optional(),
      serviceIds: z
        .array(z.string().uuid('each service id must be a valid id.'))
        .min(1, 'Select at least one service.')
        .optional(),
      deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
      formData: z.record(z.string(), z.unknown()).default({}),
    })
    .refine((data) => Boolean(data.serviceId) !== Boolean(data.serviceIds), {
      message: 'Provide exactly one of serviceId or serviceIds.',
      path: ['serviceIds'],
    })
    .refine(
      (data) => !data.serviceIds || new Set(data.serviceIds).size === data.serviceIds.length,
      { message: 'serviceIds must not contain duplicate service ids.', path: ['serviceIds'] },
    )
    .transform((data) => ({
      queueId: data.queueId,
      deviceIdentifier: data.deviceIdentifier,
      formData: data.formData,
      serviceIds: data.serviceIds ?? [data.serviceId!],
    })),
};

export const tokenIdOnlySchema = {
  params: tokenIdParams,
};

// V2 Checkpoint 7: matches the notification-preferences customer-write
// pattern exactly (ADR-011/Phase 7 Step 7) — a self-asserted deviceIdentifier
// resolved and ownership-checked in the service layer, never a client-
// supplied organizationId or an assumption that knowing the token id alone
// is enough.
export const cancelTokenSchema = {
  params: tokenIdParams,
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
  }),
};

export const verificationCodeQuerySchema = {
  params: tokenIdParams,
  query: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
  }),
};

export const reissueVerificationCodeSchema = {
  params: tokenIdParams,
  body: z.object({
    deviceIdentifier: z.string().trim().min(1, 'deviceIdentifier is required.').max(200),
  }),
};

// V2 Checkpoint 7: CALLED -> IN_PROGRESS now requires the customer-told
// verification code — replaces the old bare tokenIdOnlySchema on /start.
export const startTokenSchema = {
  params: tokenIdParams,
  body: z.object({
    verificationCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'verificationCode must be a 6-digit code.'),
  }),
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

// V2 Checkpoint 4: staff override of an active customer's required
// service duration, in minutes.
export const setRequiredDurationSchema = {
  params: tokenIdParams,
  body: z.object({
    requiredDurationMinutes: z.number().int().positive('requiredDurationMinutes must be a positive integer.'),
  }),
};
