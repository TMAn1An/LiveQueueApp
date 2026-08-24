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

/**
 * Resolves the service-account credential from whichever source is
 * configured. FIREBASE_CREDENTIALS (the raw JSON content as the env var's
 * own value) takes priority — it's the only form a stateless host like
 * Render can hold without a separate secret-file mount. Falls back to
 * FIREBASE_SERVICE_ACCOUNT_PATH (a local file path) for local dev, where
 * the downloaded key already sits on disk. Returns null, never throws, if
 * neither is set or the configured one can't be parsed — initialize()
 * below treats that identically to "not configured."
 */
function resolveServiceAccountCredential(): Record<string, unknown> | null {
  if (env.FIREBASE_CREDENTIALS) {
    try {
      return JSON.parse(env.FIREBASE_CREDENTIALS) as Record<string, unknown>;
    } catch (err) {
      logger.error(
        { message: (err as Error).message },
        'FIREBASE_CREDENTIALS is set but is not valid JSON — Firebase Admin/FCM dispatch is disabled.',
      );
      return null;
    }
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const raw = readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      // Deliberately logs only the message, never the caught value itself —
      // a JSON.parse or file-read failure on a malformed credential file
      // could otherwise end up echoing file content/paths into the error.
      logger.error(
        { message: (err as Error).message },
        'FIREBASE_SERVICE_ACCOUNT_PATH is set but could not be read — Firebase Admin/FCM dispatch is disabled.',
      );
      return null;
    }
  }

  return null;
}

function initialize(): App | null {
  if (app !== undefined) {
    return app;
  }

  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }

  if (!env.FIREBASE_CREDENTIALS && !env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    logger.warn(
      'Neither FIREBASE_CREDENTIALS nor FIREBASE_SERVICE_ACCOUNT_PATH is set — Firebase Admin/FCM dispatch is disabled.',
    );
    app = null;
    return app;
  }

  const credential = resolveServiceAccountCredential();
  if (!credential) {
    app = null;
    return app;
  }

  try {
    app = initializeApp({ credential: cert(credential) });
    logger.info('Firebase Admin initialized — FCM dispatch is enabled.');
  } catch (err) {
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
