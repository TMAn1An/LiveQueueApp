# LiveQueue — architecture decision matrix and recommendation

**Date:** 2026-10-09
**Inputs:** `full-architecture-audit.md`, `performance-hotspots.md`, `cloudflare-architecture.md`, `cost-comparison.md`, `migration-plan.md`, `cloudflare-poc-results.md`.

## 1. Weights
The weights favour LiveQueue's real situation: a small team, a production system with governance guarantees, a near-zero budget, and growth that is uncertain. Risk and reliability therefore weigh more than theoretical scale.

| Criterion | Weight | Why |
|---|---:|---|
| Migration risk | 11 | FCFS, governance and audit correctness are the product |
| Reliability | 10 | Queues are live operations |
| Database suitability | 10 | Transactions, locks, triggers and immutable history |
| Monthly cost | 9 | Near-zero budget |
| Realtime scaling | 9 | The fan-out is the main technical limit |
| Implementation complexity | 9 | Small team |
| Operational maintenance | 9 | Nobody on call |
| Free-tier capacity | 7 | Growth on free tiers first |
| Future scale | 6 | Uncertain, but should not be blocked |
| Rollback ease | 6 | Every step must be reversible |
| Vendor lock-in | 5 | |
| Developer experience | 5 | |
| Observability | 4 | |
| **Total** | **100** | |

## 2. Scores (1–10, higher is better)

| Criterion (weight) | Current | Optimized current | Cloudflare hybrid | Cloudflare native | VPS | Railway |
|---|---:|---:|---:|---:|---:|---:|
| Monthly cost (9) | 6 | 8 | 9 | 9 | 9 | 6 |
| Free-tier capacity (7) | 5 | 7 | 8 | 8 | 3 | 3 |
| Realtime scaling (9) | 4 | 6 | 9 | 9 | 6 | 5 |
| Implementation complexity (9) | 10 | 8 | 5 | 2 | 7 | 8 |
| Migration risk (11) | 10 | 9 | 6 | 2 | 6 | 7 |
| Operational maintenance (9) | 7 | 7 | 8 | 8 | 3 | 7 |
| Reliability (10) | 6 | 6 | 7 | 6 | 4 | 6 |
| Vendor lock-in (5) | 8 | 8 | 4 | 2 | 9 | 7 |
| Database suitability (10) | 9 | 9 | 9 | 4 | 9 | 8 |
| Developer experience (5) | 8 | 8 | 6 | 5 | 7 | 8 |
| Observability (4) | 4 | 5 | 6 | 6 | 4 | 6 |
| Future scale (6) | 4 | 6 | 9 | 7 | 5 | 5 |
| Rollback ease (6) | 10 | 9 | 7 | 2 | 7 | 8 |
| **Weighted total (/10)** | **7.18** | **7.49** | **7.31** | **5.43** | **6.10** | **6.49** |

**Notes on the scores**
- **Optimized current wins now:**
  - it keeps every guarantee;
  - it roughly doubles the free capacity and triples the single-process ceiling;
  - it costs 2–4 weeks.
- **Cloudflare hybrid is close behind and wins on scale and cost** beyond about 250k visits a month. It loses today on migration risk and complexity: a dispatch rewrite, two transports during the Android transition, and new failure modes (correlated vendor outage, reconnects on every deploy, keeping DO state and PostgreSQL in step).
- **Cloudflare native is last.** D1 can't carry the transactional and governance model without a rewrite (`cloudflare-architecture.md` §5).
- **VPS** is cheapest in dollars but poor on operations and reliability.
- **Railway** is a lateral move from Render with no structural gain.

## 3. Decision

### **OPTIMIZE CURRENT STACK** — with a planned, staged path to a Cloudflare hybrid realtime layer

**Why**
1. The measured costs are **algorithmic**, not hosting:
   - O(N) row reads and simulations per event;
   - an O(C·N²·S) ETA engine;
   - N messages per staff tab;
   - per-minute polling.

   A provider change carries these problems along; fixing them helps in any architecture, including a future DO.
2. **Up to about 100k visits/month, every architecture costs $0–40/month.** A migration saves single-digit dollars at a cost of weeks.
3. The hybrid's real advantages only become decisive near the optimized single-process ceiling (about 250k–800k visits/month):
   - horizontal realtime with no Redis;
   - free outgoing fan-out and no egress fees;
   - per-queue isolation.

   The POC shows the idea works locally, so the path is de-risked, but it isn't needed yet.

### What to do this month
1. **H6:** stop the per-minute crons hitting the database when nothing is live. This is required **before any always-on Render plan**, or Neon Free breaks.
2. **H13:** add backend and dashboard tests to GitHub Actions.
3. **H4, H5, H7, H8:** fewer queries per event, slimmer `include`s, concurrent push fan-out, no polling while connected.
4. **Retention policy (H9):** decide it with governance in mind; Neon Free 1 GB is about 285k cumulative visits.
5. **Owner action:** confirm that `DATABASE_URL` uses Neon's pooled endpoint (H14).

### At about 25k visits/month (today's free ceiling)
- Ship **H1** (linear ETA with the old engine as a test oracle) and **H2** (state version + memoized simulation).
- If cold starts hurt users: Render Starter ($7), only after H6.
- Expect Neon Launch to start costing a few dollars.

### At about 100k visits/month
- Ship **H3** (batched, versioned protocol on Socket.io, with an Android release).
- Start migration **Stages 1–2**: edge proxy, and a shadow queue Durable Object with automated state diffing.
- Budget about $10–40/month.

### At about 1M visits/month
- Run **Stages 3–5**: all realtime and dispatch on per-queue Durable Objects, writing through to PostgreSQL via Hyperdrive (Neon Launch).
- Keep governance, audit and reports PostgreSQL-first.
- Expected about $25–60/month for infrastructure, versus about $140 (optimized current) or $300+ (current with Redis + replicas). ESTIMATE.

## 4. Would Cloudflare Durable Objects have been better from day one?

**PARTIALLY.**

**Better**
- Realtime fan-out would have been batched and free of egress costs from the start.
- No single-process ceiling, no Redis stage, no cold start.
- Single-writer FCFS per queue would have removed most row-lock reasoning in the dispatch path.
- Per-queue isolation.

**Worse**
- **Governance:** Head succession, Admin replacement, organization deletion and immutable audit are multi-entity PostgreSQL transactions with triggers. These would still need PostgreSQL, so day one would have meant **two** data stores and the consistency discipline between them, much earlier than the product needed.
- **Tooling:** Workers' 10 ms Free CPU limit, a Workers-specific test harness, and no Socket.io (reconnection, acks and fallbacks written by hand).
- **Lock-in and failures:** stronger vendor lock-in, and correlated edge and compute outages.

**Complexity avoided** with Express and PostgreSQL:
- one process and one database with ACID transactions for everything;
- a mature ORM and migrations;
- 1,234 fast integration tests with supertest;
- simple local development;
- governance features built quickly and safely.

**Is migrating now justified? No, not now.** Optimize in place first. The hybrid becomes justified at about 250k+ visits/month, or earlier if one queue needs more than about 1,000 concurrent live visitors on the free server. When it comes, run it as the staged strangler in `migration-plan.md`, starting with realtime only.

## 5. Presentation implications
- **The capacity figures stand:**
  - about 300–500 waiting per queue;
  - about 25,000 visits/month;
  - about 5 small organizations.

  All are ESTIMATE, NOT LOAD-TEST VALIDATED. Neon's free quotas remain the first bottleneck.
- **Add one honest caveat:** upgrading Render to an always-on plan **before** H6 would break the Neon free tier (the per-minute crons keep the database awake 24/7).
- **Optional new slide:** "Next architecture step: per-queue Durable Objects for realtime (prototype measured locally: 1 message per staff tab per event instead of N; about 35–45× fewer bytes)." Label it **future, not implemented**.
- **No other slide needs to change** until H1–H8 ship; then free capacity rises to about 50–60k visits/month (ESTIMATE).
