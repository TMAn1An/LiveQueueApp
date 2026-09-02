# LiveQueue Backend — Production Deployment

Phase 7 Step 8. Backend only — `web-dashboard` (a static Vite build) and
`mobile-app` (a Flutter app store/sideload build) have their own,
independent deployment paths not covered here. This document describes
**how to deploy what this repository actually contains today** — it does
not introduce infrastructure (Docker, PM2, systemd, a reverse-proxy config)
the repository doesn't already have. Where an example is genuinely useful,
it's explicitly labeled as an example, not presented as existing tooling.

---

## 1. Production prerequisites

- **Node.js ≥ 22.0.0** — `backend/package.json`'s `engines` field. Note this
  is an **open-ended floor, not a pin**: a host that resolves "latest
  satisfying" will pick whatever major is newest at build time (Render has
  already selected Node 26 this way, while local development runs Node 25).
  Nothing is currently tested against a single agreed major. Pinning an
  exact major (`"22.x"` / `"24.x"`) and setting the host's Node version
  explicitly is recommended — do it together with a full backend
  test/build run on that major, not as a blind edit.
- **PostgreSQL** — the only supported datasource (`backend/prisma/schema.prisma`'s
  `provider = "postgresql"`, `backend/prisma/migrations/migration_lock.toml`).
  No specific version is pinned in this repository; use a currently-supported
  PostgreSQL release.
- **A Firebase service-account credential**, if backend push notifications
  (reminder dispatch) are wanted in this deployment. Optional — the backend
  runs correctly without one; see §6.
- **Every required environment variable set** (§3) before the process starts
  — `backend/src/config/env.ts` validates them at startup with Zod and
  **exits immediately** (`process.exit(1)`) if anything required is missing
  or malformed, printing which field failed (never a secret value).
- **`CORS_ORIGINS`** set to the real dashboard origin(s) — an empty value
  makes the CORS middleware reject every cross-origin request
  (`origin: false` when the parsed list is empty, `backend/src/app.ts`).
- **`NODE_ENV=production`** — this is not cosmetic. It changes: Pino's log
  level (`info`, not `debug`), Prisma's own logging (`error` only, never
  `warn`), Helmet's HSTS header (sent only in production, §4), and the
  reminder scheduler's eligibility to start at all (it never starts under
  `NODE_ENV=test`, and — like every other environment-gated behavior in this
  codebase — is intended to run in `production`).

---

## 2. Backend deployment

Run from the `backend/` directory — every command below assumes that as the
working directory (matching the existing `npm run <script>` scripts, which
are all defined there).

```bash
cd backend
npm ci                    # install exact locked dependencies
npm run prisma:generate   # regenerate the Prisma client for this environment
npm run prisma:deploy     # apply migrations — see §7, never `prisma:migrate`
npm run build             # tsc -p tsconfig.json -> dist/
npm start                 # node dist/server.js
```

`npm start` runs `node dist/server.js` (`package.json`'s `main`/`start`
script) — the build step is required first; there is no dev-mode-in-production
path (`npm run dev` uses `tsx watch`, not intended for production).

**Verify `/health`** once the process is listening (`src/app.ts` — no
auth, no rate limiting, returns `{"success":true,"data":{"status":"ok"}}`):

```bash
curl -f http://localhost:$PORT/health
```

A non-200 or connection failure here means the process isn't listening yet
or crashed at startup — check the structured logs for the Zod validation
failure `env.ts` prints on invalid configuration (§1).

---

## 3. Environment configuration

Every variable currently defined in `backend/.env.example` /
`backend/src/config/env.ts`. **Required** = no default, startup fails
without it. **Optional** = has a default or is genuinely optional.

### 3a. Startup-fatal — the process exits immediately without these

There are exactly **three**. `env.ts` validates them with Zod and calls
`process.exit(1)` if any is missing or malformed.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:port/db`. |
| `JWT_SECRET` | ≥32 chars. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `OTP_SECRET` | ≥32 chars, generated the same way. Keys the service-start verification-code cipher (V2 Checkpoint 7, ADR-029/ADR-031). **A separate secret from `JWT_SECRET` — never reuse the same value.** |

> **`OTP_SECRET` was added in V2 Checkpoint 7 and is startup-fatal.** A
> deployment that carries forward a pre-V2 environment without it will
> **fail to boot** — this has already happened once in production. Set it
> before deploying any build at or after commit `4c3c20b`.

### 3b. Optional to *start*, but required for a feature to actually work

These never block startup, so a misconfiguration here is silent — the
process comes up healthy and the feature is simply dead. Verify each one
deliberately rather than trusting `/health`.

| Variable | Default | What breaks if unset/wrong |
|---|---|---|
| `NODE_ENV` | `development` | Must be `production` — see §1. Also note the dev default selects Pino's `pino-pretty` transport, which is a **devDependency**: a production install that omits dev dependencies *and* leaves `NODE_ENV` unset can fail at logger construction. |
| `CORS_ORIGINS` | `''` → blocks **all** cross-origin | The dashboard cannot call the API at all. Comma-separated origin list. |
| `RESEND_API_KEY` | unset → emails not sent | **Registration is effectively broken**: the account is created `PENDING_EMAIL_VERIFICATION`, the verification email is never delivered, the user can never verify, and the pending organization is auto-deleted one hour later by the cleanup scheduler (§5). |
| `APP_BASE_URL` | `http://localhost:5173` | Verification emails link to `localhost` — every verification link is unusable. Set to the real dashboard origin. |
| `EMAIL_FROM` | `LiveQueue <onboarding@resend.dev>` | Works, but sends from Resend's shared sandbox sender. Use a verified sending domain. |
| `FIREBASE_CREDENTIALS` *or* `FIREBASE_SERVICE_ACCOUNT_PATH` | unset → push disabled | No push notifications (reminders, lifecycle). See §6 — **on Render, use `FIREBASE_CREDENTIALS`**. |
| `MOBILE_ANDROID_STORE_URL` | `''` | Only matters once you raise the minimum app version — the Update Required screen then has no store to send users to. See §11. |

### 3c. Safe defaults — set only to override

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port. |
| `TEST_DATABASE_URL` | falls back to `DATABASE_URL` | Test-suite only; irrelevant in production. |
| `JWT_EXPIRES_IN` | `15m` | Access-token lifetime. |
| `REFRESH_TOKEN_EXPIRES_IN` | `30d` | Refresh-session lifetime (ADR-013). |
| `BCRYPT_SALT_ROUNDS` | `12` | Password hashing cost, bounded 10–15. |
| `RATE_LIMIT_PUBLIC_WINDOW_MS` / `RATE_LIMIT_PUBLIC_MAX` | `60000` / `60` | Public endpoints. |
| `RATE_LIMIT_TOKEN_CREATE_WINDOW_MS` / `RATE_LIMIT_TOKEN_CREATE_MAX` | `60000` / `10` | `POST /api/tokens`'s stricter limiter. |
| `RATE_LIMIT_SENSITIVE_WINDOW_MS` / `RATE_LIMIT_SENSITIVE_MAX` | `900000` / `30` | Sensitive authenticated mutations (incl. OTP-gated `/start`). |
| `RATE_LIMIT_REPORT_WINDOW_MS` / `RATE_LIMIT_REPORT_MAX` | `900000` / `10` | Reports/export. |
| `RATE_LIMIT_EMAIL_WINDOW_MS` / `RATE_LIMIT_EMAIL_MAX` | `900000` / `3` | Verification-email resend (deliberately tighter — a real email is sent). |
| `REMINDER_DISPATCH_CRON` | `*/1 * * * *` | See §5. |
| `PENDING_REGISTRATION_CLEANUP_CRON` | `*/5 * * * *` | See §5. |
| `MOBILE_ANDROID_MIN_VERSION` | `1.0.0` | Below this, the mobile app hard-blocks itself. See §11. |
| `MOBILE_ANDROID_LATEST_VERSION` | `1.0.0` | Advisory "update available" only — never blocks. |
| `MOBILE_ANDROID_FORCE_UPDATE` | `false` | Emergency kill switch; ORs with the version check, never narrows it. |
| `MOBILE_ANDROID_UPDATE_MESSAGE` | `A new version of LiveQueue is available.` | Shown on the Update Required screen. |

`RATE_LIMIT_TEST_ENFORCE` also exists in `env.ts` but is deliberately **not**
in `.env.example` and must never be set in a real environment — it exists
solely so one test file can exercise 429 behavior in isolation.

**Never commit a real value for any of these into `.env.example` or anywhere
else tracked by git** — `.env.example` must stay placeholders only, exactly
as it is today.

---

## 4. Reverse proxy / HTTPS

This Node process **never terminates TLS itself** — there is no certificate
handling anywhere in this codebase, by design (CLAUDE.md's infra-minimalism;
see `src/app.ts`'s own comment on the Helmet configuration). Production is
assumed to run behind a TLS-terminating reverse proxy or load balancer; the
backend only ever speaks plain HTTP on `PORT`.

This is why **HSTS is production-only** (`src/app.ts`):
```ts
app.use(helmet(env.NODE_ENV === 'production' ? {} : { hsts: false }));
```
Browsers ignore `Strict-Transport-Security` when it arrives over plain HTTP
anyway (RFC 6797 §7.2), so this doesn't change behavior in dev — it makes
the TLS-terminates-elsewhere assumption explicit rather than relying on
every browser's spec compliance.

**No reverse-proxy configuration exists in this repository.** The example
below is illustrative only — not part of this project, not tested here, and
not a claim that this is how the repository is actually deployed:

```nginx
# EXAMPLE ONLY — not part of this repository.
server {
    listen 443 ssl;
    server_name api.example.com;
    # ssl_certificate / ssl_certificate_key from your certificate provider

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If the proxy is trusted to set `X-Forwarded-For` correctly, Express's
`req.ip` (already used throughout — rate limiting, audit `ipAddress`
snapshots) reflects the real client IP only if the proxy is configured to
forward it; this repository does not currently set Express's `trust proxy`
setting, so evaluate that against your actual proxy before relying on
`req.ip` in production.

---

## 5. Schedulers

**Two** `node-cron` jobs are started automatically from `server.ts` once the
HTTP server is listening — no separate process or command is needed for
either:

1. **Reminder dispatch** — `REMINDER_DISPATCH_CRON` (default `*/1 * * * *`).
   Sends "it's almost your turn" pushes.
2. **Pending-registration cleanup** — `PENDING_REGISTRATION_CLEANUP_CRON`
   (default `*/5 * * * *`, V2 Checkpoint 2). Deletes organizations whose
   owner never verified their email within the 1-hour registration window.
   Verified accounts are never matched (their `registrationExpiresAt` is
   cleared on verification).

**Both are safe to run on more than one backend instance.** Reminder
dispatch claims each token with a conditional `UPDATE ... WHERE
reminderSentAt IS NULL` before sending, and cleanup is an idempotent
`deleteMany` — neither depends on there being exactly one process. (Note
that **Socket.io does**: see §12.)

The notes below apply to both.

```ts
server.listen(env.PORT, () => {
  logger.info(...);
  startReminderScheduler();
  startPendingRegistrationCleanupScheduler();
});
```

- **Never starts under `NODE_ENV=test`** (both `start*Scheduler()` functions
  return immediately) — the automated test suite drives the dispatch logic
  directly instead.
- **No overlapping runs**: `node-cron`'s own `noOverlap: true` option
  guards against a slow run still executing when the next tick fires.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` stop both schedulers (awaited)
  before the HTTP server and Prisma connection close — a
  deployment that sends `SIGTERM` on redeploy (most container schedulers,
  systemd, PM2) stops the schedulers cleanly first.
- Every tick's failures are caught and logged (`reminderScheduler.ts`) —
  a bad run is visible in structured logs but never crashes the process or
  blocks the next tick.

---

## 6. Firebase Admin

Full detail, including manual dispatch/verification steps, lives in
[`docs/FIREBASE_SETUP.md`](./FIREBASE_SETUP.md) — this section is the
production-deployment summary of it.

There are **two** supported ways to supply the credential; exactly one is
needed. `FIREBASE_CREDENTIALS` takes priority if both are set.

- **`FIREBASE_CREDENTIALS`** — the entire service-account JSON *content* as
  the variable's value. **This is the one to use on Render** (or any other
  stateless host): such platforms have no mechanism to mount a plain
  environment variable as a file on disk, so the path-based option below
  simply cannot work there.
- **`FIREBASE_SERVICE_ACCOUNT_PATH`** — an absolute filesystem path to the
  downloaded JSON file. Local development and traditional servers only.

1. **Firebase Console** → the `livequeue-99529` project → **Project
   Settings → Service Accounts → Generate new private key**. This downloads
   a JSON file — that download is the only place the credential should ever
   exist outside the running server's own environment.
2. **On Render (or similar):** paste the file's full contents as the value
   of `FIREBASE_CREDENTIALS` in the service's environment settings. Do not
   commit it anywhere.
   **On a traditional server:** place the file outside the deployed
   application directory if possible — at minimum outside anything a
   build/deploy step might package or serve, never inside a path git tracks
   — restrict its permissions to the user the Node process runs as (e.g.
   `chmod 600`), and set `FIREBASE_SERVICE_ACCOUNT_PATH` to its absolute
   path.
4. **Verify initialization**: watch the logs after the first reminder-dispatch
   tick or FCM send attempt (initialization is lazy, not at boot) for either
   `"Firebase Admin initialized — FCM dispatch is enabled."` or a warning
   that it's disabled. Nothing crashes either way.
5. **Real push delivery requires this credential.** Without it, the backend
   runs completely normally — reminder dispatch simply has nothing to send
   through, every attempt logged and skipped, never a startup failure.

**Never**: commit the JSON file (already blocked by `.gitignore`'s
`*service-account*.json` rule), paste its contents into source, a commit
message, an issue, or this documentation, or fabricate a placeholder that
looks like a real key.

---

## 7. Database deployment

```bash
npm run prisma:deploy   # = prisma migrate deploy
```

**Never run `npm run prisma:migrate` (`prisma migrate dev`) against a
production database** — it's an interactive, schema-drift-resolving command
intended for local development; it can prompt for destructive actions and
is not the production-safe path. `prisma migrate deploy` only ever applies
already-committed, already-reviewed migrations in order — it never
generates new ones and never asks a question.

**Back up the database before running migrations in production**, as a
standing operational rule, not a per-migration judgment call — every
migration in this repository so far has been purely additive (new
tables/columns/indexes, confirmed via `prisma migrate status` after each
one — see Phase 7 Steps 4 and 7's own migrations), but that doesn't
substitute for a real backup being current before a schema-affecting
deploy.

**Do not modify existing migration files.** `prisma migrate deploy` computes
which migrations are already applied by their checksum; editing a migration
that's already run in any environment will make Prisma report drift.

---

## 8. Post-deployment health checklist

Run through this after every production deploy:

- [ ] Process starts and stays up (check the process manager / container status).
      A boot loop with `Invalid environment configuration` in the logs means a
      **§3a** variable is missing — most commonly `OTP_SECRET` on an
      environment carried forward from before V2 Checkpoint 7.
- [ ] `curl -f http://localhost:$PORT/health` returns `200` with `{"success":true,...}`.
- [ ] `curl -f "http://localhost:$PORT/api/public/version-policy?platform=android"`
      returns the expected policy — confirm `minimumVersion` is **not** above
      the version currently on the store (§11), or every installed app blocks itself.
- [ ] Register a disposable organization and confirm the verification email
      actually arrives (§3b: without `RESEND_API_KEY` the account is created
      but can never be verified, and is auto-deleted an hour later).
- [ ] `npx prisma migrate status` (run from `backend/`, against the production `DATABASE_URL`) reports **no pending migrations**.
- [ ] A real database write succeeds — e.g. `POST /api/auth/register` against a disposable test org, then remove it, or simply confirm existing staff can log in.
- [ ] Logs show the reminder scheduler started (`"Reminder dispatch scheduler started"`).
- [ ] If `FIREBASE_SERVICE_ACCOUNT_PATH` is set: logs show `"Firebase Admin initialized"` after the first tick, not the "disabled" warning.
- [ ] `POST /api/devices/fcm-token` with a real device identifier + token returns `200`.
- [ ] `PUT /api/tokens/:tokenId/notification-preferences` against a real token returns `200`.
- [ ] A real reminder dispatch can be observed in logs (`"Reminder dispatch run complete"` with a non-zero `scanned` once real eligible tokens exist) — full manual walkthrough in `docs/FIREBASE_SETUP.md` §6.
- [ ] Grep recent logs for anything that looks like a raw secret (`Bearer `, a JWT structure, `password`, a long opaque token) — none should appear; Pino's redaction (`src/config/logger.ts`) and this codebase's own redacted-token-logging convention (`fcm.service.ts`, mobile `FcmService`) should mean there's nothing to find.

---

## 9. Rollback / failure handling

**Application rollback** (bad deploy, no schema change involved) is safe and
simple: redeploy the previous build/commit and restart the process — this
backend is stateless application code; nothing about rolling the process
back is destructive.

**Database migration rollback is a different, harder problem this
repository does not currently have tooling for.** There are no "down"
migrations in `backend/prisma/migrations/` — each migration folder contains
only the forward `migration.sql`. Prisma's own `migrate deploy` workflow has
no built-in rollback command. Concretely:

- If a migration hasn't shipped yet, don't apply it — fix the schema and
  regenerate it locally instead (`npx prisma migrate dev`, in development
  only).
- If a bad migration has already been applied to production, **the tested
  path is restoring the pre-migration backup** (§7) — not hand-writing a
  reverse migration or manually editing the `_prisma_migrations` table,
  neither of which this repository has a verified procedure for. Do not
  improvise a destructive rollback command against a production database.

---

## 10. Security rules (operational)

- **Never commit `.env`** — already enforced by `.gitignore` (`.env`,
  `.env.*`, with `.env.example` explicitly excepted).
- **Never commit the Firebase service-account JSON** — already enforced by
  `.gitignore`'s `*service-account*.json` pattern.
- **Never paste a private key into source code, a commit message, an issue,
  or documentation** — including this file.
- **Restrict the service-account file's permissions** on the server (e.g.
  `chmod 600`, owned by the process user only).
- **Use HTTPS in production** — via the reverse proxy (§4); this process
  itself never terminates TLS.
- **Keep `CORS_ORIGINS` restricted** to the real dashboard origin(s) — never
  a wildcard, never left empty in a way that's mistaken for "allow
  everything" (empty means the opposite: block everything, §1).
- **Do not enable Prisma query logging in production** — `src/config/prisma.ts`
  already only enables `warn`/`error` in production (`query`, which would
  log full parameterized SQL including any embedded values, is never
  enabled in any environment) — do not change this for production
  debugging; use `NODE_ENV=development` locally against a copy of the data
  instead.

---

## 11. Mobile version policy / force-update

The mobile app asks the backend at every launch whether its installed
version is still supported (`GET /api/public/version-policy?platform=android`,
V2 Checkpoint 9 / ADR-031). The policy is entirely environment-driven, so
it changes with a backend environment update + redeploy — no mobile rebuild
and no database change.

**The shipped defaults are deliberately inert**: `MOBILE_ANDROID_MIN_VERSION`
and `MOBILE_ANDROID_LATEST_VERSION` both default to `1.0.0`, matching the
currently shipped app, with `MOBILE_ANDROID_FORCE_UPDATE=false`. Deploying
this backend does **not** block any existing install.

**Before ever raising `MOBILE_ANDROID_MIN_VERSION`**, in this order:

1. Deploy the backward-compatible backend first (old and new app builds both work).
2. Publish the new mobile build and confirm store rollout has actually reached users.
3. Set `MOBILE_ANDROID_STORE_URL` to the real store listing — an empty value
   leaves blocked users with an Update button that has nowhere to send them.
4. Only then raise `MOBILE_ANDROID_MIN_VERSION`. This is the step that starts
   hard-blocking old installs.
5. Later, once the old client population is gone, retire any backend
   compatibility shims that existed only for it.

Client behavior on failure is fail-open: if the policy request fails and the
app has no cached policy, it continues normally rather than locking users
out of a working app because the API was briefly unreachable. A previously
cached *blocking* policy still blocks.

---

## 12. Instance count / horizontal scaling

**Run a single backend instance unless Socket.io is reworked first.**

The Socket.io server holds its state in a module-level singleton with no
cross-instance adapter (`src/realtime/socketServer.ts`; approved Phase 4
decision — no Redis, per CLAUDE.md's infra-minimalism). With more than one
instance behind a load balancer, an event emitted by the instance that
handled a REST request only reaches the clients connected to *that*
instance; clients on other instances silently miss it.

This degrades gracefully rather than corrupting anything — PostgreSQL
remains the single source of truth, and both clients already treat realtime
as a notification layer only (the mobile app re-syncs authoritative state
over REST on every reconnect and after every FCM wake; the dashboard
invalidates and refetches). But live updates become unreliable, so:

- Keep the service at **one instance** (on Render: no autoscaling, instance
  count 1) for now, **or**
- add a Socket.io adapter (e.g. Redis) before scaling out — a deliberate
  architectural change, not a configuration toggle.

Both `node-cron` schedulers are multi-instance safe already (§5); Socket.io
is the only component that constrains instance count.

---

## Deployment assumptions this document could not verify from the repository

- No specific PostgreSQL version is pinned anywhere in this repository —
  use a currently-supported release.
- No process manager, container runtime, or hosting platform is chosen by
  this repository — whichever is used just needs to run `npm start` from
  `backend/` with the environment variables in §3 set, and send `SIGTERM`
  on stop/redeploy for the graceful-shutdown path (§5) to run.
- Express's `trust proxy` setting is not configured in this codebase (§4) —
  verify this against your actual reverse proxy before relying on `req.ip`
  for anything security-sensitive in production.
- No backup tooling or schedule exists in this repository — §7/§9's "back
  up before migrating" is an operational rule this document states, not
  infrastructure this repository implements (that's Phase 7's separate,
  not-yet-started backup-strategy step).
