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
