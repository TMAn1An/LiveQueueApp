import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './config/logger';
import { corsOrigins, env } from './config/env';
import routes from './routes';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  // Helmet's other defaults (CSP, X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy, COOP, etc.) are kept exactly as-is — this app only ever
  // serves JSON (no HTML/JS is served from this origin; the dashboard is a
  // separately-hosted SPA), so those headers are inert today and are simply
  // sound defense-in-depth for the future, not something worth tuning now
  // (Phase 7 Step 3 review, docs/ARCHITECTURE_DECISIONS.md).
  //
  // HSTS is the one deliberate exception: this Node process never
  // terminates TLS itself (no cert handling exists anywhere in this
  // codebase — production is assumed to sit behind a TLS-terminating
  // reverse proxy, per CLAUDE.md's infra-minimalism). Browsers already
  // ignore Strict-Transport-Security when it arrives over plain HTTP (RFC
  // 6797 §7.2), so this changes no actual behavior in dev/test today — it's
  // disabled there anyway, to make that assumption explicit rather than
  // relying on every browser's spec compliance, and to avoid ever caching
  // an HSTS policy for `localhost` if a developer's setup puts a local TLS
  // proxy in front of it.
  app.use(helmet(env.NODE_ENV === 'production' ? {} : { hsts: false }));
  app.use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ success: true, data: { status: 'ok' } });
  });

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
