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

### Tasks

- [x] Inspect `/next` and counter-occupancy semantics before changing anything — found both already correct (see ADR-025), no code change needed for either
- [x] `callToken()`: reject a manually-called WAITING token that isn't the earliest WAITING token in its queue (`409 FCFS_VIOLATION`), checked atomically inside the existing transaction
- [x] Confirm Recall stays exempt from the new order check but remains bounded by the existing shared counter-busy check
- [x] Dashboard: `TokenActions.tsx` shows "Call" only for the position-1 WAITING row, a disabled "Locked" button otherwise — reusing the already-present `position` field, no backend response-shape change
- [x] Concurrency test: two simultaneous `/call` requests for the true-earliest token never both succeed
- [x] Commit

### Acceptance

- With one active counter, only the earliest WAITING token can be called; a later one is rejected and remains WAITING
- With two active counters, calling the earliest unlocks the second-earliest; a third token stays locked until capacity/order allow it
- Completing an earlier token unlocks the correct next-in-line token — never the one after it
- A busy counter rejects even the correctly-earliest token (pre-existing behavior, confirmed unaffected)
- Concurrent `/call` requests for the same token never both succeed
- Recall (SKIPPED → CALLED) is unaffected by the order check but still respects counter capacity
- Full backend + dashboard test suites pass with zero regressions; no migration

See ADR-025 for full design/implementation detail, including why `/next` needed no changes and why the new check is race-safe without additional locking.

## V2 Checkpoint 4: ETA + live countdown + variable service duration

**Goal:** One coherent ETA/service-duration model — the actual durations of customers genuinely ahead across every active counter (a real multi-server FCFS simulation, not the old `currentTokenDuration × position / counters` approximation), staff-adjustable per-customer required time (recalculating every WAITING token in the queue), the default +2-minute automatic extension when a service's estimated duration expires without completion (a named constant, not a hardcoded magic number), and the mobile live countdown — a server-authoritative timestamp (`estimatedReadyAt`) that the mobile app ticks locally and re-anchors on every real-time update, never polling. Multi-service selection's *total*-duration contribution is deferred to Checkpoint 5 (the simulation's duration input is generic enough to accept a summed total later without rework) — this checkpoint fixes the formula for the current single-service model first.

### Tasks

- [x] `queueEtaEngine.ts`: a pure, unit-tested multi-server FCFS simulation replacing the old approximation entirely
- [x] `Token.requiredDurationMinutes` (additive migration) — staff override, authoritative when set, CALLED/IN_PROGRESS only
- [x] Default +2-minute auto-extension, computed live from anchor + duration + now, never persisted
- [x] `PATCH /api/tokens/:tokenId/duration` + dashboard "Adjust Time" action
- [x] Broadened the realtime broadcast from "tokens whose position shifted" to "every WAITING token in the queue," called from every mutation that can affect counter occupancy (call/start/complete/skip/recall/duration-override)
- [x] `estimatedReadyAt` added to every token view, the `/status` snapshot, and the `position_changed` socket payload
- [x] Mobile: a local ticking countdown widget anchored to `estimatedReadyAt`, re-anchoring automatically on every provider update
- [x] Commit

### Acceptance

- Two free counters serving 10-minute jobs report 0/0/10 minutes wait, not a flat position/counters average
- A staff duration override on the in-service customer shifts every WAITING token's ETA behind them
- A service whose allocated time expires without a staff update rolls forward in +2-minute increments, live, not stored
- The mobile Live Tracking screen shows a real ticking mm:ss countdown anchored to a server timestamp, re-anchoring on reconnect/update, never polling
- Full backend + mobile + dashboard test suites pass; one purely-additive migration, applied locally only

See ADR-026 for full design/implementation detail, including exactly why the old formula was wrong (not just imprecise) and the full realtime-broadcast rationale.

## V2 Checkpoint 5: Multi-service selection

**Goal:** A customer may select more than one service when joining a queue; the backend computes and validates the total duration from `QueueService.durationMinutes` rows, never a client-supplied number, and feeds it into the unchanged Checkpoint 4 ETA engine. Production-safe: `Token.serviceId` is preserved (not dropped), a new `TokenService` join table is backfilled from every existing token in the same migration, and the create-token endpoint accepts either the legacy singular `serviceId` or the new `serviceIds` array so an already-installed V1 mobile app is never broken.

### Tasks

- [x] Re-verify Checkpoint 4's +2min auto-extension against the exact rolling example first — confirmed already correct, no change made
- [x] `TokenService` join table (additive migration) + backfill of every existing token's `serviceId` into it, verified against a simulated pre-migration row before committing
- [x] `createTokenSchema`: dual-accept `serviceId` (legacy) / `serviceIds` (new), canonicalized internally, min 1, no duplicates
- [x] `createToken`: validate every selected service belongs to the queue and is active as a set; create the token + all `TokenService` rows atomically
- [x] Idempotency: same-key requests compared by canonical (sorted) service set, order-independent but set-exact
- [x] ETA engine: duration source changed to `sum(selected services' durationMinutes)`, staff-override priority unchanged
- [x] Every token view gains an additive `services: [...]` array alongside the still-populated legacy `serviceId`
- [x] Dashboard: live queue table + Blocked-Devices context show the full service list ("+N more")
- [x] Mobile: checkbox multi-select UI with a running (UX-only) total; always sends the new `serviceIds` shape
- [x] Commit

### Acceptance

- A token can be created with two (or more) valid services; the backend-computed total equals their sum, provable through a real ETA read
- A service from another queue, a duplicate service id, or an inactive service is rejected
- `[A,B]` and `[B,A]` under the same idempotency key resolve to the same token; `[A,B]` vs `[A,C]` under the same key is rejected
- The legacy singular `serviceId` request shape still works end-to-end (old mobile app compatibility)
- Every existing token remains fully readable after migration — `serviceId` still populated, `services` correctly backfilled
- Full backend + mobile + dashboard test suites pass; one additive migration, backfill-verified, applied locally only

See ADR-027 for full design/implementation detail, including the exact backward-compatibility mechanism and the service-deletion safety analysis.

## V2 Checkpoint 6: Queue repeat-visit policy

**Goal:** A queue-level setting for whether a device/person may take only one token ever (until a documented reset condition) or may rejoin after completing. A SKIPPED token never consumes the single-visit allowance. Enforced backend-side; idempotent retries never miscounted as a second visit. `serviceIds` has no upper bound enforced anywhere yet (Checkpoint 5), so a `multiServiceAllowed` restriction here needs no further Token schema change.

### Tasks

- [x] `Queue.allowRepeatVisits` / `Queue.allowMultipleServices` (additive migration, both `DEFAULT true`), verified against a simulated pre-migration row before committing
- [x] `createToken`: repeat-visit check (`COMPLETED`-only, scoped by `deviceId`+`queueId`) added as a second, independent rule alongside the pre-existing active-token guard, inside the same queue-row-locked transaction — no new locking system
- [x] `createToken`: `allowMultipleServices=false` restriction validated before the transaction (`serviceIds.length !== 1` → `409`)
- [x] `createQueueSchema`/`updateQueueSchema`: both fields added, additive, defaults matching the DB defaults
- [x] Public queue-config endpoint exposes `allowMultipleServices` only (`allowRepeatVisits` has no actionable pre-join mobile UX and is not exposed)
- [x] Dashboard: two toggles (create + edit forms), both defaulting on, with the specified helper text
- [x] Mobile: `QueueConfig.allowMultipleServices`; `QueueJoinProvider.toggleService` branches to radio-replace behavior when `false`; `ServiceSelectionScreen` renders `RadioGroup` instead of independent checkboxes when `false`
- [x] Checkpoint 5 follow-up: `deleteService` now returns `409 SERVICE_IN_USE` (pre-check, not error-string parsing) instead of a generic `500` when the service has token history
- [x] Commit

### Acceptance

- Default/existing queues permit another token after `COMPLETED` (unchanged behavior)
- `allowRepeatVisits=false` blocks a device from rejoining after `COMPLETED`, but never after only `SKIPPED`
- The pre-existing active-token rule still independently blocks a duplicate active token, unaffected by this checkpoint
- Concurrent join attempts against an already-`COMPLETED` device cannot bypass the policy
- `allowMultipleServices=false` rejects more than one service id and accepts exactly one (both request shapes); `allowMultipleServices=true` preserves Checkpoint 5 behavior exactly
- Every existing queue row reads `allowRepeatVisits=true`/`allowMultipleServices=true` after migration
- Deleting a service referenced by token history returns `409 SERVICE_IN_USE` and preserves the history
- Full backend + mobile + dashboard test suites pass; one additive migration, verified locally only

See ADR-028 for full design/implementation detail, including the concurrency analysis and the honest device-identity limitation.

## V2 Checkpoint 7: Customer cancellation + OTP-gated service start

**Goal (as actually delivered — supersedes this section's original, narrower goal below):** A customer can cancel their own token while `WAITING` **or `CALLED`** (broader than this section's original "WAITING only" goal — the actual Checkpoint 7 prompt explicitly required CALLED too, "before service actually begins"); cannot once IN_PROGRESS. Enforced backend-side regardless of what the mobile UI shows. Consistent with the repeat-visit rule from Checkpoint 6 — `CANCELLED`, like `SKIPPED`, never consumes the `allowRepeatVisits=false` allowance; only `COMPLETED` does. Additionally — and this is the part that turned out to overlap with Checkpoint 8 below — staff can no longer transition `CALLED → IN_PROGRESS` merely by clicking Start: a short-lived, customer-told verification code is now required and backend-verified, specifically to prevent staff from bypassing a customer's cancellation window by starting service early.

*Original goal, as it read before this checkpoint (kept for the record):* "A customer can cancel their own token while WAITING; cannot once service has started (CALLED or later)."

### Tasks

- [x] `TokenStatus.CANCELLED` (additive enum value) + `Token.cancelledAt`, both purely additive
- [x] `cancelToken`: WAITING/CALLED → CANCELLED only, device-ownership-checked (mirrors the notification-preferences customer-write pattern), compare-and-swap concurrency-safe
- [x] `TokenStatus.CANCELLED → IN_PROGRESS` gate: `serviceStartOtpCipher`/`serviceStartOtpExpiresAt`/`serviceStartOtpFailedAttempts` added to `Token`; `callToken` mints a fresh code on every CALLED entry (call and Recall alike)
- [x] `utils/otp.ts`: cryptographically secure generation, reversible keyed AES-256-GCM storage (not a one-way hash — see ADR-029 for why), timing-safe verification
- [x] `startTokenWithOtp` replaces the old bare `startToken` as the only path to IN_PROGRESS — expiry, single-use, and a 5-failed-attempt limit that invalidates (not permanently locks) the current code
- [x] Two new customer-only endpoints: `GET .../verification-code` (never mints on read) and `POST .../verification-code/reissue` (explicit renewal only)
- [x] Centralized OTP-field stripping (`omitOtpFields`) applied to every raw-token-returning function, so no staff-facing response, socket payload, or audit entry can leak it
- [x] Dashboard: Start reveals an inline code-input form instead of firing immediately
- [x] Mobile: Leave Queue action (WAITING/CALLED), a verification-code display (CALLED only, self-clearing, reissue-capable)
- [x] Full repository security review (every IN_PROGRESS/startedAt write site, every otp-named symbol) before considering this done
- [x] Commit

### Acceptance

- WAITING or CALLED can be cancelled by the owning device; IN_PROGRESS/COMPLETED/SKIPPED/already-CANCELLED cannot
- A device can never cancel another device's token
- Cancelling frees the active-token slot and does not consume the repeat-visit allowance; a cancelled token can never be recalled
- No code path other than a correctly-verified `startTokenWithOtp` call can produce an IN_PROGRESS token
- The raw verification code never appears in any staff-facing response, Socket.io payload, FCM payload, log, or audit entry
- A wrong code fails without revealing which digits were right; 5 wrong attempts invalidate the code; an expired code is rejected and can be reissued; a used code can never be replayed
- A concurrent cancel and a valid start on the same token produce exactly one winner, never both, never neither
- Full backend + mobile + dashboard test suites pass; one additive migration, verified locally only

See ADR-029 for full design/implementation detail, including the reversible-encryption reasoning, the concurrency analysis, and the flagged overlap with Checkpoint 8 immediately below.

## V2 Checkpoint 8: Anti-bias OTP verification

**Goal:** `CALLED → OTP → IN_PROGRESS`. A server-generated, short-lived, single-use OTP — visible only inside the customer's own app session, never a public API response, never client-generatable — must be correctly entered by staff before a CALLED token can transition to IN_PROGRESS, protecting against staff silently starting service without customer consent/presence. Reuses existing FCM delivery, rate limiting, and auth/tenant infrastructure. Its own checkpoint, separate from cancellation, since this is a distinct security feature.

**Status note (added when Checkpoint 7 shipped, 2026-09-02): this goal appears to already be fully implemented by Checkpoint 7** — see ADR-029's closing note. Flagged for explicit confirmation before starting this checkpoint, not silently marked done or silently discarded.

## V2 Checkpoint 9: Mobile force-update system

**Goal:** A backend-controlled minimum supported app version (e.g. `minimumSupportedAndroidVersion`/`minimumSupportedIosVersion`, likely a simple app-config endpoint or existing public-config response addition) that the mobile app checks at startup — a version below the minimum shows a Force Update screen instead of continuing normally. Lets an old app be forced to update without a new backend release for every version bump. A proper platform feature recorded now rather than left as something to remember manually later.

## V2 Checkpoint 10: V2 production verification

**Goal:** A focused final regression pass across all V2 business rules, tenant isolation, concurrency, migrations, and cross-app compatibility — no unnecessary new tests, final build/typecheck/lint verification across all three apps.

---

## Open Questions (Require Decision Before Implementation)

1. **Staff email scope**: Globally unique or per-organization? → ADR-005 recommends global.
2. **`CLIENT_API_KEY` on public API**: Required or optional for MVP? → ADR-008 recommends optional/rate-limit-only.
3. **Refresh token storage**: Stored in DB (`Session` table) or stateless (longer-lived JWT)? DB storage is more revocable but adds a table.
4. **Flutter FCM project**: Firebase project must be created before Phase 5. Who creates it?
5. **Soft-delete scope**: Only queues, or also services and counters?
