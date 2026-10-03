import webpush from 'web-push';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * ADR-068: the one place that talks to Web Push services (RFC 8030 + VAPID
 * RFC 8292 + payload encryption RFC 8291) — Apple's web.push.apple.com for
 * iPhone/iPad Home Screen web apps, and any standards-compliant push service.
 *
 * Mirrors fcm.service.ts's contract: never throws; reports `gone` only for
 * the two answers that mean "this subscription is permanently dead" (404 and
 * 410), so a transient failure never unsubscribes a working browser.
 * Endpoints are logged by host only — the full URL is a capability.
 */

export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the portal's service worker receives. Deliberately small and free
 * of personal data: no names, emails, form answers or codes. */
export interface WebPushPayload {
  title: string;
  body: string;
  type: string;
  tokenId: string;
  /** Path (same origin as the portal) to open when the notification is tapped. */
  url: string;
  /** Collapses repeats of the same kind for the same token on the device. */
  tag: string;
}

export interface WebPushSendOptions {
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Seconds the push service may hold the message for an offline device. */
  ttlSeconds?: number;
}

export interface WebPushSendResult {
  ok: boolean;
  /** The push service says the subscription no longer exists (404/410). */
  gone: boolean;
  statusCode?: number;
}

export function isWebPushConfigured(): boolean {
  return Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY && env.WEB_PUSH_SUBJECT);
}

/** Public by design: the portal needs it as `applicationServerKey`. */
export function getVapidPublicKey(): string | null {
  return isWebPushConfigured() ? env.WEB_PUSH_VAPID_PUBLIC_KEY! : null;
}

export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
}

export async function sendWebPush(
  target: WebPushTarget,
  payload: WebPushPayload,
  options: WebPushSendOptions = {},
): Promise<WebPushSendResult> {
  if (!isWebPushConfigured()) {
    logger.warn('Web Push send skipped — VAPID keys are not configured.');
    return { ok: false, gone: false };
  }
  try {
    const response = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: env.WEB_PUSH_SUBJECT!,
          publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY!,
          privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY!,
        },
        TTL: options.ttlSeconds ?? 3600,
        urgency: options.urgency ?? 'normal',
        timeout: 10_000,
      },
    );
    logger.info({ host: endpointHost(target.endpoint), statusCode: response.statusCode }, 'Web Push sent');
    return { ok: true, gone: false, statusCode: response.statusCode };
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    const gone = statusCode === 404 || statusCode === 410;
    logger.error({ host: endpointHost(target.endpoint), statusCode }, 'Web Push send failed');
    return { ok: false, gone, statusCode };
  }
}
