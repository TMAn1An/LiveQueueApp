import pino from 'pino';
import { env } from './env';

/**
 * Redact paths cover the standard pino-http request/response log shape
 * (req.headers.authorization, req.body.password, etc.) so that access
 * tokens, refresh tokens, and passwords never reach log output.
 *
 * V2 Checkpoint 7A: pino-http logs req.query by default (confirmed from
 * actual request-completed log lines) but not req.body — so
 * deviceIdentifier, the bearer credential for the new customer-owned
 * endpoints (cancel/verification-code/reissue; ADR-029), would otherwise
 * appear in plain INFO-level production logs on every
 * GET .../verification-code call, the one endpoint that sends it as a
 * query param rather than a body field. req.body.deviceIdentifier is
 * redacted too, defensively, in case a future change (or a differently
 * configured logger) ever starts serializing bodies.
 *
 * V2 Final Audit: two gaps in the above were found by actually running the
 * config rather than reading it. (1) The generic `*.token` wildcard matches
 * only two-segment paths (`req.token`), NOT `req.query.token` — so the raw,
 * single-use email-verification bearer token from
 * `GET /api/auth/email-verification/verify?token=...` (ADR-024) was logged
 * in full. (2) pino-http serializes `req.url` as the ORIGINAL url including
 * its query string, so every secret passed as a query param leaked a second
 * time through `url` even when the parsed `query` field was redacted —
 * which also left the Checkpoint 7A deviceIdentifier fix incomplete.
 *
 * `req.url` is therefore censored with a path-aware function that keeps the
 * request path and drops only the query string: no operational value is
 * lost (the parsed `query` object is still logged separately, with its
 * sensitive keys redacted by name), and any future sensitive query param is
 * covered by default instead of needing to be remembered here.
 */
const SENSITIVE_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.deviceIdentifier',
  'req.query.deviceIdentifier',
  'req.query.token',
  'req.url',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
];

/** Exported so the redaction guarantees can be asserted against the REAL
 * configuration in tests, rather than against a copy of it that could
 * silently drift from what production actually runs. */
export const redactOptions = {
  paths: SENSITIVE_REDACT_PATHS,
  censor: (value: unknown, path: string[]): unknown => {
    if (path[path.length - 1] === 'url' && typeof value === 'string') {
      // Keep the path, drop the query string entirely.
      return value.split('?')[0];
    }
    return '[REDACTED]';
  },
};

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: redactOptions,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
