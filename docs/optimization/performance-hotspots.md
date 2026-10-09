# LiveQueue — performance hotspots in the current stack

**Audit date:** 2026-10-09. **Code:** production master `c17678b`. **Branch:** `audit/full-architecture-optimization`.

**Labels used in this document**

| Label | Meaning |
|---|---|
| **MEASURED** | Measured locally: 4-core machine, PostgreSQL 16 on the same host, the real backend. Not Render or Neon. |
| **ESTIMATE** | Derived from measurements with the stated assumptions. |
| **PROVIDER LIMIT** | Published by the provider. |
| **NOT LOAD-TEST VALIDATED** | Applies to every capacity figure in this document. |

## How these numbers were measured

The following temporary instrumentation was added, used, and reverted; none of it was committed:
- a Prisma `query` event counter;
- a counter and timer around the ETA simulation;
- `process.cpuUsage()`.

The scenario was one queue with one active counter and one service, filled with N waiting people. One real token was created through the API, then cloned in SQL to N rows, on the **local** database only.

Each event was driven through the real HTTP API with the real Socket.io server attached. Asynchronous broadcasts were awaited until the query counter stopped moving.

The scripts are in the session scratchpad and are reproducible: `perf/events.mjs`, `perf/clone.py`, `perf/enginebench.ts`.

## 1. Cost of one queue event today (MEASURED)

Values are database queries / server CPU (ms) for the whole event, including the broadcast that runs after the HTTP response.

| Event | N = 10 | 50 | 100 | 300 | 500 | 1,000 | 2,500 | 5,000 |
|---|---|---|---|---|---|---|---|---|
| Join | 48 / 59 | 51 / 68 | 48 / 78 | 48 / 149 | 48 / 186 | 48 / 410 | 48 / 1,231 | 50 / 1,980 |
| Serve next | 59 / 73 | 59 / 69 | 62 / 77 | 59 / 143 | 59 / 232 | 59 / 256 | 59 / 754 | 53 / 950 |
| Start | 51 / 53 | 51 / 57 | 51 / 67 | 54 / 113 | 51 / 129 | 51 / 233 | 51 / 572 | 51 / 1,085 |
| Complete | 49 / 67 | 49 / 160 | 49 / 164 | 49 / 116 | 52 / 151 | 49 / 295 | 52 / 597 | 43 / 814 |
| Skip | 45 / 62 | 45 / 62 | 45 / 65 | 45 / 108 | 45 / 201 | 45 / 296 | 45 / 581 | 45 / 1,010 |
| Visitor leaves (cancel) | 32 / 48 | 32 / 48 | 32 / 53 | 32 / 88 | 32 / 109 | 32 / 217 | 32 / 442 | 30 / 777 |
| Read: visitor ticket GET | 15 / 19 | 15 / 25 | 15 / 29 | 15 / 51 | 15 / 101 | 15 / 165 | 15 / 448 | 15 / 1,152 |
| Read: dashboard table page (20 rows) | 25 / 31 | 25 / 48 | 25 / 60 | 25 / 89 | 25 / 111 | 25 / 314 | 25 / 733 | 28 / 1,083 |
| Read: own counter (console) | 5 / 13 | 5 / 12 | 5 / 15 | 5 / 12 | 5 / 12 | 5 / 14 | 5 / 13 | 5 / 11 |

**Reading the table**
- **Query count is roughly constant**, 30–60 per event. Prisma `include`s become a fixed number of batched queries.
- **Rows read and CPU grow with N.** Every broadcast loads all N waiting tokens with their services and journey steps, runs the whole-queue simulation, and emits N socket messages twice: once to the staff rooms and once to each visitor's room.
- **CPU per waiting person per event is about 0.2 ms locally.** On Render Free (0.1 CPU), assume about 10× that: about 2 ms per waiting person per event (ESTIMATE).
- **The visitor ticket GET and the dashboard table page each run a full simulation.** After ADR-074/075 they run once per tab per burst, and once per portal open, reconnect or foreground. They no longer run per event.
- Response sizes: about 0.9–1.1 KB for actions and 15.7 KB for the dashboard table page of 20 rows (uncompressed). Render compresses with Brotli.

## 2. The ETA engine is quadratic (MEASURED)

`simulateRoutedEtas` (`backend/src/services/queueEtaEngine.ts`) does three nested scans:
- each assignment loops over every counter;
- for each counter, `pick` scans **every remaining** waiting person;
- each journey step re-enters the line.

The doc comment says O(waiting × counters), but the real cost is **O(C · N² · S)**: counters × waiting² × steps.

Times are for one simulation, best of two runs:

| Workload | N = 100 | 500 | 1,000 | 2,500 | 5,000 |
|---|---|---|---|---|---|
| 1 service, 1 counter | 0.5 ms | 1.1 ms | 3.4 ms | 18.6 ms | 78.9 ms |
| 1 service, 3 counters | 0.1 ms | 4.3 ms | 12.6 ms | 58 ms | 194 ms |
| 1 service, 10 counters | 0.4 ms | 7.3 ms | 24 ms | 150 ms | 651 ms |
| Routed, 2-step journeys, 3 counters | 0.7 ms | 12.4 ms | 50 ms | 249 ms | 707 ms |
| Routed, 2-step journeys, 10 counters | 1.0 ms | 21 ms | 85 ms | 703 ms | **2,496 ms** |

At realistic sizes (N ≤ 500) the engine is a minority of the event cost; database loading and the socket fan-out dominate. Beyond about 1,000 waiting with several counters, the engine itself becomes the bottleneck. On Render Free, ×10 that 2.5 s becomes about 25 s per event (ESTIMATE).

## 3. Asymptotic behaviour today

| Operation | Today | Where |
|---|---|---|
| DB queries per event | O(1), about 30–60 | Prisma includes, lifecycle views, audit, notifications |
| DB rows read per event | O(N · (1 + services + steps)) | `simulateQueue` loads every waiting token with includes |
| DB rows written per event | O(1), about 3–8 (token, step, audit, notification bookkeeping) | Services and controllers |
| ETA simulation | **O(C · N² · S)** | `queueEtaEngine.ts` |
| Simulations per event | 1–2 (join runs 2) | Broadcast, plus lifecycle views and the join response |
| Socket messages per event | O(N · (staff sockets + 1)): N to every staff socket, 1 to each waiting visitor | `broadcastQueueEtaUpdate` |
| Socket bytes per staff tab per event | about 0.33 KB × N | Measured earlier |
| Dashboard requests per tab per event | O(1), 2–4 per burst (fixed by ADR-074) | `queryInvalidation.ts` |
| Portal ticket reads per event | O(1), zero (fixed by ADR-075) | `useLiveToken.ts` |
| Reminder job (every minute) | O(Q · N) rows plus one O(C · N² · S) simulation per queue with candidates | `reminderDispatch.service.ts` |
| Duration-override push | **O(N) serial network calls** (await in a loop) | `notifyQueueEtaUpdated` |

So the current system is O(N) per event in database rows, CPU and socket messages, and O(N²) in the ETA engine. Nothing is worse than O(N²).

## 4. Hotspot list

Classifications: **LOW-RISK OPTIMIZATION**, **MEDIUM-RISK**, **ARCHITECTURAL CHANGE**.

### H1 · Quadratic ETA engine — MEDIUM-RISK
- **Current behaviour:** O(C·N²·S); 2.5 s at N=5,000, 10 counters, 2-step journeys (MEASURED).
- **Recommended:** rewrite `simulateRoutedEtas` as an event-driven scheduler.
  - Keep per-service FIFO queues and a referral heap, plus a min-heap of counter free times.
  - Track per-counter eligibility as the first available entry across the services that counter handles.
  - Re-inserting a later journey step uses a heap keyed by `(readyMs, sequence)`.
  - Target cost: O((N·S) · (log N + C)).
- **Correctness guard:** keep the old function as a test oracle, and property-test both on random queues with random routing, referrals and journeys; results must be identical.
- **Expected gain:** at N=5,000 with 10 counters, from about 2.5 s to about 10–30 ms (ESTIMATE).
- **Risk:** this is the ETA rule itself; with the oracle tests it is medium.

### H2 · Simulations repeated for the same queue state — MEDIUM-RISK
- **Current behaviour:** one join runs 2 simulations. Each lifecycle broadcast builds the staff and customer views separately. Every dashboard table refetch, visitor ticket read, reminder tick and the join "new arrival" probe re-simulates the same unchanged state.
- **Recommended:** a per-queue `stateVersion` bumped inside every transaction that changes the queue (token, counter, service routing or session). Then a single-process memo `simulate(queueId, version, minuteBucket)`.
  - ETAs depend on `now` only through the auto-extension and the minute-rounded wait, so a one-minute bucket keeps results exact at the displayed precision.
- **Expected gain:** at most one simulation per queue per change per minute; reads become O(rows on the page).
- **Risk:** stale cache if a write path forgets to bump the version. Mitigate with a database trigger on `tokens`, `token_service_steps` and `counters` that bumps `queues.state_version`.

### H3 · Per-person `token.position_changed` fan-out — MEDIUM-RISK (protocol change)
- **Current behaviour:** each staff socket receives N messages of about 0.33 KB; each visitor gets one 0.33 KB message.
- **Recommended:** the versioned batched protocol in `cloudflare-architecture.md` §3, which also works on Socket.io:
  - **staff:** one `queue.delta` per event (ordered line + ETA array + version);
  - **visitors:** one tiny `{v, p, w}`, sent only when their displayed values change.
  - Keep `token.position_changed` while the Android app (v1.0.6) still depends on it, and add a feature flag.
- **Expected gain (staff bytes per tab per event):** about 33 KB → about 0.9 KB at N=100; 165 → 4 KB at 500; 330 → 9 KB at 1,000; 1.65 MB → 45 KB at 5,000. Messages per staff tab go from N to 1.
- **Risk:** client changes, and Android needs a release.

### H4 · About 50 queries per event — LOW-RISK
- **Current behaviour:** `emitTokenLifecycleEvent` loads the token twice (`getTokenStaffView` and `getTokenCustomerView`, each with includes), re-looks-up the queue's Admin for `staffRoomsForQueue` on every emit, and runs the notification dispatch's own lookups.
- **Recommended:** build both views from one row read, and cache staff rooms per queue (invalidated on Admin transfer, a rare event).
- **Expected gain:** about 50 → about 20 queries per event. That matters on Neon, where every query is a network round trip, and later for Hyperdrive's free 100,000 queries a day.

### H5 · Over-fetching in `include`s — LOW-RISK
- **Current behaviour:** the simulation loads whole `service` rows for every token service and journey step.
- **Recommended:** `select` only `serviceId`, `durationMinutes`, `stepNumber`, `status`, `referredToCounterId`, `referredAt`, `calledAt` and `startedAt`.
- **Expected gain:** about 30–50% fewer bytes from Neon per simulation (ESTIMATE), which directly reduces Neon egress.

### H6 · The reminder job queries the database every minute — LOW-RISK (cost-critical)
- **Current behaviour:** `node-cron` runs every minute. It scans all WAITING tokens with reminder preferences, then simulates every queue that has candidates. The session-start scheduler also queries every minute.
- **Effect:** the database stays awake for as long as the backend is awake.
- **Why it matters:** on Render Free the backend sleeps after 15 idle minutes, so this mostly lengthens Neon's awake tails. **On any always-on Render plan, these crons alone keep Neon awake 24/7:** about 730 h × 0.25 CU ≈ 183 CU-hours, which exceeds Neon Free's 100 CU-hours (PROVIDER LIMIT).
  - So **upgrading Render first would silently break the Neon free tier.**
- **Recommended:**
  - Skip the tick without touching the database when the process knows of no live queue with waiting tokens (in-memory set maintained by the emitters).
  - Compute the next reminder due time at each ETA broadcast, and schedule a single timer for it.
  - Run session-start from known session times instead of polling.
- **Expected gain:** Neon awake only while there is real activity.

### H7 · Duration-override push fan-out is serial — LOW-RISK
- **Current behaviour:** `notifyQueueEtaUpdated` awaits `deliverToDevice` for every waiting token in turn. Each call looks up the device's channels and makes one FCM or Web Push network call.
- **Cost:** at 500 waiting × about 100 ms per call, about 50 s of serial work (ESTIMATE).
- **Recommended:** bounded concurrency (for example 10 at a time), or FCM topic messages per queue.
- **Expected gain:** about 10× faster, and it no longer ties up the event loop's work queue.

### H8 · Dashboard 30-second polling while the socket is connected — LOW-RISK
- **Current behaviour:** `refetchInterval: 30_000` on stats and the live table. That is 2 requests per tab every 30 s, and each table refetch runs a simulation.
- **Cost:** 8 h × 2 tabs ≈ 3,840 requests per queue per day, even when nothing happens.
- **Recommended:** poll only while the socket is disconnected; otherwise rely on events plus the reconnect resync.
- **Expected gain:** about 3,800 fewer requests and simulations per queue per day (ESTIMATE).

### H9 · Audit and token-history growth — LOW-RISK (policy needed)
- **Current behaviour:** about 3.5 KB of database storage per visit, of which about 1.5 KB is audit rows. There is no retention or archiving.
- **Cost:** Neon Free has 1 GB per project (PROVIDER LIMIT), so the free database fills after **about 285,000 cumulative visits**. At 25,000 a month that is about 11 months.
- **Recommended:** retention per organization for token PII and form data (for example 12 months); move audit older than N months to cold storage (R2/S3 export) once governance confirms the rules.
  - Governance immutability triggers allow DELETE only with the organization, so retention needs an explicit, audited purge path. This is a product and governance decision.

### H10 · Auth reloads the staff row on every request — keep as is
This costs 1–2 queries per authenticated request. It is what makes instant revocation work (ADR-071). A short cache would weaken that guarantee, so it is **not recommended**.

### H11 · Cold start on Render Free — ARCHITECTURAL or plan change
About one minute of spin-up after 15 idle minutes (PROVIDER LIMIT). Fix with a paid instance, ideally after H6, or by moving realtime to an edge runtime.

### H12 · Single Node process and in-memory state — ARCHITECTURAL CHANGE
Socket.io has no cross-instance adapter and the rate limits are in-memory, so one process is a hard ceiling. Node is single-threaded, so that means one core.
- **Today:** about 0.8 s of local CPU per visit (ESTIMATE from §1 plus dashboard and portal reads), which gives a ceiling of **about 250,000 visits a month** whatever the Render plan size.
- **After H1–H8:** about 0.25 s per visit, which gives a ceiling of **about 800,000 visits a month**.
- **Beyond that:** a Redis adapter, a shared rate-limit store and multiple instances, or per-queue Durable Objects (see `cloudflare-architecture.md`).

### H13 · CI does not run backend or dashboard tests — LOW-RISK (reliability)
`.github/workflows` covers only the Flutter app and the Android releases. The 1,234 backend and 640 dashboard tests run only by hand. Add a workflow for them with a PostgreSQL service container.

### H14 · Database connection usage — check
Make sure production `DATABASE_URL` uses Neon's pooled endpoint (`-pooler`) with Prisma's `pgbouncer=true`, or a sized `connection_limit`. That avoids exhausting the roughly 104 connections of a 0.25 CU compute (PROVIDER LIMIT).
The value is a secret and wasn't inspected. **Owner action.**

## 5. What has already been fixed (for context)

| Fix | Status | Effect (MEASURED) |
|---|---|---|
| ADR-074, dashboard refetch coalescing | Live since 2026-10-09 | 1,003 → 4 requests per Serve next at 500 waiting |
| ADR-075, portal applies event payloads | Live since 2026-10-09 | 51 → 1 simulation per event at 500 waiting with 50 portal visitors |
| ADR-073, per-client rate limits | Live since 2026-10-09 | Verified in production from two runners |

## 6. Expected effect of H1–H8 together (ESTIMATE, NOT LOAD-TEST VALIDATED)

| Metric per visit (k = 4 events, about 20 waiting, 2 staff tabs) | Today | After H1–H8 |
|---|---|---|
| Local CPU | about 0.8 s | about 0.25 s |
| DB queries | about 530 | about 150 |
| Neon egress | about 0.2 MB | about 0.07 MB |
| Render outbound | about 0.12 MB | about 0.03 MB |
| Neon awake time | backend-awake time | activity time only |
