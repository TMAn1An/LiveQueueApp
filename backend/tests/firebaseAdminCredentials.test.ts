import { beforeAll, describe, expect, it } from 'vitest';

/**
 * env.ts's `env` export is a module-level singleton parsed once on first
 * import — so FIREBASE_CREDENTIALS must be set, and firebaseAdmin.ts must be
 * dynamically imported inside beforeAll, strictly before any static import
 * of it (or anything that transitively imports env.ts) executes. Same
 * pattern already established by rateLimit.test.ts for the identical
 * reason.
 *
 * The fake service account below has a made-up project/client identity, but
 * firebase-admin's cert() *does* eagerly parse the private_key as real PEM
 * at construction time (confirmed directly — a placeholder string throws
 * "Failed to parse private key" immediately, before any network call is
 * ever attempted) — so this is a throwaway RSA key pair generated once via
 * Node's own crypto module purely to be structurally valid PEM. It is not,
 * and has never been, a real Firebase credential; isFirebaseAvailable()/
 * getFirebaseMessaging() never make a real network call, so nothing here
 * needs to actually authenticate.
 */
process.env.FIREBASE_CREDENTIALS = JSON.stringify({
  type: 'service_account',
  project_id: 'livequeue-test',
  private_key_id: 'fake-key-id',
  private_key:
    '-----BEGIN PRIVATE KEY-----\n' +
    'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCBXD0cG6XKdwSQ\n' +
    'woCO8uzo1YiiaQJgfyzqay/WFuH3QF4RiepdJWahQmUPJDPRkgQ2Tlx4a3OLyQ7L\n' +
    'E2tb3ZONXRsCmZ4vQzWWc/vGTQnk+oSsCdYkrNTf7mmipssv0OrTQLwBCYwMBXlU\n' +
    'ARoG+GXGPdG1fvf/cTUyfmzkApZ7RWVTd8juBnDyaf3ak7JI48H0AM5dh1jEIoDn\n' +
    'G0HD5AfGteRGnpygkO9efDmqnITyz83Vn2F+vf1qcYUrO5yGCR2u8enl79K1fmfJ\n' +
    'TWx8Jj3v4Uk6rUyuCiQl5SevekMMwLk6UsKq23+vato9hijCdxlqMpzY3AJITr87\n' +
    'Ha97WAFDAgMBAAECggEABKiwyWle1ZA8dDDny74zYB4IrL4WyCjsZ4jyu8WD3+bL\n' +
    '5y/OEWATy9ewp2nzX9HgIEs+3gC+CZkf1O/fHFDk9otq5J4Uag6unbuRpCO0KTCz\n' +
    'RIrve89UX2Lzylgy1dxdXhG6c63HWHYorNOD/3TvcsNZNoMwerJgwG/N4NcNr7op\n' +
    'VKh9NeBFrsfWyM/QPrHJ2lSiAXFnA/JMiiM229+heYkl8V9pgmPnfe8Pa/exelbx\n' +
    'm4o3MI/3qJSsJgi3St4L6lIEJP6w0WRKrc44N7bTTQrTXHXFE+fMGVumzmMK9kV4\n' +
    'uThtc1X81ZICqXkhne5E4wDKsaoQov4ZLraIbv8kaQKBgQC23NchC8qkLDK/e7Ds\n' +
    'klieQ5FERZJ43LodZs9ffuCR5ZzFMYGsPCKqpybeDuSOgWpk8K3rHRtLFptSLdRu\n' +
    'RZedglT4XdmH97TgIsHUOgK232FDv9qZfKuC30va4pVSSQX0d2PLtY7VqKmDYhpw\n' +
    'ZKRTKDFDC73jf3JH7d8lP7EqlwKBgQC1GVYDkILsulZPZoWHATIt+tu+y+siyRPP\n' +
    'Xurr8vcYMEczapObM29B4Ks4ERhe6/tOYLbjOewivYMvVYXW17UO5yugHReBXBb2\n' +
    'TfsyYtpHoVDMQS5KKs2n1rtpI+Uem9eCx4It+QMJvEK0uvpMVZfBmcifkDnRKF7H\n' +
    'ZroYZt1QNQKBgQCygGUoBwCqvdJUBQQyCrGi3EYjpN5USPMM3F011P6WrNMZ0zfH\n' +
    'z3PvrfdM8LC/Qyl+m0rKpcEMzWaVE9O4SQq1YJJdWA+OoIjZ+lPHPVGE/g1OOyvC\n' +
    'hGZP/HVpl6E3j7zWZOzv360sd9XxQISajkOyQRvFXOLh/niqKlOXYtMoxQKBgAXW\n' +
    'Cy+SOKXoW1+zrhnrr/JLY0mCyNEWKc1FAc0Yx13AMIs3pAocXjmBRANKib6FXFPq\n' +
    'SfqIo1N7R/7+gpGp4evZB07hoSBKF3NYj//Pr7kfObtbXmKFfpsqEGATCA80dn2A\n' +
    'cHGK1M47gurQG8DaAUn76rs5qqNS6bsDVHv01K0BAoGBAI0x85cWDTg1XJReniCa\n' +
    'gOk7K8uPX0oAwcJQ4zNXhFoUfpMBrR3L7DWsaCBWNiA+tjfdQPjnz75j+bDZMyi8\n' +
    'BUWYHRPBIzEqmPXn5+2PukRpKnvzAA4NByTtCvDboOKJoPnMRftSFT4/tfzMbGt/\n' +
    'u9gyEC66u/7SvQKv2JsSmD6i\n' +
    '-----END PRIVATE KEY-----\n',
  client_email: 'fake@livequeue-test.iam.gserviceaccount.com',
  client_id: '123456789',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
});

let isFirebaseAvailable: () => boolean;
let getFirebaseMessaging: () => unknown;

beforeAll(async () => {
  const mod = await import('../src/services/firebaseAdmin.js');
  isFirebaseAvailable = mod.isFirebaseAvailable;
  getFirebaseMessaging = mod.getFirebaseMessaging;
});

describe('Firebase Admin provider — FIREBASE_CREDENTIALS (env-var JSON content)', () => {
  it('initializes successfully from FIREBASE_CREDENTIALS alone, with no file on disk', () => {
    expect(isFirebaseAvailable()).toBe(true);
  });

  it('getFirebaseMessaging returns a real (non-null) messaging instance', () => {
    expect(getFirebaseMessaging()).not.toBeNull();
  });
});
