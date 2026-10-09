# LiveQueue — migration complexity and staged plan

**Status: a plan only.** Nothing here is implemented, merged or deployed. Implementation needs explicit owner approval.

## 1. Migration complexity (Phase 15)

The two right-hand columns describe the same component under two targets: **Hybrid**, where Render keeps REST, and **Full Workers**.

| Component | Today | Hybrid (B) | Full Workers / native | Notes |
|---|---|---|---|---|
| React dashboard | React Query + `socket.io-client` | **Small adaptation** | Small adaptation | Replace the socket wrapper with a WebSocket client and the version/resync protocol. Batching (ADR-074) stays |
| iPhone/iPad portal | `useLiveToken` over Socket.io | **Small adaptation** | Small adaptation | Already applies event payloads (ADR-075); only the transport and the `me` message change |
| Flutter Android | `socket_io_client`; applies `position_changed` | **Medium adaptation + app release** | Medium + release | Both transports must run until old installs age out (v1.0.6 is on devices) |
| REST API (110 routes) | Express | **As-is** (stays on Render) | **Rewrite** to Hono or Workers routing | Hono keeps an Express-like shape; every middleware is re-ported |
| Auth | JWT + DB reload, bcrypt | As-is (Render); the Worker adds JWT verify + staff reload for DO routes | **Small adaptation** | bcrypt in a Worker may exceed the Free 10 ms CPU; keep login on Render, or use Workers Paid |
| Express middleware (helmet, cors, rate limit, validation) | Express | As-is | **Rewrite** | Zod validators reusable as-is |
| Prisma | Node engine | As-is (Render); `@prisma/adapter-pg` via Hyperdrive in DO/Workers | **Small adaptation** | `FOR UPDATE` raw SQL still works on PostgreSQL |
| PostgreSQL schema and migrations | 35 migrations, triggers | **As-is** + one migration (`queues.state_version` + trigger) | As-is (or **full rewrite** for D1) | |
| Queue services, FCFS dispatch | `token.service.ts` (2,711 lines) | **Rewrite of the dispatch path** into the queue DO (single writer); the transactional writes are re-used | Rewrite | Highest-risk area; FCFS, referrals and journeys must be identical |
| ETA calculation | `queueEtaEngine.ts` (pure) | **As-is** (imported into the DO) + H1 | As-is | |
| Socket.io realtime | `realtime/*` | **Rewrite** (hibernatable WebSockets, batched protocol) | Rewrite | |
| Notifications | FCM (`firebase-admin`), `web-push`, Resend | As-is (Render) | **Small/medium adaptation** | FCM v1 over `fetch`; `web-push` needs `nodejs_compat` crypto or a fetch-based VAPID signer |
| Governance, audit | Transactional services + triggers | **As-is** | Rewrite of handlers; schema as-is | Never asynchronous for audit |
| Tests (1,234 backend, 640 dashboard, 479 Flutter) | Vitest + supertest | As-is for REST; **new** DO tests (`@cloudflare/vitest-pool-workers`) | Large rewrite of the backend harness | Keep the old engine as an oracle |

### Effort (ESTIMATE, one experienced engineer, ±40%)

| Path | Effort |
|---|---|
| **Optimized current stack (H1–H8, H13)** | **2–4 weeks** |
| Hybrid, realtime coordinator only (Model A) | 3–5 weeks |
| Hybrid, DO owns dispatch with write-through (Model B), REST stays on Render | 6–10 weeks, plus an Android release cycle |
| Hybrid with all API paths on Workers | 12–20 weeks |
| Cloudflare-native with D1 | 20–30+ weeks, plus a full revalidation of governance |

## 2. Staged strangler migration (Phase 16)

Each stage ships behind a flag, can be rolled back in minutes, and needs a green production smoke before the next stage starts.

| Stage | What changes | Exit criteria | Rollback |
|---|---|---|---|
| **0 — Now: optimize in place** | H6 (crons), H4, H5, H7, H8, H13 (CI); then H1 (linear ETA, with the old engine as oracle), H2 (state version + memo), H3 (batched protocol alongside `position_changed`) | Tests and oracle green; event CPU ↓ about 3×; Neon awake only during activity; production smoke | Revert commits; protocol flag off |
| **1 — Edge proxy (no behaviour change)** | A Worker on a new route (`api.<domain>`) proxies REST and the WebSocket upgrade to Render unchanged; `CF-Connecting-IP` already handled | Latency unchanged; clients configurable to either origin | Point clients back to `onrender.com` |
| **2 — One experimental queue DO (shadow)** | The API notifies a queue DO after each committed change (Model A). The DO computes snapshots and ETAs and serves **staff dashboards only** for one internal test queue. Socket.io continues in parallel | DO snapshots identical to the PostgreSQL simulation (automated diff on every version) | Feature flag per queue → Socket.io |
| **3 — Realtime for selected queues through the DO** | Dashboard and portal connect to the DO WebSocket for flagged queues (batched protocol); Android stays on Socket.io | No version gaps without resync; reconnect storms after deploys handled (jittered backoff) | Unflag the queue → clients fall back to Socket.io |
| **4 — All web realtime through DOs; Android release with WebSocket support** | Every queue; Socket.io remains only for old Android builds | Active Android installs on the new build above X% (Play/Release telemetry) | Global flag → Socket.io |
| **5 — DO owns dispatch (Model B)** | Serve next / start / complete / skip / join go to the DO, which writes through to PostgreSQL in one transaction; `queues.state_version` enforced | Oracle tests: DO decisions = PostgreSQL decisions on replayed production-shaped traffic; zero divergence alerts for 2 weeks | Route the mutations back to Render's endpoints (the DO becomes Model A again) |
| **6 — Retire Render (only if justified)** | Move the remaining REST (governance, reports, auth) to Workers + Hyperdrive, or keep a small Render service | Cost or operations benefit shown at the then-current scale | Keep Render; this stage is optional |

**Guardrails for every stage**
- PostgreSQL stays the system of record.
- Audit stays in the same transaction as the change.
- Revocation stays immediate.
- No production data is changed by the migration itself.
- The Neon backup is untouched.
- Each stage gets a written rollback drill before it is enabled.
