/**
 * EXPERIMENT ONLY — not production code, not deployed, no production data.
 *
 * A Worker in front of one Durable Object per live queue:
 * - The Worker authenticates every request (HS256 bearer, WebCrypto) and
 *   only then forwards it, so unauthenticated traffic never bills the DO.
 * - The QueueDurableObject owns the live queue: waiting list, counters,
 *   strict FCFS Serve next, and the realtime fan-out over hibernatable
 *   WebSockets. Its SQLite storage is the live-state store; every change is
 *   also appended to an outbox that a real system would flush to PostgreSQL
 *   (via Hyperdrive) as the durable business/history record.
 */
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  QUEUE: DurableObjectNamespace<QueueDurableObject>;
  POC_JWT_SECRET: string;
}

type Role = 'staff' | 'visitor';
interface Claims {
  sub: string;
  role: Role;
  queueId: string;
  exp: number;
}

// ---------------------------------------------------------------- auth ---
const enc = new TextEncoder();
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signToken(secret: string, claims: Claims): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
async function verifyToken(secret: string, token: string | null): Promise<Claims | null> {
  if (!token) return null;
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(`${head}.${body}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Claims;
  return claims.exp * 1000 > Date.now() ? claims : null;
}

// -------------------------------------------------------------- worker ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // POC-only helper to mint test tokens for synthetic clients.
    if (url.pathname === '/poc/token' && request.method === 'POST') {
      const claims = (await request.json()) as Claims;
      return Response.json({ token: await signToken(env.POC_JWT_SECRET, claims) });
    }
    const m = url.pathname.match(/^\/queues\/([A-Za-z0-9_-]{1,64})\/(join|serve-next|ws|snapshot|start|complete|stats)$/);
    if (!m) return new Response('not found', { status: 404 });
    const [, queueId, action] = m;
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? url.searchParams.get('access_token');
    const claims = await verifyToken(env.POC_JWT_SECRET, bearer);
    if (!claims || claims.queueId !== queueId) return new Response('unauthorized', { status: 401 });
    const staffOnly = ['serve-next', 'start', 'complete', 'snapshot', 'stats'];
    if (staffOnly.includes(action!) && claims.role !== 'staff') return new Response('forbidden', { status: 403 });
    // The DO trusts these headers only because they come from this Worker.
    const fwd = new Request(request, { headers: new Headers(request.headers) });
    fwd.headers.set('x-poc-sub', claims.sub);
    fwd.headers.set('x-poc-role', claims.role);
    const stub = env.QUEUE.get(env.QUEUE.idFromName(queueId!));
    return stub.fetch(fwd);
  },
};

// ------------------------------------------------------- durable object ---
interface Attachment {
  role: Role;
  sub: string;
  ticket: number | null;
}

const SERVICE_MINUTES = 5;

export class QueueDurableObject extends DurableObject<Env> {
  private sql: SqlStorage;
  private version = 0;
  private counters = 1;
  private loaded = false;
  private stats = { events: 0, staffMsgs: 0, staffBytes: 0, visitorMsgs: 0, visitorBytes: 0, handlerMs: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Kept tiny: the constructor runs again every time the object wakes from hibernation.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tickets (seq INTEGER PRIMARY KEY, sub TEXT NOT NULL, status TEXT NOT NULL, joined_at INTEGER NOT NULL, called_at INTEGER, counter INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS tickets_status_seq ON tickets(status, seq)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL)`);
  }

  private load() {
    if (this.loaded) return;
    const v = this.sql.exec<{ v: number }>(`SELECT v FROM meta WHERE k = 'version'`).toArray()[0];
    this.version = v?.v ?? 0;
    const c = this.sql.exec<{ v: number }>(`SELECT v FROM meta WHERE k = 'counters'`).toArray()[0];
    this.counters = c?.v ?? 1;
    this.loaded = true;
  }

  /** Every state change: bump the version and record it for the durable store, in one storage transaction. */
  private commit(kind: string, body: unknown) {
    this.version += 1;
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, this.version);
    this.sql.exec(`INSERT INTO outbox (version, kind, body) VALUES (?, ?, ?)`, this.version, kind, JSON.stringify(body));
  }

  private waiting(): { seq: number; sub: string }[] {
    return this.sql.exec<{ seq: number; sub: string }>(`SELECT seq, sub FROM tickets WHERE status = 'WAITING' ORDER BY seq`).toArray();
  }

  /** ETA per position, O(N log C) — the simple FCFS case; the real engine adds routing and journeys. */
  private etas(n: number): number[] {
    const free = Array.from({ length: this.counters }, () => 0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = 1; j < free.length; j++) if (free[j]! < free[k]!) k = j;
      out.push(free[k]!);
      free[k]! += SERVICE_MINUTES;
    }
    return out;
  }

  /**
   * The batched protocol. Staff get ONE message per event with the whole
   * ordered line (positions are implicit in the order; ETAs as one int
   * array). Each visitor gets ONE tiny message with only their own
   * position and wait. Everything carries the state version, so a client
   * that sees a gap asks for a fresh snapshot.
   */
  private broadcast(event: Record<string, unknown>) {
    const line = this.waiting();
    const etas = this.etas(line.length);
    const staffMsg = JSON.stringify({ t: 'delta', v: this.version, e: event, line: line.map((x) => x.seq), eta: etas });
    for (const ws of this.ctx.getWebSockets('staff')) {
      ws.send(staffMsg);
      this.stats.staffMsgs++;
      this.stats.staffBytes += staffMsg.length;
    }
    const positionBySeq = new Map(line.map((x, i) => [x.seq, i]));
    for (const ws of this.ctx.getWebSockets('visitor')) {
      const a = ws.deserializeAttachment() as Attachment;
      if (a.ticket == null) continue;
      const i = positionBySeq.get(a.ticket);
      const msg = i === undefined ? JSON.stringify({ t: 'me', v: this.version, s: this.statusOf(a.ticket) }) : JSON.stringify({ t: 'me', v: this.version, p: i + 1, w: etas[i] });
      ws.send(msg);
      this.stats.visitorMsgs++;
      this.stats.visitorBytes += msg.length;
    }
  }

  private statusOf(seq: number) {
    return this.sql.exec<{ status: string }>(`SELECT status FROM tickets WHERE seq = ?`, seq).toArray()[0]?.status ?? 'UNKNOWN';
  }

  async fetch(request: Request): Promise<Response> {
    this.load();
    const t0 = performance.now();
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();
    const sub = request.headers.get('x-poc-sub')!;
    const role = request.headers.get('x-poc-role') as Role;
    try {
      switch (action) {
        case 'ws': {
          if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
          const ticket = role === 'visitor' ? (this.sql.exec<{ seq: number }>(`SELECT seq FROM tickets WHERE sub = ? ORDER BY seq DESC LIMIT 1`, sub).toArray()[0]?.seq ?? null) : null;
          // Hibernatable: the runtime holds the socket; the object can be evicted from memory between events.
          this.ctx.acceptWebSocket(server, [role]);
          server.serializeAttachment({ role, sub, ticket } satisfies Attachment);
          return new Response(null, { status: 101, webSocket: client });
        }
        case 'join': {
          const seq = (this.sql.exec<{ m: number }>(`SELECT COALESCE(MAX(seq), 0) + 1 AS m FROM tickets`).toArray()[0]!.m);
          this.ctx.storage.transactionSync(() => {
            this.sql.exec(`INSERT INTO tickets (seq, sub, status, joined_at) VALUES (?, ?, 'WAITING', ?)`, seq, sub, Date.now());
            this.commit('joined', { seq, sub });
          });
          if (url.searchParams.get('quiet') !== '1') this.broadcastTimed({ k: 'joined', seq });
          return Response.json({ seq, v: this.version });
        }
        case 'serve-next': {
          const counter = Number(url.searchParams.get('counter') ?? 1);
          // Strict FCFS, decided here — the only writer for this queue, so no row locks are needed.
          const head = this.sql.exec<{ seq: number }>(`SELECT seq FROM tickets WHERE status = 'WAITING' ORDER BY seq LIMIT 1`).toArray()[0];
          if (!head) return Response.json({ called: null, v: this.version });
          this.ctx.storage.transactionSync(() => {
            this.sql.exec(`UPDATE tickets SET status = 'CALLED', called_at = ?, counter = ? WHERE seq = ? AND status = 'WAITING'`, Date.now(), counter, head.seq);
            this.commit('called', { seq: head.seq, counter });
          });
          this.broadcastTimed({ k: 'called', seq: head.seq, counter });
          return Response.json({ called: head.seq, v: this.version });
        }
        case 'snapshot': {
          const line = this.waiting();
          return Response.json({ v: this.version, line: line.map((x) => x.seq), eta: this.etas(line.length) });
        }
        case 'stats': {
          const outbox = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`).toArray()[0]!.n;
          return Response.json({ ...this.stats, version: this.version, outbox, sockets: this.ctx.getWebSockets().length });
        }
        default:
          return new Response('unknown', { status: 404 });
      }
    } finally {
      this.stats.handlerMs += performance.now() - t0;
    }
  }

  private broadcastTimed(event: Record<string, unknown>) {
    this.stats.events++;
    this.broadcast(event);
  }

  // Visitors only ever ask for a resync; everything else arrives from the server.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    this.load();
    if (typeof message === 'string' && message === 'resync') {
      const a = ws.deserializeAttachment() as Attachment;
      const line = this.waiting();
      const etas = this.etas(line.length);
      if (a.role === 'staff') ws.send(JSON.stringify({ t: 'snapshot', v: this.version, line: line.map((x) => x.seq), eta: etas }));
      else {
        const i = line.findIndex((x) => x.seq === a.ticket);
        ws.send(JSON.stringify({ t: 'me', v: this.version, p: i >= 0 ? i + 1 : null, w: i >= 0 ? etas[i] : null }));
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code, 'closing');
  }
}
