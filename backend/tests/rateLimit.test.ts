import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Every rate limiter is skipped by default whenever NODE_ENV === 'test'
 * (src/middleware/rateLimit.ts) — the rest of the suite relies on that to
 * avoid tripping on its own request volume. RATE_LIMIT_TEST_ENFORCE flips
 * that off, and the small MAX/WINDOW overrides below make the limits
 * reachable in a handful of requests instead of real production volume.
 *
 * These must be set — and everything that transitively imports
 * src/config/env.ts (prisma, resetDb, createApp) must be dynamically
 * imported inside beforeAll, never statically at the top of this file —
 * strictly before any such import executes. env.ts's `env` export is a
 * module-level singleton parsed once on first import; a static import here
 * would be hoisted above these assignments and freeze in the default
 * (production-scale) values, silently defeating this whole file. (A static
 * top-level import also can't be `await`ed anyway — this project's tsconfig
 * compiles to CommonJS, where top-level await isn't legal.)
 */
process.env.RATE_LIMIT_TEST_ENFORCE = 'true';
process.env.RATE_LIMIT_PUBLIC_WINDOW_MS = '300000';
process.env.RATE_LIMIT_PUBLIC_MAX = '3';
process.env.RATE_LIMIT_TOKEN_CREATE_WINDOW_MS = '300000';
process.env.RATE_LIMIT_TOKEN_CREATE_MAX = '2';
process.env.RATE_LIMIT_SENSITIVE_WINDOW_MS = '300000';
process.env.RATE_LIMIT_SENSITIVE_MAX = '2';
process.env.RATE_LIMIT_REPORT_WINDOW_MS = '300000';
process.env.RATE_LIMIT_REPORT_MAX = '2';

type App = ReturnType<typeof import('../src/app').createApp>;

let app: App;

function api() {
  return request(app);
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface Owner {
  accessToken: string;
  organizationId: string;
}

async function registerOwner(): Promise<Owner> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const res = await api()
    .post('/api/auth/register')
    .send({
      organizationName: `RateLimit Org ${suffix}`,
      email: `ratelimit-${suffix}@example.com`,
      password: 'Password123',
    });
  if (res.status !== 201) {
    throw new Error(`registerOwner failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { accessToken: res.body.data.accessToken, organizationId: res.body.data.organization.id };
}

describe('rate limiting (Phase 7)', () => {
  let owner: Owner;
  let queueId: string;
  let serviceId: string;
  let blockableDeviceId: string;

  beforeAll(async () => {
    const { createApp } = await import('../src/app.js');
    const { resetDb } = await import('./helpers/db.js');
    app = createApp();

    await resetDb();
    owner = await registerOwner();

    const queueRes = await api()
      .post('/api/queues')
      .set(authHeader(owner.accessToken))
      .send({ name: 'RL Queue', tokenPrefix: 'R' });
    if (queueRes.status !== 201) {
      throw new Error(`queue setup failed: ${queueRes.status} ${JSON.stringify(queueRes.body)}`);
    }
    queueId = queueRes.body.data.id;

    const serviceRes = await api()
      .post(`/api/queues/${queueId}/services`)
      .set(authHeader(owner.accessToken))
      .send({ serviceName: 'RL Service', durationMinutes: 5 });
    if (serviceRes.status !== 201) {
      throw new Error(`service setup failed: ${serviceRes.status} ${JSON.stringify(serviceRes.body)}`);
    }
    serviceId = serviceRes.body.data.id;

    // Registered here, before the "public rate limiter" tests below
    // deliberately exhaust that same limiter (POST /register shares it) —
    // otherwise the sensitive-limiter test that needs a real device to
    // block would itself get blocked by the already-spent public budget.
    const deviceRes = await api()
      .post('/api/devices/register')
      .send({ deviceIdentifier: `rl-blockable-${randomUUID()}` });
    if (deviceRes.status !== 201) {
      throw new Error(`device setup failed: ${deviceRes.status} ${JSON.stringify(deviceRes.body)}`);
    }
    blockableDeviceId = deviceRes.body.data.id;
  });

  describe('public rate limiter', () => {
    it('allows requests below the configured limit through to the real handler', async () => {
      const res = await api().get(`/api/public/queues/${randomUUID()}/config`);
      // A random UUID has no matching queue — 404, not 429 — proving the
      // request reached the real handler rather than being blocked.
      expect(res.status).toBe(404);
    });

    it('returns 429 in the standard error format once the limit is exceeded', async () => {
      let last;
      for (let i = 0; i < 5; i++) {
        last = await api().get(`/api/public/queues/${randomUUID()}/config`);
      }
      expect(last!.status).toBe(429);
      expect(last!.body).toMatchObject({
        success: false,
        error: { code: 'RATE_LIMITED' },
      });
    });
  });

  describe('token creation rate limiter', () => {
    it('does not share a counter with the public rate limiter (already exhausted above)', async () => {
      const res = await api()
        .post('/api/tokens')
        .set('Idempotency-Key', `rl-idem-${randomUUID()}`)
        .send({
          queueId,
          serviceId,
          deviceIdentifier: `rl-device-${randomUUID()}`,
          formData: {},
        });

      expect(res.status).toBe(201);
    });

    it('has its own stricter limit and returns 429 once exceeded', async () => {
      let last;
      for (let i = 0; i < 3; i++) {
        last = await api()
          .post('/api/tokens')
          .set('Idempotency-Key', `rl-idem-${randomUUID()}`)
          .send({
            queueId,
            serviceId,
            deviceIdentifier: `rl-device-${randomUUID()}`,
            formData: {},
          });
      }
      expect(last!.status).toBe(429);
    });
  });

  describe('sensitive rate limiter (staff/organization/device mutations)', () => {
    it('still requires authentication under the limit — rate limiting never substitutes for it', async () => {
      const res = await api().post(`/api/devices/${randomUUID()}/block`);
      expect(res.status).toBe(401);
    });

    it('allows a genuine authenticated mutation under the limit', async () => {
      const res = await api()
        .post(`/api/devices/${blockableDeviceId}/block`)
        .set(authHeader(owner.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('BLOCKED');
    });

    it('returns 429 once the limit is exceeded', async () => {
      let last;
      for (let i = 0; i < 3; i++) {
        last = await api().post(`/api/devices/${randomUUID()}/block`);
      }
      expect(last!.status).toBe(429);
    });
  });

  describe('report rate limiter', () => {
    it('still requires authentication under the limit — rate limiting never substitutes for it', async () => {
      const res = await api().get('/api/reports');
      expect(res.status).toBe(401);
    });

    it('allows a genuine authenticated report request under the limit', async () => {
      const res = await api().get('/api/reports').set(authHeader(owner.accessToken));
      expect(res.status).toBe(200);
    });

    it('returns 429 once the limit is exceeded', async () => {
      let last;
      for (let i = 0; i < 3; i++) {
        last = await api().get('/api/reports');
      }
      expect(last!.status).toBe(429);
    });
  });

  describe('existing auth rate limiter (unchanged)', () => {
    it('still enforces its original 20/15min limit and returns 429 in the standard format', async () => {
      let last;
      for (let i = 0; i < 25; i++) {
        const suffix = Math.random().toString(36).slice(2, 10);
        last = await api()
          .post('/api/auth/register')
          .send({
            organizationName: `Auth RL Org ${suffix}`,
            email: `auth-rl-${suffix}@example.com`,
            password: 'Password123',
          });
      }
      expect(last!.status).toBe(429);
      expect(last!.body).toMatchObject({
        success: false,
        error: { code: 'RATE_LIMITED' },
      });
    });
  });
});
