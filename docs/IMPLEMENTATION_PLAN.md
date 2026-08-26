# LiveQueue — Implementation Plan

Reference spec: `docs/LiveQueue_AI_Ready_Specification.md`

---

## Phase 1: Foundation (Backend Only)

**Goal:** A running Express server with PostgreSQL, Prisma, authentication, and the organization + staff models. No business logic beyond auth.

### Tasks

- [ ] Initialize `backend/` as a Node.js/TypeScript project
- [ ] Configure TypeScript (`tsconfig.json`), ESLint, Prettier
- [ ] Install core dependencies: Express, Prisma, Zod, JWT, bcrypt, Helmet, CORS, express-rate-limit, Pino
- [ ] Create `.env.example` with all required variables (no secrets committed)
- [ ] Set up Prisma schema: `Organization`, `Staff`
- [ ] Run initial migration
- [ ] Create database connection module
- [ ] Create centralized error handler middleware
- [ ] Create centralized request validation middleware (Zod)
- [ ] Create structured logger (Pino)
- [ ] Implement auth routes: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/refresh`
- [ ] Implement JWT access token + refresh token strategy
- [ ] Implement `authenticate` middleware (verify JWT, load staff + org)
- [ ] Implement `requirePermission` middleware
- [ ] Write unit tests: registration, login, /me, tenant isolation
- [ ] Run type check, lint, tests — all pass
- [ ] Commit

### Acceptance

- Server starts with `npm run dev`
- `POST /api/auth/register` creates org + owner staff
- `POST /api/auth/login` returns access + refresh tokens
- `GET /api/auth/me` returns authenticated staff info
- Suspended staff cannot log in
- All tests pass

---

## Phase 2: Queue Core

**Goal:** Full CRUD for queues, services, counters, and the dynamic form builder.

### Tasks

- [ ] Add Prisma models: `Queue`, `QueueService`, `QueueFormField`, `Counter`
- [ ] Queue CRUD endpoints + status patch
- [ ] Service CRUD endpoints
- [ ] Counter CRUD + status + staff assignment endpoints
- [ ] Dynamic form field CRUD (with versioning)
- [ ] QR code generation endpoint (returns `livequeue://queue/{queueId}`)
- [ ] Soft-delete for queues
- [ ] Tests for all CRUD and tenant isolation
- [ ] Commit

### Acceptance

- Owner can create/edit/pause/delete a queue
- Queue generates a valid QR URI
- Service and counter CRUD work
- Tenant isolation: org A staff cannot access org B queues

---

## Phase 3: Token Engine

**Goal:** Token creation, serial numbers, and the full token lifecycle state machine.

### Tasks

- [ ] Add Prisma models: `Device`, `Token` (with idempotency key column)
- [ ] Device registration endpoint
- [ ] Public queue config endpoint (`GET /api/public/queues/:queueId/config`)
- [ ] Token creation with atomic serial number (`SELECT FOR UPDATE` on Queue row)
- [ ] Idempotency key handling
- [ ] Token state machine service (centralized, not in controllers)
- [ ] Token operation endpoints: call, start, complete, skip
- [ ] Next token endpoint (`POST /api/queues/:queueId/next`)
- [ ] Queue position calculation (derived, not stored)
- [ ] Estimated wait time calculation
- [ ] Tests: serial uniqueness, concurrent creation, duplicate idempotency key, invalid state transitions, concurrent "next" calls
- [ ] Commit

### Acceptance

- Two simultaneous token creates get unique serial numbers
- Two simultaneous "next" calls assign only one token
- Invalid state transitions return 422
- Idempotency key returns existing token on retry

---

## Phase 4: Real-Time Layer

**Goal:** Socket.io rooms with authentication and all required events.

### Tasks

- [ ] Install and configure Socket.io on Express server
- [ ] JWT verification on socket handshake
- [ ] Room structure: `organization:{id}`, `queue:{id}`, `token:{id}`
- [ ] Emit events after each database write: `token.created`, `token.called`, `token.started`, `token.completed`, `token.skipped`, `token.position_changed`, `queue.status_changed`, `counter.status_changed`
- [ ] Socket auth middleware prevents cross-org room access
- [ ] Reconnection and re-join after disconnect
- [ ] Tests: socket auth, cross-org room rejection, event delivery
- [ ] Commit

### Acceptance

- Dashboard receives live token events without polling
- An org A socket cannot join org B rooms
- Events only fire after DB transaction succeeds

---

## Phase 5: Mobile App

**Goal:** Flutter app covering the full customer journey.

### Tasks

- [ ] Initialize Flutter project in `mobile-app/`
- [ ] Add dependencies: mobile_scanner, shared_preferences, socket_io_client, flutter_local_notifications, firebase_messaging
- [ ] Layer structure: models, services, repositories, providers, screens, widgets
- [ ] Device UUID generation and persistence
- [ ] Screens: Splash, Home, QR Scanner, Queue Details, Service Selection, Dynamic Form, Token Confirmation, Live Tracking, Notification Settings, Token History, Token Details, Settings
- [ ] Socket.io live tracking integration
- [ ] FCM setup for background notifications
- [ ] Notification preferences (reminder time, sound, vibration)
- [ ] Offline/reconnection handling
- [ ] Local history (last 100 tokens)
- [ ] Tests: QR parsing, invalid QR, token creation, live tracking, reconnection
- [ ] Commit

---

## Phase 6: Web Dashboard

**Goal:** React dashboard covering all staff operations.

### Tasks

- [ ] Initialize React/Vite/TypeScript project in `web-dashboard/`
- [ ] Configure Tailwind CSS, React Router, TanStack Query, Socket.io client
- [ ] Folder structure: api, components, pages, layouts, hooks, context, services, utils, types
- [ ] Auth context (login state)
- [ ] Pages: Login, Register, Dashboard, Queues, QueueDetails, Counters, Staff, Reports, BlockedDevices, AuditLogs, OrganizationSettings, Profile
- [ ] Live dashboard table (tokens, counters, queue stats)
- [ ] Token action buttons (Call, Start, Complete, Skip) with correct state visibility
- [ ] QR code display and download
- [ ] Form builder UI
- [ ] Reports with date filters and CSV export
- [ ] Socket.io integration — events invalidate TanStack Query caches
- [ ] Permission-aware UI (hide unavailable actions)
- [ ] Tests: login, permissions, token operations, real-time updates
- [ ] Commit

---

## Phase 7: Production Hardening

**Goal:** Security, observability, and deployment readiness.

### Tasks

- [ ] Add `AuditLog` model and write to it on all tracked actions
- [ ] Rate limiting on all public and sensitive endpoints
- [ ] Security headers (Helmet config review)
- [ ] Structured error logging (no stack traces in responses)
- [ ] Push notification jobs (reminder before turn)
- [ ] node-cron for scheduled reminder dispatch
- [ ] Load and concurrency tests
- [ ] `.env.example` review — no secrets committed
- [ ] Database backup strategy documented
- [ ] Deployment documentation
- [ ] Final security review

---

# LiveQueue V2 — Production Bug Fixes & Improvements

Phases 1-7 above built and shipped V1 — already launched to production. Everything from here on is V2: a post-launch evolution, not a rebuild. The existing `backend`/`web-dashboard`/`mobile-app` architecture is preserved; no new infrastructure (Redis, brokers, microservices, polling) unless a checkpoint genuinely requires it. Each checkpoint below is implemented, verified, and committed independently — existing V1 behavior stays unchanged unless the checkpoint's requirement explicitly changes it.

## V2 Checkpoint 1: Password change + `ACCOUNTANT` → `STAFF` rename

**Goal:** Close a real self-service gap and correct domain-specific role terminology, with no queue/ETA/token changes.

### Tasks

- [x] Self-service `PATCH /api/auth/password` (current-password check, existing password rules, session revocation of other sessions only)
- [x] Rename `StaffRole.ACCOUNTANT` → `STAFF` via an in-place enum-value-rename migration (no data backfill)
- [x] Update every code reference (permissions, validators, dashboard types/UI, tests)
- [x] Regression-verify the full existing RBAC/permission test suite
- [x] Commit

### Acceptance

- A staff member can change their own password with a valid current password; an incorrect current password is rejected
- The old password stops working; other active sessions for that staff member are revoked; the session that made the change keeps working
- Extra body fields (e.g. `staffId`, `role`) are rejected, not silently ignored
- `STAFF` is recognized everywhere `ACCOUNTANT` previously was; no remaining `ACCOUNTANT` reference in active code
- Full backend test suite passes; typecheck/lint clean on backend and dashboard

## V2 Checkpoint 2: Queue fairness and multi-counter engine

**Goal:** Strict server-enforced FIFO calling, with active-counter capacity determining how many tokens may be concurrently eligible — never allowing a later token to be called while an earlier eligible one still waits. Concurrency-safe under simultaneous staff actions. Existing SKIPPED → CALLED recall remains an intentional, allowed exception to strict order.

## V2 Checkpoint 3: Service duration + authoritative ETA engine

**Goal:** ETA computed from the actual total service duration of tokens genuinely ahead (not the current simplistic `currentTokenDuration × position / counters` approximation), across multiple active counters. Staff can adjust an individual active customer's required duration from the dashboard, with recalculation propagated to affected customers behind them in real time. A default +2 minute automatic extension applies when an active service's estimated duration expires but the token hasn't completed, via a named configurable constant/setting rather than a hardcoded magic number.

## V2 Checkpoint 4: Mobile live countdown + notification verification

**Goal:** A true locally-ticking countdown on the mobile Live Tracking screen, anchored to a server-authoritative timestamp (e.g. `estimatedReadyAt`) and re-anchored on every real-time update — no per-second polling. Verify (not rebuild) the existing FCM/state-change notification infrastructure from Issue #5, closing only genuine gaps.

## V2 Checkpoint 5: Queue repeat-visit policy

**Goal:** A queue-level setting for whether a device/person may take only one token ever (until a documented reset condition) or may rejoin after completing. A SKIPPED token never consumes the single-visit allowance. Enforced backend-side; idempotent retries never miscounted as a second visit.

## V2 Checkpoint 6: Multi-service selection

**Goal:** Customers may select multiple services when a queue allows it; the backend authoritatively computes and validates the total duration (never trusting a client-supplied value). Requires a safe, production-data-preserving Token↔Service persistence change — existing single-service tokens remain readable, no column dropped outright.

## V2 Checkpoint 7: Customer cancellation + anti-bias OTP verification

**Goal:** A customer can cancel their own token before service starts (not after); enforced backend-side regardless of UI. A server-generated, short-lived, single-use OTP — visible only inside the customer's own app session, never a public API response, never client-generatable — must be correctly entered by staff before a CALLED token can transition to IN_PROGRESS, protecting against staff silently starting service without customer consent. Reuses existing FCM delivery, rate limiting, and auth/tenant infrastructure.

## V2 Checkpoint 8: V2 production verification

**Goal:** A focused final regression pass across all V2 business rules, tenant isolation, concurrency, migrations, and cross-app compatibility — no unnecessary new tests, final build/typecheck/lint verification across all three apps.

---

## Open Questions (Require Decision Before Implementation)

1. **Staff email scope**: Globally unique or per-organization? → ADR-005 recommends global.
2. **`CLIENT_API_KEY` on public API**: Required or optional for MVP? → ADR-008 recommends optional/rate-limit-only.
3. **Refresh token storage**: Stored in DB (`Session` table) or stateless (longer-lived JWT)? DB storage is more revocable but adds a table.
4. **Flutter FCM project**: Firebase project must be created before Phase 5. Who creates it?
5. **Soft-delete scope**: Only queues, or also services and counters?
