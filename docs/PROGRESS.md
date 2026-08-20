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
- 23 automated tests (registration, login, `/me`, refresh rotation + reuse detection, logout/revocation, tenant isolation) — all passing against a real PostgreSQL instance
- TypeScript strict mode and ESLint both clean

## Known, Documented Deviations

- Prisma pinned to `6.12.0` rather than the `7.x` default `npm install` resolves to — see ADR-014.
- Owner `Staff.name` at registration defaults to the email's local part, since the spec's registration flow (section 4.1) collects only organization name, email, and password. Rename support arrives with staff-profile management in a later phase.

## Last Action

Phase 1 implemented, migrated against a live PostgreSQL database, and verified: connection, migration, table creation, full test suite, type check, and lint all confirmed passing. Awaiting approval to begin Phase 2 (Queue Core).
