# LiveQueue — full architecture and cost-optimization audit

**Audit date:** 2026-10-09
**Code audited:** production master `c17678b` (Android v1.0.6 unchanged)
**Branch:** `audit/full-architecture-optimization`, documents only. Nothing here is deployed or merged.

**Companion documents**
- `performance-hotspots.md` (measured costs)
- `cloudflare-architecture.md` (Durable Object design)
- `cost-comparison.md`
- `migration-plan.md`
- `decision-matrix.md`
- `cloudflare-poc-results.md`

**Labels:** MEASURED (local machine) · ESTIMATE · PROVIDER LIMIT (official page, date given) · NOT LOAD-TEST VALIDATED.

---

## Executive summary

1. **The current architecture is sound for today's scale.**
   - PostgreSQL with Prisma transactions, row locks and governance triggers is the right foundation for what LiveQueue guarantees (FCFS, ownership rules, immutable audit).
   - It should **not** be replaced by D1.
2. **Most remaining cost is algorithmic, not hosting.**
   - Every queue event re-reads and re-simulates the whole queue: O(N) rows and an **O(C·N²·S)** ETA engine (MEASURED: 2.5 s at 5,000 waiting with 10 counters and 2-step journeys).
   - It also sends N socket messages to every staff tab.
   - These are fixable in the current stack at low or medium risk (`performance-hotspots.md` H1–H8).
3. **A per-minute reminder cron would silently break Neon's free tier on any always-on Render plan** (H6). It must be fixed before any Render upgrade.
4. **Cloudflare Durable Objects (DO) fit LiveQueue's realtime layer very well:**
   - one live queue maps to one DO;
   - single-writer FCFS without row locks;
   - hibernatable WebSockets with free outgoing messages;
   - no egress fees.

   They don't fit as the system of record. The local POC measured one Serve next reaching 2,500 clients in about 234 ms with **one** 24 KB message per staff tab, versus about 825 KB today.
5. **Decision: OPTIMIZE CURRENT STACK now.** Prepare a **Cloudflare hybrid realtime layer** (DO + Hyperdrive, PostgreSQL stays) as a staged strangler, triggered at about 100k–250k visits a month or when the single-process ceiling approaches. Details in `decision-matrix.md`.

---

## 1. Current architecture, traced from the code

### 1.1 Runtime topology

| Part | Implementation | Evidence |
|---|---|---|
| Static dashboard + iPhone/iPad portal | React 18 + Vite build on Cloudflare Pages; portal is a second entry (`portal.html`, `/visit/*`) | `web-dashboard/`, `public/_redirects` |
| API + realtime + schedulers | One Node.js process on Render: Express (110 REST routes: 37 GET, 44 POST, 11 PUT, 9 PATCH, 9 DELETE), Socket.io, three `node-cron` jobs | `backend/src/app.ts`, `server.ts`, `routes/` |
| Database | PostgreSQL (Neon) through Prisma; 28 models, 35 migrations, 61 indexes/uniques, governance triggers | `backend/prisma/` |
| Android | Flutter v1.0.6; Socket.io client; applies `position_changed` payloads locally | `mobile-app/lib/services/socket_service.dart` |
| Notifications | FCM (`firebase-admin`), Web Push/VAPID (iPhone/iPad Safari Home Screen PWA only), Resend email | `fcm.service.ts`, `webPush.service.ts`, `email.service.ts` |
| CI/CD | GitHub Actions: **Flutter only** (mobile CI, test APK, signed release). Render deploys master (build runs `prisma migrate deploy`). Pages deploys master. | `.github/workflows/` |

### 1.2 Authentication, sessions and revocation
- Staff log in with bcrypt; access tokens are 15-minute JWTs; refresh tokens are rotated and stored hashed (`sessions`).
- `authenticate` reloads the staff row on **every request**, so `accessRevokedAt` (millisecond precision, ADR-071) cuts access instantly.
  - This costs 1–2 queries per authenticated request. It is a deliberate security property.
- Socket.io authenticates in the handshake (`socketAuth.ts`). Revocation calls `disconnectStaff`, which force-closes that person's live sockets.
- Visitors have no account. The high-entropy token id is the capability (ADR-068); customer views exclude staff-only fields and OTPs.

### 1.3 Authorization
- Every mutation is authorized in the service layer against role (OWNER / MANAGER / ADMIN / STAFF-Executive) and the organization and workspace scope (ADR-069). A cross-tenant id returns 404.
- Room joins re-check scope: organization room for the Head and Managers, workspace room for an Admin and their Executives, a staff-queue room for counter operators, and the public token and queue rooms.

### 1.4 Rate limiting
- `express-rate-limit`, in memory and per process: public 60/min, join 10/min, auth (login, refresh, invitation, handover) 20 per 15 min, sensitive 30 per 15 min, reports 10 per 15 min, email 3 per 15 min.
- Since ADR-073 the key is Cloudflare's `CF-Connecting-IP`; `trust proxy` stays off.

### 1.5 Queue engine
- **Join (`createToken`):**
  1. lock the queue row (`FOR UPDATE`);
  2. allocate `nextTokenNumber`;
  3. apply the identity policy (repeat-visit fingerprints and claims);
  4. assign a session when the queue is scheduled;
  5. create the token, its services and its journey steps, all in one transaction.
- **Serve next (`nextToken`, ADR-064/070):**
  1. lock the caller's own counter (`FOR UPDATE`) and the queue (`FOR SHARE`);
  2. pick, in this order: the earliest referral bound to this counter, else the earliest-joined person whose **current journey step** this counter handles;
  3. compare-and-swap WAITING → CALLED.

  Concurrent counters never take the same person. The client sends only the queue id.
- **Start / complete / skip / cancel:** conditional status updates.
  - Complete either advances the journey (the next step rejoins in the original arrival position) or makes a referral to a specific counter.
  - Start may require the visitor's service-start code (ADR-041).
- **FCFS and eligibility:** strict arrival order within "who this counter can serve" (`counter_services`, none meaning all services). Referrals go first at their bound counter. A token whose assigned session hasn't started isn't callable (ADR-048).

### 1.6 ETA and position computation (see §4)
- `simulateQueue` loads all ACTIVE counters with their current CALLED or IN_PROGRESS tokens, all WAITING tokens with services and journey steps, and the staffed counters.
- It then runs `simulateRoutedEtas` (`queueEtaEngine.ts`), a pure function.
- Position is the index in the callable line. ETA is the simulated call time; "minutes" is rounded up from now.

### 1.7 Realtime
- After every committed change the controller calls a guarded emitter (`realtime/emit.ts`):
  - **Lifecycle events** (`token.called`, `started`, `step_completed`, `completed`, `skipped`, `cancelled`) carry the staff view to the staff rooms and the customer view to the token's room.
  - `broadcastQueueEtaUpdate` re-simulates the queue and emits `token.position_changed` **once per waiting person**, to the staff rooms and to that person's room.
  - Counter and queue events go to the staff rooms only. The public queue room only ever gets `queue.status_changed`.
- **Clients:**
  - The dashboard coalesces invalidations: one refetch per view per burst (ADR-074).
  - The portal and Android apply event payloads; the portal re-reads only on (re)connect, on foreground, and every ~10 minutes as a safety read (ADR-075).
  - The Floating Counter Console shares the dashboard's cache and socket, and its own-counter refresh goes through the same scheduler.

### 1.8 Notifications
- **Status changes:** `notifyTokenStatusChange` sends one delivery per affected token: FCM for Android, Web Push for the iPhone/iPad PWA.
- **Reminders:** a cron scans every minute for WAITING tokens with notifications on and an ETA within the reminder window, claims them with a conditional update, and delivers.
- **Duration override:** `notifyQueueEtaUpdated` pushes to **every** waiting device, serially (hotspot H7).
- **Email:** Resend sends verification, invitations, password reset, Head succession codes and links, and optional visitor email codes.

### 1.9 Governance and audit
- Admin replacement (atomic workspace transfer), Head succession (password + emailed code + single-use 72-hour link, tenure records), and organization deletion with a minimal receipt.
- Every governance change writes its audit row **in the same transaction** with actor and target snapshots.
- Database triggers forbid UPDATE or DELETE on audit and history, except as part of deleting the organization. Partial unique indexes enforce one Head per organization, one live queue per Admin, and one open succession.

### 1.10 Reports
Raw-SQL aggregates (averages, peak hours, journey steps, referrals) over `tokens` and `token_service_steps` by organization and date, using the `(organization_id, created_at)` indexes. Rate-limited to 10 per 15 minutes. These are not hot.

### 1.11 Scheduled and background work

| Job | Schedule | Database work | Note |
|---|---|---|---|
| Reminder dispatch | every minute | scan WAITING tokens with preferences, plus a simulation per queue with candidates | Keeps the DB awake while the backend is awake (H6) |
| Session start | every minute | find queues whose sessions start now, then broadcast | Same |
| Pending-registration cleanup | every 5 minutes | delete unverified registrations older than 1 hour; expire successions | Light |

### 1.12 Data growth
- About 3.5 KB per completed single-step visit (MEASURED earlier): token about 1.25 KB, step about 0.46 KB, service link about 0.34 KB, device about 0.33 KB, audit about 1.5 KB.
- There is no retention policy (H9).

---

## 2. Remaining hotspots
Summarized here; full detail is in `performance-hotspots.md`.

| # | Hotspot | Class | Expected gain |
|---|---|---|---|
| H1 | ETA engine O(C·N²·S) | MEDIUM-RISK | 2.5 s → about 20 ms at 5,000 waiting, 10 counters |
| H2 | Repeated simulations of the same state | MEDIUM-RISK | At most 1 simulation per change per minute |
| H3 | N socket messages per staff tab per event | MEDIUM-RISK (protocol) | About 37× fewer staff bytes; 1 message instead of N |
| H4 | About 50 queries per event | LOW-RISK | About 50 → about 20 |
| H5 | Over-fetching `include`s | LOW-RISK | About 30–50% less Neon egress per simulation |
| H6 | Per-minute crons keep Neon awake | LOW-RISK, **cost-critical** | Neon awake only during activity; required before any always-on Render plan |
| H7 | Serial duration-override push to every device | LOW-RISK | About 10× faster |
| H8 | 30 s dashboard polling while connected | LOW-RISK | About 3,800 fewer requests and simulations per queue per day |
| H9 | No retention; Neon Free 1 GB fills at about 285k cumulative visits | Policy | Keeps the free DB usable |
| H12 | Single process: one-core ceiling of about 250k visits/month (about 800k after H1–H8) | ARCHITECTURAL | Removed by Redis+replicas or by DO |
| H13 | No backend or dashboard CI | LOW-RISK | Reliability |

---

## 3. Queue-event cost model

### 3.1 Per event, today (MEASURED at N ≤ 5,000; formulas for socket bytes)

Assumptions: one staff tab (D = 1); N waiting visitors connected. Per-event values come from `performance-hotspots.md` §1. Socket bytes use the measured message sizes (about 0.33 KB per `position_changed`, about 1–1.5 KB per lifecycle message).

| Waiting N | Server CPU, Serve next (local) | DB queries | DB rows read (≈) | DB writes | Socket messages | Socket bytes (staff tab + visitors) | Dashboard requests per tab | Portal requests |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 73 ms | 59 | about 60 | 3–8 | 1 + 10 + 10 | about 7 KB | 2–4 | 0 |
| 50 | 69 ms | 59 | about 250 | 3–8 | 1 + 50 + 50 | about 34 KB | 2–4 | 0 |
| 100 | 77 ms | 62 | about 500 | 3–8 | 1 + 100 + 100 | about 67 KB | 2–4 | 0 |
| 300 | 143 ms | 59 | about 1,500 | 3–8 | 1 + 300 + 300 | about 200 KB | 2–4 | 0 |
| 500 | 232 ms | 59 | about 2,500 | 3–8 | 1 + 500 + 500 | about 330 KB | 2–4 | 0 |
| 1,000 | 256 ms | 59 | about 5,000 | 3–8 | 1 + 1,000 + 1,000 | about 660 KB | 2–4 | 0 |
| 2,500 | 754 ms | 59 | about 12,500 | 3–8 | 1 + 2,500 + 2,500 | about 1.65 MB | 2–4 | 0 |
| 5,000 | 950 ms | 53 | about 25,000 | 3–8 | 1 + 5,000 + 5,000 | about 3.3 MB | 2–4 | 0 |

**Notes on the table**
- **Rows read** ≈ 5 × N: each waiting token plus its token-service link, service, journey step and step service.
- **Other events:** Join, Start, Complete and Skip have the same shape (§1 of the hotspots doc). Join is the most expensive because it runs 2 simulations. Referral costs the same as Complete plus one extra step row.
- **Notification work per event** is O(1): one delivery for the affected person, plus the per-minute reminder scan. The exception is a duration override, which is O(N) serial pushes.
- **Socket bytes per staff tab** scale with the number of open staff tabs: ×D.
- **Render Free CPU:** multiply local CPU by about 10 (ESTIMATE). Serve next at 1,000 waiting is then about 2.5 s; at 5,000 about 9.5 s, longer once multiple counters or journeys make the engine quadratic.

### 3.2 Asymptotic summary

| Item | Today | After H1–H8 | Durable Object model |
|---|---|---|---|
| DB rows read per event | O(N) | O(N) once per state version (memoized) | O(1) (hot state in the DO; Postgres gets writes only) |
| ETA computation | O(C·N²·S) | O((N·S)(log N + C)) | Same as optimized, in memory |
| Socket messages | O(N·(D+1)) | O(N + D) | O(N + D), outgoing messages free |
| Socket bytes per staff tab | O(N) at 0.33 KB each | O(N) at about 9 B each | Same as optimized |
| Dashboard requests | O(1) per burst | O(1), no polling | O(1) (snapshot over WebSocket) |

---

## 4. ETA algorithm audit (Phase 7)

### 4.1 Why whole-queue recomputation is needed
The ETA of person *i* depends on:
- when every **active counter** frees up: the current person's service time, a staff override, or the +2-minute auto-extension of an overdue service (`computeEffectiveEndTime`);
- **everyone ahead** who is eligible for the same counters (routing by `counter_services`);
- **referrals**, which jump ahead at their bound counter;
- **journeys**, because people ahead come back for later steps in their original arrival position;
- **session scheduling**, because not-yet-started sessions are excluded.

A change at any counter, or anywhere ahead in the line, can therefore move everyone behind. Recomputation is correct by design. Its *cost* is the problem, not its existence.

### 4.2 Complexity today
`pick` scans all remaining entries for each counter on each assignment, giving **O(C · N² · S)**. Measured: from 0.5 ms (N=100) to 2.5 s (N=5,000, 10 counters, 2-step journeys).

### 4.3 Alternatives evaluated

| Option | Correct? | Gain | Verdict |
|---|---|---|---|
| **Linear-log scheduler:** per-service FIFO + referral heap + counter heap; journey re-entry keyed by (readyMs, seq) | Exact. Same rule, different data structures. Prove with the old function as an oracle in property tests | O((N·S)(log N + C)); about 100× at 5,000 | **Do it (H1)** |
| **Cached simulation per state version + minute bucket** | Exact at displayed precision (minutes) | Removes repeated simulations on reads and joins | **Do it (H2)** |
| **Recompute only the affected suffix** | Not exact: a counter becoming free earlier changes everyone, and journeys feed back into earlier parts of the line | Small | Reject |
| **Event-driven cached projection** (apply each event's delta to the stored ETA array) | Fragile: overrides, auto-extensions and referrals all need special cases | Medium | Reject; recompute with H1 is cheap enough |
| **Precomputed capacity** (throughput per service and counter) | Approximation. Loses referrals and journeys | Large | Reject for display; could be used for "new arrival" estimates only if clearly labelled |
| **Approximation for very long queues** (exact for the first K, average rate beyond) | Approximate beyond K | Large | Possible later for N > 5,000, **only if labelled "approximate"** |

### 4.4 Current vs optimized vs Durable Object

| | Current | Optimized current stack | Durable Object model |
|---|---|---|---|
| Input | DB read of N tokens with includes, every event and many reads | DB read once per state version | In-memory or DO SQLite state, no DB read |
| Engine | O(C·N²·S) | O((N·S)(log N + C)) | Same module, reused unchanged (it is a pure function) |
| Runs per event | 1–2, plus 1 per read | 1 per version | 1 per event, inside the queue's single-writer object |
| Correctness | Reference | Identical (oracle-tested) | Identical, if the DO state mirrors the database. That is the hard part (see `cloudflare-architecture.md` §2) |

---

## 5. Current stack maximum potential (Phase C)

ESTIMATE, NOT LOAD-TEST VALIDATED. Assumptions: k = 4 events per visit, about 20 waiting, 2 staff tabs, 8 business hours a day, 22 days a month, peak factor 3.

| | Today | After H1–H8 (Optimized current) |
|---|---|---|
| CPU per visit (local) | about 0.8 s | about 0.25 s |
| Free tier (Render Free + Neon Free) | about 25k visits/month (Render CPU and Neon quotas) | about 50–60k visits/month (Neon CU-hours, plus 1 GB storage over time) |
| Single-process ceiling (any plan) | about 250k visits/month | about 800k visits/month |
| Comfortable waiting per queue (Render Free) | about 300–500 | about 1,000 (memory and socket fan-out become the limit) |
| Beyond the ceiling | Redis adapter + replicas + shared rate-limit store, or per-queue Durable Objects | Same |
