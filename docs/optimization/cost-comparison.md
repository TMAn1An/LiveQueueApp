# LiveQueue — provider costs and cost at scale

**Checked:** 2026-10-09; Neon and Render also re-confirmed on 2026-10-08.
**Labels:** PROVIDER LIMIT · ESTIMATE · NOT LOAD-TEST VALIDATED. Every monthly total below is an **ESTIMATE**.
Engineering time, the domain, and taxes are excluded.

## 1. Provider quotas and prices (PROVIDER LIMIT)

### Cloudflare
Source: developers.cloudflare.com, checked 2026-10-09.

| Product | Free | Paid (Workers Paid, minimum **$5/month** per account) |
|---|---|---|
| Workers | 100,000 requests/day; **10 ms CPU** per invocation; 50 subrequests; 128 MB | 10M requests/month, then $0.30/M; 30M CPU-ms/month, then $0.02/M CPU-ms; up to 5 min CPU per request; **no egress or bandwidth charges** |
| Durable Objects | SQLite-backed only; 100,000 requests/day; 13,000 GB-s/day; operations fail when exceeded | 1M requests/month, then $0.15/M; 400,000 GB-s/month, then $12.50/M GB-s |
| DO WebSockets | A connection is 1 request; **outgoing messages free**; incoming messages 20:1; no duration billed while hibernated | Same |
| DO SQLite storage | 5M rows read/day; 100k rows written/day; 5 GB in total | 25B rows read, then $0.001/M; 50M rows written, then $1.00/M; 5 GB-month, then $0.20/GB-month |
| D1 | 5M rows read/day; 100k rows written/day; 500 MB per database; 10 databases; 5 GB in total | 25B reads, 50M writes, 5 GB included; then $0.001/M, $1.00/M, $0.75/GB-month; 10 GB per database |
| Hyperdrive | 100,000 queries/day; about 20 origin connections | Unlimited queries; about 100 origin connections |
| Queues | 10,000 operations/day; 24 h retention | 1M operations/month, then $0.40/M |
| KV | 100k reads, 1k writes/day; 1 GB | 10M reads, 1M writes/month; then $0.50/M reads, $5.00/M writes |
| Pages (static) | Already used; no published bandwidth cap | — |

### Current stack and alternatives

| Provider | Free | First paid steps |
|---|---|---|
| **Render** (render.com/docs/free) | Free web service: spins down after 15 min idle; about 1 min spin-up; 750 instance-hours/workspace; Hobby workspace 5 GB outbound/month; **without a payment method, exceeding bandwidth suspends all Free services** | Starter 0.5 CPU about **$7**; Standard 1 CPU / 2 GB about **$25**; Pro 2 CPU about $85; Pro Plus 4 CPU about $175 (the pricing page renders dynamically; figures as previously corroborated, **confirm in the dashboard**); bandwidth overage $0.15/GB |
| **Neon** (neon.com/pricing, 2026-10-09) | 100 CU-hours/project/month; 1 GB storage/project; 5 GB egress; scale to zero after 5 min (can't be disabled); up to 2 CU | **Launch:** $0.106/CU-hour, $0.35/GB-month storage, 500 GB egress included then $0.10/GB, no minimum. **Scale:** $0.222/CU-hour |
| **Railway** (railway.com/pricing) | Free: $1/month usage credit; 1 vCPU / 0.5 GB per service | Hobby $5/month including $5 usage; about $20/vCPU-month, about $10/GB-month RAM, **$0.05/GB egress**, $0.15/GB-month volumes; Pro $20/month |
| **DigitalOcean** (digitalocean.com/pricing/droplets) | — | Basic droplet 1 GB **$6**, 2 GB $12 (1–2 TB transfer included); backups 20–30% of the droplet price |
| **Hetzner** | — | CX23 (2 vCPU / 4 GB) about **€5.49–5.99/month** after the April 2026 price change. **Third-party sources only:** hetzner.com renders prices dynamically, so confirm before buying. 20 TB traffic in the EU |
| **Resend** (resend.com/pricing) | 3,000 emails/month, **100/day** | Pro $20 (50k/month); Scale from $90 (100k) |
| **FCM / Web Push** | No-cost products | — |
| **GitHub** | Public repository: Actions runners free | — |

## 2. Workload assumptions (ESTIMATE)
- Per visit: 4 queue events (join, call, start, complete), about 20 waiting on average, 2 staff tabs per queue.
- 8 business hours a day, 22 days a month, one shared time zone; peak = 3 × average.

Resource use per visit:

| Architecture | Resource use per visit |
|---|---|
| **Current** (MEASURED + ESTIMATE) | About 0.8 s local CPU, about 530 DB queries, about 0.2 MB Neon egress, about 0.12 MB Render outbound |
| **Current optimized** (H1–H8) | About 0.25 s CPU, about 150 queries, about 0.07 MB Neon egress, about 0.03 MB outbound |
| **Cloudflare hybrid** (design B) | About 10 Worker requests at about 15 ms CPU, about 6 DO requests, about 0.025 GB-s, about 40 Hyperdrive queries, about 0.02 MB Neon egress |
| **Cloudflare native** | Same as hybrid, but with D1 instead of Neon (about 400 rows read, about 25 rows written per visit) |
| **VPS** | Optimized code with PostgreSQL on the same machine |

## 3. Monthly cost at scale (ESTIMATE, NOT LOAD-TEST VALIDATED)

### Totals

| Visits/month | Current | Current optimized | Cloudflare hybrid | Cloudflare native (D1) | VPS (+backups) |
|---:|---:|---:|---:|---:|---:|
| 10,000 | **$0** | **$0** | **$0** | **$0** | about $8 |
| 25,000 | **$0–7** (Render Free is borderline; Starter if CPU binds) | **$0** | **$0** | **$0** | about $8 |
| 50,000 | about $13 | **$0** | **$0** | **$0** | about $8 |
| 100,000 | about $37 | about $13 | about $11 | about $5 | about $8 |
| 250,000 | about $100 (at the single-process ceiling) | about $14 | about $12 | about $5 | about $8 |
| 500,000 | about $230 (needs horizontal scaling) | about $51 | about $20 | about $10 | about $17 |
| 1,000,000 | about $300+ (replicas + Redis) | about $140 | about $26 | about $20 | about $36 |

### Breakdown

| Visits/month | Line | Current | Current optimized | Cloudflare hybrid | Cloudflare native | VPS |
|---:|---|---|---|---|---|---|
| 10k | backend / realtime | Render Free | Render Free | Workers Free + DO Free | Workers Free + DO Free | VPS $7 |
| | DB | Neon Free | Neon Free | Neon Free (via Hyperdrive Free) | D1 Free | on the VPS |
| | bandwidth / frontend | $0 / Pages $0 | $0 / $0 | $0 / $0 | $0 / $0 | $0 / Pages $0 |
| 100k | backend / realtime | Render Standard $25 | Render Starter $7 | Workers Paid $5 | Workers Paid $5 | VPS $7 |
| | DB | Neon Launch about $11 | Neon Launch about $6 | Neon Launch about $6 | D1 included | on the VPS |
| | bandwidth | about $1 | $0 | $0 | $0 | $0 |
| 1M | backend / realtime | 2–3 × Render Pro Plus + Redis, about $190 | Render Pro $85 | Workers Paid about $8 | Workers Paid about $8 | VPS about $30 |
| | DB | Neon about $92 (1–2 CU) | Neon about $50 | Neon about $18 (writes only, scales to zero) | D1 about $12 | on the VPS |
| | bandwidth | about $17 | about $4 | $0 | $0 | $0 (TBs included) |

**Email** is the same in every architecture:
- Resend Free while email stays below 100 a day (staff email only);
- **Pro at $20/month** once queues verify visitors by email (one email per join), from about 100 such joins a day.

**Frontend:** Cloudflare Pages costs $0 in every architecture.

### Reading the numbers honestly
- **Up to about 100k visits/month, every architecture costs $0–40/month.** The differences are a few dollars, while a migration costs weeks of engineering. At that scale cost is not a reason to migrate.
- **The biggest saving available today is not a provider change.** It is H1–H8 (`performance-hotspots.md`): they roughly double the free capacity, and move the single-process ceiling from about 250k to about 800k visits a month.
- **From about 250k–500k visits/month, the Cloudflare hybrid becomes clearly cheaper** ($20–26 vs $50–140 at 500k–1M). The reasons:
  - Durable Objects replace both the CPU-bound single Node process and the Redis + replicas stage.
  - Outgoing WebSocket messages and egress are free.
  - Neon then serves only writes and history.
- **A VPS is cheapest in dollars at every scale,** but carries operations work the other options avoid: patching, backups, monitoring, PostgreSQL upgrades and failover. It is also a single point of failure. Its total cost of ownership is higher than the bill suggests.
- **Cloudflare-native (D1) looks cheapest,** but `cloudflare-architecture.md` §5 shows it would require rewriting every transactional and governance guarantee. Excluded on suitability, not cost.
- **Neon Free storage (1 GB) fills at about 285k cumulative visits in every PostgreSQL design** unless retention is introduced (H9). After that, Neon Launch storage is $0.35/GB-month: about $1–15/month in the first year at these volumes.

## 4. Free-tier capacity comparison (ESTIMATE, NOT LOAD-TEST VALIDATED)

| | Current (live) | Current optimized | Cloudflare hybrid (B) |
|---|---|---|---|
| Visits/month on free tiers | about 25,000 | about 50–60,000 | about 55–110,000 (Hyperdrive 100k queries/day binds; more with write batching) |
| First free-tier limit hit | Render Free CPU and Neon CU-hours, transfer and storage | Neon CU-hours, then storage | Hyperdrive or Workers daily requests, then Neon storage |
| Comfortable waiting per queue | about 300–500 | about 1,000 | about 1,000–2,500 per queue Durable Object |
| Small organizations, similar business hours | about 5 | about 10 | about 10–20 |
