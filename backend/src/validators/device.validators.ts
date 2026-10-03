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

/**
 * ADR-068: a Web Push subscription from the Safari portal.
 *
 * The backend later POSTs to `endpoint`, so it is not trusted blindly: it
 * must be https on a known Web Push service. That keeps a forged
 * subscription from turning the server into a request proxy (SSRF) toward
 * internal or arbitrary hosts. Apple's service is web.push.apple.com
 * (`*.push.apple.com` per Apple's documentation); the others are the
 * standard services of other engines, listed so a browser on them is not
 * rejected for no reason.
 */
const WEB_PUSH_HOST_SUFFIXES = [
  '.push.apple.com',
  'fcm.googleapis.com',
  'android.googleapis.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

export function isAllowedWebPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return WEB_PUSH_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
  );
}

function base64UrlOfLength(bytes: number) {
  return z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url')
    .refine((value) => Buffer.from(value.replace(/=+$/, ''), 'base64url').length === bytes, {
      message: `must encode ${bytes} bytes`,
    });
}

const browserInstallationId = z
  .string()
  .trim()
  .uuid('deviceIdentifier must be the browser installation id (a UUID).');

export const registerWebPushSubscriptionSchema = {
  body: z.object({
    deviceIdentifier: browserInstallationId,
    subscription: z.object({
      endpoint: z
        .string()
        .trim()
        .max(1024)
        .refine(isAllowedWebPushEndpoint, 'endpoint must be an https URL of a Web Push service.'),
      keys: z.object({
        // RFC 8291: an uncompressed P-256 point (65 bytes) and a 16-byte secret.
        p256dh: base64UrlOfLength(65),
        auth: base64UrlOfLength(16),
      }),
    }),
  }),
};

export const unregisterWebPushSubscriptionSchema = {
  body: z.object({
    deviceIdentifier: browserInstallationId,
    endpoint: z.string().trim().max(1024),
  }),
};
