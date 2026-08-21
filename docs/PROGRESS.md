# LiveQueue — Progress

## Current Phase: Phase 1 (Foundation) — Complete and verified

## Status

| Phase | Status |
|---|---|
| Phase 1: Foundation | **Done** — auth, sessions, tenant isolation implemented and tested against a real PostgreSQL database |
| Phase 2: Queue Core | Not started |
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

## Known, Documented Deviations

- Prisma pinned to `6.12.0` rather than the `7.x` default `npm install` resolves to — see ADR-014.
- Owner `Staff.name` at registration defaults to the email's local part, since the spec's registration flow (section 4.1) collects only organization name, email, and password. Rename support arrives with staff-profile management in a later phase.

## Last Action

Phase 1 implemented, migrated against a live PostgreSQL database, and verified: connection, migration, table creation, full test suite, type check, and lint all confirmed passing. A follow-up security review closed its identified test gaps (cross-staff revocation, DB-level storage/revocation assertions, access-token-after-logout) with 5 new tests — 28/28 passing. Awaiting approval to begin Phase 2 (Queue Core).
