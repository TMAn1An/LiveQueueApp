# LiveQueue — Progress

## Current Phase: Phase 5 (Mobile) — Complete and verified

## Status

| Phase | Status |
|---|---|
| Phase 1: Foundation | **Done** — auth, sessions, tenant isolation implemented and tested against a real PostgreSQL database |
| Phase 2: Queue Core | **Done** — Queue/Service/Counter/FormField CRUD, soft deletion, computed QR, tenant isolation, tested against a real PostgreSQL database |
| Phase 3: Token Engine | **Done** — Device/Token models, token creation with atomic sequencing and idempotency, state machine, call/start/complete/skip/next, position/estimated wait, public queue config, tested against a real PostgreSQL database |
| Phase 4: Real Time | **Done** — Socket.io with JWT-verified organization rooms, public queue/token rooms, all 12 spec events, targeted position_changed broadcasting, tested against a real PostgreSQL database and real socket.io-client connections |
| Phase 5: Mobile | **Done** — Flutter customer app: QR scan, queue details, dynamic form, token creation, live tracking, notification preferences, history. No backend changes — pure consumer of the Phase 1-4 API. |
| Phase 6: Dashboard | Not started |
| Phase 7: Production Hardening | Not started |

## What Exists

- `CLAUDE.md`, `docs/LiveQueue_AI_Ready_Specification.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ARCHITECTURE_DECISIONS.md`
- `backend/` — Express + TypeScript + Prisma + PostgreSQL project, fully scaffolded and building
- `mobile-app/` — Flutter customer app, fully scaffolded and building (Android verified via `flutter build apk --debug`)
- `web-dashboard/` — still empty (Phase 6)

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

## What Is Implemented (Phase 3)

- Prisma schema additions: `Device`, `Token` (+ `DeviceStatus`, `TokenStatus` enums) — migrated to `livequeue_dev`, migration `20260822074508_add_token_engine` (purely additive: new tables/enums/indexes/FKs, no changes to Phase 1/2 tables)
- Device registration (`POST /api/devices/register`, idempotent get-or-create), public queue config (`GET /api/public/queues/:queueId/config`, customer-safe only)
- Token creation (`POST /api/tokens`, public/device-based): validates queue existence/archival/`ACTIVE` status, service existence/queue-membership/active status, device-not-blocked, form data against the queue's current `QueueFormField` set — then atomically allocates the sequence number under `SELECT ... FOR UPDATE` on the `Queue` row (ADR-003) and creates the token in the same transaction. Serial numbers are `{tokenPrefix}` + 3-digit zero-padded sequence number, never truncated past 999.
- Idempotency (ADR-004): `Idempotency-Key` header, unique on `(deviceId, idempotencyKey)`. Same key + same payload returns the existing token; same key + different payload returns `409 IDEMPOTENCY_KEY_CONFLICT`; concurrent duplicate requests produce exactly one token with the sequence advancing exactly once (proven under real concurrent load, not asserted).
- Centralized token state machine (`src/utils/tokenStateMachine.ts`): `WAITING → {CALLED, SKIPPED}`, `CALLED → {IN_PROGRESS, SKIPPED}`, `IN_PROGRESS → {COMPLETED, SKIPPED}`, both `COMPLETED`/`SKIPPED` terminal — enforced on every transition endpoint (`/call`, `/start`, `/complete`, `/skip`), never in a controller. Each transition also applies a compare-and-swap `UPDATE` as a concurrency safety net.
- `POST /api/queues/:queueId/next`: staff selects the counter; the backend auto-selects the oldest eligible `WAITING` token using `FOR UPDATE SKIP LOCKED`, so two counters calling `/next` concurrently claim two different tokens without blocking each other.
- Position (count of `WAITING` tokens ahead in the same queue + 1) and estimated wait (`ceil(serviceDuration × position / activeCounters)`, or `null` when zero counters are `ACTIVE` — a deliberate post-review product decision, not a spec requirement, see ADR-016) are computed at read time, never stored.
- Tenant isolation: every staff-facing token/counter lookup is scoped through `organizationId` (token) or the `counter → queue → organizationId` join (reused from Phase 2's `findCounterScoped`, now exported); cross-organization ids 404, never leaking existence.
- Customer-facing responses (`GET /api/tokens/:tokenId` for an anonymous or cross-org caller, `GET /api/tokens/:tokenId/status`) never expose `organizationId`, `deviceId`, `idempotencyKey`, or `formVersion`; staff of the owning organization get the full record via the same endpoint (`optionalAuthenticate` + an in-service view check, not separate routes).
- `Token.formVersion` is a plain integer snapshot of `Queue.formVersion` at creation — proven immutable under a real form-version bump in a dedicated test, not just documented.
- 74 new automated tests across 9 files (creation validation matrix incl. optional-field blank-value handling, idempotency incl. concurrent duplicates, sequence concurrency at 2/10/100 simultaneous requests with DB-level count/min/max/distinct verification plus a real-constraint-violation rollback test, full state-machine coverage, `/next` concurrency incl. two-counters-claim-different-tokens and same-counter-only-one-wins, position/estimated-wait incl. the zero-active-counters null case, tenant isolation, device registration, public config) — all passing against a real PostgreSQL instance, no mocked locks
- Full design record in `docs/ARCHITECTURE_DECISIONS.md` ADR-016, including two post-review refinements: `estimatedWaitMinutes` returns `null` (not a floored numeric estimate) when zero counters are `ACTIVE`, and optional form fields now accept an explicitly-submitted empty string as "no answer," not just an omitted key

## What Is Implemented (Phase 4)

- Socket.io server (`socket.io`) attached to the same `http.Server` as the Express app (`src/server.ts`) — no separate port, no separate process.
- All 12 specification events (§8): `queue.created/updated/status_changed`, `token.created/called/started/completed/skipped/position_changed`, `counter.created/updated/status_changed` — the specification's list, not `IMPLEMENTATION_PLAN.md`'s narrower 8-event list (spec is authoritative where they conflict). No `service.*` events (not in the spec).
- Three rooms exactly as specified: `organization:{id}` (staff-only, JWT-verified via the existing Phase 3 `resolveAuthContext` — no second JWT implementation), `queue:{id}` (public), `token:{id}` (public by UUID possession, matching the Phase 3 REST trust model).
- Room/payload security tiers (closing a customer-PII-leak and staff-data-leak risk identified in the Phase 4 readiness review): organization room gets full staff-authorized payloads for all 12 events; the queue room only ever receives `queue.status_changed` with a minimal public-safe payload (`{id, status}`) — never token or counter detail; each token's own room gets only that token's customer-safe events (never `token.created`, since no one could have joined yet).
- Targeted `token.position_changed`: only waiting tokens behind the one that just left `WAITING` are recomputed and notified, each to its own room — proven with dedicated tests for the affected/unaffected/wrong-transition-type cases.
- Controller-level emission only, always after the HTTP response is already sent; every emit function catches its own errors, so a socket delivery failure can never turn a successful, already-committed REST operation into an HTTP failure.
- No Redis, no event replay/log, no persisted socket-session records — reconnection is a fresh handshake + fresh room joins, resynchronization is the client's existing REST calls.
- 44 new automated tests across 7 files (handshake auth incl. expired/invalid/suspended, organization room isolation, public room joins, queue/token room leak-prevention, all 12 events individually, multi-client delivery, a real forced-DB-failure-produces-zero-events test reusing the Phase 3 poison-row technique, a forced socket-emit-failure-doesn't-break-HTTP test, targeted position_changed, 10-concurrent-token-creation event delivery, and reconnection/no-replay behavior) — all passing against a real PostgreSQL instance and real `socket.io-client` connections, no mocked sockets.
- Full design record in `docs/ARCHITECTURE_DECISIONS.md` ADR-017.

**Discovered, recorded, not fixed (out of Phase 4's scope, per explicit instruction):**

- Phase 3's public REST endpoints (`POST /api/tokens`, `GET /api/public/queues/:id/config`) still have no rate limiter, despite spec §19 listing both under mandatory rate limiting. Pre-existing from Phase 3, unrelated to the Socket.io layer — flagged for a future, separately-scoped fix rather than folded into Phase 4.
- Neither queue archival nor counter deletion has a corresponding real-time event (the spec's event lists don't include a `deleted`/`archived` event for either) — these mutations remain real-time-invisible by design, matching the literal spec rather than inventing new event names.

## What Is Implemented (Phase 5)

Flutter customer app in `mobile-app/`, exactly the folder layout the spec and `IMPLEMENTATION_PLAN.md` both specify (`lib/{models,services,repositories,providers,screens,widgets}`, `test/`). Pure API consumer — **zero backend changes**; every endpoint it calls already existed from Phases 1-4.

- **Full join flow** (spec section 4.3): `QrScannerScreen` (mobile_scanner) → `QueueDetailsScreen` → `ServiceSelectionScreen` → `DynamicFormScreen` → `TokenConfirmationScreen` → `LiveTrackingScreen`. Plus `HomeScreen`, `SplashScreen`, `NotificationSettingsScreen`, `SettingsScreen`, `TokenHistoryScreen`, `TokenDetailsScreen` — all 12 screens from `IMPLEMENTATION_PLAN.md`'s list.
- **QR handling** (`utils/qr_parser.dart`): validates `livequeue://queue/{uuid}` format client-side before ever calling the backend — matches spec section 7.15's "validate its format" step; the backend remains the actual authority (rejects unknown/invalid ids itself).
- **Dynamic form rendering** (`widgets/dynamic_form_field_widget.dart`): renders the correct input per backend `FormFieldType` (text/number/email/phone/date/dropdown/radio/checkbox); client-side required-field validation is UX only (`utils/form_validation.dart`) — the backend re-validates everything (unchanged from Phase 3).
- **Token creation**: generates a real UUID v4 idempotency key (`utils/uuid_generator.dart`, no `uuid` package dependency needed) and resolves the device identifier (persisted via `shared_preferences`, registered via the existing `POST /api/devices/register`). The idempotency key is generated lazily and cached (`QueueJoinProvider._pendingIdempotencyKey`) — one logical join attempt uses exactly one key across every retry, cleared only on success or `reset()`, never merely because an HTTP call failed. This matters because a request can succeed on the server while its response is lost in transit; a retry that generated a *new* key would look like a brand-new request to the backend and could create a duplicate token — see the pre-commit review fix below.
- **Live tracking** (`services/socket_service.dart`, `repositories/token_repository.dart`, `providers/token_tracking_provider.dart`): connects to Socket.io anonymously (customers never authenticate — ADR-007/Phase 3 decision 8), joins only the public `queue:{id}`/`token:{id}` rooms (never `organization:{id}`, which is staff-only and would be rejected), and re-joins those rooms itself after every reconnect since the server intentionally keeps no cross-disconnect room memory (Phase 4 ADR-017 decision 7). Every `connectionStatus` transition to "connected" — including the very first one — triggers a REST resync (`GET /api/tokens/:id`) rather than trusting no events were missed, matching spec section 26 exactly ("refresh token status after reconnecting").
- **Notifications** (`services/notification_service.dart`): `flutter_local_notifications`, fully functional — turn alert on `CALLED`, reminder when `estimatedWaitMinutes` drops to the customer's configured threshold (2/5/10/15/20 minutes, spec section 7.18), skipped/queue-paused/resumed notices. Requires the app to have a live connection (foreground or backgrounded-but-connected) — see limitations below for the background-push gap.
- **Notification preferences & history**: both persisted locally via `shared_preferences` (`services/preferences_storage_service.dart`, `services/history_storage_service.dart`); history capped at the spec's recommended 100 records, keyed by tokenId so re-tracking the same token updates rather than duplicates its entry. Both storage services degrade gracefully rather than crash on corrupted local data: missing storage returns the empty/default fallback, malformed or structurally-invalid JSON does the same, and — for history specifically — a single corrupted *entry* inside an otherwise-valid list is dropped individually rather than discarding the whole history. `HistoryProvider.load()` carries an independent second safety net (its own `catch`) so a storage-layer failure can never surface as an uncaught exception in the UI.
- **103 automated tests** across unit (models, QR parsing, form validation, UUID generation, storage services incl. corrupted-data fallback behavior), API-client (using `http`'s built-in `MockClient` — no live backend needed), provider (`QueueJoinProvider`'s full validation/submit/error-mapping/idempotency-key-stability flow, `HistoryProvider`'s corrupted-storage resilience), and widget tests (`StatusBadge`, `ConnectionIndicator`, `DynamicFormFieldWidget`, `LiveTrackingScreen` across WAITING/CALLED/paused/terminal/disconnected states, `HomeScreen` navigation) — `flutter analyze`: 0 errors/warnings (17 info-level style hints, see Known, Documented Deviations below). `flutter test`: 103/103 passing. Verified with a real `flutter build apk --debug` (not just static analysis) after fixing two real Android/Gradle issues found only by that build (see below).

**Discovered, recorded, and fixed during Phase 5 (in `mobile-app/` only — no backend changes):**

- A real bug: `LiveTrackingScreen`'s `dispose()` originally called `context.read<TokenTrackingProvider>()` directly, which throws ("Looking up a deactivated widget's ancestor is unsafe") once the element is already deactivated. Fixed by capturing the provider reference in `didChangeDependencies()` instead, which runs while the widget is still active — a standard Flutter pattern for this exact class of bug. Caught by the widget test suite, not by `flutter analyze`.
- `flutter build apk --debug` failed twice before succeeding: `flutter_local_notifications` requires Android core library desugaring (added `isCoreLibraryDesugaringEnabled = true` + the `desugar_jdk_libs` dependency in `android/app/build.gradle.kts`), and Kotlin's incremental-compilation cache threw on this machine because the project (`D:`) and Gradle/pub caches (`C:`) are on different drive letters (worked around with `kotlin.incremental=false` in `android/gradle.properties` — a build-speed-only setting, not a behavior change).
- Added the Android manifest permissions (`INTERNET`, `CAMERA`, `POST_NOTIFICATIONS`, `VIBRATE`) and the iOS `NSCameraUsageDescription` that `flutter create`'s default template doesn't include — without these the app would crash at runtime (iOS) or silently fail to scan/notify (Android), despite compiling fine either way.

**Two further defects found in a dedicated final pre-commit review, both fixed and regression-tested before commit:**

- **Idempotency key was regenerated on every retry, not reused.** `QueueJoinProvider.submitJoin()` originally called `generateUuidV4()` inline on every invocation — if a token-creation request succeeded on the server but its response was lost in transit, the customer's retry would carry a *different* key the backend couldn't recognize as the same request, risking a duplicate token (violating spec section 26's explicit "do not allow duplicate token creation caused by retrying the same request"). Fixed with a lazily-generated, cached `_pendingIdempotencyKey` field: one logical join attempt now uses exactly one key across every retry, cleared only on success or `reset()`. 4 new regression tests prove key stability across a failed-then-retried submit, key clearing on success, and a fresh key after `reset()`.
- **Corrupted local storage could crash the app.** `HistoryStorageService.getAll()` and `PreferencesStorageService.load()` called `jsonDecode`/`fromJson` with no error handling, so malformed or structurally-invalid persisted JSON (a genuinely possible state — future schema changes, interrupted writes) would throw an uncaught exception; `HistoryProvider.load()`'s `try/finally` had no `catch` to stop that exception from propagating. Fixed: both storage services now degrade to their safe fallback (`[]` / defaults) on any parse failure, with per-entry recovery in history (one corrupted record doesn't discard the rest), and `HistoryProvider.load()` gained its own independent `catch` as a second safety net. 16 new regression tests cover missing/malformed/structurally-invalid/partially-corrupted storage for both services plus end-to-end provider resilience.

**Discovered, recorded, NOT fixed (outside Phase 5's scope — backend or infrastructure changes):**

- **FCM background push is scaffolded but not functional** (`services/fcm_service.dart`, fully guarded/non-crashing without it). Two things this session cannot supply: (1) a real Firebase project and its generated config — `IMPLEMENTATION_PLAN.md`'s own "Open Questions" section asks "Firebase project must be created before Phase 5. Who creates it?" and that was never answered; (2) a backend endpoint to store each device's FCM token plus a server-side dispatch job — that's `IMPLEMENTATION_PLAN.md` Phase 7 ("Push notification jobs", "node-cron for scheduled reminder dispatch"), not Phase 5. Practical effect: turn alerts/reminders work whenever the app has a live socket connection (foreground, or backgrounded while the OS keeps the connection alive); true "app fully killed, notified anyway" background push does not work yet.
- **The public queue config response doesn't match spec's example JSON.** Spec section 7.16 shows `organization_name` and a `state: { active_tokens, estimated_wait_minutes }` block; the actual Phase 3 implementation (`backend/src/services/publicQueue.service.ts`, unchanged here) returns neither. The mobile app is built against what the endpoint *actually* returns — `QueueDetailsScreen` shows no organization name or pre-join aggregate wait, since that data doesn't exist server-side. Not fixed here: would be a backend change, out of Phase 5's scope.
- **The customer-safe token view has no queue/service *names*, only ids** (`toCustomerView` in `backend/src/services/token.service.ts`, unchanged — Phase 3 approved decision 8 deliberately keeps this minimal). Worked around, not fixed: `HistoryEntry` denormalizes the queue/service names the app already has in hand from the just-fetched `QueueConfig` at the moment of joining, rather than requesting a backend change.
- Phase 3's public-REST rate-limiting gap (already recorded in Phase 4's section above) remains unaddressed — still out of scope here too.

## Known, Documented Deviations

- Prisma pinned to `6.12.0` rather than the `7.x` default `npm install` resolves to — see ADR-014.
- Owner `Staff.name` at registration defaults to the email's local part, since the spec's registration flow (section 4.1) collects only organization name, email, and password. Rename support arrives with staff-profile management in a later phase.
- `authRateLimiter` (auth endpoints) now skips enforcement when `NODE_ENV === 'test'` — added during Phase 2 because the larger integration suite legitimately exceeds 20 requests/15min from a single test address. Production and development behavior is unchanged; see ADR-015.
- Mobile: `kotlin.incremental=false` in `mobile-app/android/gradle.properties` is a machine-specific build-speed workaround (see Phase 5 section above), not a functional change.
- Mobile: iOS build has not been verified — no macOS/Xcode available in this environment. Android is verified via a real `flutter build apk --debug`. The app is pure cross-platform Flutter/Dart with no platform-specific logic beyond the standard `flutter create --platforms ios` scaffold plus the added `NSCameraUsageDescription`.
- Mobile: FCM (background push) is scaffolded (`services/fcm_service.dart`) but not functional — no Firebase project is configured, and real delivery also needs a backend device-token-storage endpoint and dispatch job that is Phase 7 scope, not Phase 5. `flutter_local_notifications` covers all notification types while the app has a live connection; see the Phase 5 section above for the full explanation.

## Last Action

Phase 5 (Mobile) implemented, reviewed, and closed out: a full Flutter customer app in `mobile-app/` covering the entire spec section 4.3 join flow plus live tracking, notification preferences, and history — with zero backend changes, consuming only endpoints Phases 1-4 already built and tested. A dedicated final pre-commit review found and blocked on two real defects (idempotency key not stable across retries; corrupted local storage could crash the app) — both fixed and regression-tested (20 new tests) before commit. Verified with `flutter analyze` (0 errors/warnings), `flutter test` (103/103 passing), and a real `flutter build apk --debug`, re-run after the fixes. iOS build not verified (no macOS/Xcode in this environment). Committed; awaiting approval to begin Phase 6 (Dashboard).
