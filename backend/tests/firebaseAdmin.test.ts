import { describe, expect, it } from 'vitest';
import { getFirebaseMessaging, isFirebaseAvailable } from '../src/services/firebaseAdmin';
import { sendNotification } from '../src/services/fcm.service';

/**
 * FIREBASE_SERVICE_ACCOUNT_PATH is unset in this test environment (no local
 * service-account credential exists — see the Step 7 report). These tests
 * confirm the required graceful-degradation behavior: nothing throws,
 * nothing crashes, the API/tests run normally without a real credential.
 */
describe('Firebase Admin provider — graceful degradation without credentials', () => {
  it('reports Firebase as unavailable when no credential is configured', () => {
    expect(isFirebaseAvailable()).toBe(false);
  });

  it('returns null from getFirebaseMessaging rather than throwing', () => {
    expect(getFirebaseMessaging()).toBeNull();
  });

  it('initialization is cached — repeated calls do not re-attempt or throw', () => {
    expect(isFirebaseAvailable()).toBe(false);
    expect(isFirebaseAvailable()).toBe(false);
    expect(getFirebaseMessaging()).toBeNull();
  });

  it('fcm.service.sendNotification resolves (never throws) and reports failure, not a crash', async () => {
    const result = await sendNotification('any-fake-token', { title: 'Test', body: 'Test body' });
    expect(result).toEqual({ ok: false, invalidToken: false });
  });
});
