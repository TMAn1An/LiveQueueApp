import { describe, expect, it } from 'vitest';
import {
  computeIdentityFingerprint,
  hashEmailCode,
  hashPhoneCode,
} from '../src/utils/customerIdentity';

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
 * file exists to *prove* it rather than assert it: every fixed-input
 * expectation below was computed against the pre-cleanup implementation
 * (raw NUL bytes, current git HEAD) with a known
 * `CUSTOMER_IDENTITY_SECRET`, and must still match, byte for byte, after
 * the NUL bytes are replaced with `\0` escapes.
 *
 * A change to the actual separator, the join order, or the HMAC key would
 * fail every one of these — that is the whole point of a golden-value test
 * over a "does verification still work end-to-end" one: the latter would
 * pass even if the separator changed to something else entirely, as long
 * as hashing and comparing stayed internally consistent with each other.
 */
describe('customerIdentity HMAC outputs are unchanged by the NUL-byte source cleanup', () => {
  it('hashPhoneCode produces its pre-cleanup golden value', () => {
    expect(hashPhoneCode('verification-1', '123456')).toBe(
      '56d4c468bd0f17b52d070d7a0ffbe91994c21121e869fb3bd3feae48b1d1721f',
    );
  });

  it('hashEmailCode produces its pre-cleanup golden value', () => {
    expect(hashEmailCode('verification-1', '123456')).toBe(
      '5f3a3df90e58dd18dbad7318e4e56e84e3b62642d9f614c8750cb5fc274e620a',
    );
  });

  it('a verified-email fingerprint produces its pre-cleanup golden value', () => {
    expect(
      computeIdentityFingerprint({
        queueId: 'queue-1',
        mode: 'VERIFIED_EMAIL',
        normalizedVerifiedContact: 'person@example.com',
      }),
    ).toBe('235478eb55793877f01b8794935f4dba2b86c8efbfcae140651bade303323d4a');
  });

  it('a custom-field fingerprint produces its pre-cleanup golden value', () => {
    expect(
      computeIdentityFingerprint({
        queueId: 'queue-1',
        mode: 'CUSTOM_FIELD',
        normalizedCustomValue: 'national-id-12345',
      }),
    ).toBe('2e99cba4d7efa15327859d555d3a3348ed6d522e2917039157ae05bd70937e8d');
  });

  it('hashPhoneCode and hashEmailCode differ for the same inputs (distinct purpose strings)', () => {
    // Confirms the two functions are not accidentally sharing one HMAC
    // input despite both routing through the same internal hmac() helper.
    expect(hashPhoneCode('v1', '000000')).not.toBe(hashEmailCode('v1', '000000'));
  });
});
