# LiveQueue — Architecture Decisions

## ADR-001: Three-app monorepo structure

**Decision:** Keep backend, web-dashboard, and mobile-app as three independent applications in one repository.

**Reason:** The spec mandates this structure. A monorepo allows shared tooling and coordinated commits without coupling the runtimes.

**Consequence:** Each app has its own package.json / pubspec.yaml and is deployed independently.

---

## ADR-002: PostgreSQL as the single source of truth

**Decision:** All state lives in PostgreSQL. Socket.io, React state, Flutter state, and local storage are presentation layers only.

**Reason:** Spec mandate. Prevents split-brain between real-time layer and persistent storage.

**Consequence:** Every real-time event must be emitted *after* the database transaction commits, never before.

---

## ADR-003: Atomic token sequence counter on Queue row

**Decision:** `Queue.next_token_number` is incremented inside a database transaction using a row-level lock (`SELECT ... FOR UPDATE`) each time a token is created.

**Reason:** Counting existing tokens (SELECT COUNT) is unsafe under concurrent inserts and can produce duplicates. The spec explicitly recommends a queue-level sequence.

**Consequence:** Token creation is serialized per queue, which is acceptable at MVP scale. A PostgreSQL sequence per queue could replace this later if throughput demands it.

---

## ADR-004: Idempotency key for token creation

**Decision:** Token creation accepts an `Idempotency-Key` request header. The backend stores the key and returns the existing token on duplicate submission.

**Reason:** Mobile retries on network failure must not create duplicate tokens. Spec section 26 mandates this.

**Consequence:** Token table needs an idempotency key column with a unique constraint. Keys can be expired/cleaned up after a reasonable window (e.g., 24 hours).

---

## ADR-005: Staff email globally unique

**Status:** Approved (user decision, 2026-08-21). No multi-organization staff memberships in this phase; each email maps to exactly one organization for MVP.

**Decision:** Staff email must be unique across the entire system, not just per organization.

**Reason:** The spec does not clarify scope, but a single-email identity model is simpler and safer. An email address identifying two different staff accounts across two orgs would complicate the login flow.

**Consequence:** A person who works at two organizations must use a different email per organization, or we support multiple org memberships under one email (deferred to future). For MVP, global uniqueness is enforced.

---

## ADR-006: Permissions stored as a JSON array on Staff

**Decision:** `Staff.permissions` is stored as a PostgreSQL `TEXT[]` array (or JSONB array) of permission string constants.

**Reason:** The spec lists ~10 named permissions and says they must be explicit. An array of strings is simple, query-friendly in Postgres, and avoids a separate permissions join table for MVP.

**Consequence:** Permission checks in middleware compare the authenticated staff's permissions array against the required permission constant. A dedicated `RolePermission` table can be added later if per-role defaults need to be managed separately.

---

## ADR-007: Socket.io room authentication via JWT middleware

**Decision:** On socket connection, the client passes the JWT in the handshake auth object. The server verifies it before allowing the client to join organization or queue rooms.

**Reason:** Spec section 8 requires that authenticated dashboard sockets verify the staff JWT and that a client cannot subscribe to another organization's room.

**Consequence:** Unauthenticated sockets can only connect. They may join public `queue:{queueId}` rooms for mobile live tracking. They must not join `organization:{organizationId}` rooms.

---

## ADR-008: Public queue API uses optional API key, not a security boundary

**Decision:** The `CLIENT_API_KEY` in `.env` is used as a soft abuse-prevention measure for public endpoints, not as a security boundary.

**Reason:** Spec section 24 notes that a key shipped inside a mobile app is extractable and must be treated as public. Rate limiting is the real protection for the public API.

**Consequence:** Public endpoints (`/api/public/...`) are rate-limited. The API key check is optional and primarily for identifying legitimate app traffic, not for authorization.

---

## ADR-009: Form versioning via `form_version` integer on Queue and Token

**Decision:** `Queue.form_version` increments each time the queue's form fields are changed. Each `Token` records the `form_version` at creation time alongside `form_data`.

**Reason:** Spec section 7.6 states that existing token form data must not change when the queue form is edited, and that historical submissions must remain understandable.

**Consequence:** `QueueFormField` rows are never deleted when a form is edited — the version is bumped and new rows are written. Old tokens retain their version reference.

---

## ADR-010: No Redis at MVP

**Decision:** Redis is not included in Phase 1–6.

**Reason:** Spec and CLAUDE.md both explicitly prohibit adding infrastructure without a documented technical requirement. A single Node.js instance with PostgreSQL is sufficient for MVP.

**Consequence:** Socket.io runs in single-instance mode (no adapter). If horizontal scaling is needed later, a Redis adapter will be added.

---

## ADR-011: Device authentication uses a generated UUID, not a user account

**Decision:** The mobile app generates a UUID on first launch and sends it in every request as a device identifier. The backend registers the device and can block it. There is no password or credential for a device.

**Reason:** Spec section 7.19 states customers do not need a traditional email/password account and that device IDs are device-level controls only, not user identity.

**Consequence:** Blocking a device (by UUID) prevents new token creation from that device but does not prevent the device from generating a new UUID. Physical device fingerprinting is out of MVP scope.

---

## ADR-012: Soft deletion (archive) for queues

**Decision:** Deleting a queue sets a `deleted_at` timestamp (soft delete) rather than destroying the row.

**Reason:** Spec section 11 recommends preferring soft deletion/archive for production systems so historical token records remain valid.

**Consequence:** All queue queries must filter `deleted_at IS NULL`. Reports can include archived queue data by explicitly querying archived records.

---

## ADR-013: DB-backed refresh sessions with rotation and reuse detection

**Status:** Approved (user decision, 2026-08-21). Resolves the open question in `IMPLEMENTATION_PLAN.md` and supersedes the "stateless JWT" alternative previously under consideration.

**Decision:** Access tokens are short-lived JWTs (`JWT_EXPIRES_IN`, default 15m). Refresh tokens are opaque, high-entropy random strings (not JWTs) backed by a `Session` table:

- Only a SHA-256 hash of the refresh token is stored (`Session.refreshTokenHash`); the raw value is returned to the client once, at issuance/rotation, and is never logged (see `src/config/logger.ts` redaction paths).
- Every use of a refresh token rotates it: the presented `Session` row is marked `revokedAt` and linked via `replacedBySessionId` to a newly created row carrying the new hash.
- Presenting a refresh token whose session is already `revokedAt` is treated as reuse (a theft indicator) and revokes every active session for that staff member as a precaution.
- Logout revokes the specific session tied to the presented refresh token; it is idempotent.
- `Session.staffId` is indexed, and `revokedAt`/`expiresAt` are on the row, so "logout from all devices" (revoke all sessions where `staffId = X AND revokedAt IS NULL`) is a direct future addition — no schema change required.
- `Staff.status` and `Organization.status` are re-checked from the database on every authenticated request (`src/middleware/authenticate.ts`), not just at token issuance, so suspending a staff member or organization takes effect before the (short-lived) access token would naturally expire.

**Reason:** Spec section 7.2 and section 19 call for token revocation/session management in production; the user named this as one of the key risk areas up front. A DB-backed session with rotation and reuse detection is standard practice for refresh tokens and satisfies "sessions must be revocable" without needing a distributed store (fits ADR-010, no Redis at MVP).

**Consequence:** Every refresh call is a write (rotate), and reuse detection means a client that races two refresh calls with the same token will have one succeed and the other revoke the whole session family — this is intentional and client SDKs (web/mobile) must serialize their own refresh calls to avoid self-triggering it. Refresh tokens use SHA-256 (not bcrypt/Argon2) because they are high-entropy random values, not low-entropy user secrets — offline brute force is not the threat model there, unlike passwords.

---

## ADR-014: Prisma pinned to 6.x, not 7.x

**Decision:** The backend uses `prisma`/`@prisma/client` 6.12.0, not the 7.x line that `npm install` resolves to by default.

**Reason:** Prisma 7 removed support for `datasource db { url = env("DATABASE_URL") }` in `schema.prisma` for Migrate; it now requires a `prisma.config.ts` file and an explicit driver adapter package (e.g. `@prisma/adapter-pg`) passed to the `PrismaClient` constructor. That is a real architectural shift (new config file, new required dependency, different `PrismaClient` construction), not a patch-level change, and it buys nothing for LiveQueue's MVP requirements. CLAUDE.md and ADR-010 both direct against adding infrastructure/complexity the current requirements don't justify. 6.12.0 was chosen specifically (rather than the newer 6.13+ patch releases) because 6.13+ pulls in `@prisma/config`, which has a known high-severity `npm audit` advisory (stack-exhaustion DoS in a transitive `deepmerge-ts` dependency) — 6.12.0 predates that dependency and audits clean.

**Consequence:** `backend/package.json` pins `"prisma"` and `"@prisma/client"` to `6.12.0` rather than `^7.x`. Revisit this pin when Prisma 7 stabilizes further and/or a documented reason to adopt driver adapters emerges (e.g. edge runtime deployment, connection pooling requirements) — not before.

---

## ADR-015: Phase 2 queue-core design (approved decisions, as implemented)

**Status:** Approved (user decisions, 2026-08-21) and implemented.

**Decision:** Five specific design choices for the Queue/Service/Counter/FormField layer, all already approved before implementation:

1. **Read permissions.** No dedicated "view" permission exists. Any authenticated staff member of the organization can `GET` queues (list/detail, with nested `services`) and `GET` counters. Only mutations require `manage_queues` / `manage_services` / `manage_counters`, enforced via `requirePermission` on each write route.
2. **Dynamic form versioning is a single atomic replace**, not per-field CRUD: `PUT /api/queues/:queueId/form-fields` takes the complete field set, and inside one `prisma.$transaction`, writes new `QueueFormField` rows at `version = Queue.formVersion + 1` and bumps `Queue.formVersion` — it never mutates or deletes existing rows. `@@unique([queueId, version, key])` enforces key-uniqueness per version at the database level, not just in the Zod schema.
3. **QR is a computed field, never stored**: `qrCodeUri: "livequeue://queue/{id}"` is derived at serialization time in `queue.service.ts`, not persisted on the `Queue` row and not served by a dedicated endpoint.
4. **Soft-deleted queue visibility**: `GET /api/queues` filters `deletedAt: null`; `GET /api/queues/:queueId` does not — an authorized staff member can still fetch an archived queue directly, with `deletedAt` visible in the response and `status` left completely untouched (see decision 6).
5. **No cascading soft delete**: deleting a queue never touches its `QueueService`/`Counter` rows. They remain exactly as they are; nothing about them is soft-deleted or otherwise flagged. This resolves the open question carried since the original `IMPLEMENTATION_PLAN.md` review.
6. **`status` and `deletedAt` are independent axes**: `Queue.status` (`ACTIVE`/`PAUSED`/`INACTIVE`) is never inferred from or coupled to `deletedAt`, and vice versa — a soft-deleted queue keeps whatever `status` it had.

**Additional implementation-level decisions made while building this (not requiring separate approval, recorded for completeness):**

- **Nested-resource authorization always goes through the parent queue**, never the child id alone: `service → queue → organizationId`, `counter → queue → organizationId`, `form field → queue → organizationId` (CLAUDE.md Rule 4). Centralized in `src/utils/tenantScope.ts`'s `requireOwnedQueue()` for the "verify a queueId belongs to this org" check shared by services, counters, and form fields; a comparable `findServiceScoped`/`findCounterScoped` join lives in each resource's own service module for id-only lookups (`PUT/DELETE/PATCH /api/services/:serviceId`, `/api/counters/:counterId`, which carry no `queueId` in their path).
- **Counter assignment** (`PATCH /api/counters/:counterId/assign`) explicitly checks `targetStaff.organizationId === counter.queue.organizationId`, returning `404 STAFF_NOT_FOUND` if the staff id doesn't exist at all and `403 STAFF_ORGANIZATION_MISMATCH` if it belongs to a different org.
- **`FormFieldType` enum values are lowercase** (`text`, `phone`, `dropdown`, …) rather than the uppercase convention used by every other enum in the schema, specifically to match the spec's own JSON examples (`"type": "phone"`) and avoid a translation layer between the wire format and storage.
- **Services have no dedicated list endpoint** (matching the spec's endpoint map, which defines none) — they're only ever returned nested inside a `Queue` response. Counters, by contrast, do have a dedicated `GET /api/queues/:queueId/counters` and are not nested in the queue response, avoiding two competing representations of the same data.
- **Test-environment rate-limit exemption**: `authRateLimiter` (`src/middleware/rateLimit.ts`) now skips enforcement when `NODE_ENV === 'test'`. The Phase 2 integration suite legitimately drives far more than 20 requests/15min from a single address (127.0.0.1) as a natural consequence of test volume, not the kind of abuse the limiter exists to catch. Production and development enforce it exactly as before — this is a test-environment carve-out, not a weakening of the control itself.

**Reason:** All five numbered decisions were explicitly approved before coding began; the additional items follow directly from CLAUDE.md's tenant-isolation and authorization rules and from keeping the API surface exactly as specified rather than inventing endpoints the spec doesn't define.

**Consequence:** Phase 3 (Token Engine) will read `Queue.nextTokenNumber`/`Queue.formVersion` and the current-version `QueueFormField` rows as-is — no migration or contract change anticipated from this phase's design.

---

## ADR-015 addendum: Archived queues are read-only (2026-08-22)

**Decision:** A queue with `deletedAt` set is not just excluded from the default list (decision 4) — it is fully read-only. Every mutation path that touches the queue itself, or any of its services/counters/form fields, now rejects with `409 QUEUE_ARCHIVED` once the parent queue is archived:

- Queue: `PUT`, `PATCH .../status`, and — notably — a **second** `DELETE` call (the first `DELETE` is the one allowed transition into the archived state; a repeat call is a mutation attempt against an already-archived queue, so it now fails instead of silently no-opping as it did before this addendum).
- Services: `POST` (create), `PUT`, `DELETE`, `PATCH .../status`.
- Counters: `POST` (create), `PUT`, `DELETE`, `PATCH .../status`, `PATCH .../assign`.
- Form fields: `PUT .../form-fields`.

`GET` behavior is completely unchanged (decision 4 still holds as originally approved).

**Implementation:** `assertQueueMutable()` in `src/utils/tenantScope.ts` is a pure guard — `if (queue.deletedAt) throw AppError(409, 'QUEUE_ARCHIVED', ...)`. Every mutating service function calls the existing tenant-ownership resolver first (`findQueueOrThrow` / `requireOwnedQueue` / the join-based `findServiceScoped` / `findCounterScoped`, all unchanged), and only calls `assertQueueMutable` after that succeeds — so a cross-organization queue id still 404s before the archived check is ever reached; the archived check never substitutes for or bypasses the tenant check.

**Reason:** Approved follow-up review: an archived queue being retrievable but still mutable was an inconsistency between "archived" as a concept and the actual API surface.

**Consequence — explicitly not a change to the soft-delete strategy itself:** Queues are still soft-deleted the same way (a timestamp, not a row removal), still not cascaded to children (decision 5 unchanged), and `status` is still fully independent of `deletedAt` (decision 6 unchanged). What changed is narrower: repeat mutation attempts against an already-archived queue now get an explicit, typed rejection instead of either silently succeeding (the old repeat-delete case) or silently succeeding at creating orphaned data under an archived queue (the service/counter/form-field cases, which had no guard at all before this addendum).

---

## ADR-016: Phase 3 token engine design (approved decisions, as implemented)

**Status:** Approved (user decisions, 2026-08-22) and implemented.

**Decision:** Fifteen specific design choices for the Device/Token layer, all approved before implementation:

1. **Idempotency uniqueness is `(deviceId, idempotencyKey)`**, not a global unique on the key alone — two different devices coincidentally generating the same key value can never collide.
2. **Idempotency conflict returns `409 IDEMPOTENCY_KEY_CONFLICT`** when the same device reuses a key with different `queueId`/`serviceId`/`formData` — the original token is never silently returned for a mismatched payload.
3. **`POST /api/queues/:queueId/next` takes `{ counterId }`** — the staff member selects the counter; the backend auto-selects the oldest eligible `WAITING` token for it.
4. **Sequence allocation uses `SELECT ... FOR UPDATE`** on the `Queue` row inside the token-creation transaction (ADR-003, now implemented) — no application-level locks, mutexes, in-memory counters, or Redis.
5. **`/next`'s token-selection query uses `FOR UPDATE SKIP LOCKED`**, scoped only to that query — the sequence-allocation lock in `createToken` stays plain `FOR UPDATE`. This lets two counters call `/next` concurrently and claim two different tokens without blocking each other.
6. **`Device` has no `organizationId`** — kept exactly as specified (ADR-011): a device is a global, lightweight identifier, not a tenant-scoped account.
7. **`Token.serviceId` uses `ON DELETE RESTRICT`**, not `CASCADE` — a service with token history can never be hard-deleted out from under that history.
8. **Customer-facing token endpoints require no staff authentication**; authorization is possession of the token's (high-entropy) UUID. Customer responses are a restricted view (`toCustomerView` in `token.service.ts`) that never includes `organizationId`, `deviceId`, `idempotencyKey`, or `formVersion`.
9. **Serial numbers are 3-digit zero-padded** (`A001` … `A999`, `A1000`, …) and never truncated past 999.
10. **`PAUSED`/`INACTIVE` queues reject new token creation but do not affect existing tokens** — `call`/`start`/`complete`/`skip`/`next` are never gated on `queue.status`.
11. **Archived queues reject new token creation (`409 QUEUE_ARCHIVED`)** but existing `WAITING`/`CALLED`/`IN_PROGRESS` tokens remain fully processable to `COMPLETED`/`SKIPPED` — the archived-queue guard (`assertQueueMutable`) is deliberately never called from any token-transition path.
12. **Position counts only `WAITING` tokens in the same queue**, regardless of selected service — one physical line per queue, not per-service sub-queues.
13. **`deviceIdentifier` is a request-body field**, not a header; `Idempotency-Key` remains an HTTP header.
14. **Device registration is `POST /api/devices/register`** with `{ deviceIdentifier }` (the spec doesn't name an exact path).
15. **`GET /api/public/queues/:queueId/config` is fully public** and returns only queue public info, active services, and the current-version form fields — never staff, counters, internal organization data, or historical form versions.

**Token creation transaction (as implemented, `token.service.ts` `createToken`):** every independently-failable check (queue exists/not archived/`ACTIVE`, service exists/belongs to the queue/active, device not blocked, form data valid against the current `QueueFormField` set) runs before the queue row is locked. The lock, the authoritative idempotency re-check, the sequence increment, and the insert are the last steps — a failed transaction never leaves `next_token_number` advanced. One refinement beyond the literal approved step order: the queue's `status`/`deletedAt` are re-checked against the *locked* row (not the earlier pre-lock read) to close the narrow TOCTOU window between validation and lock acquisition (e.g. staff pausing the queue mid-request) — the pre-lock checks still run first as an early-exit optimization.

**State machine (`src/utils/tokenStateMachine.ts`):** `WAITING → {CALLED, SKIPPED}`, `CALLED → {IN_PROGRESS, SKIPPED}`, `IN_PROGRESS → {COMPLETED, SKIPPED}`, `COMPLETED`/`SKIPPED` terminal. Centralized and called from every transition path; never re-implemented in a controller. Each transition (`call`/`start`/`complete`/`skip`) additionally applies a conditional (compare-and-swap) `UPDATE ... WHERE id = ? AND status = ?` as a concurrency safety net beyond the pre-check — two racing requests against the same token can only have one succeed, surfaced as `409 TOKEN_STATE_CHANGED` for the loser.

**Reason:** All fifteen numbered decisions were explicitly approved before coding began. The transaction/state-machine refinements follow directly from CLAUDE.md's transaction and concurrency rules and from the spec's own "two simultaneous requests must never produce duplicates" requirement.

**Consequence:** `Token.formVersion` is a plain integer snapshot (not a foreign key) of `Queue.formVersion` at creation time, permanently resolvable via `(queueId, formVersion)` against `QueueFormField` — this depends on ADR-009's existing guarantee that old `QueueFormField` rows are never mutated, and required no change to that guarantee. Phase 4 (Real-Time) will wrap `createToken`/`callToken`/`startToken`/`completeToken`/`skipToken`/`nextToken` with Socket.io event emission *after* each already-committed transaction — no event emission exists yet in Phase 3, deliberately.

**Post-implementation review findings (2026-08-22), both closed before commit:**

- **`estimatedWaitMinutes` returns `null` when zero counters are `ACTIVE`, rather than flooring the divisor to 1.** The spec (§7.14) gives only the bare formula (`service time × eligible tokens ahead ÷ available active counters`) and is silent on the zero-counter edge case — this is a product decision, not a spec requirement. The original implementation substituted `Math.max(activeCounters, 1)`, which produced a real numeric estimate implying active service even when no counter was open — misleading rather than merely imprecise. Approved decision: return `null` instead (matching how `position`/`estimatedWaitMinutes` are already nulled for non-`WAITING` tokens), so clients can distinguish "an estimate exists" from "no one is currently serving this queue."
- **Optional form fields now accept an explicitly-submitted empty string as "no answer," not just an omitted key.** `buildFormDataSchema`'s non-empty constraint (`.min(1)` / enum membership) was previously applied to the base schema before the required/optional split, so Zod's `.optional()` only ever tolerated a missing key, never a blank value — inconsistent with `required: false`'s own meaning and with how real form clients typically submit a left-blank optional field. Fixed for all string-based field types (text/email/phone/date/dropdown/radio); `number`/`checkbox` were left untouched (out of scope — would need type coercion, not requested). Required-field validation is unchanged: an empty string is still rejected wherever `required: true`.

---

## ADR-017: Phase 4 real-time layer design (approved decisions, as implemented)

**Status:** Approved (user decisions, 2026-08-22) and implemented.

**Decision:** Fourteen specific design choices for the Socket.io layer, all approved before implementation:

1. **All 12 spec-defined events implemented** (`queue.created/updated/status_changed`, `token.created/called/started/completed/skipped/position_changed`, `counter.created/updated/status_changed`), not the narrower 8-event list in `IMPLEMENTATION_PLAN.md` — the specification is authoritative where they conflict. No `service.*` events (not in the spec's list).
2. **Three rooms exactly as specified**: `organization:{id}` (staff-only), `queue:{id}` (public), `token:{id}` (public by UUID possession). Room/event/payload-tier mapping, closing the customer-PII-leak risk identified in the readiness review:
   - Organization room: all 12 events, full staff-authorized payload.
   - Queue room: `queue.status_changed` only, with a minimal public-safe payload (`{id, status}`) — never token or counter detail.
   - Token room: `token.called/started/completed/skipped/position_changed` only (never `token.created` — no one could have joined a room for an id that didn't exist yet), with the existing Phase 3 customer-safe view.
3. **Authentication reuses Phase 3's `resolveAuthContext`** (`src/utils/authContext.ts`) verbatim — no second JWT verification implementation. No token → anonymous; valid token → authenticated; invalid/expired token or suspended staff/organization → handshake rejected (`resolveAuthContext` already returns `null` identically for all three failure cases, matching REST `authenticate`'s DB-authoritative check).
4. **`token.position_changed` uses targeted per-token emission**: only waiting tokens *behind* the one that just left `WAITING` (via `call`/`next`, or a `WAITING`→`SKIPPED` `skip`) are recomputed and notified, each to its own `token:{id}` room (and the organization room, per decision 2's "all 12 events" there) — never broadcast to the queue room, never for a `CALLED`/`IN_PROGRESS`→`SKIPPED` skip (which never affected the waiting set to begin with).
5. **One envelope**: `{ type, organizationId, queueId?, tokenId?, data }`, `data` shaped per the room's security tier.
6. **Emission is controller-level**, always *after* `res.json(...)` has already been sent, and every exported `emit*`/`broadcast*` function internally catches and logs its own errors — a socket delivery failure can never turn an already-sent, already-successful HTTP response into an error, and services stay Socket.io-independent.
7. **No event replay, no Redis, no event log, no persisted socket-session records.** Reconnection is a fresh handshake + fresh room joins; resynchronization is the client's existing REST calls (e.g. `GET /api/tokens/:id/status`), not a socket-delivered replay.
8. **Dependencies**: `socket.io` (runtime), `socket.io-client` (dev/test only). No Redis, no message broker, no new database tables, no FCM. No Prisma migration — confirmed via `prisma migrate status` before and after implementation. Socket.io reuses the existing `corsOrigins` config (its own `cors` option, since it doesn't share Express's `cors()` middleware automatically).
9. **No new Socket.io rate-limiting system** — out of scope for Phase 4, per explicit instruction.
10. **Module structure**: `src/realtime/{types,events,rooms,socketAuth,socketServer,emit}.ts`, plus modifications to `src/server.ts` (attaches the socket server to the same `http.Server`) and the queue/counter/token controllers (emit calls after each already-successful service call — never inside the services themselves).

**Discovered but explicitly not fixed (per Phase 4's scope rule — recorded, not silently patched):**

- Neither queue archival (`DELETE /api/queues/:id`) nor counter deletion has a corresponding spec event (the spec's 3 queue events and 3 counter events are `created/updated/status_changed` only, no `deleted`/`archived`) — these mutations remain real-time-invisible by design, matching the literal spec list rather than inventing new event names.
- `assignCounter` (`PATCH /api/counters/:id/assign`) has no dedicated spec event; it emits `counter.updated` (a recommended, not explicitly approved, mapping from the readiness review — the assignment genuinely is an update to the counter row).
- Phase 3's public REST endpoints (`POST /api/tokens`, `GET /api/public/queues/:id/config`) still have no rate limiter, despite spec §19 listing both under mandatory rate limiting — pre-existing from Phase 3, unrelated to the Socket.io layer, explicitly not addressed here per the scope rule (recorded in `docs/PROGRESS.md`).

**Reason:** All fourteen numbered decisions were explicitly approved before coding began; the room/payload-tier split in decision 2 directly closes the customer-to-customer PII leak and staff-only-data leak risks identified in the Phase 4 readiness review (§15 of that review).

**Consequence:** `token.service.ts` gained `getTokenCustomerView`/`getTokenStaffView` (renamed/added exports, single source of truth for "what's safe to show whom," reused by both REST and realtime) and `listWaitingTokenPositions` (batch position recompute for the targeted broadcast), and `transitionToken`'s internal return shape changed to `{ token, previousStatus }` so `skip`'s controller can decide whether a position broadcast is needed — the REST response bodies for `/start`, `/complete`, `/skip` are byte-for-byte unchanged, only the internal service return shape changed. Phase 5 (Mobile) and Phase 6 (Dashboard) can now build against a working, tested realtime layer for live token/queue/counter updates.

---

## ADR-018: Phase 5 mobile app design (approved decisions, as implemented)

**Status:** Approved (user decision, 2026-08-22) and implemented.

**Decision:** At the start of Phase 5, the spec and `IMPLEMENTATION_PLAN.md` were found to independently and consistently define "Phase 5" as a Flutter mobile client app in `mobile-app/` — different language, different runtime, no backend changes — while the phase kickoff instructions were written entirely in backend terms (Prisma, `routes → controllers → services`, the Vitest baseline). This was surfaced as a conflict rather than silently resolved; the user confirmed: build the actual spec-defined Phase 5 (Flutter app), not a backend feature. Implemented exactly as both governing documents specify — `lib/{models,services,repositories,providers,screens,widgets}`, Provider for state management, `mobile_scanner`/`shared_preferences`/`socket_io_client`/`flutter_local_notifications`/FCM — with zero backend changes; every endpoint the app calls already existed from Phases 1-4.

**Reused, not redesigned:** the app is a pure consumer of the existing REST/Socket.io contract — public queue config (Phase 3), device registration (Phase 3), token creation/get/status (Phase 3), the `queue:{id}`/`token:{id}` public rooms and their exact event payload shapes (Phase 4 ADR-017). No new backend endpoint, field, or event was added or requested for this phase.

**Design decisions made while implementing (not requiring separate approval, recorded for completeness):**

1. **Reconnection always triggers a REST resync**, including the very first connect (`TokenTrackingProvider._onConnectionChanged`) — rather than trying to distinguish "initial connect" from "genuine reconnect," every transition to `connected` calls `GET /api/tokens/:id`. The first call is a harmless no-op refresh; every later one is exactly the resync spec section 26 requires ("refresh token status after reconnecting"). Matches Phase 4's own "no event replay" design — the client never assumes a missed event will be redelivered.
2. **`token.position_changed` reminder tracking is per-tracking-session, not persisted** — `TokenTrackingProvider._reminderShown` resets each time `start()` is called (a fresh live-tracking session), so a reminder fires at most once per session even though `position_changed` can arrive many times as the token moves up the queue.
3. **History is denormalized at join time**, not resolved from the token later — the customer-safe token view (Phase 3 decision 8) has no queue/service *name* fields, only ids, so `HistoryEntry` captures `queueName`/`serviceName` from the `QueueConfig`/`ServiceOption` already in hand at the moment of creating the token, rather than requesting a backend change to add names to the token view.
4. **FCM is scaffolded, not functional** (`services/fcm_service.dart`) — `IMPLEMENTATION_PLAN.md`'s own "Open Questions" section asks who creates the required Firebase project, and that was never answered; separately, real push delivery needs a backend device-token-storage endpoint and dispatch job that is explicitly Phase 7 scope ("Push notification jobs", "node-cron for scheduled reminder dispatch"), not Phase 5. `flutter_local_notifications` (no external dependency) is fully implemented and covers the turn alert / reminder / skipped / queue paused-resumed notice types for as long as the app has a live connection; true background-after-app-killed push does not work without both of the above.
5. **Client-side dynamic form validation is UX only** (`utils/form_validation.dart`) — mirrors the same required-field check the backend already enforces (Phase 3 `buildFormDataSchema`), never a second source of truth; the backend remains authoritative and is never bypassed.

**Reason:** Decision was explicitly approved before implementation began (the scope conflict) or follows directly from working within the constraints of what Phases 1-4 already expose, without inventing new backend surface area (CLAUDE.md: don't invent requirements; reuse existing architecture).

**Consequence:** `mobile-app/` is a genuinely independent client — the backend (`backend/`) has zero code changes from this phase, confirmed by `git status` showing only new files under `mobile-app/` plus documentation. Phase 6 (Dashboard) can proceed independently; neither phase depends on the other's client-side implementation, only on the shared Phase 1-4 backend contract both already consume.

**Post-implementation review findings, both closed before commit:**

- **Idempotency key stability across retries.** `QueueJoinProvider.submitJoin()` originally generated a fresh `generateUuidV4()` on every call, including manual retries after a failed attempt — meaning a response lost in transit after the server had already created the token would produce a *different* key on retry, which the backend cannot recognize as the same request, risking a duplicate token. This directly undermines the reason ADR-004 exists ("Mobile retries on network failure must not create duplicate tokens"). Fixed: a lazily-generated `_pendingIdempotencyKey` field is cached for the duration of one logical join attempt (`_pendingIdempotencyKey ??= generateUuidV4()`), reused across every retry, and cleared only on successful token creation or an explicit `reset()` — never merely because an HTTP call failed.
- **Corrupted local storage could crash the app.** `HistoryStorageService.getAll()` and `PreferencesStorageService.load()` had no error handling around `jsonDecode`/`fromJson`, so malformed or structurally-invalid persisted JSON would throw an uncaught exception rather than degrading to the safe fallback — and `HistoryProvider.load()`'s `try/finally` had no `catch` to stop that exception from reaching the UI layer. Fixed: both storage services now catch any parse failure and return their documented fallback (`[]` for history, defaults for preferences); history additionally recovers per-entry, so one corrupted record doesn't discard the rest of a customer's history; `HistoryProvider.load()` gained its own independent `catch` as defense in depth, consistent with the app's existing pattern of never trusting local device state to be well-formed (mirrors `TokenStatus`/`DynamicFieldType`'s enum-parsing fallback to `unknown` rather than throwing).

Both were found in a dedicated, read-only pre-commit review (not caught by the original test suite), fixed with the smallest change that satisfies the stated requirement, and covered by 20 new regression tests before this phase was approved for commit.

---

## ADR-019: Phase 6 web dashboard design (implemented, pre-commit review complete)

**Status:** Implemented, security-reviewed, and blocker findings fixed and regression-tested. Committed as `f5b9bb1`; pending push/synchronization with origin/master.

**Scope-conflict resolution (approved user decision before implementation began):** the specification's own §31 phase breakdown lists "Audit logs" under *both* "Phase 6: Dashboard" (item 7) and "Phase 7: Production Hardening" (item 4) — a genuine self-contradiction, compounded by `IMPLEMENTATION_PLAN.md`'s Phase 6 page list naming an `AuditLogs` page while its task checklist never creates the backing `AuditLog` model or any write-on-action logic (that model/logging is explicitly `IMPLEMENTATION_PLAN.md`'s Phase 7 task: "Add `AuditLog` model and write to it on all tracked actions"). Rather than guess, this was surfaced and the user chose: **defer the Audit Logs page and all backing infrastructure entirely to Phase 7.** Every other Phase 6 page/feature from spec §9-§13 and §31 was implemented.

**Backend additions (all additive, zero Prisma migration — confirmed via `prisma migrate status` before and after):**

1. **Organization management** (`organization.{service,controller,routes}.ts`) — `GET/PUT/DELETE /api/organizations/me`, singular (no `:organizationId` param; always the authenticated staff member's own org, CLAUDE.md Rule 4). Edit/delete additionally require `role === 'OWNER'` in the service layer, on top of the `manage_organization` permission gate at the route layer (spec 7.1 scopes this to the owner specifically, not just "anyone with the permission") — defense in depth, not redundant. Delete re-verifies the typed-name confirmation server-side (`confirmName` must equal the org's actual name) rather than trusting the frontend's confirmation dialog alone (CLAUDE.md section 10). **Only `name` is editable** — the schema's `Organization` model has no customer-terminology or default-queue-settings columns; those already exist per-*queue* (`Queue.clientTerminology`/`baseTimeMinutes`/`defaultNotificationMinutes`, Phase 2). Adding organization-wide duplicates of those fields would be a new schema change and a new "how do org-level defaults propagate to queues" business rule that spec 7.1's prose doesn't actually specify — deliberately not invented; recorded as a known gap.
2. **Staff management** (`staff.{service,controller,routes}.ts`) — the exact five endpoints spec 7.3 names (`GET/POST/PUT/DELETE /api/staff[/:staffId]`). Reads are open to any authenticated staff member (Phase 2 decision-1 convention); mutations require `manage_staff`. `POST`/`PUT` restrict `role` to `ADMIN`/`ACCOUNTANT` — an organization has exactly one `OWNER`, created only at registration (ADR-005); staff management creates/edits staff, never a second owner. `DELETE` enforces spec 7.3's explicit rule ("Owner cannot be deleted by normal staff") with a `403 CANNOT_DELETE_OWNER`; `PUT` enforces the equivalent protection with `403 CANNOT_MODIFY_OWNER` (see "Post-implementation review findings" below — this was a gap at first implementation, closed before commit). **Superseded by the frozen RBAC policy (see the RBAC freeze entry below):** this paragraph originally described a per-staff, client-suppliable `permissions` array (capped by the acting staff member's own grant, `403 PERMISSION_ESCALATION_DENIED`) and a reserved-but-unused `manage_roles` permission. Neither exists anymore. Permissions are now derived entirely from `role` via `getEffectivePermissions()` (`backend/src/constants/permissions.ts`) — there is no per-user permission customization, no client-suppliable `permissions` field on create/update, and `manage_roles` has been removed from the permission set outright (roles are assigned directly by name — `OWNER`/`ADMIN`/`ACCOUNTANT` — with no task-specific role-management feature).
3. **Blocked devices** (`device.service.ts` additions) — `GET /api/devices` (paginated, optional `status` filter) and `PATCH /api/devices/:deviceId/status`, both gated by `manage_blocked_devices`. **Deliberately global, not tenant-scoped** — `Device` has no `organizationId` by design (ADR-011/ADR-016 decision 6: a device is a platform-wide abuse-prevention identifier, since the same phone can join queues at different, unrelated organizations). Phase 6 is the first time this list is surfaced in a UI; redesigning `Device` to be per-organization would reverse an already-approved Phase 3 decision and is out of this phase's scope — recorded as an inherited tradeoff (a staff member can see/block a device that has only ever interacted with a *different* organization's queues), not a new tenant-isolation defect introduced here.
4. **Dashboard** (`dashboard.service.ts`) — `GET /api/dashboard/stats` (spec §10's nine summary cards, all org-scoped; wait/service-time averages and completed/skipped counts boxed to "today" via `EXTRACT(EPOCH FROM ...)` raw SQL for the timestamp-difference averages) and `GET /api/dashboard/tokens` (the live queue table: paginated `WAITING`/`CALLED`/`IN_PROGRESS` tokens with queue/service/counter names, reusing `token.service.ts`'s existing `listWaitingTokenPositions` per distinct queue on the page rather than re-deriving the position formula a second time, CLAUDE.md Rule 5).
5. **Reports** (`report.service.ts`) — `GET /api/reports` (`view_reports`) and `GET /api/reports/export` (`export_reports`, CSV; a genuinely separate permission, not implied by `view_reports`) with spec §13's five date-range presets (`today`/`yesterday`/`last7`/`last30`/`custom`, `utils/dateRange.ts`, shared with the dashboard's "today" boundary). Metrics: tokens created/completed/skipped, average waiting/service time, peak-hours-of-day histogram, per-queue performance, and counter utilization. **Counter utilization is an approximation, labeled as such in the API consumer (`ReportsPage`), not hidden**: it's "share of tokens this counter served" rather than true wall-clock active/offline duration, because the schema has no history table tracking counter status over time — building one would be new schema/infrastructure out of Phase 6's scope.
6. **Form field read endpoint** (`formField.service.ts` addition) — `GET /api/queues/:queueId/form-fields`, added per CLAUDE.md Rule 7 ("add a new endpoint only when necessary... document it"): Phase 2 only ever built the atomic-replace `PUT`, so there was no way for *any* client to read a queue's current form-field definitions before this. The dashboard's form builder needs to display existing fields before editing them; the already-public `GET /api/public/queues/:id/config` returns current-version fields too, but that's the customer-facing, unauthenticated path — mixing it into a staff dashboard flow would blur the public/staff data boundary CLAUDE.md section 3 and spec §7.16 establish. This new endpoint is staff-authenticated, reuses the same `requireOwnedQueue` tenant check as every other nested queue resource, and requires no permission beyond `authenticate` (read-only, Phase 2 decision-1 convention).

**A real, pre-existing bug found and fixed while building these endpoints:** `middleware/validate.ts`'s query-parameter validation branch did `req.query = schemas.query.parse(req.query)`, which silently either threw or no-opped under Express 5 — Express 5 redefined `req.query` as a **getter-only accessor** that recomputes a fresh object from the raw URL on every access, so neither a direct assignment (no setter — throws in strict mode/ESM) nor mutating the object returned by one access (lost — the next access recomputes) actually persists parsed/coerced/defaulted query values for downstream handlers. No Phase 1-5 route validated query parameters at all (only `body`/`params`), so this had never been exercised until Phase 6's `page`/`pageSize`/`status`/`range` query params hit it — surfaced immediately as five failing tests (`GET /api/staff`, `GET /api/reports`, `GET /api/devices`) with the underlying cause traced via a raw `PrismaClientValidationError` ("Argument `skip` is missing") rather than any Express-level error. **Fixed** by redefining the `query` property itself via `Object.defineProperty(req, 'query', { value: parsedQuery, writable: true, configurable: true, enumerable: true })`, which actually replaces the getter rather than fighting it. This is a real fix to shared middleware, not new business logic — it makes the *existing* `validate()` contract (documented as "validates and replaces req.body/params/query") actually work for the `query` case, which nothing before Phase 6 had exercised.

**Frontend** (`web-dashboard/`, React 19 + TypeScript + Vite + React Router 7 + TanStack Query 5 + Tailwind CSS 4 + `socket.io-client`, exactly the spec's stack): folder layout matches `IMPLEMENTATION_PLAN.md`'s Phase 6 list (`api, components, pages, layouts, hooks, context, services, utils, types`). Design choices made while implementing:

1. **Native `fetch`, no `axios`** — not in the spec's tech stack list (§6), and `fetch` alone is sufficient for this API's needs; avoids an unnecessary dependency (CLAUDE.md section 11).
2. **`qrcode` (npm) for QR generation** (`components/QrCodeDisplay.tsx`) — spec §12 requires generate/display/download/print for every active queue's `qrCodeUri`; rendered entirely client-side from the bare `livequeue://queue/{id}` string with no network call, so no private data is exposed by the code itself.
3. **`oxlint`, not `eslint`** — the current Vite React-TS scaffold ships `oxlint` by default; kept as scaffolded rather than swapped for the backend's ESLint, since the spec doesn't mandate a specific frontend linter and swapping would be an unrequested tooling change.
4. **Access token in memory only; refresh token in `localStorage`** (`context/AuthContext.tsx`) — mirrors the mobile app's "never persist the more powerful credential" instinct. On load, a stored refresh token is silently exchanged for a fresh access token, then `GET /api/auth/me` re-confirms current staff/org/permissions from the database rather than trusting anything cached (matches ADR-013's re-check-on-every-request philosophy). `apiFetch` retries exactly once on a `401 TOKEN_EXPIRED` after a successful silent refresh, mirroring standard interceptor patterns without adding an HTTP client library to get them.
5. **One socket connection per dashboard session, joining `organization:{id}` on every `connect` — including reconnects** (`hooks/useOrganizationSocket.ts`) — matches Phase 4 ADR-017 decision 7 (no server-side cross-disconnect room memory) and the mobile app's ADR-018 decision 1 (resync on every "connected" transition, never assume a missed event will be replayed): each (re)connect both re-joins the room and invalidates the affected TanStack Query keys as a resync, and each of the 12 socket events invalidates only the specific queries it affects (e.g. `token.*` → `['dashboard']`, `queue.*` → `['queues']` + `['queue', id]`).
6. **`QueueDetails` and `Counters` are separate pages/routes** (`/queues/:queueId` and `/queues/:queueId/counters`) — `IMPLEMENTATION_PLAN.md`'s Phase 6 page list names both separately, and the backend's counter endpoints are queue-nested only (`GET /api/queues/:queueId/counters`, no global listing), so a per-queue counters page is the only shape the existing API supports; not a new backend surface.
7. **`ProfilePage` is read-only** (name/email/role/status/permissions + logout) — no endpoint lets a staff member edit their own record without `manage_staff` (`staff.service.ts`'s `updateStaff` gates uniformly), and adding a self-service exception would be a new, unspecified business rule (should a staff member without `manage_staff` be able to change their own password? spec 7.3 doesn't say). Recorded as a known limitation rather than guessed at.
8. **No "Forgot password" page** — spec §9 lists it explicitly as "(recommended for production)", not required, and spec §15 lists `PasswordResetToken` under "Optional later," with no backing model or endpoint existing. Building one would mean inventing a new model, endpoint, and email-sending infrastructure with no spec-defined contract — deliberately deferred, consistent with the spec's own hedge.

**Post-implementation review findings (both closed before commit):**

- **Permission self-escalation via `createStaff`/`updateStaff`.** Neither function checked the requested `permissions` array against the *acting* staff member's own permission set, so any staff member holding only `manage_staff` could grant themselves — or a newly-created account — any permission in the system, including `manage_organization`, by simply including it in a `POST /api/staff` or `PUT /api/staff/:staffId` body. Live-reproduced during the Phase 6 pre-commit review: a staff member with only `['manage_staff']` self-escalated to `['manage_organization', 'manage_staff', 'export_reports', 'manage_blocked_devices']` via a single `PUT` call on their own record. This collapsed the entire permission model — `manage_staff` was, in effect, equivalent to holding every permission. **Fixed** with `assertGrantablePermissions()`: every permission in a `POST`/`PUT` body's `permissions` array must already be held by the caller (`req.auth.permissions`, loaded fresh from the database per request — never trusted from a stale token claim), or the call is rejected with `403 PERMISSION_ESCALATION_DENIED`. Only checked when `permissions` is actually present in the request — an update that doesn't touch permissions has nothing to grant, so it's never blocked by this check. The controller passes `req.auth!.permissions` into both service functions to make this possible.
- **Missing owner protection on `updateStaff`.** `deleteStaff` already enforced spec 7.3's "Owner cannot be deleted by normal staff," but `updateStaff` had no equivalent guard, so any staff member holding `manage_staff` could suspend the owner (`status: 'SUSPENDED'`, immediately blocking their login), demote them (`role: 'ADMIN'`), or strip their permissions (`permissions: []`) — all live-reproduced during the review. This achieves the same practical outcome as deletion (loss of the owner's control) and is arguably worse, since a suspended owner cannot log back in to undo it themselves. **Fixed** with `assertNotOwner()`, mirroring `deleteStaff`'s guard exactly: if the target staff record's `role === 'OWNER'`, the entire `updateStaff` call is rejected with `403 CANNOT_MODIFY_OWNER` — not just the role/status/permissions fields, but the whole operation (including e.g. a name change), since no legitimate flow currently depends on this endpoint touching the owner's record at all (owner self-service profile editing remains a known, separately-recorded limitation, not something this endpoint was ever relied on for). The guard runs immediately after the existing tenant-scoped lookup (`findStaffScoped`), so a cross-organization caller still gets `404` — they never learn the target is even an owner, exactly like every other staff endpoint's tenant-isolation behavior.

Both were found in a dedicated Phase 6 pre-commit security review (not caught by the original 262-test suite — the suite proved `DELETE` protected the owner but never proved `PUT` didn't, and proved permissions could be assigned but never proved they couldn't be over-assigned relative to the caller), confirmed via live reproduction against the real service layer (not just static analysis), fixed with the smallest change that satisfies the invariant, and covered by 13 new regression tests in `staff.test.ts` before this phase was approved for commit. The tests were themselves verified by mutation testing — temporarily removing each guard (and the controller's permission-forwarding, and the tenant-scoping order) and confirming the relevant tests fail — not just that they pass against the fixed code.

**Reason:** the Audit Logs deferral was an explicitly approved user decision resolving a genuine two-way document conflict; every other design choice follows directly from reusing what Phases 1-5 already established (CLAUDE.md: reuse existing architecture, don't invent requirements) or from a schema/spec gap that would require a new, unapproved product decision to close.

**Consequence:** the `Organization` schema's minimal shape (decision 1) and `Device`'s global identity (decision 3) both remain exactly as Phase 1/3 defined them — Phase 6 exposes what already exists rather than redesigning it. The `validate.ts` fix (decision affecting all routes) means every future route that validates query parameters — not just Phase 6's — now works correctly; this was a latent bug in shared middleware, not a Phase 6-specific one, and is called out separately from the phase's own design decisions for that reason.

---

## ADR-020: RBAC frozen — role-derived permissions, `manage_roles` removed (2026-08-24)

**Status:** Implemented, tested, approved. Not yet committed as of this entry.

**Decision:** LiveQueue has exactly three staff roles — `OWNER`, `ADMIN`, `ACCOUNTANT` — each with a fixed, non-customizable permission set. This supersedes the per-staff, client-suppliable `permissions` array described in ADR-019's Phase 6 write-up above (the `assertGrantablePermissions`/`PERMISSION_ESCALATION_DENIED` mechanism, and the "role picks a default, permissions can still be individually granted" model). There is no per-user permission customization and no task-specific role-management feature.

**Permission set (10 total; `manage_roles` has been removed — see below):**
```text
manage_organization
manage_staff
manage_queues
manage_services
manage_counters
operate_tokens
view_reports
export_reports
manage_blocked_devices
view_audit_logs
```

**Role matrix:**
- `OWNER` — all 10 permissions.
- `ADMIN` — all 10 permissions, with exactly two hard restrictions enforced independently of the permission system: cannot delete the Owner (`staff.service.ts`'s `deleteStaff`, checks `existing.role === 'OWNER'`) and cannot delete the organization (`organization.service.ts`'s `requireOwner`, checks `role !== 'OWNER'`). Both checks predate this ADR and were deliberately left unmodified.
- `ACCOUNTANT` — exactly 5: `manage_counters`, `operate_tokens`, `view_reports`, `export_reports`, `manage_blocked_devices`. Notably excludes `view_audit_logs` — audit-log access was decoupled from `view_reports` specifically so Accountant could get reporting without audit visibility (previously both were gated by the same `view_reports` permission, which was a genuine bug: any role with reports access also had audit-log access with no way to separate the two).

**Mechanism:** `getEffectivePermissions(role)` (`backend/src/constants/permissions.ts`) is the single source of truth, called everywhere authorization is established — the `authenticate` middleware (REST) and `resolveAuthContext` (Socket.io) both re-derive permissions from a **fresh per-request database read** of the staff row's `role`, never from a JWT claim or the stored `permissions` column. A role change therefore takes effect on the staff member's very next request, with no token refresh or re-login needed. The `permissions` column still exists on `Staff` (no migration) and is still written on create/update for observability, but nothing reads it back as authoritative — this was a deliberate choice to avoid a data migration while still guaranteeing no stale stored value can ever grant access inconsistent with the current role.

**`manage_roles`:** removed entirely from the permission set. It was defined since Phase 1 but never wired to any route (confirmed via a full-repository grep before removal) — a genuinely dead permission, not a feature that was retired. There is no task-specific roles-management system in this product; roles are assigned directly by name through the existing staff create/update endpoints (`role: 'ADMIN' | 'ACCOUNTANT'`, `OWNER` reserved for registration only, per ADR-005).

**Reason:** an explicit product decision to make authorization predictable and auditable — three fixed roles are easier to reason about, test exhaustively, and audit than an open-ended per-staff permission matrix, and match how the dashboard/product is actually used (no observed need for finer-grained custom roles).

**Consequence:** `CreateStaffModal`'s permission-checkbox UI was removed from the dashboard (`web-dashboard/src/pages/StaffPage.tsx`) — permissions are no longer choosable, only role is. `createStaffSchema`/`updateStaffSchema` no longer accept a `permissions` field at all (silently stripped by Zod if sent, per its default non-strict object behavior — not rejected, just ignored). New page-level route guards (`web-dashboard/src/layouts/PermissionRoute.tsx`) prevent direct URL navigation to Staff/Blocked-Devices/Audit-Logs pages for a role lacking the relevant permission, on top of the pre-existing nav-link hiding — still UI-only convenience, never the security boundary, exactly as `PermissionGate`'s own doc comment states. 378 backend authorization tests (up from 369 pre-freeze) cover the full role × endpoint matrix directly against the API, not just through the dashboard.

---

## ADR-021: `ACCOUNTANT` role renamed to `STAFF` (V2 Checkpoint 1, 2026-08-26)

**Status:** Implemented, tested, approved.

**Decision:** The third staff role (see ADR-020's role matrix) is renamed from `ACCOUNTANT` to `STAFF`. This is a V1 → V2 product-terminology correction, not a permissions change: the role's fixed permission set (`manage_counters`, `operate_tokens`, `view_reports`, `export_reports`, `manage_blocked_devices`) is unchanged, and `OWNER`/`ADMIN` are unaffected.

**Reason:** LiveQueue is a general-purpose queue management system, not one specific to accounting/finance use — `ACCOUNTANT` was domain-specific terminology left over from an early naming choice and did not describe what the role is actually used for in practice (general staff operating counters/tokens with reporting access, across any kind of organization).

**Mechanism:** `StaffRole` is a Postgres enum (`backend/prisma/schema.prisma`) with existing production rows already referencing the `ACCOUNTANT` value, so the migration (`20260826090000_rename_accountant_role_to_staff`) uses `ALTER TYPE "StaffRole" RENAME VALUE 'ACCOUNTANT' TO 'STAFF'` — an in-place catalog rename, not a drop/recreate/backfill. Every existing staff row keeps referencing the same enum label under its new name with zero data migration and no downtime window. All code-level identifiers were renamed to match: `ACCOUNTANT_PERMISSIONS` → `STAFF_PERMISSIONS` in `permissions.ts`, the `manageableRole` enum in `staff.validators.ts`, the frontend `StaffRole` type (`web-dashboard/src/types/auth.ts`), and the dashboard's manageable-role list (`StaffPage.tsx`). All 11 backend test files referencing the old name were mechanically updated (identifier rename only, no test behavior changed) and the full existing authorization suite was re-run rather than trusting a grep alone.

**Consequence:** Any external integration or stored client-side value still expecting the literal string `ACCOUNTANT` (e.g. a previously-cached dashboard session) will see `STAFF` after this deploy — there is no compatibility shim, per this project's "no backwards-compatibility hacks for internal state" convention. `docs/LiveQueue_AI_Ready_Specification.md` sections 2.5/3.3/7.4 were updated to describe the current `STAFF` role name; historical sections describing what shipped in the original MVP (e.g. section 38's scope checklist) were deliberately left as `Accountant`, since they are a record of what that specific release contained, not living documentation.

---

## ADR-022: Self-service staff password change (V2 Checkpoint 1, 2026-08-26)

**Status:** Implemented, tested, approved.

**Decision:** Added `PATCH /api/auth/password`, letting an authenticated staff member change their own password. This is additive — the existing admin-driven `PUT /api/staff/:staffId` password-set path (no current-password check, since it's an authorized admin override of someone else's account) is unchanged.

**Mechanism:** Reuses `hashPassword`/`verifyPassword` (`utils/password.ts`) and `passwordSchema` (`auth.validators.ts`) exactly as-is — no duplicated hashing/validation logic. The request body is a `.strict()` Zod schema (`currentPassword`, `newPassword`, `refreshToken` only) so an extra field such as a client-supplied `staffId` or `role` is rejected outright rather than silently ignored, closing off any privilege-escalation attempt through this endpoint. The authenticated identity comes from `req.auth.staffId` (set by the `authenticate` middleware from a fresh DB read) — never from the request body. `sensitiveRateLimiter` (already used for staff create/update/delete) protects the current-password verification step from brute-forcing.

**Session handling:** the endpoint requires the caller's own current `refreshToken` in the body — the same pattern already established by `/logout` and `/refresh` — and uses it to identify which `Session` row to keep alive. A new `revokeOtherSessions(staffId, keepRawRefreshToken)` (`session.service.ts`) revokes every other active session for that staff member, mirroring `rotateSession`'s existing reuse-detection bulk-revoke query but scoped to exclude the caller's own session instead of revoking unconditionally. The in-flight access token (a short-lived stateless JWT, not tied to a `Session` row) is unaffected by session revocation, so the calling device keeps working immediately without needing to re-authenticate.

**Reason:** this gap was flagged during the V2 roadmap investigation — `ProfilePage.tsx` was read-only with an explicit comment noting no self-service edit endpoint existed. Staff having to ask an Owner/Admin to reset their password for a routine password change is unnecessary friction and a support burden.

**Consequence:** `ProfilePage.tsx` gained a password-change form. A `password_changed` audit action was added to `AUDIT_ACTIONS` (`auditActions.ts`) and is recorded (best-effort, after the DB write succeeds) on every successful change, matching the existing `login`/`logout` audit wiring pattern.

---

## ADR-023: V2 checkpoint reorder, standing V2 development rules, and email-verification design (2026-08-26)

**Status:** Decision recorded; email verification is investigation-only at this point — not yet implemented.

**Decision 1 — Checkpoint reorder.** The V2 roadmap recorded after Checkpoint 1 (`docs/PROGRESS.md`, `docs/IMPLEMENTATION_PLAN.md`) is superseded by this order:

1. Password change + `ACCOUNTANT` → `STAFF` rename — done
2. Registration / email verification
3. Strict FCFS + multi-counter queue engine
4. ETA + live countdown + variable service duration
5. Queue repeat-visit policy
6. Customer cancellation
7. Anti-bias OTP verification
8. Mobile force-update system
9. V2 production verification

**Reason:** email verification closes a pre-existing V1 trust-boundary gap (`POST /api/auth/register` today creates a fully `ACTIVE` organization + owner from any email address with zero proof of ownership) — this should close before queue-behavior changes are layered on top of that same trust boundary. ETA, multi-service selection, and staff duration overrides were also consolidated from three separate checkpoints into one (`Checkpoint 4`), since they're one coherent duration/ETA model, not independent features — building a countdown on the current simplistic formula and then re-deriving it for multi-service would be redone work. Repeat-visit policy was pushed later since it depends on the queue engine (Checkpoint 3) being stable first. Mobile force-update was added as a new checkpoint (8) — a standing platform capability worth building deliberately rather than left as something to remember manually later.

**Decision 2 — Standing V2 development rules.** The following apply to every remaining V2 checkpoint, superseding nothing in CLAUDE.md (they're a V2-specific refinement of it, not a replacement):

1. V1 is already launched; treat it as production software.
2. Do not change existing V1 behavior unless a V2 requirement explicitly changes it.
3. V2 is both feature development and security/bug-fixing work.
4. Prefer the smallest complete implementation — no Redis/queues/brokers/polling unless a checkpoint genuinely requires it.
5. PostgreSQL remains the source of truth.
6. Socket.io and FCM remain notification/distribution channels only, never authoritative.
7. Security rules are backend-enforced; UI restrictions are convenience only.
8. Queue ordering is enforced transactionally, backend-side.
9. Multi-counter behavior must preserve strict FCFS ordering.
10. ETA calculations use server-authoritative timestamps/data; mobile countdowns tick locally but are never authoritative.
11. Customer-specific duration overrides recalculate every affected customer behind them.
12. Default extra service time is +2 minutes when the current service time expires, unless staff explicitly changes the required time.
13. Email verification is required before an organization can use queue functionality.
14. Verification link lifetime: 15 minutes.
15. Unverified registration lifetime: 1 hour, after which the pending organization/owner is removed.
16. Verification tokens are single-use and stored hashed, never raw, when persisted.
17. Password and verification endpoints are rate-limited.
18. The backend/config can force an old mobile app version into an update-required screen.
19. Migrations stay backward-safe for the live V1 database — never assume it's empty.
20. Claude Code never connects to or modifies the production database during implementation.
21. Migrations are created and tested against the local development database only.
22. Production migrations run via Render's Pre-Deploy Command (`npx prisma migrate deploy`), never from a developer machine — see `docs/DEPLOYMENT.md` §7, which already documents this exact constraint.
23. Minimal tests only — security-critical logic, concurrency/queue rules, migrations, and each checkpoint's core behavior; no low-value padding.
24. End of every checkpoint: verify `git status`/diff, run required typecheck/lint/build, run only the meaningful tests; commit + push automatically if clean, otherwise stop with a concise failure report.
25. No separate "commit" / "push" prompts needed — the clean-checkpoint rule already decides this.
26. Every checkpoint ends with a clear PASS/FAIL result.
27. Stop after the checkpoint report — do not roll into the next checkpoint unprompted.

**Decision 3 — Email verification design** (Checkpoint 2 groundwork; not yet implemented):

- **State model:** a new `StaffStatus` value `PENDING_EMAIL_VERIFICATION` (existing values `ACTIVE`/`SUSPENDED` unchanged) — `register()` creates the org + owner in this state instead of `ACTIVE`.
- **Two independent lifetimes, deliberately not conflated:** the verification *link* expires in 15 minutes; the *pending registration* survives for 1 hour regardless of how many links were sent or expired in that window. A token expiring at minute 15 does not delete the account — only reaching the full hour unverified does. This matches the explicit product correction that a 15-minute token expiry must not be read as "delete after 15 minutes."
- **Cleanup, not soft-marking:** when the 1-hour window lapses unverified, the pending **organization and owner are deleted together** (not just the email/staff row) — leaving only the email behind would strand a half-created organization with no owner. Reuses `node-cron` exactly as `reminderScheduler.ts` already does (a new scheduler module + its own `*_CLEANUP_CRON` env var, following `REMINDER_DISPATCH_CRON`'s existing convention), not a new job-scheduling mechanism.
- **Token shape:** reuses `generateRefreshToken()`/`hashRefreshToken()` (`utils/tokens.ts`) exactly as-is — an opaque random value returned to the client once, only its SHA-256 hash persisted. No new secret-handling pattern needed; this is the same shape refresh tokens already use for the same reason (single-use, unguessable, safe if the database leaks).
- **Access boundary:** a new `requireVerified` check, composed alongside (not replacing) `authenticate`, gates queue-functionality routes for a `PENDING_EMAIL_VERIFICATION` staff member. `/api/auth/me`, logout, and resend-verification stay reachable while pending, so the dashboard can show a "please verify" state and offer a resend button rather than the account being invisible to itself.
- **Rate limiting:** resend/verify endpoints use the existing `rateLimit.ts` limiter pattern (either `authRateLimiter` or a new dedicated limiter, decided at implementation time) — no new rate-limiting mechanism.
- **Open, unresolved product decision:** which email-delivery provider to use. A full-repository check confirms zero existing email infrastructure — no `nodemailer`/`resend`/`sendgrid`/`ses` dependency, no `EMAIL_*`/`SMTP_*` env var anywhere in `env.ts`/`.env.example`. This is genuinely new external infrastructure (unlike everything else in V2 so far, which reuses existing patterns) and needs an explicit choice before Checkpoint 2 can be implemented — not an invented default, per CLAUDE.md §12's "do not introduce infrastructure... unless there is a documented technical requirement" (the requirement is now documented; the specific provider is not yet decided).

---

## ADR-024: Mandatory registration email verification, implemented (V2 Checkpoint 2, 2026-08-26)

**Status:** Implemented, tested, committed. Realizes ADR-023's design section, with the specific decisions below where that design left something open.

**Provider:** Resend, via its official Node SDK (`resend` package). `backend/src/services/email.service.ts` mirrors `firebaseAdmin.ts`'s lazy-init/guarded-unavailable pattern exactly — `RESEND_API_KEY` unset means verification emails simply aren't sent (logged, never a startup or request failure), the same optional-infrastructure shape FCM already uses. `EMAIL_FROM` defaults to Resend's own `onboarding@resend.dev` (works with no verified sending domain) for zero-config local dev; a real deployment overrides it with a verified sender.

**Schema (migration `20260826094219_add_email_verification_fields`, purely additive):** `StaffStatus` gains `PENDING_EMAIL_VERIFICATION`; `Staff` gains three nullable columns — `emailVerificationTokenHash`, `emailVerificationExpiresAt` (15-minute link deadline), `registrationExpiresAt` (1-hour pending deadline). No table added: a verification token is inherently single-slot per staff member (resend overwrites, which is exactly how "invalidate the previous token" is achieved — there's only ever one hash to match), so a join table would have been unneeded complexity. Existing production rows are entirely unaffected (new columns default to `NULL`, existing `ACTIVE`/`SUSPENDED` rows never touch this code path).

**Scope boundary — which routes `requireVerified` actually gates:** the existing permission taxonomy (`constants/permissions.ts`) already splits cleanly into seven "queue-management" permissions (`manage_queues`, `manage_services`, `manage_counters`, `operate_tokens`, `view_reports`, `export_reports`, `manage_blocked_devices`) and three "organization-management" ones (`manage_organization`, `manage_staff`, `view_audit_logs`). `requireVerified` is applied to every route in the first group (`queue.routes.ts`, `service.routes.ts`, `counter.routes.ts`, the five staff-operated routes in `token.routes.ts` — not the three public customer-facing ones, `device.routes.ts`'s three blocked-device routes — not the two public registration ones, `dashboard.routes.ts`, `report.routes.ts`) and deliberately **not** to `staff.routes.ts`, `organization.routes.ts`, or `auditLog.routes.ts`. A pending owner can still invite staff, edit the organization name, or view audit logs — this was a genuine scoping call, not an oversight: the product requirement text ("no queue may be created/edited/operated... no other queue-management feature may be used") maps directly onto the existing queue-management permission group, and organization/staff administration is a different, pre-existing category the requirement didn't name.

**`authenticate` middleware change:** previously rejected any `status !== 'ACTIVE'` outright. Now only rejects `SUSPENDED` — `PENDING_EMAIL_VERIFICATION` passes through (with `status` newly carried on `req.auth`), and `requireVerified` (applied selectively, above) is what actually blocks queue functionality. Without this change, a pending owner's very first `/api/auth/me` call would have been rejected, breaking the "register → enter dashboard → see verification-required state" flow entirely — this was the one real "don't accidentally block the endpoint needed to complete verification" risk found during implementation.

**Verify endpoint:** `GET /api/auth/email-verification/verify?token=...`, public, looked up by token hash directly (never by staff id or email in the URL) — the same "possession of a high-entropy value is the credential" trust model this codebase already uses for customer-facing token endpoints. A generic `INVALID_OR_EXPIRED_TOKEN` (400) covers "no such token," "expired," and "already used" alike, never distinguishing which. The emailed link points at the **dashboard's** `/verify-email` route (`APP_BASE_URL`), not directly at the API — `VerifyEmailPage.tsx` calls the verify endpoint on mount and shows the result. The backend performs the actual state change (this is the real enforcement boundary, matching "the backend must be the actual authority"); the frontend page is a thin, unavoidable wrapper given this dashboard has no server-rendered pages anywhere (every route, including `/login`, already requires JS to render — not something this checkpoint changes or needed to).

**Resend endpoint:** `POST /api/auth/email-verification/resend`, authenticated, a new dedicated `emailRateLimiter` (default 3/15min — tighter than every existing category, since this is the only rate-limited action that costs a real email send). Overwrites the single token-hash slot (invalidating the previous token implicitly) and refreshes `emailVerificationExpiresAt` to a new 15-minute window, while leaving `registrationExpiresAt` completely untouched — the 1-hour deadline never moves regardless of how many resends happen.

**Cleanup:** `pendingRegistrationCleanupScheduler.ts` mirrors `reminderScheduler.ts` exactly (`node-cron`, `noOverlap: true`, never starts under `NODE_ENV=test`, wired into `server.ts`'s existing start/shutdown sequence). `cleanupExpiredPendingRegistrations()` is a single `prisma.organization.deleteMany({ where: { staff: { some: { role: 'OWNER', status: 'PENDING_EMAIL_VERIFICATION', registrationExpiresAt: { lt: now } } } } })` — one atomic SQL statement, not a separate select-then-delete, so a staff member verifying in a concurrently-committing transaction is simply not matched by the time this runs (no TOCTOU window to close). Deleting the `Organization` cascades to its `Staff` row (`onDelete: Cascade`, present since the very first migration), removing the pending owner together with the organization rather than leaving a stranded half-created org behind.

**Test-suite-wide consequence:** `tests/helpers/app.ts`'s shared `registerOwner()` helper — used by the overwhelming majority of this suite's setup code — now immediately marks the freshly-registered owner `ACTIVE` via a direct Prisma write after calling the real endpoint, mirroring `createStaffWithRole`'s existing "bypass realism for setup convenience" precedent. Two other call sites that invoked `POST /api/auth/register` directly instead of the shared helper (`tests/rateLimit.test.ts`'s own local `registerOwner`, `tests/notificationPreference.test.ts`'s `setupWaitingTokenForDevice`) needed the identical fix, found by running the full suite and reading the failures rather than by inspection alone. The real pending/verify/resend/expiry/cleanup behavior is exercised directly against the real endpoints in `tests/auth.emailVerification.test.ts`, never through the auto-verifying helper.

**Verification:** backend `typecheck`/`lint` clean; `npm test` — 50 files / 461 tests passing (12 new focused tests in `auth.emailVerification.test.ts`, 2 new rate-limit tests, both fixed pre-existing test files updated). Dashboard `tsc -b`/`oxlint`/`npm run build` all clean (one new informational `set-state-in-effect` warning on `VerifyEmailPage.tsx`, the same accepted category as two pre-existing warnings — a real backend API call inside a mount effect is exactly what that pattern is for). `prisma migrate status` clean after applying the migration to the local dev database only — production applies it via Render's Pre-Deploy Command (`npx prisma migrate deploy`), never from this machine.

---

## ADR-025: Strict FCFS + multi-counter capacity engine (V2 Checkpoint 3, 2026-08-26)

**Status:** Implemented, tested, committed. No migration — the existing data model already represents everything this checkpoint needed.

**Decision:** Close the V1 fairness gap where `POST /api/tokens/:tokenId/call` accepted any staff-supplied `tokenId`, letting a later customer be called while an earlier one still waited. The fix is a single new check inside `callToken()` (`token.service.ts`), gated to the WAITING source path only.

**Two findings that shaped scope, both from inspecting the existing code before writing anything:**

1. **`nextToken()`/`POST /:queueId/next` already correctly implements the full FCFS + multi-counter-capacity rule and needed zero changes.** Its selection query (`SELECT id FROM tokens WHERE status='WAITING' ORDER BY sequence_number ASC LIMIT 1 FOR UPDATE SKIP LOCKED`) always finds the true earliest remaining WAITING token, and `SKIP LOCKED` means two concurrent `/next` calls for two different counters naturally claim two *different*, correctly-ordered tokens (one transaction's row lock makes the other's `SELECT` skip past it to the next-earliest) — exactly the "counter 1 → A-001, counter 2 → A-002, never counter 2 → A-003" requirement, with no new locking logic needed. This was already proven by an existing test, `token.next.test.ts`'s "two counters calling /next concurrently claim two different tokens" — not duplicated by this checkpoint, just confirmed still passing.
2. **Counter occupancy was already exactly the rule this checkpoint specifies.** `CALLED`/`IN_PROGRESS` tokens occupy a counter slot (the pre-existing `busy` check in both `callToken` and `nextToken`); `WAITING`/`SKIPPED`/`COMPLETED` do not. No new field, no new concept — the existing per-counter ACTIVE-and-not-busy check *is* the "N active counters ⇒ N service slots" capacity model, expressed per-counter rather than as an abstract counter-agnostic pool. Since each active counter is independently gated this way, activating/deactivating counters already changes available capacity with zero additional code.

**What actually needed a fix — manual `/call` (and, structurally, `/recall`, since both share `callToken()`):** unlike `/next`, `/call` lets staff pick the `tokenId` directly, so nothing previously verified that pick was the correct one. The new check, added only when `requireSourceStatus === 'WAITING'`: inside the same transaction that already locks the target counter row, run `SELECT EXISTS(SELECT 1 FROM tokens WHERE queue_id = ? AND status = 'WAITING' AND sequence_number < ?)`; if true, reject `409 FCFS_VIOLATION` before any state change, event emission, or notification — the existing `AppError` mechanism, no second error system.

**Why a plain (non-locking) `EXISTS` read is safe here, not a race condition:** a token's `sequenceNumber` is assigned once at creation and never reused, and the state machine has no transition back *into* WAITING (`SKIPPED → CALLED` goes straight to `CALLED`, never through `WAITING` again). So the set of "WAITING tokens with a smaller sequence number than this one" can only ever shrink over time — there is no way for a concurrent transaction to turn a true "no earlier token" result into a false one before this transaction's own compare-and-swap `UPDATE` commits. Two concurrent `/call` requests that both target the genuinely-earliest token are still resolved correctly by the pre-existing compare-and-swap `UPDATE` (`updateMany({ where: { id, status: token.status } })`) — exactly one succeeds, the other gets the existing `409 TOKEN_STATE_CHANGED`, proven by a new concurrency test (`token.fcfs.test.ts`, "Test 6").

**Recall (`SKIPPED → CALLED`) is deliberately exempt from the new FCFS-order check** — a skipped token isn't WAITING, so "out of order relative to waiting tokens" doesn't apply to it; this matches the pre-existing, intentional Recall design (a deliberate override of arrival order, spec: Skipped Token Recall). Recall's capacity constraint was already fully enforced by the same shared `busy` check `/call` uses — confirmed by an existing pre-checkpoint test (`token.stateMachine.test.ts`, "rejects recalling to a counter already busy with a different token") continuing to pass unchanged, plus a new explicit test (`token.fcfs.test.ts`, "Test 7") pinning this exact interaction.

**Dashboard:** `TokenActions.tsx` gained an optional `position?: number | null` prop (defaulting to "eligible" when omitted, so no existing caller/test needed updating) — a WAITING row only shows "Call" when `position === 1`; otherwise a disabled "Locked" button replaces it. No backend response-shape change was needed: `position` was already present on every WAITING row in the live-queue-table response (`listWaitingTokenPositions`, reused unchanged), so this is a pure frontend read of already-available data. The backend remains the actual authority regardless of what this renders — a stale/bypassed UI can never call out of order, only the FCFS check above can prevent that.

**Test scope:** one new file, `tests/token.fcfs.test.ts` (6 tests, mapping directly to Checkpoint 3's Tests 1/3/2/4/5/6/7 — 1 and 3 share one test since they're the same assertion from two angles), plus 2 new dashboard component tests for the Locked UI. No new tests were added for `/next` (already covered) or for capacity/occupancy semantics (already covered by the existing `busy`-check tests across `token.stateMachine.test.ts`/`token.next.test.ts`) — reusing existing coverage rather than duplicating it, per this checkpoint's minimal-test instruction.

**Verification:** backend `typecheck`/`lint` clean; `npm test` — 51 files / 467 tests passing (6 new, zero regressions — every pre-existing test that calls a token only ever does so after any earlier-sequence token in the same queue has already left WAITING, so the new check never triggered on old test setups). Dashboard `tsc -b`/`oxlint`/`npm run build` clean, `npx vitest run` — 15 files / 72 tests passing (2 new). No migration — `prisma migrate status` unaffected, nothing to apply anywhere.

**Explicitly out of scope, unchanged:** ETA/countdown formula (still the pre-existing `duration × position / counters` approximation — Checkpoint 4), multi-service, repeat-visit policy, cancellation, OTP, force-update, and the email-verification work from Checkpoint 2.

---

## ADR-026: Real multi-counter ETA engine, staff duration override, +2min auto-extension, mobile live countdown (V2 Checkpoint 4, 2026-08-26)

**Status:** Implemented, tested, committed.

**Decision:** Replace the pre-existing `ceil(currentTokenDuration × position / activeCounters)` approximation with a real multi-server FCFS scheduling simulation, add a staff-facing duration override for the currently-served customer with a default +2-minute auto-extension when unattended, and give the mobile app a true server-anchored live countdown instead of a static minutes label. Treated as one coherent queue-time engine (per the explicit product direction), not three separate patches — every piece routes through the same new `queueEtaEngine.ts` module and the same `Token.requiredDurationMinutes` field.

**Why the old formula was actually wrong, not just imprecise:** it used the *querying* token's own duration multiplied by its position as a stand-in for the combined duration of everyone ahead of it. This produced two concrete failure modes: (1) with 2 free counters and three 10-minute jobs, it reported 5/10/15 minutes instead of the correct 0/0/10 (the first two people should be called immediately — a free counter is a free counter); (2) it never accounted for what a specific counter was *actually* serving right now, so an already-90%-done 5-minute service and a just-started 45-minute service produced identical estimates for whoever's behind them. A `token.position.test.ts` test that hardcoded the old formula's exact outputs was rewritten in this checkpoint to reflect the corrected numbers, with the divergence documented inline.

**The new model — `backend/src/services/queueEtaEngine.ts` (pure, DB-free, independently unit-tested):**
- `simulateWaitingTokenEtas(counters, waitingTokens)`: a standard "N identical machines, FCFS, known per-job durations" simulation — each WAITING token (already in strict sequence order) is assigned to whichever counter frees up soonest; that counter's free time then advances by the assigned token's own duration before the next token is considered. This is the literal mathematical answer to "counters provide parallel capacity but never change order," not a heuristic approximating it.
- `computeEffectiveDurationMinutes(requiredDurationMinutes, serviceDurationMinutes)`: the override, when set, is authoritative; otherwise the service's own configured duration applies — one function, reused everywhere duration is needed.
- `computeEffectiveEndTime(anchor, durationMinutes, now)`: the default +2-minute auto-extension (`DEFAULT_SERVICE_EXTENSION_MINUTES`, a named constant per the standing "prefer a named constant over a magic number" rule). Computed fresh on every call from `anchor + duration` versus `now` — nothing is persisted or "expires" in storage; if the base end time has already passed, the result rolls forward in fixed 2-minute increments until it's back in the future. This applies uniformly whether the current duration is the service default or a staff override — an override that itself later runs out gets the same rolling extension, not a one-time special case.

**Schema:** one new nullable column, `Token.requiredDurationMinutes` (migration `20260826102358_add_token_required_duration_override`, purely additive). Only ever set while a token is CALLED/IN_PROGRESS ("an active customer," per the product requirement) via the new `setRequiredDuration` service function — never touched by WAITING or terminal tokens, and not a state-machine transition (status is untouched), so it doesn't go through `assertValidTransition`.

**Anchor choice for an in-service token's occupancy:** `startedAt ?? calledAt ?? now`. IN_PROGRESS anchors from when service actually began; a CALLED-but-not-yet-started token anchors from `calledAt` as the best available approximation of "about to start" — a documented, smallest-reasonable decision, not left implicit.

**New endpoint:** `PATCH /api/tokens/:tokenId/duration` (`operate_tokens`, same auth/verification stack as every other token-operation route) — rejects `409 TOKEN_NOT_ACTIVE` for WAITING/terminal tokens. Not a lifecycle event: no `token.*` broadcast, just the new `broadcastQueueEtaUpdate`.

**Realtime broadcast, broadened (this is the "everyone behind that customer must be recalculated" requirement):** the old `broadcastAffectedPositions(queueId, removedSequenceNumber)` only recomputed tokens whose *position* shifted — correct under the old single-number-per-token model, but no longer sufficient once every WAITING token's ETA depends on the state of *every* active counter. Renamed to `broadcastQueueEtaUpdate(queueId)`, it now unconditionally recomputes and emits to the whole waiting set, called from every mutation that can affect counter occupancy: `call`, `start` (the anchor can shift from `calledAt` to `startedAt`), `complete` (frees a counter), `skip` (frees a counter if skipped from CALLED/IN_PROGRESS — previously this call was skipped entirely for that case, a real gap the old position-only model masked), `recall` (occupies a counter — previously skipped entirely for the same reason), and the new `setRequiredDuration`. Two pre-existing tests asserted the *old*, now-incorrect behavior (a CALLED→SKIPPED transition producing no broadcast) and were updated to assert the corrected one, with the reasoning documented inline at each site.

**Mobile countdown (Rule F):** `estimatedReadyAt` flows through the customer/staff token views, the lightweight `/status` snapshot, and the `token.position_changed` socket payload — the same one server-computed value everywhere. `LiveTrackingScreen` gained `_CountdownRow`, a small `StatefulWidget` whose own `Timer.periodic(1s)` exists solely to repaint — it never fetches anything or computes its own estimate, only the remaining `Duration` between `DateTime.now()` and the `estimatedReadyAt` it was last given. Re-anchoring happens automatically: a fresh value from a REST resync or a `position_changed` event flows into `TokenTrackingProvider`'s state, which becomes a new `estimatedReadyAt` prop on rebuild, with no special "re-anchor" code path needed.

**Dashboard:** `TokenActions.tsx` gained "Adjust Time" for CALLED/IN_PROGRESS rows — a small reveal-and-submit minutes input calling the new endpoint, mirroring the existing counter-picker reveal pattern already used for Call/Recall.

**Test scope:** `queueEtaEngine.test.ts` (12 pure unit tests — the simulation algorithm, the extension rollover, effective-duration precedence — no database needed); `token.duration.test.ts` (7 integration tests — the new endpoint's status guard, tenant isolation, validation, and one end-to-end proof that an override actually shifts a downstream WAITING token's ETA); two pre-existing test files (`token.position.test.ts`, `reminderDispatch.test.ts`, `realtime.position.test.ts`) updated where they encoded the old formula's specific numbers or the old narrower broadcast scope, each with the reasoning for the change documented inline rather than silently edited. Mobile: 2 new model tests, 1 rewritten screen test (asserting the countdown's mm:ss shape rather than a static string, since real time elapses during a widget test) plus 1 new "Not available" fallback test. Dashboard: 3 new component tests for the Adjust Time UI.

**Verification:** backend `typecheck`/`lint` clean, `npm test` — 53 files / 486 tests passing (19 new across `queueEtaEngine.test.ts` and `token.duration.test.ts`, 3 pre-existing test files updated for corrected behavior, zero unexplained regressions). Mobile `flutter analyze` clean (same 19 pre-existing info-level style hints), `flutter test` — 105/105 passing. Dashboard `tsc -b`/`oxlint`/`npm run build` clean, `npx vitest run` — 15 files / 75 tests passing. Local migration applied and verified via `prisma migrate status`; production applies it via Render's Pre-Deploy Command, never from this machine.

**Explicitly out of scope, unchanged:** multi-service selection (the simulation's `WaitingTokenInput.durationMinutes` parameter is deliberately generic so a future checkpoint can pass a summed multi-service total without touching the algorithm itself), repeat-visit policy, cancellation, OTP, force-update.

---

## ADR-027: Multi-service token selection, backward-compatible (V2 Checkpoint 5, 2026-09-02)

**Status:** Implemented, tested, committed.

**Decision:** A customer may select more than one service when joining a queue. The backend computes and stores the total from `QueueService.durationMinutes` rows — never a client-supplied number — and the same Checkpoint 4 ETA engine consumes that total exactly as it already consumed a single service's duration, with no change to the scheduling algorithm itself.

**Checkpoint 4 verification, done first per instruction:** the +2-minute rolling auto-extension was re-traced by hand against the exact example given (10-minute service: 10→12→14→16 as it stays active past each boundary; a staff override to 18: 18→20→22) and against `computeEffectiveEndTime`'s existing formula (`baseEnd = anchor + duration`; once `now >= baseEnd`, roll forward in fixed `DEFAULT_SERVICE_EXTENSION_MINUTES` increments — `Math.floor(overdue / extension) + 1` increments past `baseEnd`). Both match exactly, and the existing unit tests (`queueEtaEngine.test.ts`) already pin this behavior. **No change was made** — per the explicit instruction, an already-correct engine is left alone.

**Data model — additive only, nothing dropped:**
- New `TokenService` join table: `(tokenId, serviceId)` composite primary key (the natural unique constraint — no surrogate id needed for a pure junction table), `onDelete: Restrict` on the service relation, mirroring `Token.serviceId`'s existing protection exactly.
- **`Token.serviceId` is kept, not dropped or made nullable.** Every token — old or new — still has a valid, directly-readable `serviceId`: the legacy column continues to be written on every insert (the first service in the customer's selection), so any code path that still reads it directly — including an old, not-yet-updated mobile client parsing a token response — keeps working unmodified.
- **Migration** (`20260902135206_add_token_service_join_table`): `CREATE TABLE token_services` + one hand-added backfill statement, `INSERT INTO token_services (token_id, service_id, created_at) SELECT id, service_id, created_at FROM tokens` — every existing token gets exactly one join row from its own existing `serviceId`, in the same migration, no separate follow-up step required. Verified against a simulated pre-migration row (inserted directly via raw SQL, bypassing the application layer, with no `token_services` row — exactly the shape of a real pre-migration production token) before this migration was committed: the backfill statement produced exactly one correct join row, and `Token.serviceId` remained independently readable throughout. `prisma migrate status` clean after applying.

**Backward compatibility — the actual constraint this checkpoint had to solve:** an already-installed V1 mobile app sends `{serviceId: "..."}` on token creation and expects every token response to include a top-level `serviceId` string. Both are preserved:
- `createTokenSchema` accepts *either* `serviceId` (legacy) *or* `serviceIds` (new array), never both, never neither (a Zod `.refine`), then canonicalizes whichever was sent into one internal shape (`serviceIds: string[]`) via `.transform()` before the service layer ever sees the request — nothing downstream needs to know two request shapes exist.
- Every token view (`toCustomerView`, `toStaffView`, and therefore every REST response and every realtime payload that reuses them) still returns the legacy `serviceId` *and* a new, additive `services: [{id, name, durationMinutes}]` array. An old client ignores the new field; a new client reads `services`.
- This is the "prefer a backward-compatible transition" path from the instructions, not the "stop and require Force Update first" path — the dual-accept-and-canonicalize approach fully closes the compatibility gap without needing version-gating to ship first.

**Validation (`createToken`):** `serviceIds` — minimum 1, no duplicates (rejected at the schema level, `422`, not silently deduplicated — a clearer contract than guessing customer intent). Every id must belong to the given queue and be active, checked as a set: `services.length !== serviceIds.length` catches both "doesn't exist" and "belongs to another queue" in one comparison (the same 404 `SERVICE_NOT_FOUND` semantics as the old single-service check); any inactive match is `409 SERVICE_NOT_ACTIVE`. The `TokenService` rows are created atomically with the token itself, in the same `prisma.token.create({ data: { ..., tokenServices: { create: [...] } } })` call, inside the existing queue-row-locked transaction — no separate write, no window where a token could exist without its service rows.

**Idempotency:** the same key now resolves to the existing token only when the *set* of requested services matches — order-independent (`[A,B]` ≡ `[B,A]`) but set-exact (`[A,B]` ≠ `[A,C]`), implemented by sorting both the stored `TokenService` rows and the incoming request before comparing, inside `assertIdempotentPayloadMatches`. Never weakened from the pre-existing single-service check — a stricter, not looser, comparison than before (a duplicate-key request can no longer accidentally match on service *count* alone).

**ETA integration:** `computeQueueEtas`'s duration source changed from `token.service.durationMinutes` (singular relation) to a new `sumServiceDurations(tokenServices)` helper, applied identically to both a WAITING token's own duration and a CALLED/IN_PROGRESS occupying token's base duration. `computeEffectiveDurationMinutes`'s existing either/or logic (`requiredDurationMinutes ?? serviceDurationMinutes`) is untouched — a staff override still fully *replaces* the summed duration, never adds to it, exactly preserving the Checkpoint 4 priority rule.

**Service deletion — inspected, confirmed unaffected:** `deleteService` was already a hard `prisma.queueService.delete`, already blocked by `Token.serviceId`'s pre-existing `onDelete: Restrict` for any service referenced by history. The new `TokenService.serviceId` relation uses the identical `onDelete: Restrict`, so a service referenced via *either* relation remains equally undeletable — the protection is not weakened, and no new gap is introduced. (A pre-existing, unrelated gap was noted in passing: `errorHandler.ts` has no specific handling for a Postgres FK-violation error code, so a delete attempt against a referenced service would currently surface as a generic `500` rather than a clean `409` — this predates this checkpoint, was never exercised by any existing test, and is out of scope here per "do not perform unrelated refactoring.")

**Forward compatibility for the repeat-visit checkpoint:** `serviceIds` has no upper bound enforced anywhere in this checkpoint — a future `Queue.multiServiceAllowed` flag can reject `serviceIds.length > 1` entirely inside the existing validation step, with no further Token schema change needed.

**Mobile:** `ServiceSelectionScreen` changed from single-tap `ListTile` navigation to `CheckboxListTile` + a running "Estimated service time: N minutes" total (UX only — the backend recalculates authoritatively) + a `Next` button disabled until at least one service is selected. `QueueJoinProvider.selectedServiceIds` (a `Set<String>`) replaced the old singular `selectedService`; `selectedServices`/`selectedTotalDurationMinutes` are derived getters, never a second source of truth. `TokenApiService`/`TokenRepository.createToken` always send the new `serviceIds` array — the backend's own dual-accept is what protects an *old, already-installed* build, not this updated source. `HistoryEntry` (on-device only, never synced) gained an additive `additionalServiceNames: List<String>` field defaulting to `[]` when absent from already-stored JSON, so every history entry recorded before this checkpoint keeps parsing unchanged.

**Dashboard:** the live-queue-table and Blocked-Devices customer-context responses changed their own singular `service: {id, name}` to a plural `services: [...]` — a safe, non-backward-compat-constrained change, since the dashboard is a freshly-served SPA with no old-install concern (unlike the mobile app). `DashboardPage.tsx` renders a compact "Passport Renewal +2 more" summary with the full list in a hover tooltip.

**Test scope:** `token.multiService.test.ts` (10 backend integration tests — two valid services + summed duration proven through a real ETA read, cross-queue rejection, duplicate rejection, inactive-service rejection, idempotency both directions, legacy single-`serviceId` compatibility, missing/both-fields rejection, and a simulated-pre-migration-row read-path proof); one pre-existing test (`dashboard.test.ts`) updated for the intentional `service`→`services` shape change on that specific non-backward-compat-constrained endpoint. Mobile: 1 new provider test (multi-select accumulation, toggle-off, and the actual submitted `serviceIds` array), 2 new widget tests for the checkbox screen (an interaction test, not a screenshot test), 2 existing test files mechanically updated for the new method/parameter names.

**Verification:** backend `typecheck`/`lint` clean, `npm test` — 54 files / 496 tests passing (10 new, zero unexplained regressions). Mobile `flutter analyze` clean (same 19 pre-existing info-level hints), `flutter test` — 108/108 passing (3 new). Dashboard `tsc -b`/`oxlint`/`npm run build` clean, `npx vitest run` — 15 files / 75 tests passing (unchanged — no dashboard test asserted the old shape). Migration applied and independently verified against a realistic simulated-legacy-row scenario on the local dev database only; production applies it via Render's Pre-Deploy Command, never from this machine.

**Explicitly out of scope, unchanged:** the single-visit/repeat-visit queue policy and its `multiServiceAllowed` restriction (Checkpoint 6, designed for without being built), customer cancellation, anti-bias OTP, force-update.

---

## ADR-028: Queue repeat-visit and multi-service-restriction policy (V2 Checkpoint 6, 2026-09-02)

**Status:** Implemented, tested, committed.

**Decision:** Two new independent, queue-level boolean settings, both defaulting to `true` so every existing production queue keeps today's behavior unchanged: `allowRepeatVisits` (a device may create at most one queue visit that reaches `COMPLETED`, when `false`) and `allowMultipleServices` (a token may select at most one service, when `false` — the exact inverse-default of Checkpoint 5's new capability).

**Repeat-visit rule, precisely:** scoped by `(deviceId, queueId)` only — the same scope as the pre-existing active-token guard, never a client-supplied `organizationId` (queueId already determines tenant). Only a `COMPLETED` token counts as "consumed a visit." `SKIPPED` deliberately does **not** count: a device whose only token in this queue was skipped has never actually been served, and must remain free to (re)join. This is checked as a **second, independent** rule from the existing "one active token per device per queue" guard (`WAITING`/`CALLED`/`IN_PROGRESS` → `409 DEVICE_ALREADY_IN_QUEUE`) — the two are not merged: an active token always blocks via the pre-existing rule regardless of `allowRepeatVisits`; only once no active token exists does the new `COMPLETED`-lookup rule apply. Recall (`SKIPPED → CALLED`) reuses the same token row — it is not a new visit and is entirely unaffected; only a future `createToken` call is subject to this rule, and only once that recalled token itself eventually reaches `COMPLETED`.

**Identity limitation, stated honestly:** the only identity this rule can key on is the existing device model (ADR-011) — a lightweight, per-installation identifier with no login, no phone/email verification, and no fingerprinting. A customer with two devices, or who reinstalls and gets a new device identifier, is not caught by this rule. This is a known, accepted limitation, not a bug — introducing accounts, phone/email tracking, or device fingerprinting to close it is explicitly out of scope for this checkpoint and was not requested.

**Concurrency — reused the existing lock, no new locking system built:** both the active-token check and the new repeat-visit check now run inside the same `createToken` transaction, under the same `SELECT ... FOR UPDATE` row lock already held on the `queues` table for sequence-number allocation (unchanged from ADR-003/ADR-027). This is sufficient: the repeat-visit check only ever reads an already-committed `COMPLETED` row from an earlier, already-finished transaction — it never races against another `createToken` call concurrently writing that same status, because any token still active for this device (`CALLED`/`IN_PROGRESS`) would already have been caught by the pre-existing active-token check first. `allowRepeatVisits` itself is read off the same locked `queues` row (`QueueLockRow.allowRepeatVisits`), so a concurrent staff edit to the setting can't produce an inconsistent read within one transaction either.

**Multi-service restriction — validated before the lock, not inside it:** `allowMultipleServices` is a static queue-configuration gate, not a resource allocation, so it is checked immediately after the existing per-service existence/active validation (still before the transaction opens) — `!queue.allowMultipleServices && serviceIds.length !== 1` → `409 MULTIPLE_SERVICES_NOT_ALLOWED`. The legacy singular `serviceId` request shape from an old, not-yet-updated mobile client already canonicalizes to a 1-element `serviceIds` array (Checkpoint 5's `.transform()`), so it satisfies this restriction automatically with no client change required. When `true`, Checkpoint 5's multi-service selection and duration-summation behavior is completely unchanged — this checkpoint does not touch `sumServiceDurations`, `computeQueueEtas`, or any other part of the ETA engine.

**Data model — additive only:** `Queue.allowRepeatVisits BOOLEAN NOT NULL DEFAULT true` and `Queue.allowMultipleServices BOOLEAN NOT NULL DEFAULT true` (migration `20260902143447_add_queue_repeat_visit_and_multi_service_policy`). Verified with a standalone script simulating a pre-migration-style row (inserted via raw SQL, specifying neither new column) confirming it reads back `true`/`true`; `prisma migrate status` clean after applying to the local dev database only — production applies it via Render's Pre-Deploy Command, never from this machine.

**API surface:** both fields are additive on the existing `POST /api/queues` and `PUT /api/queues/:queueId` bodies (Zod defaults matching the DB defaults) — no new endpoints. The public, unauthenticated queue-config endpoint (`GET /api/public/queues/:queueId/config`) now also returns `allowMultipleServices`, so mobile can render the correct picker before the customer submits anything. `allowRepeatVisits` is deliberately **not** exposed there: a queue-wide setting can't tell one particular device whether *it* personally already holds a `COMPLETED` token in this queue, so there is no actionable pre-join UX for it — the `409 REPEAT_VISIT_NOT_ALLOWED` at token-creation time is the only point that actually knows, exactly mirroring how `DEVICE_ALREADY_IN_QUEUE` has always worked.

**Mobile:** `QueueConfig.allowMultipleServices` (default `true` if absent, for forward/backward JSON compatibility). `QueueJoinProvider.toggleService` now branches on it: unchanged additive-toggle `Set` behavior when `true`; when `false`, selecting a service replaces the whole selection (radio behavior) instead of adding to it. `ServiceSelectionScreen` renders the existing `CheckboxListTile` list unchanged when `true`; when `false`, the same list is wrapped in a `RadioGroup<String>` (the codebase's existing convention for single-select lists, per `dynamic_form_field_widget.dart` and `notification_settings_screen.dart` — not the deprecated per-tile `groupValue`/`onChanged` API) rendering `RadioListTile`s instead. The backend remains the actual enforcement point regardless of which widget renders.

**Dashboard:** two checkbox toggles, both defaulting to checked, added to both the queue create modal (`QueuesPage.tsx`) and the queue edit form (`QueueDetailsPage.tsx`), each with the exact helper text specified: "Customers can join this queue again after completing service." / "Customers can select more than one service when joining." No other change to either form.

**Checkpoint 5 follow-up fix — service-delete conflict:** `deleteService` previously called `prisma.queueService.delete()` directly with no pre-check; a service referenced by historical `Token.serviceId`/`TokenService` rows is protected at the database level by `onDelete: Restrict` (unchanged, not weakened), but Postgres's native `RESTRICT` action raises `SQLSTATE 23001`, which Prisma does not map to a known `P2xxx` code — it surfaced as an opaque `PrismaClientUnknownRequestError`, falling through to a generic `500`. Fixed with an explicit pre-check (`prisma.token.count` + `prisma.tokenService.count` for the service id, run before attempting the delete) rather than parsing that error's message — deliberately avoids depending on Prisma's undocumented wrapping of a Postgres error code that isn't one of its own known codes. Returns `409 SERVICE_IN_USE` with the token history left completely intact; no cascade, no soft-delete mechanism introduced.

**Test scope:** `token.repeatVisitAndMultiServicePolicy.test.ts` (11 backend integration tests: default-queue repeat allowed, `allowRepeatVisits=false` blocks after `COMPLETED`, `SKIPPED`-only does not block, a different device is unaffected, the same device may join a different queue, the pre-existing active-token rule still independently applies first, concurrent join attempts against an already-`COMPLETED` device both correctly rejected, existing-row migration-default verification, `allowMultipleServices=false` rejects >1 service ids and accepts exactly 1 via both request shapes, `allowMultipleServices=true` explicitly preserves Checkpoint 5 behavior); one test added to `service.test.ts` for the delete-conflict fix (`409 SERVICE_IN_USE`, history preserved).

**Verification:** backend `tsc --noEmit`/`eslint`/`npm test` — 55 files / 509 tests passing (12 new, zero regressions). Dashboard `tsc -b`/`oxlint`/`npx vitest run`/`npm run build` clean — 15 files / 75 tests passing (one existing test fixture updated for the two new required `Queue` fields). Mobile `flutter analyze` clean (same 19 pre-existing info-level hints, zero new deprecation warnings after switching to `RadioGroup`), relevant `flutter test` files (service-selection screen, join provider, widget smoke test) passing. Migration applied and verified against a simulated pre-migration row on the local dev database only.

**Explicitly out of scope, unchanged:** customer cancellation, anti-bias OTP, force-update, and any later checkpoint — per the checkpoint's own explicit instruction to stop here.

---

## ADR-029: Customer cancellation + OTP-gated service start (V2 Checkpoint 7, 2026-09-02)

**Status:** Implemented, tested, committed.

**Decision:** Two tightly related additions. (1) A customer may cancel their own token while it is `WAITING` or `CALLED` — a new `CANCELLED` status, distinct from staff-initiated `SKIPPED`. (2) Staff can no longer transition `CALLED → IN_PROGRESS` by clicking a button alone — the backend now requires a short-lived, server-verified code that only the owning customer can read, told verbally to staff. Both are backend-enforced regardless of what either UI shows.

**CANCELLED semantics:** Added to `TokenStatus` (`ALTER TYPE ... ADD VALUE`, purely additive — no existing value reinterpreted). Reachable only from `WAITING`/`CALLED`; terminal; **not** recallable (unlike `SKIPPED`, which recalls back to `CALLED` — cancellation is deliberate abandonment, not an interruption). `Token.cancelledAt` is its own timestamp column, never overloaded onto `skippedAt` — historical reporting can distinguish "staff skipped this customer" from "this customer left on their own." The device-side active-token partial unique index (`tokens_device_queue_active_key`, `WHERE status IN ('WAITING','CALLED','IN_PROGRESS')`) already excludes `CANCELLED` with no migration needed — cancelling immediately frees the device+queue slot, exactly like `SKIPPED` already does. The repeat-visit rule from ADR-028 is unchanged: only `COMPLETED` consumes the `allowRepeatVisits=false` allowance — `CANCELLED`, like `SKIPPED`, does not, so a customer may always rejoin after cancelling.

**Cancellation ownership:** reuses the exact model the pre-existing notification-preferences customer write already established (ADR-011/Phase 7 Step 7) — there is no device authentication in this codebase, so `POST /api/tokens/:tokenId/cancel` takes a self-asserted `deviceIdentifier` in the body, resolves it to a `Device`, and requires `token.deviceId === device.id`. A mismatch is `404 TOKEN_NOT_FOUND` (never `403`), matching this codebase's standing convention of never confirming a resource's existence across an ownership boundary the caller isn't inside.

**Cancellation concurrency:** the same compare-and-swap (`updateMany` conditioned on the status just read) pattern already used by every other transition in `token.service.ts` — no new locking mechanism. A concurrent cancel-vs-valid-OTP-start race resolves to exactly one winner because both paths key their final `UPDATE` on the current status: whichever commits first changes the row's status, and Postgres re-evaluates the loser's `WHERE` clause against the post-commit row, yielding zero matched rows (`409 TOKEN_STATE_CHANGED`) rather than a split-brain double-success. This was verified with a standalone service-level probe script (bypassing HTTP) before trusting it in tests, then confirmed again through the HTTP layer.

**OTP purpose and generation:** `callToken` — shared by both `/call` and Recall — now mints a fresh 6-digit code (`crypto.randomInt`, never `Math.random()`, never derived from the token id/serial/device id/timestamp/queue number) every time a token enters `CALLED`, storing only a derived value. This means Recall always issues a brand-new code (checkpoint requirement), with zero special-casing needed since Recall already shares this exact function.

**OTP storage — reversible, keyed encryption, not a one-way hash:** the checkpoint's own suggested design (a keyed HMAC) was evaluated and rejected for a specific reason: a 6-digit code has too little entropy for a bare hash to meaningfully resist offline brute force, so *some* keyed design is required — but the checkpoint separately requires the *owning customer* to be able to re-read the same still-valid code on a later poll (app restart, screen revisit) without the backend minting a new one on every `GET` (explicitly prohibited: "do not create unlimited codes on every GET"). A one-way hash can verify a guess but can never answer "what was the code" — those two requirements are incompatible with hashing. `utils/otp.ts` instead uses AES-256-GCM authenticated encryption, keyed by `OTP_SECRET` (SHA-256-derived into a 32-byte key, so the env var only needs to meet the same length convention as `JWT_SECRET`, not be exactly 32 raw bytes) with the token id bound in as additional authenticated data — so one token's stored value can never be replayed against another's row, and any tampering is caught by the GCM auth tag rather than silently decrypting to garbage. `OTP_SECRET` is a separate secret from `JWT_SECRET` (never reused — a rotated JWT key must never affect in-flight OTPs and vice versa), required at startup via the same Zod min-length pattern, documented in `.env.example` with no real value, never logged.

**OTP expiry, single-use, and reissue:** 5-minute expiry (`OTP_EXPIRY_MINUTES`), checked server-side on every verification and every customer read. Single-use by construction: the winning `CALLED → IN_PROGRESS` transition and the OTP invalidation (`serviceStartOtpCipher/ExpiresAt` cleared) happen in the same conditional `UPDATE`, so a replay of the same code can never succeed twice — the second attempt fails the state-machine check (token is no longer `CALLED`), not a "wrong code" check. Reissue (`POST .../verification-code/reissue`) is the smallest safe renewal path: customer-triggered only, never automatic, unconditionally overwrites whatever code existed (never merges), resets the failed-attempt counter, rate-limited the same way the pre-existing notification-preferences write is (`publicRateLimiter`).

**Brute-force protection, two layers per the checkpoint's own instruction:** (1) a per-token failed-attempt counter (`serviceStartOtpFailedAttempts`), capped at `OTP_MAX_FAILED_ATTEMPTS = 5` — reaching the cap invalidates the current code (clears the cipher, forcing a reissue) rather than locking the token or device permanently; (2) `sensitiveRateLimiter` added to the `/start` route itself, since shared-network staff traffic makes a pure per-token counter alone insufficient defense-in-depth. Verification uses `crypto.timingSafeEqual` on the decrypted candidate, not a variable-time string compare. A wrong code never reveals which digits were correct — one generic `422 INVALID_VERIFICATION_CODE` regardless.

**Staff start flow:** `POST /:tokenId/start`'s body changed from empty to `{ verificationCode }` (Zod: exactly 6 digits) — this is now the **only** code path in the entire backend capable of producing an `IN_PROGRESS` token; the old bare `startToken` export was deleted, not left as a parallel bypass. Confirmed by a full repository search (documented below) before considering this checkpoint complete. The dashboard's Start button now reveals a small inline code-input form (mirroring the existing Adjust-Time/Recall inline-form pattern already used elsewhere in `TokenActions.tsx`) instead of firing immediately; a wrong code shows the backend's error and leaves the form open for a retry.

**Customer OTP delivery — a new dedicated endpoint, deliberately not folded into the existing tracking response:** `getTokenCustomerView`/`toCustomerView` is reused directly by the Socket.io token-room payload (`realtime/emit.ts`'s `emitTokenLifecycleEvent`), which must never carry the OTP. Rather than risk that shared function ever gaining an OTP field (a future edit reusing it would silently leak into every socket payload), the code is served exclusively through two new, fully separate, ownership-checked endpoints: `GET /:tokenId/verification-code?deviceIdentifier=...` (never mints, just reads the current one) and `POST /:tokenId/verification-code/reissue`. Both 404 on a device/token ownership mismatch, matching the cancellation endpoint's convention exactly.

**OTP field leak prevention — centralized, not per-call-site:** every function in `token.service.ts` that returns a raw `Token` row (`callToken`, the shared `transitionToken` helper, the new `cancelToken`/`startTokenWithOtp`, `setRequiredDuration`, and `toStaffView`) routes its return through a new `omitOtpFields` helper that strips `serviceStartOtpCipher`/`serviceStartOtpExpiresAt`/`serviceStartOtpFailedAttempts` before the value leaves the function — chosen over patching each call site individually specifically because several of these staff-facing functions (`callToken`, `transitionToken`) return the raw Prisma object via an object spread (`{...token, ...}`), which would otherwise silently re-leak the new columns the moment they were added to the schema. `toCustomerView` was already safe by construction (an explicit field whitelist, never a spread) and needed no change — confirming the codebase's existing convention of explicit customer-view fields over spreads was the right call.

**Security review performed before considering this done (checkpoint's own requirement):** grepped the entire backend for every write of `IN_PROGRESS`/`startedAt` — found exactly one write site (`startTokenWithOtp`), matching `assertValidTransition`'s own transition table (only `CALLED → IN_PROGRESS` is legal, only checked once). Grepped for `serviceStartOtp`/`otp` across all of `src/` — found matches only in the files that are meant to own it (`utils/otp.ts`, `token.service.ts`, the token routes/controller/validators, `realtime/emit.ts`'s doc comment, `config/env.ts`). Manually re-read `dashboard.service.ts`'s live-queue-table query (which does fetch the full `Token` row via `include`, no `select`) and confirmed its response is built from an explicit field whitelist, not a spread, so the fetched-but-unlisted OTP columns never reach the response. `report.service.ts` uses only `groupBy`/`count` — no raw token rows ever serialized. Audit metadata never receives OTP data (no call site passes it); mobile's on-device history storage (`recordStatusUpdate`) only ever receives `tokenId`/`status`, never the code.

**Concurrency/FCFS/ETA (reused, not reimplemented):** cancelling a `WAITING` token removes it from the FCFS ordering exactly the way `SKIPPED` already does — `callToken`'s existing "no earlier WAITING token" check naturally observes the new status with no code change. Cancelling a `CALLED` token frees its counter exactly the way `SKIPPED` already does — `computeQueueEtas`'s counter-occupancy query already only looks at `CALLED`/`IN_PROGRESS`, so `CANCELLED` falls out automatically. `broadcastQueueEtaUpdate` is called from the new `cancel` controller action exactly like every other lifecycle action. None of Checkpoint 4/5's ETA engine, staff-duration-override, or multi-service-summation logic was touched.

**Socket.io/FCM:** a new `token.cancelled` event (`realtime/emit.ts::emitTokenCancelled`), mirroring every existing lifecycle emitter's staff-full/customer-safe split exactly — both shapes already guaranteed OTP-free by the `omitOtpFields`/whitelist work above. FCM's `tokenNotificationDispatch.service.ts` needed no new case: its `buildNotificationText` switch has no `CANCELLED` branch, so cancellation deliberately produces no push (checkpoint instruction: no noisy notification for a customer-initiated action they're already looking at); its existing four cases (`CALLED`/`IN_PROGRESS`/`COMPLETED`/`SKIPPED`) were not touched, and none of them ever referenced an OTP field to begin with.

**Audit:** cancellation has no staff actor (it's a customer action), so no audit row is written for it — `cancelledAt` is the historical record, matching the checkpoint's own instruction not to invent a fake staff actor. The pre-existing, documented gap that `CALLED → IN_PROGRESS` has no approved audit action at all (noted in Phase 7 Step 5) is unchanged — `startTokenWithOtp` is not audited, exactly as `startToken` wasn't before it.

**Migration:** purely additive (`20260902173147_add_token_cancellation_and_service_start_otp`) — one new enum value, four new nullable-or-defaulted `Token` columns. Verified with `prisma migrate status` against the local dev database only; production applies it via Render's Pre-Deploy Command.

**Mobile backward compatibility:** an already-installed V1 client's `parseTokenStatus` already has a safe `default → TokenStatus.unknown` fallback for any string it doesn't recognize — `'CANCELLED'` hits that exact path on an old build, exactly like any other never-seen-before status would, with no crash. The updated mobile source (this checkpoint) adds `TokenStatus.cancelled` properly, a `Leave Queue` action on `WAITING`/`CALLED`, and a `_VerificationCodeSection` shown only while `CALLED` (ticks locally to detect its own expiry, never polls) — `TokenTrackingProvider` fetches the current code once on entering `CALLED` (via the new dedicated endpoint) and clears it on any other transition, matching the "never mint on every read, never poll" constraint.

**Test scope:** `token.cancellationAndServiceStartOtp.test.ts` (15 backend integration tests covering the full enumerated checklist — WAITING/CALLED cancellation, IN_PROGRESS rejection, cross-device rejection, active-slot release + repeat-visit non-consumption, un-recallability, FCFS advancement after cancellation, secure code issuance + non-recoverability from the DB, absence from staff/customer REST bodies, missing/wrong code rejection, single-use replay rejection, expiry, 5-failed-attempt lockout, reissue invalidating the prior code, Recall issuing a fresh code, and the cancel-vs-start concurrency race); one new `it('token.cancelled', ...)` added to the existing `realtime.events.test.ts` event-by-event suite; ~10 pre-existing test files across the whole backend suite mechanically updated for `/start`'s new required body (the shared `startToken`/`cancelTokenRequest` test helpers added to `tests/helpers/app.ts`, following the exact same pattern `createToken` already established). Dashboard: 3 new `TokenActions.test.tsx` cases (code input reveal, correct-args submission, wrong-code error handling). Mobile: `live_queue_token_test.dart` extended for the new status/field, 4 new `live_tracking_screen_test.dart` cases (Leave Queue visibility, code display, expiry prompt, CANCELLED-specific message).

**Verification:** backend `tsc --noEmit`/`eslint`/`npm test` — 56 files / 525 tests passing (16 new, zero regressions). Dashboard `tsc -b`/`oxlint`/`npx vitest run`/`npm run build` clean — 15 files / 78 tests passing (3 new). Mobile `flutter analyze` clean (same 19 pre-existing info-level hints, zero new warnings), `flutter test` — 112/112 passing (14 new). Migration applied and verified on the local dev database only.

**Explicitly out of scope, unchanged:** force-update, and any later checkpoint — per this checkpoint's own explicit instruction to stop here.

**A note on Checkpoint 8 overlap (flagged, not silently resolved):** `docs/IMPLEMENTATION_PLAN.md`'s pre-existing Checkpoint 8 goal reads: *"CALLED → OTP → IN_PROGRESS. A server-generated, short-lived, single-use OTP — visible only inside the customer's own app session, never a public API response, never client-generatable — must be correctly entered by staff before a CALLED token can transition to IN_PROGRESS, protecting against staff silently starting service without customer consent/presence."* That is, functionally, exactly what this checkpoint just built (part B, above) — the two were apparently meant as one feature, described twice under different names ("staff cannot bypass cancellation by starting early" here vs. "anti-bias/customer-presence" there), and this checkpoint's own prompt asked for it explicitly rather than deferring to Checkpoint 8. Rather than silently deleting Checkpoint 8 from the roadmap or assuming they're identical, this is recorded here for explicit confirmation before any future checkpoint touches it — if Checkpoint 8 turns out to want something additionally distinct (e.g. a different trigger condition, a different UI surface), that gap should be identified against what already exists now, not built as if nothing existed yet.

*(Resolved by ADR-030 below — Checkpoint 8 is retired, confirmed as fully covered.)*

---

## ADR-030: Checkpoint 7 security re-inspection + Checkpoint 8 retirement (V2 Checkpoint 7A, 2026-09-03)

**Status:** Implemented, tested, committed. Two genuine defects found and fixed; no schema change.

**Purpose:** A focused, code-level re-inspection of Checkpoint 7's customer authorization model and OTP implementation — re-reading the actual current source rather than trusting the prior checkpoint's own final report — plus the roadmap reconciliation ADR-029 flagged but deliberately left open.

### 1. Customer authorization — Case B confirmed, documented honestly

Searched the entire repository for any stronger existing device credential (device JWT, signed installation token, opaque server-issued credential) before accepting `deviceIdentifier` as sufficient. None exists: `authenticate`/`optionalAuthenticate` are staff-only (organization JWT); the mobile app has no analogous per-device token anywhere. This is **Case B** — `deviceIdentifier` genuinely is the strongest customer identity mechanism currently in this codebase, and building a new device-authentication subsystem is explicitly out of scope for this small checkpoint.

Verified every item required for Case B to be acceptable:
- **High-entropy, non-sequential, on-device generated:** `generateUuidV4()` (`mobile-app/lib/utils/uuid_generator.dart`) uses `Random.secure()` — a cryptographically secure RNG, not a user-chosen or sequential value — to produce a full RFC 4122 UUID v4 (122 bits of randomness), generated on first launch and persisted via `shared_preferences`. Never server-issued, never guessable.
- **Ownership requires both the identifier and the specific token id:** every one of `cancelToken`/`getServiceStartVerificationCode`/`reissueServiceStartVerificationCode` resolves the identifier to a `Device` row, then requires `token.deviceId === device.id` for *that specific* `tokenId` — knowing a deviceIdentifier alone grants nothing without also knowing (or being told) a real token id, and vice versa.
- **A different deviceIdentifier cannot act on the token:** confirmed both by code inspection and by an existing regression test (`token.cancellationAndServiceStartOtp.test.ts` — cross-device cancel rejection).
- **organizationId is never client-trusted:** none of the three new endpoints accept or reference an organizationId from the request at all — tenant scope is irrelevant to a device-owned action (a device's token ownership is checked directly, not through a tenant boundary).
- **Non-enumerating mismatch behavior:** confirmed — `404 TOKEN_NOT_FOUND` on any ownership mismatch, matching the codebase-wide convention, never a `403` that would confirm the token exists.
- **Not exposed through public Socket.io/FCM payloads:** confirmed by re-reading `toCustomerView` (explicit whitelist, no device fields at all) and `tokenNotificationDispatch.service.ts`'s FCM payload (`{type, tokenId, status}` only).
- **Not logged unnecessarily:** see finding 4 below — this one was **not** already true, and is now fixed.

**One exposure this review does NOT change, documented as inherent rather than hidden:** `deviceIdentifier` is intentionally shown to STAFF of an organization a device has actually interacted with, via the pre-existing (Phase 7 / ADR-011) Blocked-Devices dashboard feature (`GET /api/devices`) — staff need it to identify and block abusive devices, a legitimate and unrelated use case that predates Checkpoint 7. This means a staff member of an organization a device has visited could, in principle, read that device's identifier off the dashboard and use it to call the device's own cancel/verification-code endpoints *for tokens within that same organization*. This is a real, inherent consequence of choosing a device-scoped credential that also has a legitimate reason to be staff-visible elsewhere — not a bug introduced by Checkpoint 7, and not something a small follow-up checkpoint should attempt to redesign around. Documented here explicitly rather than left implicit.

**Conclusion, stated exactly as required:** until stronger mobile authentication is introduced, the installation device identifier functions as the customer-side bearer credential for token ownership. It is not cryptographic authentication — it is a high-entropy, on-device-generated, non-guessable secret transmitted over TLS, which is a meaningfully different (weaker) property than a signed, expiring, server-verified credential. **Residual limitation:** if a device's identifier is copied, logged, or otherwise leaked, whoever possesses it can act as that installation for as long as the identifier remains valid — there is no revocation, rotation, or expiry mechanism for it today. This is an architectural limitation of the current mobile identity model (ADR-011), not specific to Checkpoint 7, and is recorded here for future reference rather than treated as resolved.

### 2. OTP encryption-at-rest — re-verified, no defect found

Re-read `utils/otp.ts` fresh (not from memory). Confirmed: a fresh `randomBytes(12)` IV per encryption (the NIST-recommended 96-bit GCM nonce size); `aes-256-gcm` with a SHA-256-derived 32-byte key from `OTP_SECRET`; the auth tag is set via `setAuthTag` before `decipher.final()`, so Node itself throws on any tampering and the surrounding `try/catch` converts that into a uniform `null` — the same "no code" outcome as an expired or never-issued one, leaking no detail about *why* decryption failed; the token id is bound as AAD on both encrypt and decrypt, so one token's stored value can never be replayed against another's row; the stored format (`iv:tag:ciphertext`, hex) contains nothing beyond what's needed. `OTP_SECRET` is Zod-validated at startup (`min(32)`, matching `JWT_SECRET`'s own convention), confirmed present only in the gitignored `.env` (96 hex characters locally) and as an empty placeholder in the committed `.env.example`, and is never passed to the logger anywhere in the codebase. No defect — the reversible-encryption design from ADR-029 remains the correct choice given the redisplay requirement, and was not changed.

### 3. OTP exposure search — one real gap found and fixed (logging)

Repository-wide, case-insensitive search for `serviceStartOtp`, `verificationCode`, `OtpCipher`, and `OTP_SECRET` outside test directories returned matches only in the files that legitimately own this feature (backend service/routes/controller/validators/utils/env/realtime-emit doc comment; mobile model/provider/repository/screen/api-service; dashboard api/component/hook) — no match in `dashboard.service.ts`, `report.service.ts`, `audit.service.ts`, `socketEvents.ts`, or any other serializer. `dashboard.service.ts`'s live-queue-table query was re-confirmed to still build its response from an explicit field whitelist (never a spread), so the extra columns its underlying Prisma query fetches (via `include`, no `select`) never reach the response.

**Finding — the one real gap:** `pino-http`'s default request logging includes `req.query` (confirmed directly from a live `request completed` log line: `"query":{}` is present, `"body"` is not). `GET /api/tokens/:tokenId/verification-code` sends `deviceIdentifier` — the customer's bearer credential — as a query parameter, which means it was appearing in plain INFO-level production request logs on every legitimate call to that endpoint, with no existing pino redact path covering `req.query.*`. **Fixed:** added `req.query.deviceIdentifier` (and, defensively, `req.body.deviceIdentifier`, in case a future logger reconfiguration ever starts serializing bodies) to `config/logger.ts`'s existing redact-paths list — the same mechanism already protecting passwords and tokens, extended by two entries. No endpoint behavior changed; this is a logging-only fix.

### 4. Start-bypass search — re-confirmed, no defect

Re-ran the exact search directly against current `git`-tracked source (not memory): `grep` for every `status: 'IN_PROGRESS'` / `startedAt:` write in `src/` found exactly one write site — `token.service.ts`'s `startTokenWithOtp` (the only place both appear together as a write, immediately after OTP verification succeeds). A separate search for a bare `startToken` export (the pre-Checkpoint-7 bypass) found none — it was fully deleted, not left as a parallel path. Every `/:tokenId/start` route registration was confirmed to be the single one in `token.routes.ts`, requiring `startTokenSchema` (a 6-digit `verificationCode` body field) and routed to `startTokenWithOtp`. No bypass.

### 5. Cancel-vs-start concurrency — re-confirmed correct, already durably tested

Re-read the exact current Prisma operations in both `cancelToken` and `startTokenWithOtp`: each function's winning transition is a single `prisma.token.updateMany({ where: { id, status: <expected-prior-status> }, data: {...} })` — a plain conditional `UPDATE` Postgres executes atomically per statement under the default READ COMMITTED isolation, re-evaluating the `WHERE` clause against the latest committed row whenever it has to wait for a conflicting writer's lock. Because the two functions' winning conditions are mutually exclusive by construction (both require `status = 'CALLED'`, and either winning write moves status away from `'CALLED'`), at most one of two truly concurrent calls can ever match. `token.cancellationAndServiceStartOtp.test.ts`'s "Test 19" (already committed as part of Checkpoint 7, re-run here and confirmed still passing) already exercises exactly this race via `Promise.all` and asserts the DB row's final status matches whichever side reported success — this durable, automated regression test already existed, so no new one was added for this guarantee (per instruction, only added where genuinely missing).

### 6. Failed-attempt concurrency — a genuine defect found and fixed

Re-reading the exact current code (not the prior report's summary) surfaced a real lost-update race in the wrong-code branch of `startTokenWithOtp`: `serviceStartOtpFailedAttempts` was read once (inside the function's initial `findTokenScoped` call), incremented in JavaScript (`token.serviceStartOtpFailedAttempts + 1`), and written back as a literal value. Unlike the cancel-vs-start guarantee above, the `WHERE` clause guarding this write (`status = 'CALLED'`) does not itself change as attempts accumulate, so Postgres has nothing to reject a stale write against — two truly concurrent wrong guesses reading the same prior count both compute and write the same "+1" value, silently losing an attempt. **Verified empirically, not just by inspection:** a targeted before/after test (five wrong guesses fired via `Promise.all`) showed the counter reaching only **1** on the unfixed code despite five genuinely distinct wrong attempts — meaning the intended 5-attempt brute-force cap could be defeated by concurrency, letting an attacker submit far more than 5 real guesses before the recorded count ever reached the lockout threshold.

**Fix:** replaced the JS-computed literal with Prisma's atomic `{ increment: 1 }` operator, pushing the read-modify-write into a single server-side SQL statement (`UPDATE ... SET service_start_otp_failed_attempts = service_start_otp_failed_attempts + 1 WHERE ...`) that Postgres itself serializes correctly under concurrent callers — N truly concurrent wrong guesses now always produce exactly N increments. Whether the *now-accurate* count has crossed the lockout threshold is checked with a follow-up read immediately after the atomic increment, and only then does a second `updateMany` clear the cipher/expiry — a narrow window remains where a handful of concurrent requests arriving in the exact same instant the threshold is first crossed could all pass that check before the cipher is cleared, but this is a fundamentally smaller, bounded-by-request-fan-out exposure, not the original unbounded collapse. No new locking mechanism, no Redis — the smallest Postgres/Prisma-safe technique available. Re-verified with the same before/after test, now passing (count `>= 5`, cipher cleared, a subsequent correct-code attempt correctly rejected).

**One focused regression test added** (`token.cancellationAndServiceStartOtp.test.ts`, "Test 21 (Checkpoint 7A)"): fires 5 wrong-code attempts concurrently via `Promise.all`, asserts the persisted failed-attempt count is `>= 5` and the code is invalidated. Confirmed this test fails against the pre-fix code (count landed at 1) and passes against the fix, before committing either.

### 7. Reissue and cancellation security — re-confirmed, no defects

Reissue (`reissueServiceStartVerificationCode`): ownership-checked identically to the getter; requires `status === 'CALLED'` (`409 TOKEN_NOT_CALLED` otherwise — so `CANCELLED`/`SKIPPED`/`IN_PROGRESS`/`COMPLETED` tokens cannot reissue); unconditionally overwrites the prior cipher/expiry/attempts (never merges, so the old code becomes unusable immediately); rate-limited via `publicRateLimiter` at the route level; a plain `GET` never mints anything (only `getServiceStartVerificationCode`, which has no write path at all). Staff have no endpoint that can trigger a reissue — the route accepts no staff auth and requires the device's own identifier, so staff "manipulating" a customer via reissue is not a reachable path; at most a reissue simply gives the customer app a new code only that customer's device can read, which is not useful leverage against them.

Cancellation (`cancelToken`): re-confirmed every listed invariant directly from the current code and the already-committed test suite — `WAITING`/`CALLED` cancellable, `IN_PROGRESS`/`COMPLETED`/`SKIPPED`/already-`CANCELLED` all rejected via the shared `assertValidTransition` (`422 INVALID_TOKEN_TRANSITION`, no special-cased message); verification material (`serviceStartOtpCipher`/`ExpiresAt`/`FailedAttempts`) is cleared in the same atomic `UPDATE` that sets `CANCELLED`; no staff audit actor is fabricated (cancellation has no staff actor by definition, matching ADR-029's original decision); the active-token slot is freed as an automatic consequence of the status change (no separate bookkeeping to verify); `CANCELLED` is excluded from `allowRepeatVisits=false`'s `COMPLETED`-only lookup (Checkpoint 6/ADR-028, unchanged). No defects — no code changes made to cancellation itself.

### 8. Checkpoint 8 retirement

Confirmed against the current `IMPLEMENTATION_PLAN.md`/`PROGRESS.md` text and the actual shipped implementation: Checkpoint 8's goal ("CALLED → OTP → IN_PROGRESS... visible only inside the customer's own app session... reuses existing FCM delivery, rate limiting, and auth/tenant infrastructure") is met exactly by Checkpoint 7's part B, re-verified line-by-line in sections 2-6 above. `IMPLEMENTATION_PLAN.md` and `PROGRESS.md` are updated to mark Checkpoint 8 retired ("completed as part of Checkpoint 7"), not silently deleted — its original goal text is preserved for the record. Checkpoint 9 (mobile force-update / minimum-supported-version) is now the next unimplemented checkpoint, marked as such in both documents; **not implemented in this checkpoint**, per its own explicit instruction to stop after reconciliation.

**Migration:** none — no schema change was needed or made.

**Test scope:** one new focused regression test (`Test 21`, concurrent-wrong-attempt atomicity) added to the already-existing `token.cancellationAndServiceStartOtp.test.ts`; no other test files touched. The pre-existing "Test 19" (cancel-vs-start race) was re-run, not re-written, and already durably covers that guarantee.

**Verification:** backend `tsc --noEmit`/`eslint` clean; `npm test` — 56 files / 526 tests passing (1 new, zero regressions). Dashboard and mobile untouched this checkpoint (no code changes in either app), so their suites were not re-run, per the checkpoint's own test-discipline instruction. `prisma migrate status` clean, no new migration.

**Files changed:** `backend/src/services/token.service.ts` (atomic increment fix), `backend/src/config/logger.ts` (redact paths), `backend/tests/token.cancellationAndServiceStartOtp.test.ts` (one new test), `docs/IMPLEMENTATION_PLAN.md`, `docs/PROGRESS.md`, `docs/ARCHITECTURE_DECISIONS.md` (this ADR).

**Explicitly out of scope, unchanged:** force-update implementation (identified as next, not started), any new device-authentication subsystem, any redesign of cancellation or the OTP storage design — both re-confirmed correct as-is.
