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
