# Cloudflare Durable Object proof of concept — results

**Branch:** `experiment/cloudflare-queue-durable-object`, commit `4f20494`. The code is under `experiments/cloudflare-queue-do/`.
**Isolation:** not wired into the app, not deployed, no production data, no Cloudflare account used.
**Environment:** local `wrangler dev --local` (wrangler 4.149, workerd), on the same 4-core machine as the other measurements.
**Label:** MEASURED (local). **Local synthetic results are not Cloudflare production capacity.**

## What was built
- **Worker:** verifies an HS256 bearer with WebCrypto and enforces roles **before** forwarding to `QUEUE.idFromName(queueId)`.
  - Unauthenticated Serve next → **401**.
  - Visitor calling Serve next → **403**.
  - Neither reaches the Durable Object.
- **`QueueDurableObject` (SQLite-backed)** keeps `tickets`, `meta(version)` and `outbox` tables:
  - strict FCFS Serve next as the single writer, with no locks;
  - every change commits in one `transactionSync` (state + version + outbox row), the persistence strategy to be flushed to PostgreSQL through Hyperdrive.
- **Hibernatable WebSockets:**
  - accepted with `ctx.acceptWebSocket(server, [role])`;
  - per-socket `serializeAttachment({role, sub, ticket})`, read back with `deserializeAttachment()` on every broadcast, which is how state is restored after eviction.
- **Batched protocol:**
  - **one** `delta` per event to each staff socket (ordered line + ETA array + version);
  - **one** small `me` message per visitor (own position, wait, version);
  - a `resync` request on a version gap.
- **Load generator:** `load.mjs` mints test tokens, joins N visitors, opens N visitor sockets + 1 staff socket, then runs 10 × Serve next.

## Results (MEASURED locally, median of 10 Serve next)

| Visitors | Sockets | HTTP requests per Serve next | Messages delivered per event | Serve next → last message delivered | Bytes to the staff tab | Bytes to all visitors |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 101 | 1 | 101 | about 26 ms | 741 B | 3.3 KB |
| 500 | 501 | 1 | 501 | about 65 ms | 4.2 KB | 17.2 KB |
| 1,000 | 1,001 | 1 | 1,001 | about 105 ms | 8.7 KB | 35.7 KB |
| 2,500 | 2,501 | 1 | 2,501 | about 234 ms | 24.2 KB | 91.7 KB |

**Comparison with the current protocol** (formula from MEASURED sizes: about 0.33 KB per `position_changed`):

| Visitors | Today: messages to one staff tab | POC | Today: bytes to one staff tab | POC | Reduction |
|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 1 | about 33 KB | 0.74 KB | about 45× |
| 500 | 500 | 1 | about 165 KB | 4.2 KB | about 39× |
| 1,000 | 1,000 | 1 | about 330 KB | 8.7 KB | about 38× |
| 2,500 | 2,500 | 1 | about 825 KB | 24.2 KB | about 34× |

Visitor messages also shrink from about 330 B to about 34–37 B, about 9× smaller.

## What this does and doesn't prove

**Proven, locally**
- One object per queue can hold the live line, decide FCFS as a single writer, version every change, and fan out a batched update to 2,500 local clients in a few hundred milliseconds.
- Staff traffic drops from N messages to 1 per event.
- Authentication and role checks in the Worker keep rejected traffic away from the object.

**Not proven**
- **Cloudflare network latency and throughput.**
- **Billing:** local dev can't show GB-s or hibernation savings.
- **Real eviction and wake:** local mode keeps the object in memory. Attachment restoration is exercised, but true eviction isn't.
- **Behaviour across deploys:** Cloudflare documents that every code update disconnects all WebSockets.
- **The real routed ETA engine:** the POC uses simple FCFS ETAs over one service.
- **Write-through to PostgreSQL through Hyperdrive.**

**Timing caveat:** inside workerd `performance.now()` is coarse by design (it advances on I/O), so the in-object `handlerMs` counter isn't a CPU measurement. The table uses end-to-end client-side timing, which includes the Node client receiving every message in the same process.

**Security shortcut in the POC:** the WebSocket URL carries the bearer token as a query parameter. That is acceptable for local synthetic tests only. A real design uses a short-lived single-use connect ticket or the `Sec-WebSocket-Protocol` header (`cloudflare-architecture.md` §9).

## Reproduce
```bash
git checkout experiment/cloudflare-queue-durable-object
cd experiments/cloudflare-queue-do && npm install
npm run dev &               # wrangler dev --local on :8787
node load.mjs 1000 10
```
