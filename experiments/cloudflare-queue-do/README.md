# EXPERIMENT — one Durable Object per live queue (local proof of concept)

**Not production code. Not deployed. No production data. Not wired into the app.**
Branch `experiment/cloudflare-queue-durable-object`; see
`docs/optimization/cloudflare-poc-results.md` on `audit/full-architecture-optimization`
for the write-up.

What it shows:

- A Worker authenticates every request (HS256, WebCrypto) and enforces roles
  **before** forwarding to the queue's Durable Object (unauthenticated → 401,
  visitor calling Serve next → 403), so rejected traffic never bills the DO.
- `QueueDurableObject` (SQLite-backed) owns one queue: waiting list, strict FCFS
  Serve next (single writer — no row locks), a version number, and an outbox of
  every change that a real system would flush to PostgreSQL through Hyperdrive.
- Hibernatable WebSockets (`ctx.acceptWebSocket`, tags `staff`/`visitor`,
  per-socket attachment `{role, sub, ticket}` restored after eviction).
- The batched protocol: **one** message per event to each staff socket (whole
  ordered line + ETA array + version) and **one tiny** message per visitor
  (own position + wait + version); a client that sees a version gap sends
  `resync`.

Run locally:

```bash
npm install
npm run dev            # wrangler dev --local on :8787
node load.mjs 1000 10  # 1,000 synthetic visitors + 1 staff socket, 10 Serve next
```
