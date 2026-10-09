# LiveQueue — Capacity, Bottleneck and Cost Analysis

**Quotas checked on: 2026-10-08. Production state: 2026-10-09** — master `c17678b` is live with the Floating Counter Console, batched dashboard refetches (ADR-074), event-payload updates on the iPhone/iPad portal (ADR-075) and per-client rate limits (ADR-073). Provider plans change; re-verify the sources in §C before quoting numbers.

**Status of every figure in this document** — each number carries one of these labels:

| Label | Meaning |
|---|---|
| **HARD LIMIT** | Enforced by LiveQueue's code or schema. |
| **PROVIDER LIMIT** | Published by the provider (source and date in §C). |
| **MEASURED (local)** | Measured on a local development machine (4-core Intel Xeon 2.8 GHz, local PostgreSQL 16) against the real backend and dashboard. Not production. |
| **ESTIMATE** | Derived with the formula and assumptions shown. **Not load-test validated.** |

> **No formal load test has been run against LiveQueue.** Unit/integration test counts are correctness evidence, not capacity evidence. Every capacity range below is an engineering estimate.

---

## A. Current provider inventory (verified from the repository)

| Component | Provider | Evidence in repo |
|---|---|---|
| Backend API + Socket.io (one Node.js process) | Render web service | `docs/DEPLOYMENT.md` §12 ("Run a single backend instance"), Render build command |
| PostgreSQL | Neon | Prisma `DATABASE_URL` (value never in repo); owner-confirmed |
| Staff dashboard + iPhone/iPad visitor portal (static) | Cloudflare Pages | `web-dashboard/public/_redirects`, `_headers`; `CF_PAGES` handling in `vite.config.ts` |
| Android push | Firebase Cloud Messaging (`firebase-admin`) | `docs/FIREBASE_SETUP.md`, `FIREBASE_CREDENTIALS` |
| iPhone/iPad push (Safari Home Screen PWA) | Standards Web Push with VAPID (`web-push`), scoped to the Safari portal | ADR-068 |
| Transactional email | Resend (`resend`) | `docs/DEPLOYMENT.md` §3b |
| Source, CI, Android releases | GitHub (public repository), GitHub Actions, GitHub Releases | `.github/workflows/*`, releases v1.0.3–v1.0.6 |
| DNS for the sending domain `tdastudbook.au` | Hostinger DNS (public-DNS audit, `docs/DEPLOYMENT.md`) | Registrar and renewal price **not verified** |

Plan in use: the owner states the deployment intentionally runs at ~zero infrastructure cost (Render Free web service on a Hobby workspace, Neon Free, Cloudflare Pages Free, Resend Free). Render cold starts observed during earlier work are consistent with the Free instance type.

## B. Free plan in use, per service

Render Free (web) · Neon Free · Cloudflare Pages Free · FCM (no-cost product) · Web Push (no provider fee) · Resend Free · GitHub Free (public repo).

**The domain is not part of "free infrastructure".** The application infrastructure runs on free tiers; `tdastudbook.au` may carry a separate registration/renewal cost that is not verified here.

## C. Official quotas (PROVIDER LIMIT, checked 2026-10-08)

### Render — https://render.com/docs/free · https://render.com/docs/compute-plans · https://render.com/docs/outbound-bandwidth · https://render.com/changelog/updated-plans-for-render-workspaces · https://render.com/docs/new-workspace-plans
- Free web service: **0.1 CPU, 512 MB RAM**; **single instance only** (no scaling).
- **Spins down after 15 minutes without inbound traffic** (WebSocket messages count as traffic); **spin-up ≈ 1 minute**.
- **750 free instance hours per workspace per month**; when exhausted, Free services are suspended until next month.
- Outbound bandwidth is a **workspace** allowance: **Hobby 5 GB/month**, Pro 25 GB, Scale 1 TB; overage **$0.15/GB**. **Without a payment method, exceeding it suspends all Free services for the rest of the month.**
- Render's load balancers **compress HTTP responses (Brotli/gzip)**; Socket.io WebSocket frames are not compressed by Socket.io's defaults.
- Workspace plans (changelog 2026-04-23): **Hobby free** (1 member, 25 services), **Pro $25/month flat** (autoscaling, more included bandwidth), Scale $499/month.
- Paid compute (plan IDs from official docs): `0.5c-512mb` (legacy "Starter"), `1c-2g` ("Standard"), `2c-4g` ("Pro") … Prices: Starter **$7/month**, Standard **$25/month** — Render's pricing page renders dynamically and could not be read directly; these two figures are corroborated by third-party listings and must be confirmed in the Render dashboard before purchase.
- Free tier: Render may restart the service at any time; ephemeral filesystem.

### Neon — https://neon.com/pricing · https://neon.com/docs/introduction/plans · https://neon.com/docs/connect/connection-pooling
- Free: **100 CU-hours per project per month** ("enough to run a 0.25 CU compute for 400 hours/month"); autoscaling up to 2 CU; **scale to zero after 5 minutes idle (cannot be disabled)**.
- **Storage 1 GB per project** (20 GB total); **egress (public network transfer) 5 GB per project per month**; 10 branches; 6-hour restore window.
- Exceeding CU-hours or egress → **compute suspended until next billing period or upgrade**; exceeding storage → writes fail. No data is deleted.
- `max_connections` at 0.25 CU = **104** (97 usable); PgBouncer pooler up to 10,000 client connections.
- Next plan **Launch**: pay-as-you-go, no minimum; **$0.106/CU-hour**, **$0.35/GB-month** storage, **500 GB egress included**, then $0.10/GB. Scale: $0.222/CU-hour.

### Cloudflare Pages — https://developers.cloudflare.com/pages/platform/limits/
- Free: **500 builds/month**, 1 concurrent build, 20-minute build timeout, 20,000 files, 25 MiB per file, 100 custom domains.
- **No static-asset bandwidth/request limit is published.** LiveQueue uses no Pages Functions, so no Workers quota applies. API traffic goes directly to Render, not through Pages.

### Firebase Cloud Messaging — https://firebase.google.com/pricing · https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas
- FCM is a **no-cost product** on Spark and Blaze.
- Project quota **600,000 messages/minute**; Android per device **240/minute, 5,000/hour**; collapsible messages burst 20, refill 1 per 3 minutes.

### Web Push / VAPID
- Scope: the deployed product uses Web Push only for iPhone/iPad visitors who add the Safari portal to their Home Screen; delivery goes through Apple's push service. Android push is separate (FCM, above). No provider fee; VAPID is a key pair identifying the sender, not a paid quota. Practical limits are platform rules (iOS/iPadOS 16.4+, Home Screen install, user permission), not money.

### Resend — https://resend.com/pricing
- Free: **3,000 emails/month, 100 emails/day**, 3 custom domains, 30-day retention.
- Pro: **$20/month for 50,000 emails** (no daily limit); $35/month tier for 100,000.

### GitHub — https://docs.github.com/en/billing/concepts/product-billing/github-actions
- The repository is **public**: standard GitHub-hosted runners are **free** for public repositories. (Private repos on GitHub Free: 2,000 minutes/month, 500 MB artifact storage.)
- GitHub Releases downloads are not metered as a quota for public repositories.

## D. Application hard limits (HARD LIMIT, from the code)

| Dimension | Limit | Source |
|---|---|---|
| Waiting people per queue | **No explicit limit** | No cap in `token.service.ts` |
| Token numbers per queue | 2,147,483,647 (32-bit `sequence_number`, unique per queue) | `schema.prisma` |
| Optional daily capacity per scheduled session | ≤ 100,000 when the Admin enables a schedule | `queue.validators.ts` |
| Counters per queue | **No explicit limit** | `counter.service.ts` |
| Live queues per Admin | **1** (partial unique index `queues_admin_live_key`) — a **product rule**, not a hosting limit | ADR-069 |
| Admins / Associates / queues / Organizations | **No explicit limit** | — |
| Steps in a journey | ≤ 20; a service at most its per-service limit (1–10, default 2), never twice in a row | ADR-070 |
| Form fields per queue | ≤ 50 | `formField.validators.ts` |
| Live-queue table page | ≤ 100 rows per page (default 20) | `dashboard.validators.ts` |
| Rate limits (per real client via Cloudflare `CF-Connecting-IP`, in-memory) | public 60/min; join 10/min; auth 20 per 15 min; sensitive 30 per 15 min (unchanged) | `middleware/rateLimit.ts`, `middleware/clientIp.ts` |

**"No explicit limit" never means "unlimited".** It means capacity is set by infrastructure and by the per-event work described below.

## E. What one queue event costs (MEASURED (local) + ESTIMATE)

Every change in a queue (join, call, start, complete, skip) runs `broadcastQueueEtaUpdate`: it recomputes the multi-counter ETA simulation for **all** waiting people and emits `token.position_changed` **once per waiting person** to the staff rooms and to that person's own token room.

Measured with one queue, three open counters, one staff socket and one visitor socket:

| Waiting (N) | ETA recompute per event (local, median) | Staff-socket messages per serve cycle (Serve next → Start → Complete) | Staff-socket bytes per cycle |
|---:|---:|---:|---:|
| 50 | 16 ms | 150 | 53 KB |
| 500 | 103 ms | 1,497 | 474 KB |
| 2,000 | 454 ms | 5,994 | 1.88 MB |

So, per staff socket: **≈ 3 × N messages ≈ 0.32 KB each per serve cycle**. A waiting visitor receives one ≈ 1.45 KB update per queue event.

**Refetch amplification — FIXED and live since 2026-10-09 (MEASURED (local), real browser, one *Serve next*).**

| Waiting | Live Queue tab before → after | Overview tab before → after | iPhone portal, 50 visitors: ticket reads · ETA recomputes · server CPU, before → after |
|---:|---|---|---|
| 50 | 103 req, 866 KB → **4 req, 18 KB** | 100 req, 87 KB → **2 req, 1.7 KB** | 50 · 50 · 1,095 ms → **0 · 1 · 73 ms** |
| 200 | 403 req, 3.4 MB → **4 req, 18 KB** | 400 req, 349 KB → **2 req, 1.7 KB** | 50 · 51 · 2,427 ms → **0 · 1 · 96 ms** |
| 500 | 1,003 req, 8.5 MB → **4 req, 18 KB** | 1,000 req, 872 KB → **2 req, 1.7 KB** | 50 · 51 · 4,849 ms → **0 · 1 · 162 ms** |

Before: every per-person `token.position_changed` invalidated the dashboard's cached queries (one or two full refetches per waiting person per open tab), and every iPhone portal visitor re-read their ticket on every event, each read recomputing the whole queue's ETAs. After: the dashboard coalesces a burst into one refetch per view (ADR-074, the Floating Counter Console included: with the console open, still 4 requests), and the portal applies the event payload (ADR-075). Measured on the release-candidate build identical to production `c17678b`. Socket fan-out is unchanged: ≈ 0.33 KB per waiting person per staff tab per event, and one message per waiting visitor.

REST sizes (uncompressed, MEASURED (local)): live table page of 20 rows 15.7 KB; queue 1.5 KB; queue list 1.6 KB; stats 0.2 KB; own counter 0.2 KB; visitor token view 1.1 KB; public queue config 0.8 KB; join response 1.1 KB.

**Render CPU translation (ESTIMATE).** Render Free is 0.1 CPU. Assuming the local core is comparable per-core and the Free instance gets ~10% of a core: ETA recompute ≈ **0.16 s at 50 waiting, ≈ 1 s at 500, ≈ 4.5 s at 2,000** per queue event, during which the single Node.js thread is partly busy. Combined with the refetch storm, this sets the practical per-queue limit.

## F. Queue-level model — "How many people can wait in one queue?"

- **A. Application hard limit:** **none** (only the 32-bit token sequence).
- **B. Practical limit on current free infrastructure (ESTIMATE):**

| Waiting | Rows touched per event | Socket fan-out per event (staff tab + visitors) | Dashboard refetches per event per open tab (live code) | Likely state on Render Free |
|---:|---:|---:|---:|---|
| 100 | ~100 tokens + steps | ~100 staff msgs/tab + 100 visitor msgs | 1–2 | Comfortable |
| 500 | ~500 | ~500 + 500 | 1–2 | Comfortable with 1–2 staff tabs and ≤ 10 counters (~1 s recompute per event) |
| 1,000 | ~1,000 | ~1,000 + 1,000 | 1–2 | Caution: CPU and socket egress per event |
| 2,500 | ~2,500 | ~2,500 + 2,500 | 1–2 | Unsuitable on Render Free |
| 5,000–10,000 | 5–10k | 5–10k ×2 | 1–2 | Unsuitable without architecture changes |

With the fixes live, the per-event ETA recompute is the limit: estimated comfortable to **~300–500 waiting per queue** on Render Free, for Android and iPhone/iPad visitors alike, higher on paid CPU (ESTIMATE, NOT LOAD-TEST VALIDATED). Before the fixes it was **≤ ~50**.

- **C. Load-tested limit:** **NOT LOAD-TEST VALIDATED.**

## G. Counter-level model — "How many counters can one queue support?"

- Hard limit: **none**. Each counter has one operator (one socket; the Floating Counter Console shares that socket). "Serve next" is a short transaction that locks the caller's counter row and compare-and-swaps the token (ADR-064), so concurrent counters never take the same person; contention is per-row and brief.
- Throughput identity: `visits/hour ≈ counters × 60 / average service minutes`. 10 counters × 5 min ⇒ 120 visits/hour ⇒ ~480 queue events/hour, each costing O(N) (§E).
- ESTIMATE on Render Free: comfortable **1–10 counters**, caution **10–25**, beyond ~25 paid compute recommended (driven by events/hour × N, not by the counter rows themselves).

## H. Organization-level model — "How many queues can one Organization have?"

- **Product rule:** one live queue per Admin workspace (ADR-069). An Organization with *A* Admins can run up to *A* live queues; archived queues do not count. **No limit on Admins**, so no explicit queue limit.
- Queues are independent for dispatch, but they share the same backend CPU, egress and database. Organization load = Σ over queues of (events/hour × waiting length × open dashboards).

| Live queues | Typical demand (assumption: 100–200 visits/day each, ≤ 20 waiting each, 2 open staff tabs each) | Free-tier verdict (ESTIMATE) |
|---:|---|---|
| 1 | 100–200 visits/day | Fits comfortably |
| 5 | 500–1,000/day | Borderline on Neon's free transfer and compute-hours |
| 10 | 1,000–2,000/day | Upgrade needed |
| 25–100 | 2,500–20,000/day | Paid compute + database; at the top, multi-instance architecture |

## I. Database storage model (MEASURED (local) row sizes, incl. indexes)

Per completed single-step visit: token ≈ 1.25 KB + journey step ≈ 0.46 KB + token-service link ≈ 0.34 KB + device ≈ 0.33 KB (first visit from that device) + audit rows ≈ 3 × ~0.5 KB ⇒ **≈ 3.5 KB per visit** (≈ +0.5 KB per extra journey step).

`storage ≈ visits × 3.5 KB`

| Completed visits | Storage (ESTIMATE) | Neon Free (1 GB) |
|---:|---:|---|
| 10,000 | ~35 MB | Fine |
| 100,000 | ~350 MB | Fine |
| 1,000,000 | ~3.5 GB | Exceeds Free → Launch ≈ 3.5 × $0.35 ≈ **$1.2/month** storage |
| 10,000,000 | ~35 GB | Launch ≈ **$12/month** storage |

**Storage is not the first database limit** — at the free tier's realistic traffic, compute hours and egress bind first.

## J. API / egress model (ESTIMATE, formulas shown)

Let *k* ≈ 4 queue events per visit (join, call, start, complete), *N̄* = average waiting length, *D* = open staff tabs watching that queue.

**Render outbound per visit, live code** (HTTP compressed ~5× by Render — assumption; WebSocket frames uncompressed):
`E_render ≈ k × [ N̄ × (D × 0.33 KB + 0.33 KB visitor) + D × 18 KB / 5 ]` — the refetch term no longer grows with N̄, and visitors no longer re-read their ticket per event.

**Neon egress per visit** (DB → backend, uncompressed; ≈ 16 KB of query results per refetch unit — ESTIMATE):
`≈ k × D × 25 KB` with the live code (it was `k × N̄ × D × 16 KB` before the fixes, plus one whole-queue ETA read per portal visitor per event)

| Profile | N̄ | D | E_render/visit | E_neon/visit | Visits/month before a 5 GB quota (Neon binds first) |
|---|---:|---:|---:|---:|---:|
| Small org, before the fixes | 10 | 2 | ~0.24 MB | ~1.3 MB | ~4,000 |
| **Small org, live code** | 10 | 2 | ~0.12 MB | ~0.2 MB | **~25,000** |
| Medium org, before the fixes | 30 | 6 | ~1.8 MB | ~11.5 MB | ~450 (unsuitable) |
| **Medium org, live code** | 30 | 6 | ~0.5 MB | ~0.6 MB | **~8,500** |

## K. Socket.io concurrency model (ESTIMATE)

- One process; **no distributed adapter**, so the service must stay at **one instance** (`docs/DEPLOYMENT.md` §12).
- Memory: Node baseline ≈ 100–150 MB; an idle Socket.io connection costs tens of KB, so 512 MB holds a few thousand idle sockets. Memory is not the first limit.
- CPU and fan-out are: every event sends N messages to each staff socket and one to each waiting visitor. **Comfortable estimate on Render Free: a few hundred concurrent sockets platform-wide** at modest event rates.
- Concurrency vs registrations: registered accounts cost only storage. 100,000 registered accounts do not imply 100,000 simultaneous connections; infrastructure planning is driven by **simultaneous sockets × events per second × waiting length**.

## L. Notification and email model

- **FCM:** free; quota 600k messages/minute per project — not a constraint at these scales.
- **Web Push:** no provider fee; limited by device rules (iOS 16.4+, Home Screen app, permission). **Physical iPhone delivery: PENDING PHYSICAL IPHONE TEST.**
- **Resend Free: 100 emails/day, 3,000/month.** LiveQueue sends email for registration verification, Associate invitations, password resets, Head succession codes/links and — only on queues configured for verified-email identity — a code per visitor. Staff-side email is tiny (< 10/day for a few organizations). **If a busy queue uses verified-email identity, every join costs one email**, and 100/day becomes a hard daily cap → Resend Pro **$20/month** (50,000/month, no daily limit).

## M. Bottleneck ranking — current free deployment (ESTIMATE, highest first)

**Fixed and live since 2026-10-09 (were #0 and the amplifier of #1):** the shared rate-limit key (every visitor shared one bucket behind Render's proxy — confirmed in production on 2026-10-08, now keyed on Cloudflare's `CF-Connecting-IP` with `trust proxy` off, verified from two machines in production), the dashboard refetch storm and the iPhone/iPad portal's per-visitor ticket re-reads (§E).

1. **Neon free quotas — first likely limit.** Data transfer 5 GB/month (≈ 0.2 MB per visit with the live code ⇒ ≈ 25,000 visits/month) and **100 CU-hours ≈ 400 awake hours/month at 0.25 CU**. The reminder job queries the database every minute, so the database stays awake whenever the backend is awake (any traffic in the last 15 minutes): ~13 hours/day of activity uses the allowance; 24/7 activity (~183 CU-hours) exceeds it. Exceeding either suspends compute until the next billing period.
2. **Render Hobby outbound 5 GB/month** — now dominated by the per-person socket fan-out (≈ 0.33 KB per waiting person per staff tab per event), which matters only for long queues watched by many staff tabs.
3. **Render Free CPU (0.1) + cold starts (~1 minute after 15 idle minutes)** — the one per-event ETA recompute (≈ 0.5–1.6 s on Render Free at 50–500 waiting, ESTIMATE) limits waiting length per queue and events/second; cold starts hurt the first user after idle time.
4. **Resend 100 emails/day** — only binding if queues use verified-email identity.
5. Not bottlenecks at this scale: Cloudflare Pages (static, no published bandwidth cap), FCM (free), Web Push (free), GitHub Actions (public repository: free runners), Render instance hours (one service ≤ 744 h/month < 750).

## N. Upgrade matrix (prices PROVIDER LIMIT as noted; checked 2026-10-08)

| Trigger | Service | Current | Upgrade to | Why | Approx. cost |
|---|---|---|---|---|---|
| ~~Refetch storm / egress growth~~ | Dashboard + portal code | **Done — live 2026-10-09** | Coalesced invalidation (ADR-074); portal applies event payloads (ADR-075) | Removed O(N) refetches per event | $0 |
| ~~HTTP 429s from shared IP key~~ | Backend code | **Done — live 2026-10-09** | Client IP from `CF-Connecting-IP`, `trust proxy` off (ADR-073) | Per-client limits | $0 |
| Neon egress or CU-hours exhausted | Neon | Free | **Launch** (pay-as-you-go) | 500 GB egress included, no hour cap | 0.25 CU × 400 h ≈ **$10.6**; always-on 0.25 CU ≈ **$19.3/month** + storage $0.35/GB-month |
| Cold starts unacceptable / CPU saturated | Render | Free | **Starter (0.5 CPU, 512 MB)** | Always on, 5× CPU | **$7/month** (confirm in dashboard) |
| Render outbound > 5 GB | Render workspace | Hobby | Add payment method (overage $0.15/GB) or **Pro workspace** (25 GB) | Avoid suspension | $0.15/GB or **$25/month** |
| Sustained CPU/RAM | Render | Starter | **Standard (1 CPU, 2 GB)** | More compute, one instance | **$25/month** (confirm) |
| Need > 1 backend instance | Render + Redis | 1 instance | Multiple instances + Redis + Socket.io Redis adapter + shared rate-limit store | Socket.io events must reach clients on every instance | Instance cost × n + Redis (price not verified) |
| > 100 emails/day | Resend | Free | **Pro** | 50k/month, no daily cap | **$20/month** |
| CI minutes | GitHub | Free (public) | — | Not expected while public | $0 |

## O. Stages and cost (ESTIMATE; checked 2026-10-08)

| Stage | What changes | Fixed monthly | Usage-based | Estimated total |
|---|---|---|---|---|
| **0 — Before the fixes** | All free tiers | $0 | $0 within quotas | **$0**; ≈ 4,000 visits/month |
| **1 — Software first (done; today)** | Batched refetch, portal payloads, per-client limits — live 2026-10-09 | $0 | $0 | **$0** infrastructure (+ domain, not verified); ≈ 25,000 visits/month (ESTIMATE) |
| **2 — First paid** | Neon Launch; Render Starter | $7 | Neon ≈ $11–20 | **≈ $18–27/month** |
| **3 — Growing multi-org** | Render Standard; Pro workspace; Resend Pro if verified-email queues | $25 + $25 (+ $20) | Neon ≈ $20–40 | **≈ $70–110/month** |
| **4 — High concurrency** | 2+ instances, Redis, Socket.io adapter, observability | not verified | — | Price only after a load test sizes it |

**Economics:** at Stage 0, the incremental infrastructure cost per 1,000 visits is **$0** until a quota is reached. Then it becomes a step function (suspension) rather than a per-visit price. At Stage 2, Neon compute dominates and is time-based rather than per-visit: an organization open 8 h/day on a 0.25 CU database costs ≈ 0.25 × 176 h × $0.106 ≈ **$4.7/month**, regardless of whether it serves 1,000 or 10,000 visits in that time.

## P. Assumptions (all estimates depend on these)

- 22 working days/month; 8 open hours/day per organization.
- *k* = 4 queue events per visit; average service 5 minutes.
- Small org: 1–2 queues, 2–5 counters, ~200 visits/day, N̄ ≈ 10, 2 staff tabs per queue.
- Medium org: 3–10 queues, 10–30 counters, ~1,000 visits/day, N̄ ≈ 30, 6 tabs.
- Busy org: 10+ queues, many counters, several thousand visits/day.
- Render HTTP compression ≈ 5× on JSON; WebSocket frames uncompressed.
- Neon minimum compute 0.25 CU; ≈ 16 KB of query results per refetch unit (one per staff tab per event with the live code).
- Render Free CPU ≈ 10% of the measured local core.

## Q. Uncertainty

- Local micro-measurements on a fast machine; Render's real per-request CPU, Neon latency, and compression ratio may differ by 2–5×.
- Neon egress per refetch is estimated, not measured.
- The shared-rate-limit key was confirmed in production (2026-10-08) and the fix verified in production (2026-10-09); the refetch and portal numbers are local measurements on a build identical to production, not production traffic measurements.
- **No formal load test exists. Every range here is NOT LOAD-TEST VALIDATED.**

## R. Load-testing plan (not run; never against production without approval)

Environment: a staging copy (Render + Neon branch), seeded synthetic organizations.

Scenarios: 100, 500, 1,000, 2,500, 5,000 concurrent clients (k6 or Artillery for HTTP; a Socket.io client harness for sockets), with realistic mixes of visitors (join, wait, receive events) and staff (dashboards open, counters serving every ~5 minutes).

Measure: API latency p50/p95/p99; Socket.io connection success and event delivery latency; CPU and memory; DB connections and query latency; Neon CU and egress consumed; Render outbound bytes; error/429 rate.

Run on a staging copy of the live code (the refetch and portal fixes are in production since 2026-10-09).

## S. Faculty-ready answer

**Short (20–30 s):** "LiveQueue runs entirely on free tiers. There's no software limit on people per queue, queues per organization, or organizations. With the October software fixes live, we estimate the free deployment is comfortable for about **five small organizations** with similar business hours — about **25,000 visits a month** — and about **300–500 people waiting per queue**, for Android and iPhone/iPad alike. The first likely limit is **Neon's free quotas**: 5 GB of data transfer and 100 compute-hours a month. The first paid step is **Neon's Launch plan**, roughly $10–20 a month, then **Render Starter at $7** to remove cold starts. These are engineering estimates from measured payloads and published quotas, **not load-test results**."

**Longer follow-up:** walk through §E (measured fan-out, and the refetch storm before and after the fix), §J (egress formula), §M (ranking) and §N (upgrade matrix), stating each label: measured locally, provider limit, or estimate.
