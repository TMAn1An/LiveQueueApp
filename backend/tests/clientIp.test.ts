import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR-073: rate limits key on the real client, not on the proxy in front of
 * the service. This file runs the app as it runs on Render — the edge header
 * CF-Connecting-IP enabled, limiters enforced — with small limits so each
 * bucket is reachable in a few requests. Every variable must be set before
 * env.ts is first imported (see tests/rateLimit.test.ts for why), hence the
 * dynamic imports inside beforeAll.
 */
process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';
process.env.RATE_LIMIT_TEST_ENFORCE = 'true';
process.env.RATE_LIMIT_PUBLIC_WINDOW_MS = '300000';
process.env.RATE_LIMIT_PUBLIC_MAX = '3';
process.env.RATE_LIMIT_TOKEN_CREATE_WINDOW_MS = '300000';
process.env.RATE_LIMIT_TOKEN_CREATE_MAX = '2';

type App = ReturnType<typeof import('../src/app').createApp>;
let app: App;

/** A request as Cloudflare would forward it for the client at `ip`. */
function from(ip: string | null) {
  const agent = request(app);
  return {
    get: (path: string) => {
      const req = agent.get(path);
      return ip ? req.set('CF-Connecting-IP', ip) : req;
    },
    post: (path: string) => {
      const req = agent.post(path);
      return ip ? req.set('CF-Connecting-IP', ip) : req;
    },
  };
}

const publicPath = () => `/api/public/queues/${randomUUID()}/config`;

async function exhaustPublic(ip: string | null, extra?: Record<string, string>) {
  let last;
  for (let i = 0; i < 4; i++) {
    const req = from(ip).get(publicPath());
    last = await (extra ? req.set(extra) : req);
  }
  return last!;
}

describe('client IP resolution for rate limiting (ADR-073)', () => {
  let queueId: string;
  let serviceId: string;

  beforeAll(async () => {
    const { createApp } = await import('../src/app.js');
    const { resetDb } = await import('./helpers/db.js');
    const helpers = await import('./helpers/app.js');
    app = createApp();
    await resetDb();

    // A real queue so the join limiter is exercised on the real handler.
    // Setup traffic carries no edge header, so it lands in the peer bucket.
    const owner = await helpers.registerOwner();
    const queue = await helpers.createQueue(owner.accessToken);
    const service = await helpers.createService(owner.accessToken, queue.id);
    queueId = queue.id;
    serviceId = service.id;
  });

  describe('different real clients get different buckets', () => {
    it('one client exhausting the public limit does not block another', async () => {
      expect((await exhaustPublic('203.0.113.10')).status).toBe(429);
      const other = await from('203.0.113.11').get(publicPath());
      expect(other.status).toBe(404);
      expect(other.headers['ratelimit-remaining']).toBe('2');
    });

    it('IPv6 clients are bucketed separately from IPv4 clients', async () => {
      expect((await exhaustPublic('2001:db8:aaaa::1')).status).toBe(429);
      expect((await from('198.51.100.20').get(publicPath())).status).toBe(404);
    });

    it('join (token creation) is limited per client', async () => {
      const join = (ip: string) =>
        from(ip)
          .post('/api/tokens')
          .set('Idempotency-Key', `ip-idem-${randomUUID()}`)
          .send({ queueId, serviceId, deviceIdentifier: `ip-device-${randomUUID()}`, formData: {} });

      expect((await join('203.0.113.30')).status).toBe(201);
      expect((await join('203.0.113.30')).status).toBe(201);
      expect((await join('203.0.113.30')).status).toBe(429);
      expect((await join('203.0.113.31')).status).toBe(201);
    });

    it('login, and the invitation routes sharing its limiter, are limited per client (20/15min unchanged)', async () => {
      const login = (ip: string) =>
        from(ip).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Password123' });
      for (let i = 0; i < 20; i++) {
        expect((await login('203.0.113.40')).status).toBe(401);
      }
      expect((await login('203.0.113.40')).status).toBe(429);
      // Same bucket: an invitation check from that client is also refused…
      const invitation = await from('203.0.113.40').get(`/api/auth/invitations/validate?token=${'x'.repeat(64)}`);
      expect(invitation.status).toBe(429);
      // …while a different client can still sign in.
      expect((await login('203.0.113.41')).status).toBe(401);
    });
  });

  describe('spoofed forwarding headers do not escape a bucket', () => {
    it('rotating X-Forwarded-For does not reset the limit', async () => {
      expect((await exhaustPublic('203.0.113.50')).status).toBe(429);
      for (const spoof of ['1.1.1.1', '8.8.8.8, 9.9.9.9', randomUUID()]) {
        const res = await from('203.0.113.50').get(publicPath()).set('X-Forwarded-For', spoof);
        expect(res.status).toBe(429);
      }
    });

    it('X-Real-IP and True-Client-IP are ignored', async () => {
      const res = await from('203.0.113.50')
        .get(publicPath())
        .set('X-Real-IP', '1.2.3.4')
        .set('True-Client-IP', '5.6.7.8');
      expect(res.status).toBe(429);
    });

    it('a missing or malformed CF-Connecting-IP falls back to the peer address, never a fresh bucket', async () => {
      // No header: every such request shares the peer (proxy) address.
      expect((await exhaustPublic(null)).status).toBe(429);
      for (const junk of ['not-an-ip', '1.2.3.4, 5.6.7.8', '', '999.1.1.1']) {
        const res = await request(app).get(publicPath()).set('CF-Connecting-IP', junk);
        expect(res.status).toBe(429);
      }
    });
  });
});

describe('resolveClientIp middleware', () => {
  async function ipSeenBy(headerName: string | null, headers: Record<string, string>) {
    const { resolveClientIp } = await import('../src/middleware/clientIp.js');
    const probe = express();
    probe.use(resolveClientIp(headerName));
    probe.get('/', (req, res) => {
      res.json({ ip: req.ip });
    });
    const res = await request(probe).get('/').set(headers);
    return res.body.ip as string;
  }

  it('leaves req.ip as the peer address when no header is configured (local dev and tests)', async () => {
    const ip = await ipSeenBy(null, { 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': '1.1.1.1' });
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('uses the configured header when it holds one valid address', async () => {
    expect(await ipSeenBy('cf-connecting-ip', { 'CF-Connecting-IP': ' 203.0.113.9 ' })).toBe('203.0.113.9');
    expect(await ipSeenBy('cf-connecting-ip', { 'CF-Connecting-IP': '2001:db8::5' })).toBe('2001:db8::5');
  });

  it('never reads X-Forwarded-For, even with a header configured', async () => {
    const ip = await ipSeenBy('cf-connecting-ip', { 'X-Forwarded-For': '1.1.1.1' });
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });
});

describe('pickClientIpHeader', () => {
  it('defaults to the peer address off Render and to CF-Connecting-IP on Render', async () => {
    const { pickClientIpHeader } = await import('../src/config/env.js');
    expect(pickClientIpHeader(undefined, undefined)).toBeNull();
    expect(pickClientIpHeader(undefined, 'false')).toBeNull();
    expect(pickClientIpHeader(undefined, 'true')).toBe('cf-connecting-ip');
  });

  it('lets an explicit setting win in either direction', async () => {
    const { pickClientIpHeader } = await import('../src/config/env.js');
    expect(pickClientIpHeader('none', 'true')).toBeNull();
    expect(pickClientIpHeader('cf-connecting-ip', undefined)).toBe('cf-connecting-ip');
  });
});
