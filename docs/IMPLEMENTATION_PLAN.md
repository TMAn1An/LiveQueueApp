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

**Reordered 2026-08-26** (see ADR-023): the roadmap below supersedes the checkpoint 2-8 ordering originally recorded here after Checkpoint 1. Rationale: V1's trust-boundary gap (no email verification — any email/password combination can register and immediately operate a real organization) should close before queue-behavior changes are layered on top of it, and ETA/multi-service/duration-override are one coherent model, not three separate features.

## V2 Checkpoint 2: Registration / email verification

**Goal:** Close the pre-existing V1 gap where `POST /api/auth/register` creates a fully active organization + owner with no proof the email address is real or owned by the registrant.

### Tasks

- [x] `Staff.status` gains `PENDING_EMAIL_VERIFICATION`; registration creates the org + owner in this state, plus token-hash/expiry/deadline columns (additive migration, no data backfill)
- [x] Verification token generated server-side, reusing `generateRefreshToken()`/`hashRefreshToken()` exactly as-is
- [x] Two independent lifetimes: 15-minute link, 1-hour pending-registration deadline (resend never extends it)
- [x] `node-cron` cleanup job deletes the pending organization + owner together once the 1-hour window lapses, mirroring `reminderScheduler.ts`
- [x] `requireVerified` middleware, applied to the queue-management route group only; `/me`/logout/verification endpoints stay reachable while pending
- [x] `GET /api/auth/email-verification/verify` (public) and `POST /api/auth/email-verification/resend` (authenticated, rate-limited) endpoints
- [x] Resend (Node SDK) wired with the same optional/guarded pattern Firebase Admin already uses
- [x] Dashboard: verification-required banner + resend action, `/verify-email` page
- [x] Regression-verify the full existing test suite (two setup helpers outside the shared `registerOwner()` needed the same auto-verify fix)
- [x] Commit

### Acceptance

- A new registration returns `status: PENDING_EMAIL_VERIFICATION` and triggers a verification email
- The verification token is stored hashed, never in plaintext; an expired or unknown token is rejected with a generic error
- A valid token transitions the account to `ACTIVE` and clears the verification fields
- Resend invalidates the previous token and issues a new one without moving the 1-hour deadline
- A pending account is rejected (403 `EMAIL_VERIFICATION_REQUIRED`) from queue-management routes but can still reach `/me`, logout, and the verification endpoints
- A pending registration older than 1 hour is deleted (organization + owner together); a verified account or a still-fresh pending one is never touched by cleanup
- Full backend test suite passes; typecheck/lint/build clean on backend and dashboard; local migration applied and verified, production migration left to Render's Pre-Deploy Command

See ADR-023 (design) and ADR-024 (implementation, including the exact route-scoping rationale for `requireVerified`) for full detail.

## V2 Checkpoint 3: Strict FCFS + multi-counter queue engine

**Goal:** One coherent queue-engine rule, not two separate features — strict server-enforced FIFO calling, where active-counter capacity determines how many tokens may be concurrently eligible (N active counters ⇒ up to N eligible tokens), and a later token can never become eligible while an earlier one still waits. Staff cannot call an arbitrary later customer; the dashboard must visually lock unavailable customers, matching backend enforcement. Concurrency-safe under simultaneous staff actions at the backend level. Existing SKIPPED → CALLED recall remains an intentional, allowed exception to strict order.

## V2 Checkpoint 4: ETA + live countdown + variable service duration

**Goal:** One coherent ETA/service-duration model instead of three unrelated features — combines multi-service selection (total duration = sum of selected services), the actual durations of customers genuinely ahead, active-counter count, staff-adjustable per-customer required time (recalculating every affected customer behind them), the default +2-minute automatic extension when a service's estimated duration expires without completion (a named configurable constant/setting, not a hardcoded magic number), and the mobile live countdown — a server-authoritative timestamp (e.g. `estimatedReadyAt`) that the mobile app ticks locally and re-anchors on every real-time update, never polling. Do not build the countdown on top of the current simplistic `currentTokenDuration × position / counters` approximation — fix the formula first.

## V2 Checkpoint 5: Queue repeat-visit policy

**Goal:** A queue-level setting for whether a device/person may take only one token ever (until a documented reset condition) or may rejoin after completing. A SKIPPED token never consumes the single-visit allowance. Enforced backend-side; idempotent retries never miscounted as a second visit. Deliberately sequenced after the queue engine (Checkpoint 3) is stable, not before.

## V2 Checkpoint 6: Customer cancellation

**Goal:** A customer can cancel their own token while WAITING; cannot once service has started (CALLED or later). Enforced backend-side regardless of what the mobile UI shows. Consistent with the repeat-visit rule from Checkpoint 5 — a skipped token remains eligible to rejoin per that rule, a cancelled one follows whatever this checkpoint's own state-machine addition specifies.

## V2 Checkpoint 7: Anti-bias OTP verification

**Goal:** `CALLED → OTP → IN_PROGRESS`. A server-generated, short-lived, single-use OTP — visible only inside the customer's own app session, never a public API response, never client-generatable — must be correctly entered by staff before a CALLED token can transition to IN_PROGRESS, protecting against staff silently starting service without customer consent/presence. Reuses existing FCM delivery, rate limiting, and auth/tenant infrastructure. Its own checkpoint, separate from cancellation, since this is a distinct security feature.

## V2 Checkpoint 8: Mobile force-update system

**Goal:** A backend-controlled minimum supported app version (e.g. `minimumSupportedAndroidVersion`/`minimumSupportedIosVersion`, likely a simple app-config endpoint or existing public-config response addition) that the mobile app checks at startup — a version below the minimum shows a Force Update screen instead of continuing normally. Lets an old app be forced to update without a new backend release for every version bump. A proper platform feature recorded now rather than left as something to remember manually later.

## V2 Checkpoint 9: V2 production verification

**Goal:** A focused final regression pass across all V2 business rules, tenant isolation, concurrency, migrations, and cross-app compatibility — no unnecessary new tests, final build/typecheck/lint verification across all three apps.

---

## Open Questions (Require Decision Before Implementation)

1. **Staff email scope**: Globally unique or per-organization? → ADR-005 recommends global.
2. **`CLIENT_API_KEY` on public API**: Required or optional for MVP? → ADR-008 recommends optional/rate-limit-only.
3. **Refresh token storage**: Stored in DB (`Session` table) or stateless (longer-lived JWT)? DB storage is more revocable but adds a table.
4. **Flutter FCM project**: Firebase project must be created before Phase 5. Who creates it?
5. **Soft-delete scope**: Only queues, or also services and counters?
