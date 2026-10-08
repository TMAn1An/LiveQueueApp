# LiveQueue — Faculty Q&A Preparation

Answers reflect the actual repository and production state as of 2026-10-08 (production master `cb03e01`, Android v1.0.6). "Estimate" means it is not load-test validated; see `livequeue-capacity-analysis.md`.

### Architecture and design

**1. Why Socket.io instead of polling?**
Queue state changes are rare per person but must arrive quickly: being called is the moment that matters. Socket.io pushes an event the moment it happens and reconnects automatically. We still treat the database as the truth: events tell clients *what changed*, and clients refetch over REST to read the new state. Polling remains a fallback (the dashboard refreshes every 30 s).

**2. How do you guarantee first-come-first-served?**
The client never chooses who is next. "Serve next" sends only the queue id; the backend picks the earliest-joined waiting person whose current step the caller's counter handles, at the caller's own counter (ADR-064). The only exception is a referral, which a staff member makes deliberately when completing a step.

**3. What happens if two counters press "Serve next" at exactly the same time?**
Each claim runs in a database transaction that locks the caller's counter row and then updates the token with a compare-and-swap on its status (`WAITING → CALLED`). Only one update can match. The other counter gets the next eligible person, or `NO_ELIGIBLE_TOKENS`. Tests cover concurrent claims.

**4. How do you prevent two visitors getting the same queue position or number?**
Token numbers come from an atomic increment on the queue row, and a unique index on `(queue_id, sequence_number)` rejects duplicates. Position is not stored; it is computed from join time, so two people can't hold "the same position".

**5. How are race conditions handled in general?**
Transactions with row locks (`SELECT … FOR UPDATE`) on the organization, counter or token being changed; compare-and-swap updates; partial unique indexes (one Head, one live queue per Admin, one open succession); database triggers for invariants (a live queue needs an Admin; history is append-only); idempotency keys on joins.

**6. Why PostgreSQL?**
The domain is relational and transactional: organizations, associates, queues, counters, tokens, steps and audit. We rely on transactions, row locks, partial unique indexes, CHECK constraints and triggers to enforce rules that must hold even under concurrency.

**7. Why Prisma?**
Type-safe queries shared with TypeScript types, versioned SQL migrations (`prisma migrate deploy` in the release pipeline), and an escape hatch to raw SQL for locks and triggers.

**8. Why not microservices?**
One team, one domain with strong consistency needs, and a free-tier budget. A modular monolith (services, routes, a realtime module) gives transactions across the whole domain without distributed-consistency problems. The scaling path is vertical first, then replicas plus Redis — not a split into services.

**9. What makes this more than a CRUD project?**
Server-authoritative dispatch with routing and referrals; ordered multi-service journeys; an event-driven multi-counter ETA simulation; realtime synchronization across Android, web and iPhone; immediate session revocation, including live sockets; governance with transactional, immutable audit; Head succession; a production release pipeline with signing-certificate verification.

**10. What were the main engineering challenges?**
Keeping one source of truth across three clients; making concurrent claims safe; journeys with referral fallback; revoking access immediately everywhere; preserving history while people leave (snapshots); safe additive migrations on a live database.

### Security

**11. How does authentication work?**
bcrypt-hashed passwords; a 15-minute JWT access token plus a 30-day refresh token that is stored hashed and rotated on every use. Every request reloads the user and organization from the database, so a removed, suspended or changed user is refused at once.

**12. How do you revoke a user immediately?**
Any authorization change sets `accessRevokedAt` in the same transaction. Every request and socket handshake rejects tokens issued before it (millisecond precision), and the server disconnects that person's live sockets. The client then gets `401 SESSION_REVOKED` and signs out.

**13. What prevents IDOR?**
The tenant scope is always the database's `organizationId` for the authenticated user, never a client value. Every lookup is scoped by organization and workspace, and a record outside your scope answers 404, so its existence isn't revealed.

**14. How does Admin isolation work?**
One scoping module decides visibility: the Head and Manager see the organization; an Admin sees only their workspace; an Executive sees their Admin's queue. Reports, audit, service history and socket rooms use the same scope. Each Admin has at most one live queue, enforced by a partial unique index.

**15. How do you protect sensitive data?**
Visitors identify with a device id, not an account. Staff views and visitor views are separate serializers, so OTPs are never sent to staff and other people's data is never sent to visitors. Audit metadata is sanitized. Free text stays out of audit rows. The Floating Counter Console shows only token number and service.

**16. Is it fully secure?**
No system is. Known gaps: rate limiting is in-memory and keyed on the client IP without `trust proxy` behind Render's proxy, so limits may be shared across clients (to be verified and fixed). There's no WAF, no external penetration test and no centralized security monitoring.

### Governance

**17. What happens if an Admin leaves?**
If they run a live queue or have Executives, the system refuses until the Head chooses a replacement (`ADMIN_OWNS_LIVE_QUEUE`). The handover is one transaction: the queue and every Executive move; counters, tokens and history are untouched.

**18. What happens if the Organization Head leaves?**
Head succession: the Head confirms with their password and an emailed code. The successor accepts through a single-use 72-hour link. In one transaction the tenures switch and the old Head's account is closed; their actions remain in history as snapshots.

**19. Can audit history be edited?**
Not through the application, and not through SQL either: database triggers reject updates and deletes on audit and transfer history. The only exception is deleting the whole organization, which leaves a minimal deletion receipt.

### Reliability

**20. How does the app behave when Socket.io disconnects?**
Socket.io reconnects automatically. On reconnect the client re-joins its rooms and refetches everything, because missed events are never replayed. The dashboard also refreshes every 30 s. The Floating Console holds its actions until the connection is live again.

**21. What happens if Render goes down?**
The API and realtime stop; the dashboard still loads from Cloudflare but shows a reconnecting state. Clients resync when the backend returns. There is no multi-region failover today.

**22. What happens if the database fails?**
Requests fail with errors; nothing is half-written because changes are transactional. Neon provides point-in-time restore within its window (6 hours on Free). There is no hot standby on the free tier.

**23. How are migrations deployed safely?**
Migrations are additive and reviewed. They're tested on a fresh database and on an upgrade from the previous schema, with no data loss and no schema drift. They run in Render's build (`prisma migrate deploy`) before the new code starts; a failed migration fails the deploy and the old version keeps serving. Before v1.0.6 we ran read-only preflight queries on production.

### Capacity and cost

**24. What is the current bottleneck?**
Network egress quotas on the free tiers (Neon 5 GB and Render 5 GB per month), currently amplified by the dashboard refetching once per waiting person on each queue event. That's a software fix. Next come Neon's 100 CU-hours (about 400 active hours a month) and Render Free's 0.1 CPU and cold starts.

**25. How many people can wait in one queue?**
There's no software limit. On the current free server we estimate up to about **50 waiting per queue** comfortably, and about 300–500 after the refetch fix. That's an estimate from measured per-event costs, not a load test.

**26. How many concurrent users can you support?**
Estimate: a few hundred concurrent sockets platform-wide on Render Free at modest event rates. Concurrency, not registered accounts, is what matters: 100,000 accounts are just rows.

**27. How was that calculated?**
We measured locally the payload size of every request and socket event, the per-event fan-out (≈3 messages per waiting person per serve cycle), and a real browser's refetches (305 requests for one serve with 200 waiting). We combined those with the published quotas in formulas, and labelled every result as an estimate.

**28. How large can it run for free?**
About one small organization's daily traffic today (≈4,000 visits/month), and an estimated ≈25,000 visits/month (about five small organizations) after the refetch fix. Not load-test validated.

**29. What is free, and what costs money first?**
Render Free, Neon Free, Cloudflare Pages, FCM, Web Push, Resend Free and GitHub (public repo) are all free. The domain may have its own registration cost. First to cost money: Neon Launch (≈$10–20/month, usage-based), then Render Starter ($7/month) for always-on and 5× the CPU.

**30. Why Render, Neon and Cloudflare Pages?**
Render runs a long-lived Node.js process with WebSockets, which serverless platforms handle poorly. Neon is managed PostgreSQL with branching and a usable free tier. Cloudflare Pages serves static assets globally with no published bandwidth cap. Each is the right shape for its job at zero cost.

**31. How do you scale Socket.io beyond one server?**
Add the Socket.io Redis adapter so events emitted on one instance reach clients connected to the others. Move rate-limit counters to Redis too. Use sticky sessions or WebSocket-only transport behind the load balancer. Until then we deliberately run one instance.

**32. What would you change for 100,000 users?**
First, fix the per-person fan-out: send one queue-level update instead of N, and stop the refetch storm. Then: paid CPU, multiple instances with Redis and the Socket.io adapter, a shared rate-limit store, Neon autoscaling with connection pooling, background jobs for notifications, metrics and alerting — sized by a staged load test.

### Testing and verification

**33. What testing has been done?**
Production master: backend 1,216 tests, dashboard 574, Flutter 479 — all passing — plus typecheck, lint and production builds. The Floating Console branch: 1,222 and 614. Migration upgrade tests on a copy of the schema, a read-only production preflight, production smoke checks, and APK signing verification on every release.

**34. Has formal load testing been done?**
No. Our capacity figures are estimates from measured payloads and published quotas. A staged load-test plan exists (100 → 5,000 clients) and would run against a staging copy, never production.

**35. What remains unverified physically?**
Real iPhone Web Push delivery (pending a physical iPhone test) and physical Android device QA. The Floating Console's OS-level always-on-top behaviour can't be verified headlessly.

**36. Why a browser Picture-in-Picture console instead of a desktop app?**
Document Picture-in-Picture gives an always-on-top window with the same session, data and socket, and no new security surface, install or update channel. A Tauri/Electron companion is a possible future step, not current work.
