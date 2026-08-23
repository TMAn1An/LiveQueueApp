import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
 * Isolated from every other test file: overrides NODE_ENV to 'production'
 * before anything imports src/config/env.ts, to verify Helmet's HSTS header
 * is actually present in production (securityHeaders.test.ts proves the
 * opposite — absent — for the normal test environment). env.ts's `env`
 * export is a module-level singleton parsed once on first import, so this
 * override must happen strictly before any such import, and that import
 * must be dynamic — a static import here would be hoisted above the
 * assignment below and see the wrong NODE_ENV. No live database connection
 * is required: PrismaClient connects lazily, and this file only issues a
 * request to the unauthenticated /health endpoint.
 */
process.env.NODE_ENV = 'production';

describe('security headers — production environment', () => {
  it('sends Strict-Transport-Security when NODE_ENV=production', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toMatch(/^max-age=\d+/);
  });
});
