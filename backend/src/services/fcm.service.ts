import { getFirebaseMessaging } from './firebaseAdmin';
import { logger } from '../config/logger';

export interface SendResult {
  ok: boolean;
  /** true when Firebase reports the token as permanently dead (uninstalled app, rotated token). */
  invalidToken: boolean;
}

export interface NotificationPayload {
  title: string;
  body: string;
}

/** First 8 chars + length only — the raw token itself must never be logged. */
function redact(token: string): string {
  return `${token.slice(0, 8)}…(${token.length} chars)`;
}

// Deliberately narrow: only the two codes Firebase documents as meaning
// "this specific token is permanently dead" (uninstalled app, rotated
// token). messaging/invalid-argument is NOT included — it's a broad
// validation error that also fires for a malformed payload (a bug in this
// service's own message construction, not the customer's device), and
// misclassifying it here would silently unregister a healthy device from
// reminders. Cleanup must never be triggered by an ambiguous error code.
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * The one place that calls the Firebase Admin SDK to send a message
 * (Phase 7 Step 7) — business logic (reminderDispatch.service.ts) depends on
 * this boundary, never on firebase-admin directly, so it can be mocked in
 * tests without ever touching real Firebase. Never throws: a Firebase
 * failure is reported back as a result, not an exception, so one bad token
 * can never stop the caller's loop over other tokens.
 */
export async function sendNotification(fcmToken: string, payload: NotificationPayload): Promise<SendResult> {
  const messaging = getFirebaseMessaging();
  if (!messaging) {
    logger.warn('FCM send skipped — Firebase Admin is not configured.');
    return { ok: false, invalidToken: false };
  }

  try {
    await messaging.send({
      token: fcmToken,
      notification: { title: payload.title, body: payload.body },
    });
    logger.info({ token: redact(fcmToken) }, 'FCM notification sent');
    return { ok: true, invalidToken: false };
  } catch (err) {
    const code = (err as { errorInfo?: { code?: string } })?.errorInfo?.code;
    const invalidToken = typeof code === 'string' && INVALID_TOKEN_ERROR_CODES.has(code);
    logger.error({ token: redact(fcmToken), code }, 'FCM send failed');
    return { ok: false, invalidToken };
  }
}
