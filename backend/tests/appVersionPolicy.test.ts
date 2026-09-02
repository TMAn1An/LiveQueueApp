import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/public/version-policy — V2 Checkpoint 9', () => {
  it('returns the current production-safe policy for android with no auth', async () => {
    const res = await api().get('/api/public/version-policy').query({ platform: 'android' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      platform: 'android',
      // Defaults must match the currently shipped app version (pubspec.yaml
      // 1.0.0+1) so this checkpoint's initial policy never locks out an
      // already-installed user.
      minimumVersion: '1.0.0',
      latestVersion: '1.0.0',
      forceUpdate: false,
      storeUrl: '',
      message: 'A new version of LiveQueue is available.',
    });
  });

  it('requires no Authorization header at all', async () => {
    // No .set('Authorization', ...) anywhere in this file — this test just
    // makes that a documented, explicit assertion rather than an implicit
    // fact of every other test here.
    const res = await api().get('/api/public/version-policy').query({ platform: 'android' });
    expect(res.status).not.toBe(401);
  });

  it('rejects a missing platform query param', async () => {
    const res = await api().get('/api/public/version-policy');
    expect(res.status).toBe(422);
  });

  it('rejects an unsupported platform value', async () => {
    const res = await api().get('/api/public/version-policy').query({ platform: 'windows' });
    expect(res.status).toBe(422);
  });

  it('never exposes organization, token, or device data', async () => {
    const res = await api().get('/api/public/version-policy').query({ platform: 'android' });
    const keys = Object.keys(res.body.data);
    expect(keys).toEqual(['platform', 'minimumVersion', 'latestVersion', 'forceUpdate', 'storeUrl', 'message']);
  });
});
