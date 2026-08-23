import { describe, expect, it } from 'vitest';
import { api, registerOwner } from './helpers/app';

/**
 * Verifies the security properties Helmet/CORS are relied on for, not
 * Helmet's exact header string internals (which would make this brittle
 * across Helmet version bumps). Runs against the normal test-environment
 * app (NODE_ENV=test) — see securityHeaders.production.test.ts for the
 * separate, isolated check that HSTS is actually present in production.
 */
describe('security headers (Phase 7 Step 3)', () => {
  it('applies Helmet to every response, including the unauthenticated health check', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });

    // Clickjacking protection.
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");

    // MIME-sniffing protection.
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    // Referrer leakage protection.
    expect(res.headers['referrer-policy']).toBe('no-referrer');

    // CSP is present and, at minimum, has no dangerous wildcard/unsafe-eval
    // default-src — the exact directive set is Helmet's own well-reviewed
    // default, kept as-is per this review's findings (see PROGRESS.md).
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('unsafe-eval');

    // Cross-Origin-Opener-Policy — process/window isolation.
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
  });

  it('does not send Strict-Transport-Security outside production', async () => {
    const res = await api().get('/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('applies the same security headers to API and error responses alike', async () => {
    const res = await api().get('/api/organizations/me');

    expect(res.status).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  describe('CORS', () => {
    it('does not reflect an arbitrary, disallowed origin', async () => {
      const res = await api().get('/health').set('Origin', 'https://evil.example.com');

      expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
    });

    it('never sends a wildcard Access-Control-Allow-Origin', async () => {
      const res = await api().get('/health').set('Origin', 'https://evil.example.com');
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  it('leaves normal authenticated API usage working (existing behavior unaffected)', async () => {
    const ctx = await registerOwner();

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.staff.id).toBe(ctx.staffId);
  });
});
