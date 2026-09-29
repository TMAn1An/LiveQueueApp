import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * V2 Product Completion checkpoint, Part E: `customerIdentity.ts` contains
 * two literal NUL bytes inside template literals, used as domain
 * separators between the joined values that go into an HMAC. Git treats
 * the whole file as binary because of them, so it has never had a
 * reviewable diff.
 *
 * `\0` is a valid template-literal escape (ES2015+) whenever it is not
 * followed by another decimal digit — true in both cases here, since each
 * is immediately followed by `${...}` — and evaluates to exactly the same
 * runtime character (U+0000) as the raw byte it replaces. That makes the
 * source-level substitution behaviorally inert by construction, but this
 * file exists to *prove* it rather than assert it: every expectation below
 * pins the exact bytes the pre-cleanup implementation hashed (a raw 0x00
 * between purpose and material, a raw 0x00 between a phone verification id
 * and its code, a plain space between an email verification id and its
 * code), and must keep matching byte for byte.
 *
 * A change to the actual separator, the join order, or the HMAC key would
 * fail every one of these — that is the whole point of a golden-value test
 * over a "does verification still work end-to-end" one: the latter would
 * pass even if the separator changed to something else entirely, as long
 * as hashing and comparing stayed internally consistent with each other.
 *
 * The suite owns its key. `env.ts` parses `process.env` once, when it is
 * first imported, and `dotenv` never overrides a variable that is already
 * set — so the fixed test-only secret is stubbed before a fresh import of
 * the module under test, and the stub is removed afterwards. The golden
 * values therefore no longer depend on whatever CUSTOMER_IDENTITY_SECRET a
 * developer's local `.env` happens to contain.
 */

/** Fake, test-only key. Never used by any real environment. */
const TEST_SECRET = 'test-only-customer-identity-secret-not-a-real-key';

/**
 * Independent reference: the documented byte layout, built by hand with
 * node:crypto — purpose bytes, one explicit 0x00 byte, material bytes —
 * without going through the production helper or its template literals.
 */
function referenceHmac(purpose: string, material: string): string {
  return createHmac('sha256', Buffer.from(TEST_SECRET, 'utf8'))
    .update(
      Buffer.concat([
        Buffer.from(purpose, 'utf8'),
        Buffer.from([0x00]),
        Buffer.from(material, 'utf8'),
      ]),
    )
    .digest('hex');
}

const NUL = String.fromCharCode(0);

/** Literal material strings, written out rather than rebuilt by production code. */
const VECTORS = {
  phoneCode: {
    purpose: 'livequeue:phone-code:v1',
    material: `verification-1${NUL}123456`,
    expected: '4245b09b640e7eaa6fbd27c264c1dfbe24132d37d285aabc900d30727c092530',
  },
  emailCode: {
    purpose: 'livequeue:customer-email-code:v1',
    material: 'verification-1 123456',
    expected: 'fabc17aaf999394e80698818ba161eab48cfde584149ad4a3172ce3ffc1949d6',
  },
  verifiedEmailFingerprint: {
    purpose: 'livequeue:identity:v1',
    material: '7:queue-1|14:VERIFIED_EMAIL|18:person@example.com|0:',
    expected: 'f37aa153f4139f014120fb87df1441221591f378ebeccd48a9a73d8adde277e6',
  },
  customFieldFingerprint: {
    purpose: 'livequeue:identity:v1',
    material: '7:queue-1|12:CUSTOM_FIELD|0:|17:national-id-12345',
    expected: '39203b25f64be3b991b7f0eda4210317784b17016ad8007d230b363aeaf0509c',
  },
} as const;

type CustomerIdentityModule = typeof import('../src/utils/customerIdentity');
let identity: CustomerIdentityModule;

beforeAll(async () => {
  vi.stubEnv('CUSTOMER_IDENTITY_SECRET', TEST_SECRET);
  vi.resetModules();
  identity = await import('../src/utils/customerIdentity.js');
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('customerIdentity HMAC golden vectors are independently derived', () => {
  it.each(Object.entries(VECTORS))(
    '%s golden value matches the hand-built byte layout',
    (_, vector) => {
      expect(referenceHmac(vector.purpose, vector.material)).toBe(vector.expected);
    },
  );
});

describe('customerIdentity HMAC outputs are unchanged by the NUL-byte source cleanup', () => {
  it('hashPhoneCode produces its pre-cleanup golden value', () => {
    expect(identity.hashPhoneCode('verification-1', '123456')).toBe(VECTORS.phoneCode.expected);
  });

  it('hashEmailCode produces its pre-cleanup golden value', () => {
    expect(identity.hashEmailCode('verification-1', '123456')).toBe(VECTORS.emailCode.expected);
  });

  it('a verified-email fingerprint produces its pre-cleanup golden value', () => {
    expect(
      identity.computeIdentityFingerprint({
        queueId: 'queue-1',
        mode: 'VERIFIED_EMAIL',
        normalizedVerifiedContact: 'person@example.com',
      }),
    ).toBe(VECTORS.verifiedEmailFingerprint.expected);
  });

  it('a custom-field fingerprint produces its pre-cleanup golden value', () => {
    expect(
      identity.computeIdentityFingerprint({
        queueId: 'queue-1',
        mode: 'CUSTOM_FIELD',
        normalizedCustomValue: 'national-id-12345',
      }),
    ).toBe(VECTORS.customFieldFingerprint.expected);
  });

  it('hashPhoneCode and hashEmailCode differ for the same inputs (distinct purpose strings)', () => {
    // Confirms the two functions are not accidentally sharing one HMAC
    // input despite both routing through the same internal hmac() helper.
    expect(identity.hashPhoneCode('v1', '000000')).not.toBe(identity.hashEmailCode('v1', '000000'));
  });
});
