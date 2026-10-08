# LiveQueue — Production Architecture Summary

Study notes for the faculty presentation. **Current as of 2026-10-08:** production runs master `cb03e01` (Android release v1.0.6). The Floating Counter Console is implemented on `feature/floating-counter-console` and is **ready for review, not deployed**.

## 1. Components

| Layer | Technology (from the repository) | Role |
|---|---|---|
| Android app (visitors) | Flutter, `provider`, `http`, `socket_io_client`, `firebase_messaging` | Scan QR → choose queue and services → token → live tracking → push notifications |
| Staff dashboard | React 19, Vite, TanStack Query, Tailwind CSS 4, `socket.io-client` | Organization, Associates, queues, counters, live serving, reports, audit, governance |
| iPhone/iPad visitor portal | Same React build, separate entry (`portal.html`, `/visit/*`), PWA + service worker | Safari-only visitor flow with standards Web Push |
| Floating Counter Console (feature branch) | Document Picture-in-Picture + React portal; in-page fallback dock | Compact always-visible counter controls |
| Backend | Node.js, TypeScript, Express 5, Socket.io 4, Zod validation | REST API, authorization, business rules, realtime events, schedulers |
| Data | PostgreSQL (Neon), Prisma ORM 6, SQL migrations | System of record, constraints, triggers |
| Push / email | `firebase-admin` (FCM), `web-push` (VAPID), `resend` | Notifications and transactional email |
| Hosting | Render (one web service), Neon, Cloudflare Pages, GitHub (public repo, Actions, Releases) | — |

## 2. Request flow (REST)

`Client → HTTPS → Render (Express) → authenticate → validate (Zod) → service layer (authorization + business rules, often in a transaction) → Prisma → PostgreSQL → JSON envelope {success, data | error}`

- `authenticate` verifies the JWT and **reloads the Associate and Organization from the database on every request**; the database, not the token, is the source of role, status and Organization.
- The tenant scope is always the database's `organizationId`, never a client-supplied one. A record in another tenant answers 404, never 403, so its existence is not leaked (IDOR protection).
- ADR-069 workspace scoping (`workspaceScope.service.ts`): the Head and Manager see the Organization; an Admin sees their own workspace; an Executive sees their Admin's queue.

## 3. Realtime flow (Socket.io)

- **One Socket.io server in the same process.** The dashboard opens one connection per tab and joins `organization:{id}` (Head/Manager), `workspace:{adminId}` (Admin/Executive) or the legacy room; visitors join `token:{id}`; the public queue room carries no personal data.
- **Events notify; the database stays the truth.** The dashboard reacts to `token.*`, `queue.*` and `counter.*` events by invalidating TanStack Query caches, which refetch over REST. On every reconnect it re-joins rooms and refetches everything, because missed events are never replayed.
- Every queue change also recomputes ETAs and emits `token.position_changed` for each waiting person (`broadcastQueueEtaUpdate`).
- **Revocation:** `realtime.disconnectStaff` drops the sockets of anyone whose access changes. The next request answers `401 SESSION_REVOKED` and the dashboard signs out.
- **Scaling constraint:** no distributed adapter. **Run exactly one backend instance** (`docs/DEPLOYMENT.md` §12); a second instance would not deliver events emitted by the first.

## 4. Authentication and authorization

- Passwords: bcrypt (cost 12). Access token: JWT, 15 minutes, carrying a millisecond issue time (`iatMs`). Refresh token: 30 days, stored hashed, rotated atomically on every use; reuse of a rotated token revokes the session family (ADR-052).
- `staff.accessRevokedAt`: any role, status, workspace or password change, removal or handover sets it in the same transaction. Every request, optional-auth path and socket handshake rejects tokens issued before it.
- Permissions are derived from the role only (no per-user grants). Every mutation is authorized in the service layer, regardless of what the UI shows.
- Email verification for registration; invitation and handover links are single-use, stored as hashes and expiring; the Head-succession code is HMAC-hashed, valid 10 minutes, 5 attempts.
- Rate limiting: `express-rate-limit`, in-memory per process (public 60/min, join 10/min, auth 20 per 15 min, sensitive 30 per 15 min). Note: `trust proxy` is not configured — see the capacity analysis §M.0.

## 5. Roles and workspaces

| Role (internal) | Label | Scope |
|---|---|---|
| OWNER | Organization Head | Whole organization; governance; exactly one (DB-enforced) |
| MANAGER | Organization Manager | Organization-wide read, reports, audit; no serving |
| ADMIN | Admin | Own workspace; at most one live queue (DB-enforced) |
| STAFF | Executive | Belongs to one Admin's workspace; operates an assigned counter |

Governance roles: Head, Manager. Operational roles: Admin, Executive (the Head may also operate a counter they are assigned to on older, Admin-less queues).

## 6. Token lifecycle (centralized state machine — `tokenStateMachine.ts`)

`WAITING → CALLED → IN_PROGRESS → COMPLETED`
`WAITING / CALLED / IN_PROGRESS → SKIPPED` (staff; a reason is required)
`WAITING / CALLED → CANCELLED` (visitor)

On a journey, completing a step that is not the last returns the token to `WAITING` for the next step, keeping the original arrival order. Optional service-start verification: the visitor's one-time code is required for `CALLED → IN_PROGRESS`.

## 7. Service journey and dispatch

- The visitor builds an ordered journey of 1–20 steps from the queue's services, starting from the Admin's recommended order. A service may repeat (within its 1–10 limit) but never twice in a row. **The order is fixed once the token exists** (`409 JOURNEY_LOCKED`).
- Each counter handles chosen services (none selected = all).
- **Server-authoritative dispatch ("Serve next"):** the backend picks, for the caller's own counter, first the counter's referrals (earliest first), otherwise the earliest-joined waiting person whose *current step* that counter handles. A short transaction locks the counter row and compare-and-swaps the token, so two counters can never take the same person.
- **Referral:** on completing a step, an operator may send the next step to a specific open counter that handles it. That person is next at that counter, never interrupting anyone. If the counter closes first, the referral keeps its priority at another open counter that handles the step, or waits safely.
- ETA: an event-driven multi-counter simulation over every waiting person and later step.

## 8. Counters

Open (ACTIVE: operator required) · Paused (ON_BREAK: operator retained) · Off (OFFLINE: unassigned). Assigning an operator to an Off counter makes it Paused, never Open. Turning a counter Off releases its operator, and is refused while someone is called or in progress there. One operator per counter; one counter per person; a queue keeps at least one counter.

## 9. Notification architecture

| Channel | Used for | Mechanism |
|---|---|---|
| Socket.io | Live position, ETA, called, completed | In-app / in-portal while open |
| FCM (Android) | Called, reminders, lifecycle | `firebase-admin` → Google → device |
| Web Push (iPhone/iPad Safari, Home Screen PWA) | Same events | `web-push` with VAPID → Apple's push service → the visitor's Home Screen web app |
| Email (Resend) | Verification, invitations, password reset, Head succession, optional visitor email codes | HTTPS API |

A reminder scheduler (`node-cron`, every minute) sends "your turn is close" reminders. **Delivery is best-effort; no channel is guaranteed.**

## 10. Governance (v1.0.5–v1.0.6)

- Every live queue keeps an Admin (DB trigger). Changing or removing an Admin who runs a queue or has Executives requires a **replacement Admin**: an atomic workspace transfer (the queue, every Executive and pending invitee move; counters, tokens and history stay).
- **Head succession:** the Head's password plus an emailed code; the successor accepts via a single-use 72-hour link. In one transaction tenures switch, the old Head's account is closed, and history keeps snapshots.
- **Transactional, immutable history:** governance audit rows are written in the same transaction as the change, with actor/target snapshots. DB triggers forbid editing or deleting audit and transfer history, except as part of deleting the organization (which leaves a minimal deletion receipt).

## 11. Database (simplified domain)

Organization 1–N Staff (Associates) · Organization 1–N Queue · Admin 1–0..1 live Queue · Queue 1–N Counter · Queue 1–N QueueService · Counter N–M QueueService (`counter_services`) · Queue 1–N Token · Token 1–N TokenServiceStep (journey) · Token N–M QueueService (`token_services`) · Organization 1–N AuditLog · Organization 1–N HeadTenure / HeadSuccession / AdminWorkspaceTransfer · OrganizationDeletionReceipt (survives deletion) · Device 1–N Token · WebPushSubscription.

Constraints worth naming: one Head per organization (partial unique index); one live queue per Admin; one open succession per organization; a live queue requires an Admin (trigger); append-only history (triggers); unique token number per queue.

## 12. Deployment architecture

```
Visitors (Android app, iPhone portal)      Staff (dashboard, Floating Console*)
        │ HTTPS + WebSocket                        │ static assets
        ▼                                          ▼
 Render web service (1 instance) ◀── API ── Cloudflare Pages (dashboard + portal)
 Express + Socket.io + cron
        │ Prisma (TLS)            ├── FCM (Android push)
        ▼                         ├── Web Push (iPhone/iPad Safari Home Screen PWA, VAPID)
 Neon PostgreSQL                  └── Resend (email)
GitHub: source, Actions (tests, signed APK), Releases (APK)      *feature branch
```

- Render build: `npm ci --include=dev && npm run prisma:generate && npm run prisma:deploy && npm run build`. **Migrations run before the new code starts**; a failed migration fails the deploy and the old release keeps serving.
- Cloudflare Pages builds the dashboard and portal from master; API calls go directly to Render.
- Android releases: the `android-release.yml` workflow builds from master and verifies the APK: exactly one signer, release certificate pin, package, version, not debuggable, production API. When asked, it then tags and publishes. Example: **v1.0.6** (build 7, certificate `70:08:D3:…:0A:93`).

## 13. Current scaling limitations

1. **Single backend instance** (no Socket.io adapter) — vertical scaling only, until Redis and an adapter are added.
2. **Free-tier cold starts** — about 1 minute after 15 idle minutes.
3. **Per-event O(N) work** — ETA recompute and per-person `position_changed` fan-out, plus the dashboard refetch amplification (capacity analysis §E).
4. **Free-tier quotas** — Neon 100 CU-hours and 5 GB egress; Render Hobby 5 GB outbound; Resend 100 emails/day.
5. **In-memory rate limiting** — per process, and keyed on the IP without `trust proxy`.
6. **No formal load test; no centralized metrics or alerting.**
