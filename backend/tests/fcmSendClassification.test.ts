import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebaseAdmin', () => ({
  getFirebaseMessaging: vi.fn(),
}));

import { getFirebaseMessaging } from '../src/services/firebaseAdmin';
import { sendNotification } from '../src/services/fcm.service';

/**
 * Phase 7 review fix: messaging/invalid-argument must NOT be treated as a
 * dead token. It's a broad Firebase validation error that also fires for a
 * malformed payload — a bug in this service's own message construction, not
 * evidence the customer's device is gone. Misclassifying it previously
 * would have silently deleted a healthy device's DeviceFcmToken row.
 */
describe('fcm.service — invalid-token error classification', () => {
  it('classifies messaging/registration-token-not-registered as invalidToken', async () => {
    const send = vi.fn().mockRejectedValue({ errorInfo: { code: 'messaging/registration-token-not-registered' } });
    vi.mocked(getFirebaseMessaging).mockReturnValue({ send } as never);

    const result = await sendNotification('dead-token', { title: 'T', body: 'B' });

    expect(result).toEqual({ ok: false, invalidToken: true });
  });

  it('classifies messaging/invalid-registration-token as invalidToken', async () => {
    const send = vi.fn().mockRejectedValue({ errorInfo: { code: 'messaging/invalid-registration-token' } });
    vi.mocked(getFirebaseMessaging).mockReturnValue({ send } as never);

    const result = await sendNotification('bad-token', { title: 'T', body: 'B' });

    expect(result).toEqual({ ok: false, invalidToken: true });
  });

  it('does NOT classify messaging/invalid-argument as invalidToken', async () => {
    const send = vi.fn().mockRejectedValue({ errorInfo: { code: 'messaging/invalid-argument' } });
    vi.mocked(getFirebaseMessaging).mockReturnValue({ send } as never);

    const result = await sendNotification('some-token', { title: 'T', body: 'B' });

    expect(result).toEqual({ ok: false, invalidToken: false });
  });

  it('does not classify an error with no recognizable code as invalidToken', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network timeout'));
    vi.mocked(getFirebaseMessaging).mockReturnValue({ send } as never);

    const result = await sendNotification('some-token', { title: 'T', body: 'B' });

    expect(result).toEqual({ ok: false, invalidToken: false });
  });

  it('a successful send reports ok:true, invalidToken:false', async () => {
    const send = vi.fn().mockResolvedValue('projects/x/messages/123');
    vi.mocked(getFirebaseMessaging).mockReturnValue({ send } as never);

    const result = await sendNotification('good-token', { title: 'T', body: 'B' });

    expect(result).toEqual({ ok: true, invalidToken: false });
  });
});
