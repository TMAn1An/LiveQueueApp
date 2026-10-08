import net from 'node:net';
import type { RequestHandler } from 'express';

/**
 * ADR-073: makes `req.ip` the real client address behind an edge proxy
 * without turning on Express's `trust proxy`.
 *
 * `trust proxy` would read X-Forwarded-For, which on Render arrives as
 * "<whatever the client sent>, <client>, <edge>, <render>": the proxy appends
 * rather than replaces, so a hop count is fragile and `true` lets a caller
 * pick their own address. A single header the edge always overwrites
 * (Cloudflare's CF-Connecting-IP) has neither problem.
 *
 * With no header configured, or a missing/malformed value, `req.ip` stays
 * the TCP peer address — the pre-ADR-073 behavior — so a request can only
 * ever fall back to the shared proxy bucket, never escape into a fresh one.
 * Everything downstream (rate limiters, audit `ipAddress`) reads `req.ip`.
 */
export function resolveClientIp(headerName: string | null): RequestHandler {
  return (req, _res, next) => {
    if (headerName) {
      const raw = req.headers[headerName];
      const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
      if (value && net.isIP(value) !== 0) {
        // `ip` is a getter on Express's request prototype; an own property
        // shadows it for this request only.
        Object.defineProperty(req, 'ip', { value, configurable: true, enumerable: true });
      }
    }
    next();
  };
}
