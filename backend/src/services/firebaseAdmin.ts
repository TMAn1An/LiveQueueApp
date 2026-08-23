import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Phase 7 Step 7. Lazily initialized exactly once, cached for the lifetime
 * of the process — `undefined` means "not attempted yet", `null` means
 * "attempted and unavailable" (missing/invalid credential), so a failed
 * attempt is never silently retried on every call. Firebase/FCM is optional
 * infrastructure here, mirroring the mobile app's own FcmService: a missing
 * or invalid credential must never crash backend startup or any request —
 * it only means reminder dispatch has nothing to send through.
 */
let app: App | null | undefined;

function initialize(): App | null {
  if (app !== undefined) {
    return app;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH is not set — Firebase Admin/FCM dispatch is disabled.');
    app = null;
    return app;
  }

  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }

  try {
    const raw = readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8');
    const serviceAccount = JSON.parse(raw) as Record<string, unknown>;
    app = initializeApp({ credential: cert(serviceAccount) });
    logger.info('Firebase Admin initialized — FCM dispatch is enabled.');
  } catch (err) {
    // Deliberately logs only the message, never the caught value itself —
    // a JSON.parse or file-read failure on a malformed credential file
    // could otherwise end up echoing file content/paths into the error.
    logger.error(
      { message: (err as Error).message },
      'Firebase Admin initialization failed — FCM dispatch is disabled.',
    );
    app = null;
  }

  return app;
}

export function isFirebaseAvailable(): boolean {
  return initialize() !== null;
}

export function getFirebaseMessaging(): Messaging | null {
  const initialized = initialize();
  return initialized ? getMessaging(initialized) : null;
}
