import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { envSchema } from '../src/config/env';

/** ADR-068: VAPID configuration is all-or-nothing and shape-checked, and a
 * rejection never echoes the secret value. */
describe('Web Push environment validation', () => {
  const base = { ...process.env };
  const keys = webpush.generateVAPIDKeys();
  const parse = (extra: Record<string, string | undefined>) => envSchema.safeParse({ ...base, ...extra });

  it('accepts all three unset (Web Push off)', () => {
    const result = parse({ WEB_PUSH_VAPID_PUBLIC_KEY: '', WEB_PUSH_VAPID_PRIVATE_KEY: '', WEB_PUSH_SUBJECT: '' });
    expect(result.success).toBe(true);
    expect(result.data?.WEB_PUSH_VAPID_PUBLIC_KEY).toBeUndefined();
  });

  it('accepts a real key pair with a mailto: or https: subject', () => {
    for (const subject of ['mailto:support@example.com', 'https://example.com/contact']) {
      const result = parse({
        WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
        WEB_PUSH_SUBJECT: subject,
      });
      expect(result.success, subject).toBe(true);
    }
  });

  it('refuses a partial configuration', () => {
    const result = parse({ WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: '', WEB_PUSH_SUBJECT: '' });
    expect(result.success).toBe(false);
  });

  it('refuses malformed keys and subjects without echoing them', () => {
    const result = parse({
      WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: 'not-a-key-SECRETVALUE',
      WEB_PUSH_SUBJECT: 'support@example.com',
    });
    expect(result.success).toBe(false);
    const messages = JSON.stringify(result.error?.issues);
    expect(messages).toContain('WEB_PUSH_VAPID_PRIVATE_KEY');
    expect(messages).toContain('WEB_PUSH_SUBJECT');
    expect(messages).not.toContain('SECRETVALUE');
  });
});
