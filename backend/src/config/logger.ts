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
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refreshToken',
      'req.body.accessToken',
      'req.body.deviceIdentifier',
      'req.query.deviceIdentifier',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
