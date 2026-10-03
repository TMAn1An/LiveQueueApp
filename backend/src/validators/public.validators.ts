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

// ADR-068: the organization's public QR code. Validated loosely here (the
// service normalises case and rejects anything unknown with one 404).
export const publicOrganizationSchema = {
  params: z.object({
    publicCode: z.string().trim().min(1).max(64),
  }),
};
