import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { redactOptions } from '../src/config/logger';

/**
 * V2 Final Audit: secrets must never reach log output. These assert against
 * the REAL exported `redactOptions` the production logger is built from —
 * not a copy — so the guarantee cannot silently drift from what actually
 * ships.
 *
 * The object logged below is the exact shape pino-http serializes for a
 * request-completed line (`url` is the original url *including* its query
 * string; `query` is the parsed object; both are logged).
 */
function captureLogLine(payload: Record<string, unknown>): string {
  const chunks: string[] = [];
  const stream = { write: (chunk: string) => chunks.push(chunk) };
  const testLogger = pino({ level: 'info', redact: redactOptions }, stream as never);
  testLogger.info(payload, 'request completed');
  return chunks.join('');
}

describe('logger redaction — secrets must never reach log output', () => {
  it('redacts every credential carried in a request, including query params and the raw url', () => {
    const line = captureLogLine({
      req: {
        method: 'GET',
        // pino-http serializes the ORIGINAL url, query string included.
        url: '/api/auth/email-verification/verify?token=SECRET_VERIFY_TOKEN',
        query: {
          token: 'SECRET_VERIFY_TOKEN',
          deviceIdentifier: 'SECRET_DEVICE_ID',
        },
        headers: { authorization: 'Bearer SECRET_JWT', cookie: 'sid=SECRET_COOKIE' },
        body: {
          password: 'SECRET_PASSWORD',
          refreshToken: 'SECRET_REFRESH',
          deviceIdentifier: 'SECRET_DEVICE_ID',
        },
      },
    });

    // The raw email-verification bearer token must not survive anywhere in
    // the line — neither as the parsed query field nor inside `url`.
    expect(line).not.toContain('SECRET_VERIFY_TOKEN');
    expect(line).not.toContain('SECRET_DEVICE_ID');
    expect(line).not.toContain('SECRET_JWT');
    expect(line).not.toContain('SECRET_COOKIE');
    expect(line).not.toContain('SECRET_PASSWORD');
    expect(line).not.toContain('SECRET_REFRESH');
  });

  it('keeps the request path (operational value) while dropping only the query string', () => {
    const line = captureLogLine({
      req: { method: 'GET', url: '/api/devices?page=2&status=BLOCKED', query: { page: 2 } },
    });

    expect(line).toContain('/api/devices');
    expect(line).not.toContain('page=2');
    // Non-sensitive parsed query values are still logged as structured data,
    // so nothing operationally useful is lost by stripping the url's query.
    expect(line).toContain('"page":2');
  });

  it('leaves a url with no query string untouched', () => {
    const line = captureLogLine({ req: { method: 'GET', url: '/health' } });
    expect(line).toContain('"url":"/health"');
  });

  /**
   * ADR-037: a customer's email address is personal data, the code is a
   * credential, and the proof is a bearer credential for an identity claim.
   * All three arrive on the public verification and join routes.
   */
  it('redacts a customer email verification request', () => {
    const line = captureLogLine({
      req: {
        method: 'POST',
        url: '/api/public/email-verification/confirm',
        body: {
          verificationId: 'abc',
          email: 'person@example.com',
          code: '424242',
          emailVerificationProof: 'SECRET_EMAIL_PROOF',
        },
      },
    });

    expect(line).not.toContain('person@example.com');
    expect(line).not.toContain('424242');
    expect(line).not.toContain('SECRET_EMAIL_PROOF');
  });

  it('redacts the email proof on the join request too', () => {
    // The proof rides along on POST /api/tokens as well as the verification
    // routes. The wildcard entry covers a top-level req.emailVerificationProof;
    // like the pre-existing '*.token', it matches two-segment paths only, so
    // req.body is named explicitly rather than relied on by pattern.
    const line = captureLogLine({
      req: {
        method: 'POST',
        url: '/api/tokens',
        body: { emailVerificationProof: 'SECRET_EMAIL_PROOF' },
        // Also covered one level up by the '*.emailVerificationProof'
        // wildcard, which — like the pre-existing '*.token' — matches
        // two-segment paths, so this is the reach it actually has.
        emailVerificationProof: 'SECRET_EMAIL_PROOF',
      },
    });

    expect(line).not.toContain('SECRET_EMAIL_PROOF');
  });
});
