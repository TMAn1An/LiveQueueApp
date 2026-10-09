# LiveQueue on Cloudflare — Durable Object design, database choice and free-tier capacity

**Audit date:** 2026-10-09. Provider facts were checked on that date from the official Cloudflare documentation; URLs are at the end.
**Labels:** PROVIDER LIMIT · MEASURED (local POC on `wrangler dev`, not Cloudflare's network) · ESTIMATE · NOT LOAD-TEST VALIDATED.

> No Cloudflare figure here is a guarantee of LiveQueue capacity. "A Durable Object can hold thousands of WebSockets" (PROVIDER LIMIT, qualitative) is not the same as "a LiveQueue queue comfortably serves thousands of visitors". The latter also depends on the per-event work the object does, which is measured in the POC only locally.

---

## 1. Target designs

### B. Cloudflare hybrid (recommended later, staged)

```
Browsers / Android ── HTTPS ──► Worker (router + auth + scope check)
        │                                   │
        └─ WebSocket (hibernatable) ──► Queue Durable Object  (one per live queue)
                                            │  hot state: waiting line, counters,
                                            │  versions, ETA, sockets
                                            ├─ DO SQLite: live state + outbox
                                            └─ Hyperdrive ──► Neon PostgreSQL
                                                   (system of record: tokens, steps,
                                                    governance, audit, reports)
Render (shrinking): REST for governance, reports and admin, until each path moves
```

- The **Worker** authenticates the JWT, reloads the staff row through Hyperdrive (keeping instant revocation), checks the organization and workspace scope of the queue, then forwards to `QUEUE.idFromName(queueId)`.
  - Anything rejected never reaches, or bills, the DO.
- The **Queue DO** is the only writer for that queue's live state. It serves FCFS "Serve next" without row locks, recomputes ETAs in memory with the existing pure engine, and fans out with the batched protocol (§3).
- **Every state change** is written transactionally to DO SQLite **and** to an outbox. The outbox is flushed to PostgreSQL in batches through Hyperdrive, idempotently by `(queueId, version)`. See §2 for the safer variant.
- **Governance, audit, reports, invitations, succession and organization deletion stay PostgreSQL-first,** unchanged, on Render or later on Workers through Hyperdrive.

### C. Cloudflare-native
Workers + Durable Objects + D1 (or DO SQLite) as the only database, plus Queues/KV/R2 as needed. Evaluated in §5. **Not recommended** for LiveQueue.

---

## 2. One live queue ≈ one Durable Object (Phase 4)

### 2.1 What the queue DO could own
- **Queue ordering and the waiting list:** yes. The DO is a natural single writer, so the arrival order is its own counter.
- **Counter state and current tokens:** yes, for live status. The counter **operator assignment** stays governed in PostgreSQL (ADR-064 rules), and the DO is told about changes.
- **FCFS dispatch, service eligibility, referrals, journey step progression:** yes. These are deterministic functions of the state above, already written as pure code (`queueEtaEngine.ts`, `journey.service.ts headForCounter` logic).
- **Realtime WebSockets and position broadcasts:** yes. This is the best fit.
- **ETA:** yes, in memory.
- **Not owned by the DO:**
  - identity, repeat-visit policy and verification codes;
  - staff roles and workspaces;
  - governance, audit and reports;
  - organization deletion;
  - notification preferences;
  - the history of completed visits.

### 2.2 Three ways to use the DO

| Model | What the DO does | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Realtime coordinator only** | PostgreSQL stays the authority for every mutation; the DO receives "state changed" from the API, reads a snapshot once per version, computes ETA, fans out | Smallest change; no dual-write; trivial rollback | Still one DB read of the queue per change; latency of 2 hops | **Stage 1 of the migration (safest)** |
| **B. Realtime + ephemeral queue state** | The DO decides FCFS and holds live state; each decision is committed to PostgreSQL in the **same request**, before acknowledging, via Hyperdrive; DO SQLite is a cache rebuilt from PostgreSQL on wake | Removes N-row reads per event; single-writer correctness; PostgreSQL stays the truth | Every write pays a DB round trip; needs version and idempotency keys; PostgreSQL outage blocks writes, as today | **Recommended target** |
| **C. Primary state store** | The DO is the authority; PostgreSQL gets an asynchronous outbox | Highest availability and lowest latency; PostgreSQL outage doesn't stop serving | Dual-write divergence risk; reports and audit lag; governance rules split between two stores; hardest to reason about | Not recommended now |

**Recommendation:** Model A first, then Model B, with PostgreSQL authoritative and synchronous writes.
- The POC demonstrates the storage mechanics of Model C (DO SQLite + outbox) only to measure them.
- The production target is B: write-through, where the commit to PostgreSQL happens before the acknowledgement.

### 2.3 Correctness rules for Model B
- **Single writer per queue:** the DO serializes every mutation of that queue, replacing `SELECT … FOR UPDATE` on the queue and counter rows.
- **Version:** every committed change increments `queues.state_version` in the **same PostgreSQL transaction**. The DO only applies a change after its commit succeeds. On wake, or after an error, it reloads `(state, version)` from PostgreSQL.
- **Cross-queue writes** (a staff member assigned to a counter in another queue, organization deletion, Admin transfer) go through PostgreSQL first, then notify each affected DO, which reloads.
- **Clients never decide order:** they only render `(version, line, eta)` from the server.

---

## 3. Batched realtime protocol (Phase 6)

**Server-authoritative and versioned.** It works on Socket.io today and on raw WebSockets in a DO.

| Message | To | Content | When |
|---|---|---|---|
| `queue.snapshot` | staff (on join or resync) | `{v, line:[tokenId…], eta:[min…], counters:[…]}` | Connect or resync |
| `queue.delta` | staff | `{v, event:{kind, tokenId, counterId}, line?:[…], eta:[…]}`, one per change | Every change |
| `me` | each visitor | `{v, p, w}` (position, wait minutes), or `{v, s}` (status) on a lifecycle change | Only if that visitor's displayed values changed |
| `resync` | client → server | — | On a version gap, reconnect or foreground |

**Correctness implications**
- Positions are **computed on the server** and sent as values. A client never derives FCFS order or position from its own knowledge, so a visitor can't infer or influence order.
- A client that sees `v` jump by more than 1 asks for a snapshot. A dropped message is therefore detected, not silently ignored.
- Staff payloads carry token ids the staff may already see. Visitor payloads carry only their own position and wait; no other person's data reaches a visitor.
- Android keeps receiving `token.position_changed` until a release that understands `me`. Both are emitted during the transition, behind a flag.

**Quantified effect per event** (ESTIMATE from measured sizes: current `position_changed` about 0.33 KB; POC staff delta about 9.7 B per waiting person; visitor message about 34 B):

| Waiting | Staff tab today: messages / bytes | Batched: messages / bytes | Visitors today: msgs × size | Batched: msgs × size |
|---:|---:|---:|---:|---:|
| 100 | 100 / about 33 KB | 1 / about 0.9 KB | 100 × 0.33 KB | ≤100 × 34 B |
| 500 | 500 / about 165 KB | 1 / about 4.2 KB (MEASURED in POC) | 500 × 0.33 KB | ≤500 × 34 B (MEASURED: 17 KB in total) |
| 1,000 | 1,000 / about 330 KB | 1 / about 8.7 KB (MEASURED) | 1,000 × 0.33 KB | ≤1,000 × 36 B (MEASURED: 36 KB) |
| 5,000 | 5,000 / about 1.65 MB | 1 / about 48 KB | 5,000 × 0.33 KB | ≤5,000 × 36 B |

That is a **37–40× reduction** in staff bytes and **N→1** staff messages, plus about **9×** smaller visitor messages. Start and Complete events often change no displayed position, and change ETA only when the rounded minute moves, so fewer visitor messages are sent for those.

---

## 4. WebSocket Hibernation (Phase 5)

**PROVIDER LIMIT and behaviour** (Cloudflare docs, checked 2026-10-09):
- `ctx.acceptWebSocket(ws, tags)` lets the runtime keep the socket open while the object is evicted from memory. *"Billable Duration (GB-s) charges do not accrue during hibernation."*
- A connection counts as **one request**. **Outgoing messages are free.** Incoming messages are billed at a 20:1 ratio. Protocol pings are free and auto-answered without waking the object.
- On wake, the **constructor runs again** and *"in-memory state is reset"*. Per-socket metadata survives through `serializeAttachment()` (16,384 bytes max).
- Timers (`setTimeout`/`setInterval`), outbound connections and in-flight requests prevent hibernation. Alarms are the supported way to schedule work.
- *"Code updates disconnect all WebSockets."* Every deploy forces every client to reconnect.
- No hard per-object connection cap is published. The docs say objects *"connect thousands of clients per instance"* and recommend batching messages, because *"sending many small messages can overwhelm a single Durable Object."*

**How LiveQueue would benefit**

| Situation | Today (Socket.io on Render) | With hibernation |
|---|---|---|
| Idle waiting visitors | Each holds a socket in one Node process; keeps a Render Free service awake | Sockets are held by the runtime; the object sleeps and isn't billed for duration between events |
| Operator consoles and dashboards | Same socket; fine | Same; one connection per tab |
| Thousands of long-lived connections | One process, one core, memory-bound; Socket.io has no adapter | Per-queue isolation: a busy queue can't slow another queue's object |
| Wake on message | n/a | Constructor reruns; state reloads from DO SQLite or PostgreSQL by version; attachments restore `{role, staffId, tokenId}` |
| Reconnection | Socket.io automatic; client resyncs | Raw WebSocket: the client must implement backoff and resync (the portal and dashboard already resync on reconnect) |
| Session revocation | `disconnectStaff` closes that staff member's sockets | The API notifies every queue DO the staff member is connected to (index kept in PostgreSQL or DO storage); each closes sockets whose attachment `staffId` matches. Also a revocation epoch checked on every staff message |
| Queue deletion | Cancels tokens, emits `token.cancelled` | The DO sends final `me` statuses, closes all sockets, and refuses new connections (tombstone in DO storage) |
| Access changes (role, workspace) | Disconnect, then re-join with re-checked rooms | Same: close and reconnect through the Worker, which re-checks scope |

**Socket.io or plain WebSockets?** Socket.io's server isn't designed to run inside a Durable Object, and the hibernation API works on standard WebSocket objects. Socket.io's protocol, Engine.IO polling fallback and ack semantics aren't documented as supported. **Assume plain WebSockets.**
- **Dashboard and portal:** small adaptation; one client wrapper replacing `socket.io-client`.
- **Android:** medium adaptation (`socket_io_client` → `web_socket_channel`) plus an app release. During migration both transports must run: Render Socket.io for old apps, DO WebSocket for new ones.

---

## 5. PostgreSQL vs D1 (Phase 8)

| Need in LiveQueue | PostgreSQL (today) | Cloudflare D1 (SQLite) |
|---|---|---|
| Multi-table transactions (join, serve, Head succession, Admin transfer, org deletion) | Interactive transactions | Batches only (`db.batch()`), no interactive transaction across Worker awaits. Each multi-step governance flow must be re-shaped |
| Row locks (`FOR UPDATE`/`FOR SHARE` in join, serve, start) | Yes | No; a database is single-threaded. *"Processes queries one at a time"* (PROVIDER LIMIT) |
| Concurrency | MVCC, many concurrent writers | One writer per database; about 1,000 queries/s at about 1 ms each (PROVIDER LIMIT) |
| Governance triggers (immutable audit and history), PL/pgSQL | Yes, 35 migrations rely on them | SQLite triggers exist, but every PL/pgSQL trigger and check must be rewritten and re-verified |
| Partial unique indexes (one Head, one live queue per Admin) | Yes | SQLite supports them |
| Foreign keys, cascades | Yes | Yes (must be enabled), with differences |
| Reporting (window functions, date math, `groupBy`) | Strong | Adequate but weaker; date and time zone functions differ |
| Size | Neon: 1 GB free, paid without a practical cap | **500 MB per database on Free, 10 GB on Paid** (PROVIDER LIMIT) |
| Prisma | First-class | Driver adapter (preview); raw SQL with `FOR UPDATE` won't work |
| Migrations | `prisma migrate` with 35 migrations | `wrangler d1 migrations`; full port of the schema |
| Per-tenant sharding | Not needed | Possible (up to 50,000 databases on Paid), but global uniqueness (organization `nameKey`, staff email, device identifiers, public org codes) and cross-tenant operations need a global database anyway |

**Answers**
- **A. Stay on PostgreSQL? YES.** Recommended.
- **B. Move entirely to D1?** No. It would mean a rewrite of every transactional and governance guarantee, for a database that is single-threaded and capped at 10 GB.
- **C. PostgreSQL + D1?** No real need. In the hybrid, the queue's **DO SQLite** already plays the hot-state role, scoped to one queue.
- **D. Per-Organization D1 databases?** No. Global uniqueness and cross-tenant governance would still need a central store, and every tenant database becomes a migration target.

---

## 6. Hyperdrive (Phase 9)

**PROVIDER LIMITS** (checked 2026-10-09):
- Free: 100,000 queries/day, about 20 origin connections per configuration, 10 configurations.
- Paid: unlimited queries, about 100 origin connections, 25 configurations.
- Both: 60 s maximum query duration; 10-minute idle connection timeout.
- Prisma on Workers uses `@prisma/adapter-pg` with `pg` ≥ 8.13 and `nodejs_compat`.

| Question | Answer |
|---|---|
| Connection pooling and reuse | Yes. Hyperdrive keeps warm pooled connections near the database, so a Worker or DO doesn't pay TLS + auth setup per request |
| Query caching | Read caching exists. **For LiveQueue, caching must be disabled** for queue state (stale reads would break FCFS and position correctness). At most, cache public read-only configuration |
| Latency | Removes connection setup; each query still costs one round trip to the Neon region. Keep the queue DO near the database (location hint), and keep queries per event low (H4) |
| Neon compatibility | Standard PostgreSQL wire protocol, so compatible. Use Neon's **direct** endpoint, because Hyperdrive does the pooling |
| Transactions | Interactive transactions run over one pooled connection; `FOR UPDATE` works inside them. Avoid long transactions: they hold pool slots ("Failed to acquire a connection from the pool") |
| Prisma | Works through the driver adapter. Raw SQL is fine. Generate the client with `--no-engine` |
| Query quota | Free: 100k/day. **Today's code makes about 50 queries per event, which would exhaust it at about 2,000 events (about 500 visits) a day.** With Model B (about 5–10 queries per event) plus H4, about 2,500–5,000 visits a day |
| Failure behaviour | If Neon is down, queries fail. Under Model B, writes then fail, as today. Under Model A, realtime keeps showing the last state. Queue DO reads served from memory keep working |

**Could we keep Neon/PostgreSQL and move API and realtime to Cloudflare?** **Yes.** That is exactly design B.

**Does Hyperdrive remove today's bottleneck?**
- **Not by itself.** Today's first bottleneck is Neon's free quotas (compute-hours, transfer, storage). Hyperdrive doesn't reduce queries or transfer, unless you count caching, which must stay off.
- The reduction comes from **holding hot queue state in the DO**, which removes the O(N) row reads per event, and from H6, which stops the per-minute polling. Hyperdrive is an **enabler** (connections from Workers), not a fix.

---

## 7. Cloudflare free-tier capacity model (Phase 11)

**PROVIDER LIMITS** (Free, per day unless stated):
- Workers: 100,000 requests, **10 ms CPU per invocation**.
- Durable Objects: 100,000 requests, 13,000 GB-s.
- DO SQLite: 5M rows read, 100k rows written, 5 GB stored.
- Hyperdrive: 100,000 queries.
- D1: 5M rows read, 100k rows written, 500 MB per database.
- Neon Free (unchanged): 100 CU-hours/month, 5 GB transfer, 1 GB storage.

**Per-visit usage under design B** (ESTIMATE; k = 4 events, staff actions through the DO, visitors on a hibernating socket):

| Resource | Per visit | Basis |
|---|---|---|
| Worker requests | about 10 | join, 2 ticket opens, 3 staff actions, about 4 staff page loads amortized |
| DO requests | about 6 | 1 visitor WebSocket connect, 1 join, 3 actions, alarms amortized (incoming WebSocket messages at 20:1) |
| DO duration | about 0.025 GB-s | about 50 ms awake per event × 4 events × 128 MB |
| Hyperdrive queries | about 40 (about 10 with batched writes) | about 5–10 queries per event, plus staff page loads |
| DO SQLite rows written | about 10 | |

| Scenario (ESTIMATE) | Visits/day | Waiting per queue | Concurrent WebSockets per queue | Workers req/day | DO req/day | GB-s/day | Hyperdrive q/day | Fits on Free? |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| SMALL: 1 org, 1–2 queues | 200 | about 10 | about 15 | 2k | 1.2k | 5 | 8k | Yes |
| MEDIUM: about 5 small orgs | 1,000 | about 20 | about 25 | 10k | 6k | 25 | 40k | Yes |
| BUSY: about 25 orgs | 5,000 | about 50 | about 60 | 50k | 30k | 125 | 200k (50k batched) | Only with batched DB writes; otherwise needs Hyperdrive Paid |
| EXTREME: one 2,000-person event + 50 orgs | 20,000 | 2,000 in one queue | about 2,000 | 200k | 120k | 500 | 400k+ | **No**: Workers and DO requests exceed Free → Workers Paid ($5/month minimum) |

**Reading the table**
- **Practical free capacity (design B): about 2,500–5,000 visits/day ≈ 55k–110k visits/month.** Hyperdrive's 100k queries/day binds first; with write batching, Workers' 100k requests/day binds next. That is about 2–4× today's ~25k/month (ESTIMATE, NOT LOAD-TEST VALIDATED).
- **Neon Free still applies underneath.** With hot state in the DO and no per-minute polling, Neon is awake only while writes happen. The 1 GB storage (about 285k cumulative visits) eventually binds in every PostgreSQL design.
- **The Workers Free 10 ms CPU per invocation is a real constraint.** bcrypt logins and Prisma-heavy handlers can exceed it. Keep the Worker thin (JWT verify + scope check + forward); do heavy work in the DO (30 s CPU per request) or keep it on Render. In practice, plan for **Workers Paid ($5/month)** as soon as APIs move.
- **Per-queue realtime:** no published WebSocket cap per object. The POC delivered one event to 2,500 local clients in about 234 ms. With the real ETA engine (after H1) and the batched protocol, about **1,000–2,500 concurrent clients per queue** is a reasonable ESTIMATE; above that, measure on Cloudflare.

---

## 8. Failure and reliability comparison (Phase 13)

| Failure | Current (Render + Neon) | Cloudflare hybrid (B) | New failure mode introduced |
|---|---|---|---|
| Provider outage | Render down → no API or realtime; Pages still serves static | Cloudflare outage takes static, API and realtime together; Neon outage blocks writes | **Correlated outage** (one vendor for edge + compute) |
| DB outage | Writes and reads fail | Writes fail; the DO can keep showing the last state | — |
| Object or process restart | Process restart drops all sockets; clients reconnect and resync | DO eviction is transparent (hibernation); a DO crash or **deploy disconnects all sockets** of that queue | Every deploy reconnects every client; needs jittered reconnect |
| Deploy during an active queue | Render rolling deploy; sockets drop once | Same (sockets drop) | — |
| Race conditions | Row locks + compare-and-swap in PostgreSQL | Single writer per queue (simpler); cross-queue changes need PostgreSQL-first ordering | DO state ↔ PostgreSQL divergence if the version discipline is broken |
| Lost events | Clients resync on reconnect, foreground and every ~10 minutes | Same, plus version-gap detection | — |
| Stale queue state | Low (DB truth every time) | The DO cache must reload on any external change | **Cache invalidation** across stores |
| Region latency | One Render region + Neon region | DO lives in one location (near its first caller or a hint); Workers at the edge | A badly placed DO adds latency to every DB write |
| Cold starts | Render Free about 1 minute | Workers about none; DO wake is milliseconds plus a state reload | — |
| Backups and disaster recovery | Neon point-in-time restore (6 hours on Free) | Same for PostgreSQL; DO SQLite is rebuildable from PostgreSQL in Model B | — |

---

## 9. Security comparison (Phase 14)

| Area | Current | Cloudflare hybrid | Must not weaken |
|---|---|---|---|
| Authentication | JWT + DB reload per request | The Worker verifies the JWT **and** reloads the staff row through Hyperdrive (1 query) | Instant revocation (ADR-071) |
| Session revocation | `disconnectStaff` + `accessRevokedAt` | Revocation epoch in PostgreSQL; the Worker checks it per request; the API tells each DO to close sockets whose attachment `staffId` matches | Must remain immediate; **don't rely on KV** (eventually consistent, up to about 60 s) |
| Role authorization and workspace isolation | Service layer | Unchanged for REST; the Worker checks queue scope before forwarding; the DO trusts only Worker-set headers. DOs are reachable only through bindings, never from the internet | Scope checks before the DO |
| Client IP | `CF-Connecting-IP` (ADR-073) | Native `request.headers.get('CF-Connecting-IP')` | — |
| Rate limiting | In-memory per process | Cloudflare WAF rate-limiting rules (plan-dependent) or the Workers Rate Limiting binding, plus per-DO counters | Same or stricter limits |
| WebSocket authentication | Socket.io handshake `auth` | Don't put long-lived JWTs in the URL (the POC does, for simplicity only). Use a short-lived single-use connect ticket from the API, or the `Sec-WebSocket-Protocol` header | No tokens in logs |
| Cross-tenant isolation | Queries scoped by organization | One DO per queue id; ids are unguessable UUIDs; the Worker checks the organization before forwarding | 404, never a leak |
| Secrets | Render environment | Workers secrets | — |
| Audit logs | Transactional with each change, immutable triggers | Unchanged: audit is still written in the same PostgreSQL transaction (Model B) | Never asynchronous for governance |

---

## Sources (checked 2026-10-09)
- Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/ (page "Last updated Sep 30, 2026")
- Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Workers pricing (with Queues, KV, D1, Hyperdrive tables): https://developers.cloudflare.com/workers/platform/pricing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Hyperdrive limits: https://developers.cloudflare.com/hyperdrive/platform/limits/
- Prisma with Hyperdrive: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/
