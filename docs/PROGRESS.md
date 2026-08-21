# LiveQueue — Progress

## Current Phase: Phase 2 (Queue Core) — Complete and verified

## Status

| Phase | Status |
|---|---|
| Phase 1: Foundation | **Done** — auth, sessions, tenant isolation implemented and tested against a real PostgreSQL database |
| Phase 2: Queue Core | **Done** — Queue/Service/Counter/FormField CRUD, soft deletion, computed QR, tenant isolation, tested against a real PostgreSQL database |
| Phase 3: Token Engine | Not started |
| Phase 4: Real Time | Not started |
| Phase 5: Mobile | Not started |
| Phase 6: Dashboard | Not started |
| Phase 7: Production Hardening | Not started |

## What Exists

- `CLAUDE.md`, `docs/LiveQueue_AI_Ready_Specification.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ARCHITECTURE_DECISIONS.md`
- `backend/` — Express + TypeScript + Prisma + PostgreSQL project, fully scaffolded and building
- `web-dashboard/`, `mobile-app/` — still empty (Phase 5/6)

## What Is Implemented (Phase 1)

- Prisma schema: `Organization`, `Staff`, `Session` — migrated to a live PostgreSQL database (`livequeue_dev`), migration `20260820210143_init_organization_staff_session`
- Config: env validation (Zod), Prisma client singleton, Pino structured logger with secret redaction
- Centralized error handling (`AppError`, `errorHandler`, `notFoundHandler`) — no stack traces or internals leaked to clients
- Zod request validation middleware
- Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/refresh`
- JWT access tokens (15m default) + DB-backed refresh sessions with rotation and reuse detection (ADR-013)
- `authenticate` middleware (re-checks staff/org status from DB on every request) and `requirePermission` middleware
- Rate limiting on auth endpoints
- 28 automated tests (registration, login, `/me`, refresh rotation + reuse detection, logout/revocation, tenant isolation, plus the security-hardening tests below) — all passing against a real PostgreSQL instance
- TypeScript strict mode and ESLint both clean

## Security Verification (post-Phase-1 review)

A dedicated security review of Phase 1 (tenant isolation, refresh token handling, session revocation) was performed and closed out with 5 new tests in `backend/tests/session-security.test.ts`, verified against the real database:

- **Cross-staff session revocation** — proves Staff A cannot revoke Staff B's session by presenting Staff B's refresh token: the endpoint no-ops (still `204`, no information leaked), Staff B's `Session` row remains unrevoked in the database, and Staff B can still refresh successfully.
- **Refresh token storage (DB assertion)** — after login, directly queries the `Session` row and asserts `refreshTokenHash` equals `sha256(rawToken)`, differs from the raw token, and that no row's `refreshTokenHash` column equals the raw token value at all.
- **Logout revocation (DB assertion)** — after logout, directly queries the database and asserts the `Session` row still exists (not deleted) with `revokedAt` set, and that the revoked token can no longer refresh.
- **Access token survives logout** — asserts a `GET /api/auth/me` call with the pre-logout access token still succeeds after logout, confirming the documented ADR-013 behavior (stateless JWTs are unaffected by session revocation) is actually pinned by a test, not just documented.
- **15-minute default lifetime documented as a test** — asserts `env.JWT_EXPIRES_IN === '15m'`, so an unintentional change to the access-token lifetime (and thus the post-logout exposure window) fails a test rather than passing silently.

No production code changed as part of this — only new test coverage for existing, already-correct behavior.

**Deferred:** Concurrent/racing refresh-token testing (two simultaneous refresh calls with the same token) was explicitly *not* added yet. It's recorded here as required future coverage for **Phase 3 (Token Engine)**, the first phase that introduces high-concurrency correctness requirements (concurrent token serial generation, concurrent "Next Token" calls) — the same `SELECT ... FOR UPDATE` / transaction-under-race patterns apply, so the refresh-token race test should be added alongside that phase's concurrency test suite rather than in isolation now.

## What Is Implemented (Phase 2)

- Prisma schema additions: `Queue`, `QueueService`, `Counter`, `QueueFormField` (+ `QueueStatus`, `CounterStatus`, `FormFieldType` enums) — migrated to `livequeue_dev`, migration `20260821193938_add_queue_core` (purely additive: new tables/enums/indexes/FKs, no changes to Phase 1 tables)
- Queue CRUD + status patch + soft deletion (`deletedAt`, independent of `status` — ADR-015 decision 6), computed `qrCodeUri` field
- Service CRUD nested under a queue, no dedicated list endpoint (surfaces via the queue response)
- Counter CRUD, status, and staff assignment (verifies target staff belongs to the same organization)
- Dynamic form fields: atomic version-bump replace endpoint (`PUT /api/queues/:queueId/form-fields`), old versions retained untouched, uniqueness enforced by both Zod and a database `@@unique([queueId, version, key])` constraint
- Every nested-resource endpoint verifies tenant ownership through its parent queue (`service/counter/formField → queue → organizationId`), never through the child id alone — centralized in `src/utils/tenantScope.ts` for the shared "does this queue belong to me" check
- 47 new automated tests (CRUD, soft-deletion behavior, permissions, tenant isolation including cross-org direct-id access, staff-assignment validation, form versioning/atomicity/uniqueness, QR URI correctness) — all passing against a real PostgreSQL instance
- Full design record in `docs/ARCHITECTURE_DECISIONS.md` ADR-015

## Phase 2 Closure Items (post-review)

Two gaps found in Phase 2 review were closed, both application-code-only (no schema/migration change):

- **Archived queues are now enforced read-only.** Every mutation path touching an archived queue (`deletedAt` set) or any of its services/counters/form fields returns `409 QUEUE_ARCHIVED` — including a *second* `DELETE` call on an already-archived queue, which previously succeeded silently. `GET` behavior is unchanged. See ADR-015 addendum for the full endpoint list and the guard's implementation (`assertQueueMutable()` in `src/utils/tenantScope.ts`).
- **Form-replace transaction rollback is now proven, not just asserted.** A new test (`formField.test.ts`) pre-seeds a colliding row so the real `createMany` inside `replaceFormFields` hits a genuine Postgres unique-constraint violation mid-transaction, then verifies `Queue.formVersion`, the previous version's rows, and the attempted version's rows are all exactly as they were before the call — no test-only code was added to production.
- 10 new tests: 9 in `backend/tests/archivedQueue.test.ts` (every listed mutation endpoint, read-behavior-unaffected, and a tenant-isolation-not-bypassed check) + 1 rollback test in `formField.test.ts`. One pre-existing test (`queue.test.ts`, "is idempotent when deleted twice") was updated in place to match the new repeat-delete behavior.

## Known, Documented Deviations

- Prisma pinned to `6.12.0` rather than the `7.x` default `npm install` resolves to — see ADR-014.
- Owner `Staff.name` at registration defaults to the email's local part, since the spec's registration flow (section 4.1) collects only organization name, email, and password. Rename support arrives with staff-profile management in a later phase.
- `authRateLimiter` (auth endpoints) now skips enforcement when `NODE_ENV === 'test'` — added during Phase 2 because the larger integration suite legitimately exceeds 20 requests/15min from a single test address. Production and development behavior is unchanged; see ADR-015.

## Last Action

Phase 2 (Queue Core) implemented and closed out: Queue/Service/Counter/FormField CRUD, soft deletion (now fully read-only once archived), computed QR, atomic form versioning (rollback proven under a real constraint failure), and tenant isolation on every nested resource. Migrated against a live PostgreSQL database and verified: connection, migration (purely additive, reversible), table creation, full test suite (85/85 passing), type check, and lint all confirmed passing. Awaiting approval to begin Phase 3 (Token Engine).
