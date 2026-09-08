import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * The boundary between LiveQueue and whatever eventually sends SMS.
 *
 * This repository ships **no** SMS provider. Rather than pick one and couple
 * the identity feature to a vendor that may never be used, phone
 * verification is written against this interface, and the only shipped
 * implementations are:
 *
 *  - `none`  — the default. Reports itself unavailable, which makes the
 *    whole VERIFIED_PHONE identity mode unconfigurable rather than quietly
 *    broken (see isPhoneVerificationAvailable).
 *  - `log`   — development only. Writes a redacted line proving the send
 *    path ran; never the code itself.
 *
 * Adding a real provider means one more implementation here and one more
 * `SMS_PROVIDER` value — nothing else in the codebase changes.
 */
export interface SmsVerificationProvider {
  readonly name: string;
  /** Whether this provider can actually deliver right now. */
  isAvailable(): boolean;
  /** Never returns the code, and never logs it. Throws on delivery failure
   * so the caller can surface a real error rather than a false success. */
  sendVerificationCode(input: { phone: string; code: string }): Promise<void>;
}

const unavailableProvider: SmsVerificationProvider = {
  name: 'none',
  isAvailable: () => false,
  sendVerificationCode: async () => {
    throw new Error('No SMS provider is configured.');
  },
};

/**
 * Development aid: proves the flow reaches the provider without needing an
 * account anywhere. The code is deliberately absent from the log line —
 * tests read it from the fake provider, not from logs.
 */
const logProvider: SmsVerificationProvider = {
  name: 'log',
  isAvailable: () => true,
  sendVerificationCode: async ({ phone }) => {
    logger.info(
      { phoneSuffix: phone.slice(-4) },
      'Phone verification code dispatched via the log provider (development only)',
    );
  },
};

let overrideProvider: SmsVerificationProvider | null = null;

/** Test seam: lets the suite install an in-memory provider that captures
 * codes, so phone verification is exercised end to end without SMS. */
export function setSmsProviderForTesting(provider: SmsVerificationProvider | null): void {
  overrideProvider = provider;
}

export function getSmsProvider(): SmsVerificationProvider {
  if (overrideProvider) {
    return overrideProvider;
  }
  return env.SMS_PROVIDER === 'log' ? logProvider : unavailableProvider;
}

/**
 * The single gate the rest of the system asks. Queue configuration consults
 * it before allowing an identity mode that needs SMS, so an operator can
 * never create a queue whose customers are unable to join because the server
 * cannot text them.
 */
export function isPhoneVerificationAvailable(): boolean {
  return getSmsProvider().isAvailable();
}
