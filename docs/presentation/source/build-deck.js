// LiveQueue faculty presentation — generated with pptxgenjs.
const path = require('path');
const pptxgen = require('pptxgenjs');
// Optional: writes THEME's colors into the deck's theme part. Set APPLY_THEME to the path
// of an apply_theme.js helper; without it the deck is still complete (layouts use hex colors).
let applyTheme = async () => {};
if (process.env.APPLY_THEME) ({ applyTheme } = require(process.env.APPLY_THEME));

// Rebuild: `npm install pptxgenjs@3.12.0` anywhere, then `node docs/presentation/source/build-deck.js`.
const REPO = path.resolve(__dirname, '../../..');
const SHOTS = path.join(REPO, 'docs/presentation/assets/screenshots');
const LOGO = path.join(REPO, 'web-dashboard/public/logo-full.png');
const OUT = path.join(REPO, 'docs/presentation/LiveQueue_Production_Presentation.pptx');
const CHECKED = 'Quotas checked on: 2026-10-08 · production state: 2026-10-09';

const HEX = {
  navy: '0C2B4B', blue: '0F539E', teal: '25A596', ice: 'EEF5FC', ice2: 'D7E7F6',
  amber: 'B45309', amberBg: 'FEF3C7', red: 'B91C1C', redBg: 'FEE2E2', green: '15803D', greenBg: 'DCFCE7',
  slate: '475569', slateLt: '94A3B8', line: 'CBD5E1', white: 'FFFFFF', ink: '0F172A', mute: '64748B', card: 'F8FAFC',
};
const THEME = {
  name: 'LiveQueue', headFontFace: 'Calibri', bodyFontFace: 'Calibri',
  colors: {
    dk1: HEX.ink, lt1: HEX.white, dk2: HEX.navy, lt2: HEX.ice,
    accent1: HEX.blue, accent2: HEX.teal, accent3: HEX.amber, accent4: HEX.slate, accent5: HEX.red, accent6: HEX.green,
    hlink: HEX.blue, folHlink: HEX.navy,
  },
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
pres.title = 'LiveQueue — A Real-Time Digital Queue Management Platform';
pres.author = 'LiveQueue';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ---------- Layouts ----------
pres.defineSlideMaster({
  title: 'TITLE_DARK',
  background: { color: HEX.navy },
  objects: [],
});
pres.defineSlideMaster({
  title: 'SECTION_DARK',
  background: { color: HEX.navy },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 2.0, w: 8.8, h: 0.9, fontSize: 34, bold: true, color: C.background1, valign: 'middle' }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.6, y: 2.9, w: 8.8, h: 0.8, fontSize: 16, color: 'AECDEB', valign: 'top' }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: HEX.white },
  margin: [0.5, 0.5, 0.5, 0.5],
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.28, w: 9.0, h: 0.6, fontSize: 24, bold: true, color: C.text2, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
    { text: { text: 'LiveQueue · Faculty presentation', options: { x: 0.5, y: 5.28, w: 5, h: 0.25, fontSize: 9, color: HEX.slateLt, margin: 0 } } },
  ],
  slideNumber: { x: 9.1, y: 5.28, w: 0.4, h: 0.25, fontSize: 9, color: HEX.slateLt, align: 'right' },
});

let n = 0;
const seenSections = new Set();
function ensureSection(t) { if (!seenSections.has(t)) { pres.addSection({ title: t }); seenSections.add(t); } }
function content(title, section, notes) {
  ensureSection(section);
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: section });
  s.addText(title, { placeholder: 'title' });
  if (notes) s.addNotes(notes);
  n++;
  return s;
}
function section(title, sub, notes) {
  ensureSection(title);
  const s = pres.addSlide({ masterName: 'SECTION_DARK', sectionTitle: title });
  s.addText(title, { placeholder: 'title' });
  s.addText(sub, { placeholder: 'body' });
  if (notes) s.addNotes(notes);
  n++;
  return s;
}

// ---------- Helpers ----------
const T = (s, text, o) => s.addText(text, { isTextBox: true, margin: 0, color: C.text1, fontSize: 12, valign: 'top', ...o });
function box(s, x, y, w, h, o = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: o.r ?? 0.08,
    fill: { color: o.fill ?? HEX.card }, line: { color: o.line ?? HEX.line, width: o.lw ?? 0.75 },
    objectName: o.name,
  });
}
function label(s, x, y, w, h, title, sub, o = {}) {
  box(s, x, y, w, h, o);
  const tc = o.dark ? C.background1 : C.text1;
  if (sub) {
    T(s, [
      { text: title, options: { bold: true, fontSize: o.ts ?? 12, color: tc, breakLine: true } },
      { text: sub, options: { fontSize: o.ss ?? 10, color: o.dark ? 'D7E7F6' : HEX.slate } },
    ], { x: x + 0.1, y: y + 0.06, w: w - 0.2, h: h - 0.12, valign: 'middle', align: o.align ?? 'center' });
  } else {
    T(s, title, { x: x + 0.08, y, w: w - 0.16, h, bold: true, fontSize: o.ts ?? 12, color: tc, valign: 'middle', align: o.align ?? 'center' });
  }
}
function arrow(s, x1, y1, x2, y2, o = {}) {
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  s.addShape(pres.shapes.LINE, {
    x, y, w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
    flipH: x2 < x1, flipV: y2 < y1,
    line: { color: o.color ?? HEX.slate, width: o.w ?? 1.25, endArrowType: o.both ? 'triangle' : 'triangle', beginArrowType: o.both ? 'triangle' : undefined, dashType: o.dash },
  });
}
function pill(s, x, y, w, text, kind) {
  const map = { ok: [HEX.greenBg, HEX.green], warn: [HEX.amberBg, HEX.amber], bad: [HEX.redBg, HEX.red], info: [HEX.ice, HEX.blue] };
  const [bg, fg] = map[kind];
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.26, rectRadius: 0.13, fill: { color: bg }, line: { color: bg } });
  T(s, text, { x, y, w, h: 0.26, fontSize: 9, bold: true, color: fg, align: 'center', valign: 'middle' });
}
function bullets(s, items, o) {
  T(s, items.map((t, i) => {
    const run = typeof t === 'string' ? { text: t, options: {} } : t;
    return { text: run.text, options: { bullet: { indent: 14 }, paraSpaceAfter: 5, ...run.options, breakLine: i < items.length - 1 } };
  }), { fontSize: 13, color: C.text1, ...o });
}
const hdr = (cells) => cells.map((c) => ({ text: c, options: { bold: true, color: HEX.white, fill: { color: HEX.navy } } }));
function table(s, rows, o) {
  s.addTable(rows, {
    fontFace: 'Calibri', fontSize: o.fs ?? 10, color: HEX.ink, border: { type: 'solid', color: HEX.line, pt: 0.5 },
    valign: 'middle', margin: [3, 5, 3, 5], autoPage: false, ...o,
  });
}
const tag = (s, x, y, text, kind = 'warn') => pill(s, x, y, Math.max(1.2, text.length * 0.068 + 0.3), text, kind);

// =====================================================================
// 1. Title
{
  ensureSection('Introduction');
  const s = pres.addSlide({ masterName: 'TITLE_DARK', sectionTitle: 'Introduction' }); n++;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 0.55, w: 3.0, h: 1.0, rectRadius: 0.12, fill: { color: HEX.white }, line: { color: HEX.white } });
  s.addImage({ path: LOGO, x: 0.75, y: 0.62, w: 2.7, h: 0.86, altText: 'LiveQueue logo' });
  T(s, 'LiveQueue', { x: 0.6, y: 1.95, w: 8.8, h: 0.85, fontSize: 44, bold: true, color: C.background1 });
  T(s, 'A Real-Time Digital Queue Management Platform', { x: 0.6, y: 2.8, w: 8.8, h: 0.5, fontSize: 22, color: 'AECDEB' });
  T(s, 'Join from a QR code, wait anywhere, get called the moment it is your turn — with server-authoritative dispatch across many counters.', { x: 0.6, y: 3.35, w: 7.6, h: 0.6, fontSize: 14, color: 'D7E7F6' });
  pill(s, 0.6, 4.15, 2.6, 'In production · Android v1.0.6', 'ok');
  T(s, 'Presenter: [Your name]   ·   Supervisor: [Name]   ·   [Department, University]   ·   [Date]', { x: 0.6, y: 4.75, w: 8.8, h: 0.3, fontSize: 11, color: '7BA9D8' });
  s.addNotes('Introduce LiveQueue in one sentence: a live digital queue for organizations — visitors join from a QR code on Android or iPhone, staff serve from counters in a web dashboard, and everyone sees updates in real time. It is deployed and in production, with Android release v1.0.6 published. Replace the bracketed presenter placeholders before presenting.');
}

// 2. Problem
{
  const s = content('Queues are still physical and uncertain', 'Introduction',
    'Frame the problem from three viewpoints: visitors don\'t know how long they will wait and have to stand in a crowd; staff juggle several counters and services without a shared view; administrators can\'t see or audit what happened. Multi-service visits — e.g. an enquiry followed by a payment — make every one of these worse.');
  const cards = [
    ['Visitors', ['Stand in a crowd for an unknown time', 'No live update, easy to miss a call', 'Multi-step visits restart the wait']],
    ['Counter staff', ['Who is next? Who was here first?', 'Several counters, several services', 'Hand-offs between counters are informal']],
    ['Administrators', ['No visibility of load or idle counters', 'No record of who served whom', 'Hard to run several desks or teams']],
  ];
  cards.forEach(([h, items], i) => {
    const x = 0.5 + i * 3.05;
    box(s, x, 1.15, 2.85, 2.75, { fill: HEX.card });
    s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: 1.35, w: 0.42, h: 0.42, fill: { color: HEX.ice }, line: { color: HEX.ice2 } });
    T(s, String(i + 1), { x: x + 0.2, y: 1.35, w: 0.42, h: 0.42, align: 'center', valign: 'middle', bold: true, color: C.accent1, fontSize: 14 });
    T(s, h, { x: x + 0.75, y: 1.38, w: 2.0, h: 0.38, bold: true, fontSize: 16, color: C.text2, valign: 'middle' });
    bullets(s, items, { x: x + 0.2, y: 1.95, w: 2.5, h: 1.85, fontSize: 13 });
  });
  box(s, 0.5, 4.2, 8.95, 0.7, { fill: HEX.ice, line: HEX.ice2 });
  T(s, [{ text: 'Multi-service visits ', options: { bold: true } }, { text: '(e.g. an enquiry, then a payment) make every one of these worse.' }], { x: 0.7, y: 4.25, w: 8.6, h: 0.6, fontSize: 13, valign: 'middle' });
}

// 3. Solution
{
  const s = content('One live queue, shared by every device', 'Introduction',
    'Everything on this slide is implemented and in production, including the Floating Counter Console, which went live on 9 October 2026. The key idea: one backend owns the queue, and three kinds of client — Android, iPhone browser and the staff dashboard — stay in sync through realtime events.');
  const feats = [
    ['Organizations & roles', 'Head, Manager, Admin workspaces, Executives'],
    ['Queues & counters', 'Many counters per queue · Open / Paused / Off'],
    ['QR entry', 'One organization QR → choose a queue'],
    ['Ordered journeys', 'Several services in a chosen order · referrals'],
    ['Live updates', 'Socket.io: position, ETA, called, done'],
    ['Notifications', 'Android FCM · iPhone Web Push · email'],
    ['Governance & audit', 'Admin replacement · Head succession · immutable history'],
    ['Floating Counter Console', 'Always-visible serving controls (live)'],
  ];
  feats.forEach(([h, d], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = 0.5 + col * 2.28, y = 1.15 + row * 1.85;
    box(s, x, y, 2.12, 1.65, { fill: i === 7 ? HEX.ice : HEX.card, line: i === 7 ? HEX.ice2 : HEX.line });
    T(s, h, { x: x + 0.15, y: y + 0.18, w: 1.85, h: 0.55, bold: true, fontSize: 14, color: C.text2 });
    T(s, d, { x: x + 0.15, y: y + 0.78, w: 1.85, h: 0.8, fontSize: 11, color: HEX.slate });
  });
  T(s, 'Clients: Flutter Android app · React staff dashboard · iPhone/iPad Safari portal (PWA)', { x: 0.5, y: 4.95, w: 9, h: 0.25, fontSize: 11, color: HEX.mute });
}

// 4. Roles
{
  const s = content('Four roles: governance and operations', 'Introduction',
    'Explain the split. The Organization Head and Manager govern the whole organization; neither serves people. Each Admin owns an isolated workspace with at most one live queue — that is a product rule enforced by a unique index in the database. Executives belong to exactly one Admin and serve from a counter. Workspace isolation means an Admin never sees another Admin\'s queue, history, audit or reports.');
  box(s, 0.5, 1.1, 5.9, 1.25, { fill: HEX.ice, line: HEX.ice2 });
  T(s, 'GOVERNANCE', { x: 0.65, y: 1.15, w: 2, h: 0.25, fontSize: 9, bold: true, color: C.accent1 });
  label(s, 0.8, 1.45, 2.5, 0.75, 'Organization Head', 'Whole organization · exactly one', { fill: HEX.navy, line: HEX.navy, dark: true });
  label(s, 3.6, 1.45, 2.5, 0.75, 'Organization Manager', 'Org-wide reports & audit · no serving', { fill: HEX.white });
  box(s, 0.5, 2.55, 5.9, 2.45, { fill: HEX.card });
  T(s, 'OPERATIONS — isolated Admin workspaces', { x: 0.65, y: 2.6, w: 4, h: 0.25, fontSize: 9, bold: true, color: C.accent2 });
  [0, 1].forEach((i) => {
    const x = 0.75 + i * 2.85;
    label(s, x, 2.95, 2.55, 0.62, `Admin ${i === 0 ? 'A' : 'B'}`, 'Owns ≤ 1 live queue', { fill: HEX.white, line: HEX.blue });
    label(s, x, 3.85, 1.2, 0.55, 'Executive', null, { fill: HEX.white, ts: 10.5 });
    label(s, x + 1.35, 3.85, 1.2, 0.55, 'Executive', null, { fill: HEX.white, ts: 10.5 });
    arrow(s, x + 0.6, 3.57, x + 0.6, 3.85, { w: 1 });
    arrow(s, x + 1.95, 3.57, x + 1.95, 3.85, { w: 1 });
    T(s, i === 0 ? 'Queue: Student Services' : 'Queue: Library Desk', { x, y: 4.5, w: 2.55, h: 0.3, fontSize: 10, color: HEX.slate, align: 'center' });
  });
  T(s, '✕ no cross-workspace access', { x: 2.55, y: 4.72, w: 2.2, h: 0.25, fontSize: 9, color: HEX.red, align: 'center' });
  T(s, [
    { text: 'Product rules (enforced in the database)', options: { bold: true, color: C.text2, fontSize: 13, breakLine: true } },
    { text: 'One Head per organization', options: { bullet: { indent: 12 }, breakLine: true } },
    { text: 'One live queue per Admin', options: { bullet: { indent: 12 }, breakLine: true } },
    { text: 'A live queue always keeps its Admin', options: { bullet: { indent: 12 }, breakLine: true } },
    { text: 'Executives belong to one workspace', options: { bullet: { indent: 12 }, breakLine: true } },
    { text: 'Permissions derive from role only', options: { bullet: { indent: 12 } } },
  ], { x: 6.7, y: 1.15, w: 2.85, h: 3.8, fontSize: 12, paraSpaceAfter: 6 });
}

// 5. Architecture
{
  const s = content('System architecture', 'Architecture',
    'Walk left to right. Three clients. One backend process on Render runs the REST API, the Socket.io server and two schedulers. PostgreSQL on Neon is the single source of truth via Prisma. Static dashboard and portal are served by Cloudflare Pages — note that API traffic goes straight to Render, not through Cloudflare. Notifications fan out to FCM for the Android app, Web Push for iPhone/iPad visitors who added the Safari portal to their Home Screen, and Resend for email. The Floating Counter Console is a fourth staff surface, live in production: it shares the dashboard\'s session, data cache and Socket.io connection.');
  label(s, 0.4, 1.05, 2.1, 0.62, 'Android app', 'Flutter · visitors');
  label(s, 0.4, 1.8, 2.1, 0.62, 'iPhone/iPad portal', 'Safari PWA · visitors');
  label(s, 0.4, 2.55, 2.1, 0.62, 'Staff dashboard', 'React + Vite');
  label(s, 0.4, 3.3, 2.1, 0.62, 'Floating Counter Console', 'Document PiP · fallback dock', { fill: HEX.ice, line: HEX.ice2 });
  label(s, 0.4, 4.2, 2.1, 0.62, 'Cloudflare Pages', 'Static dashboard + portal', { fill: HEX.white, line: HEX.teal });
  box(s, 3.35, 1.05, 3.1, 3.05, { fill: HEX.ice, line: HEX.blue, lw: 1.25 });
  T(s, 'Render · one web service', { x: 3.45, y: 1.1, w: 2.9, h: 0.3, bold: true, fontSize: 12, color: C.accent1, align: 'center' });
  label(s, 3.55, 1.5, 2.7, 0.55, 'Express REST API', 'Node.js · TypeScript · Zod', { fill: HEX.white });
  label(s, 3.55, 2.15, 2.7, 0.55, 'Socket.io server', 'org / workspace / token rooms', { fill: HEX.white });
  label(s, 3.55, 2.8, 2.7, 0.55, 'Authorization + business rules', 'dispatch · journeys · governance', { fill: HEX.white });
  label(s, 3.55, 3.45, 2.7, 0.5, 'Schedulers (node-cron)', null, { fill: HEX.white, ts: 11 });
  label(s, 3.55, 4.3, 2.7, 0.62, 'Neon PostgreSQL', 'via Prisma · constraints & triggers', { fill: HEX.navy, line: HEX.navy, dark: true });
  arrow(s, 4.9, 4.1, 4.9, 4.3, { both: true });
  [1.36, 2.11, 2.86, 3.61].forEach((y) => arrow(s, 2.5, y, 3.35, y, { both: true, color: HEX.blue }));
  arrow(s, 2.5, 4.51, 3.0, 4.51, { dash: 'dash', color: HEX.slateLt });
  T(s, 'assets', { x: 2.55, y: 4.55, w: 0.6, h: 0.2, fontSize: 8, color: HEX.mute });
  label(s, 7.25, 1.3, 2.3, 0.62, 'Firebase Cloud Messaging', 'Android push');
  label(s, 7.25, 2.05, 2.3, 0.72, 'Web Push', 'iPhone/iPad Safari (Home Screen PWA)\nVAPID-based notifications', { ss: 9.5 });
  label(s, 7.25, 2.9, 2.3, 0.62, 'Resend', 'Transactional email');
  label(s, 7.25, 3.9, 2.3, 0.85, 'GitHub', 'Source · Actions CI · signed APK releases', { fill: HEX.white });
  [1.61, 2.41, 3.21].forEach((y) => arrow(s, 6.45, y, 7.25, y, { color: HEX.teal }));
  T(s, 'HTTPS + WebSocket', { x: 2.45, y: 0.82, w: 1.2, h: 0.2, fontSize: 8, color: HEX.mute });
}

// 6. Request vs realtime
{
  const s = content('REST for truth, Socket.io for change', 'Architecture',
    'Two lanes. Top: every read and write is a REST request that is authenticated, validated, authorized and usually wrapped in a transaction. Bottom: Socket.io tells clients that something changed. The staff dashboard batches the resulting refetches, so a burst of events costs one reload per view; the Android app and the iPhone/iPad portal apply the event payload directly, which the server builds with the same function as the REST read. Events are never replayed, so after a reconnect every client rejoins its rooms and re-reads the server\'s state.');
  T(s, 'REST — every read and write', { x: 0.5, y: 1.05, w: 5, h: 0.3, bold: true, fontSize: 13, color: C.accent1 });
  const steps = ['Client', 'authenticate\n(JWT + DB reload)', 'validate\n(Zod)', 'service layer\nauthorize · transaction', 'PostgreSQL'];
  steps.forEach((t, i) => {
    const x = 0.5 + i * 1.86;
    label(s, x, 1.45, 1.6, 0.82, t, null, { fill: i === 4 ? HEX.navy : HEX.card, line: i === 4 ? HEX.navy : HEX.line, dark: i === 4, ts: 10.5 });
    if (i < 4) arrow(s, x + 1.6, 1.86, x + 1.86, 1.86, { color: HEX.blue });
  });
  T(s, 'Socket.io — "something changed"', { x: 0.5, y: 2.65, w: 5, h: 0.3, bold: true, fontSize: 13, color: C.accent2 });
  const rt = ['Committed change', 'emit to rooms\norg · workspace · token', 'dashboard: batched invalidate\nvisitors: apply payload', 'dashboard refetches once\nper burst over REST'];
  rt.forEach((t, i) => {
    const x = 0.5 + i * 2.33;
    label(s, x, 3.05, 2.05, 0.82, t, null, { fill: HEX.card, ts: 10.5 });
    if (i < 3) arrow(s, x + 2.05, 3.46, x + 2.33, 3.46, { color: HEX.teal });
  });
  box(s, 0.5, 4.15, 9.0, 0.82, { fill: HEX.ice, line: HEX.ice2 });
  T(s, [
    { text: 'On reconnect: ', options: { bold: true } },
    { text: 're-join rooms and refetch everything — a missed event is never assumed to be replayed. ' },
    { text: 'Rooms: ', options: { bold: true } },
    { text: 'organization (Head/Manager), workspace (Admin/Executives), token (one visitor), public queue (no personal data).' },
  ], { x: 0.7, y: 4.22, w: 8.6, h: 0.7, fontSize: 12, valign: 'middle' });
}

// 7. Token lifecycle
{
  const s = content('Token lifecycle: one server-side state machine', 'Queue engine',
    'This is the real state machine from tokenStateMachine.ts. Visitors can cancel only before service starts. Staff must give a reason to skip. On an ordered journey, completing a step that is not the last returns the token to WAITING for its next step — keeping the original arrival position. Clients only render the state; they never decide transitions.');
  const st = [['WAITING', HEX.amber], ['CALLED', HEX.blue], ['IN_PROGRESS', HEX.teal], ['COMPLETED', HEX.green]];
  st.forEach(([t, c], i) => {
    const x = 0.6 + i * 2.3;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.55, w: 1.85, h: 0.75, rectRadius: 0.37, fill: { color: c }, line: { color: c } });
    T(s, t, { x, y: 1.55, w: 1.85, h: 0.75, align: 'center', valign: 'middle', bold: true, fontSize: 13, color: C.background1 });
    if (i < 3) arrow(s, x + 1.85, 1.92, x + 2.3, 1.92, { w: 1.75 });
  });
  T(s, 'Serve next', { x: 2.35, y: 1.25, w: 1.0, h: 0.25, fontSize: 9, color: HEX.mute, align: 'center' });
  T(s, 'Start (± code)', { x: 4.6, y: 1.25, w: 1.1, h: 0.25, fontSize: 9, color: HEX.mute, align: 'center' });
  T(s, 'Complete', { x: 7.0, y: 1.25, w: 0.9, h: 0.25, fontSize: 9, color: HEX.mute, align: 'center' });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.0, y: 3.15, w: 1.85, h: 0.65, rectRadius: 0.32, fill: { color: HEX.redBg }, line: { color: HEX.red } });
  T(s, 'SKIPPED', { x: 3.0, y: 3.15, w: 1.85, h: 0.65, align: 'center', valign: 'middle', bold: true, color: HEX.red });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 3.15, w: 1.85, h: 0.65, rectRadius: 0.32, fill: { color: HEX.card }, line: { color: HEX.slate } });
  T(s, 'CANCELLED', { x: 0.6, y: 3.15, w: 1.85, h: 0.65, align: 'center', valign: 'middle', bold: true, color: HEX.slate });
  arrow(s, 1.5, 2.3, 1.5, 3.15, { dash: 'dash' });
  arrow(s, 3.9, 2.3, 3.9, 3.15, { dash: 'dash', color: HEX.red });
  arrow(s, 1.6, 2.3, 3.4, 3.15, { dash: 'dash', color: HEX.red });
  arrow(s, 6.2, 2.3, 4.6, 3.15, { dash: 'dash', color: HEX.red });
  T(s, 'visitor cancels\n(before service)', { x: 0.25, y: 2.5, w: 1.2, h: 0.5, fontSize: 9, color: HEX.mute });
  T(s, 'staff skip — reason required', { x: 6.35, y: 2.55, w: 2.4, h: 0.25, fontSize: 9, color: HEX.red });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.6, y: 3.05, w: 3.9, h: 1.0, rectRadius: 0.08, fill: { color: HEX.ice }, line: { color: HEX.ice2 } });
  T(s, [
    { text: 'Journey step done, more to go → ', options: { bold: true } },
    { text: 'back to WAITING for the next step, keeping the original arrival position.' },
  ], { x: 5.75, y: 3.12, w: 3.6, h: 0.85, fontSize: 11.5, valign: 'middle' });
  T(s, 'Serve next and Start are atomic compare-and-swap updates; the server rejects any transition the machine does not allow.', { x: 0.6, y: 4.45, w: 8.9, h: 0.45, fontSize: 12, color: HEX.slate });
}

// 8. Journey + referral
{
  const s = content('Ordered journeys and referrals', 'Queue engine',
    'A visitor builds their own ordered journey from the queue\'s services, starting from the Admin\'s recommended order. Rules: 1 to 20 steps, a service may repeat but never twice in a row and not beyond its limit. Once the token exists the order is locked. Each step is served by a counter that handles that service. A referral sends the next step to a specific open counter, ahead of normal order but never interrupting anyone; if that counter closes, the referral keeps its priority at another counter that handles the step.');
  const svc = [['Step 1', 'Admissions enquiry'], ['Step 2', 'Fee payment'], ['Step 3', 'Document collection']];
  svc.forEach(([a, b], i) => {
    const x = 0.6 + i * 3.1;
    label(s, x, 1.15, 2.45, 0.78, a, b, { fill: i === 1 ? HEX.ice : HEX.card, line: i === 1 ? HEX.blue : HEX.line });
    if (i < 2) arrow(s, x + 2.45, 1.54, x + 3.1, 1.54, { w: 1.5, color: HEX.blue });
  });
  pill(s, 3.95, 2.03, 1.6, 'current step', 'info');
  T(s, 'Desk 2 handles Payment → served there', { x: 3.4, y: 2.38, w: 2.8, h: 0.25, fontSize: 9.5, color: HEX.mute, align: 'center' });
  const rules = [
    ['Ordered, 1–20 steps', 'Chosen by the visitor from the recommended order'],
    ['Repeat rules', 'A service may repeat (limit 1–10), never twice in a row'],
    ['Locked at creation', 'Any change is refused: 409 JOURNEY_LOCKED'],
    ['Counter eligibility', 'A counter serves only the services it handles'],
    ['Referral', 'Next step goes to a chosen open counter — no interruption'],
    ['Fallback', 'Target closes → priority kept at another eligible counter'],
  ];
  rules.forEach(([h, d], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.6 + col * 3.0, y = 2.85 + row * 1.08;
    box(s, x, y, 2.8, 0.92, { fill: HEX.card });
    T(s, h, { x: x + 0.15, y: y + 0.1, w: 2.5, h: 0.3, bold: true, fontSize: 12, color: C.text2 });
    T(s, d, { x: x + 0.15, y: y + 0.42, w: 2.5, h: 0.45, fontSize: 10.5, color: HEX.slate });
  });
}

// 9. Counters + dispatch
{
  const s = content('Many counters, one server-side dispatcher', 'Queue engine',
    'Left: the counter lifecycle. Open requires an operator, Paused keeps the operator, Off releases them. Assigning someone to an Off counter makes it Paused, never Open. Right: the most important design decision — the server decides who is next. Serve next sends only the queue id; the backend picks the earliest eligible person for the caller\'s own counter inside a transaction that locks the counter and compare-and-swaps the token, so two counters can never claim the same person and every device sees the same order.');
  T(s, 'Counter states', { x: 0.5, y: 1.05, w: 4, h: 0.3, bold: true, fontSize: 13, color: C.text2 });
  const cs = [['Open', 'ACTIVE · operator required', HEX.green], ['Paused', 'ON_BREAK · operator retained', HEX.amber], ['Off', 'OFFLINE · unassigned', HEX.slate]];
  cs.forEach(([a, b, c], i) => {
    const y = 1.45 + i * 0.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y, w: 1.15, h: 0.62, rectRadius: 0.31, fill: { color: c }, line: { color: c } });
    T(s, a, { x: 0.5, y, w: 1.15, h: 0.62, align: 'center', valign: 'middle', bold: true, color: C.background1, fontSize: 13 });
    T(s, b, { x: 1.8, y, w: 2.4, h: 0.62, valign: 'middle', fontSize: 11, color: HEX.slate });
  });
  T(s, 'Assign operator to Off → Paused (never straight to Open). Off is refused while someone is called or in service there.', { x: 0.5, y: 4.05, w: 3.9, h: 0.75, fontSize: 10.5, color: HEX.mute });
  box(s, 4.7, 1.05, 4.8, 3.85, { fill: HEX.ice, line: HEX.ice2 });
  T(s, 'Serve next — decided on the server', { x: 4.9, y: 1.15, w: 4.4, h: 0.3, bold: true, fontSize: 13, color: C.accent1 });
  const seq = [
    ['1', 'Client sends only the queue id', 'No person, counter or staff id is accepted'],
    ['2', 'Lock the caller\'s own counter', 'SELECT … FOR UPDATE inside a transaction'],
    ['3', 'Pick: referrals first, then earliest arrival', 'Whose current step this counter handles'],
    ['4', 'Compare-and-swap WAITING → CALLED', 'A concurrent claim matches nothing and moves on'],
    ['5', 'Commit, then broadcast', 'Every device converges on the same truth'],
  ];
  seq.forEach(([k, a, b], i) => {
    const y = 1.55 + i * 0.66;
    s.addShape(pres.shapes.OVAL, { x: 4.9, y: y + 0.05, w: 0.38, h: 0.38, fill: { color: HEX.blue }, line: { color: HEX.blue } });
    T(s, k, { x: 4.9, y: y + 0.05, w: 0.38, h: 0.38, align: 'center', valign: 'middle', bold: true, color: C.background1, fontSize: 11 });
    T(s, [{ text: a, options: { bold: true, breakLine: true } }, { text: b, options: { color: HEX.slate, fontSize: 10 } }], { x: 5.4, y, w: 4.0, h: 0.6, fontSize: 11.5 });
  });
}

// 10. Floating console
{
  const s = content('Floating Counter Console', 'Product',
    'Newest feature — live in production since 9 October 2026. It uses the browser\'s Document Picture-in-Picture API to keep a tiny console on top of other windows. It is a React portal from the dashboard\'s own app, so it shares the same session, cache and single Socket.io connection — there is no second dispatcher. Every button calls the same endpoints as the main page, and its refreshes go through the same batching as the dashboard, so it adds no per-event refetches. Browsers without the API get an in-page dock that says honestly it cannot stay on top. Its operating-system-level always-on-top behaviour has not been verified on a real desktop.');
  T(s, 'Compact', { x: 0.5, y: 1.05, w: 2, h: 0.25, fontSize: 10, bold: true, color: HEX.slate });
  T(s, 'Expanded', { x: 2.85, y: 1.05, w: 2, h: 0.25, fontSize: 10, bold: true, color: HEX.slate });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.47, y: 1.32, w: 2.21, h: 2.15 * 460 / 676 + 0.06, fill: { color: HEX.white }, line: { color: HEX.line }, shadow: { type: 'outer', color: '000000', opacity: 0.18, blur: 6, offset: 2, angle: 90 } });
  s.addImage({ path: path.join(SHOTS, 'console-compact.png'), x: 0.5, y: 1.35, w: 2.15, h: 2.15 * 460 / 676, altText: 'Console compact mode' });
  s.addShape(pres.shapes.RECTANGLE, { x: 2.82, y: 1.32, w: 2.21, h: 2.15 * 596 / 676 + 0.06, fill: { color: HEX.white }, line: { color: HEX.line }, shadow: { type: 'outer', color: '000000', opacity: 0.18, blur: 6, offset: 2, angle: 90 } });
  s.addImage({ path: path.join(SHOTS, 'console-expanded.png'), x: 2.85, y: 1.35, w: 2.15, h: 2.15 * 596 / 676, altText: 'Console expanded mode' });
  T(s, 'Real screenshots, fictional demo data.', { x: 0.5, y: 2.95, w: 2.2, h: 0.4, fontSize: 9, color: HEX.mute });
  bullets(s, [
    { text: 'Document Picture-in-Picture: a small always-on-top window (Chromium desktop browsers)' },
    { text: 'Same APIs, same Socket.io connection — no second dispatch engine' },
    { text: 'Shows token, service, state, waiting count, server-timed timer' },
    { text: 'Actions held while reconnecting; access loss closes it' },
    { text: 'Token number and service only — no personal data' },
    { text: 'Fallback: in-page dock that says it cannot stay on top' },
  ], { x: 5.1, y: 1.1, w: 4.4, h: 3.4, fontSize: 12 });
  pill(s, 5.1, 4.6, 3.2, 'Live in production · 9 Oct 2026', 'ok');
}

// 11. Visitor experience
{
  const s = content('Visitor experience: QR → services → token', 'Product',
    'These are real screens from the iPhone/iPad portal, with a fictional demo organization. One organization QR opens the list of queues; the visitor builds an ordered journey; the tracking page shows position, ETA and step progress live. On Android the Flutter app does the same with FCM notifications. Physical device checks are still pending and labelled as such.');
  const shots = [['portal-organization.png', '1 · Scan organization QR'], ['portal-journey.png', '2 · Choose services in order'], ['portal-tracking.png', '3 · Live token, position, ETA']];
  shots.forEach(([f, cap], i) => {
    const x = 0.55 + i * 2.15, w = 1.75, h = w * 1992 / 1170;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.06, y: 1.05 - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.12, fill: { color: HEX.navy }, line: { color: HEX.navy } });
    s.addImage({ path: path.join(SHOTS, f), x, y: 1.05, w, h, altText: cap });
    T(s, cap, { x: x - 0.1, y: 4.1, w: w + 0.2, h: 0.3, fontSize: 10, color: HEX.slate, align: 'center' });
  });
  T(s, 'Android (Flutter)', { x: 7.05, y: 1.05, w: 2.45, h: 0.3, bold: true, fontSize: 13, color: C.text2 });
  T(s, 'Same flow in the app; push via Firebase Cloud Messaging.', { x: 7.05, y: 1.35, w: 2.45, h: 0.6, fontSize: 11, color: HEX.slate });
  T(s, 'iPhone / iPad', { x: 7.05, y: 2.05, w: 2.45, h: 0.3, bold: true, fontSize: 13, color: C.text2 });
  T(s, 'Safari portal; notifications need iOS 16.4+, Home Screen install and permission.', { x: 7.05, y: 2.35, w: 2.45, h: 0.8, fontSize: 11, color: HEX.slate });
  pill(s, 7.05, 3.3, 2.45, 'Physical iPhone push: pending', 'warn');
  pill(s, 7.05, 3.65, 2.45, 'Physical Android QA: pending', 'warn');
  T(s, 'Screens: fictional demo data.', { x: 7.05, y: 4.05, w: 2.45, h: 0.3, fontSize: 9, color: HEX.mute });
}

// 12. Notifications
{
  const s = content('Notification architecture', 'Product',
    'A queue event in the backend drives up to four channels. Socket.io updates any open screen instantly. Android devices get Firebase Cloud Messaging; iPhone home-screen web apps get standards Web Push through Apple\'s push service, signed with our VAPID key. A scheduler checks every minute for people whose turn is close and sends reminders. Email through Resend is for accounts and governance, plus visitor codes only on queues configured that way. Stress that delivery is best-effort — no channel is guaranteed.');
  label(s, 0.5, 2.0, 1.9, 1.1, 'Queue event', 'called · close to turn · completed', { fill: HEX.navy, line: HEX.navy, dark: true });
  label(s, 2.9, 2.05, 1.7, 1.0, 'Backend', 'events + reminder scheduler (every minute)', { fill: HEX.ice, line: HEX.blue });
  arrow(s, 2.4, 2.55, 2.9, 2.55, { w: 1.5 });
  const ch = [['Socket.io', 'Open app / portal / dashboard', 'live, instant'], ['FCM', 'Android app', 'free · Google'], ['Web Push (VAPID)', 'iPhone/iPad Safari PWA', 'free · Apple push service'], ['Resend email', 'Accounts, invitations, succession', 'free: 100/day']];
  ch.forEach(([a, b, c], i) => {
    const y = 1.05 + i * 0.98;
    label(s, 5.25, y, 2.1, 0.8, a, b, { fill: HEX.card });
    T(s, c, { x: 7.5, y, w: 2.0, h: 0.8, fontSize: 10.5, color: HEX.slate, valign: 'middle' });
    arrow(s, 4.6, 2.55, 5.25, y + 0.4, { color: HEX.teal });
  });
  box(s, 0.5, 3.55, 4.3, 1.3, { fill: HEX.amberBg, line: 'FDE68A' });
  T(s, [
    { text: 'Best-effort delivery. ', options: { bold: true, color: HEX.amber } },
    { text: 'Push depends on device settings, OS rules and vendor services. LiveQueue never assumes a notification arrived — the live screen and the server state stay authoritative.' },
  ], { x: 0.65, y: 3.62, w: 4.0, h: 1.15, fontSize: 11, valign: 'middle' });
}

// 13. Governance
{
  const s = content('Governance and succession', 'Trust',
    'This makes LiveQueue usable by a real organization with staff turnover. A live queue can never lose its Admin: changing or removing that Admin requires choosing a replacement, and the queue and all Executives move in one transaction. The Head can hand the organization to a successor, verified with their password, an emailed code and a single-use 72-hour link. Every governance change and its audit record are written in the same transaction, and database triggers make history append-only.');
  const items = [
    ['Admin replacement', 'Queue + every Executive move atomically; counters, tokens and history untouched'],
    ['Live queue keeps its Admin', 'Database trigger; refused with a guided replacement flow'],
    ['Head succession', 'Password + emailed code → single-use 72-hour link → explicit acceptance'],
    ['Tenure history', 'Who led the organization, when, and why — visible by role'],
    ['Transactional audit', 'Change and audit row commit together, with actor snapshots'],
    ['Immutable history', 'Triggers block edits and deletes; deleting an org leaves a minimal receipt'],
  ];
  items.forEach(([h, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 4.55, y = 1.1 + row * 1.25;
    box(s, x, y, 4.4, 1.08, { fill: row === 1 && col === 0 ? HEX.ice : HEX.card, line: row === 1 && col === 0 ? HEX.ice2 : HEX.line });
    s.addShape(pres.shapes.OVAL, { x: x + 0.15, y: y + 0.17, w: 0.36, h: 0.36, fill: { color: HEX.teal }, line: { color: HEX.teal } });
    T(s, '✓', { x: x + 0.15, y: y + 0.17, w: 0.36, h: 0.36, align: 'center', valign: 'middle', color: C.background1, bold: true, fontSize: 12 });
    T(s, h, { x: x + 0.65, y: y + 0.12, w: 3.6, h: 0.32, bold: true, fontSize: 13, color: C.text2 });
    T(s, d, { x: x + 0.65, y: y + 0.47, w: 3.6, h: 0.55, fontSize: 11, color: HEX.slate });
  });
}

// 14. Security
{
  const s = content('Security: implemented vs known gaps', 'Trust',
    'Left column: controls that exist in code and are covered by tests. Right column: honest limitations. Worth mentioning: preparing this analysis we found every visitor shared one rate-limit bucket behind Render\'s proxy. That is fixed and live: limits now key on the real client address from Cloudflare\'s CF-Connecting-IP, with Express trust proxy deliberately left off so forged X-Forwarded-For headers are ignored. Verified in production from two machines on 9 October 2026.');
  T(s, 'Implemented', { x: 0.5, y: 1.05, w: 4.4, h: 0.3, bold: true, fontSize: 14, color: HEX.green });
  bullets(s, [
    'bcrypt passwords · 15-min JWT · rotated, hashed refresh tokens',
    'User + organization reloaded from the DB on every request',
    'Tenant & workspace scoping on every query (404, never leak)',
    'Backend authorization on every mutation, whatever the UI shows',
    'Instant revocation: tokens + live sockets dropped',
    'Single-use, hashed, expiring invitation and handover links',
    'Transactional, immutable audit with actor snapshots',
    'Rate limits per real client (CF-Connecting-IP; spoof-resistant)',
  ], { x: 0.5, y: 1.4, w: 4.5, h: 3.6, fontSize: 12 });
  box(s, 5.3, 1.05, 4.2, 3.85, { fill: HEX.amberBg, line: 'FDE68A' });
  T(s, 'Known gaps', { x: 5.5, y: 1.12, w: 3.8, h: 0.3, bold: true, fontSize: 14, color: HEX.amber });
  bullets(s, [
    'Rate limits are in-memory, per process',
    'People behind one NAT (campus Wi-Fi, carrier) share a limit',
    'No external penetration test or WAF',
    'No centralized security monitoring or alerting',
  ], { x: 5.5, y: 1.5, w: 3.85, h: 3.3, fontSize: 12 });
}

// 15. Database
{
  const s = content('Database design (simplified)', 'Architecture',
    'Only the core entities are shown. An Organization has Associates (the staff table), queues and audit history. A queue has services and counters; counters and services are many-to-many, which is how routing works. A token belongs to a queue and has ordered journey steps. Governance tables keep tenures, successions and workspace transfers. Point out the constraints at the bottom — these are what keep the rules true under concurrency.');
  const E = (x, y, t, sub, o) => label(s, x, y, 1.75, 0.62, t, sub, { ts: 11.5, ss: 9, ...o });
  E(0.4, 1.1, 'Organization', 'tenant root', { fill: HEX.navy, line: HEX.navy, dark: true });
  E(0.4, 2.2, 'Staff (Associate)', 'role · workspace');
  E(0.4, 3.3, 'AuditLog', 'append-only');
  E(0.4, 4.35, 'Governance', 'tenures · successions');
  E(2.75, 1.1, 'Queue', '≤1 live per Admin');
  E(2.75, 2.2, 'Counter', 'Open / Paused / Off');
  E(2.75, 3.3, 'CounterService', 'routing (N–M)', { fill: HEX.ice, line: HEX.ice2 });
  E(2.75, 4.35, 'QueueService', 'duration · repeat limit');
  E(5.1, 1.1, 'Token', 'number unique per queue', { fill: HEX.ice, line: HEX.blue });
  E(5.1, 2.2, 'Journey step', 'ordered · referral');
  E(5.1, 3.3, 'Device', 'visitor identity · 1–N tokens');
  arrow(s, 1.27, 1.72, 1.27, 2.2); arrow(s, 1.27, 2.82, 1.27, 3.3); arrow(s, 1.27, 3.92, 1.27, 4.35);
  arrow(s, 2.15, 1.41, 2.75, 1.41);
  arrow(s, 3.62, 1.72, 3.62, 2.2); arrow(s, 3.62, 2.82, 3.62, 3.3); arrow(s, 3.62, 4.35, 3.62, 3.92);
  arrow(s, 4.5, 1.41, 5.1, 1.41);
  arrow(s, 5.97, 1.72, 5.97, 2.2);
  box(s, 7.3, 1.1, 2.2, 3.87, { fill: HEX.card });
  T(s, 'Enforced in PostgreSQL', { x: 7.42, y: 1.17, w: 1.75, h: 0.45, bold: true, fontSize: 11.5, color: C.text2 });
  T(s, ['One Head per org', 'One live queue per Admin', 'Live queue needs an Admin', 'One open succession', 'Unique token number per queue', 'History append-only (triggers)'].map((t, i, a) => ({ text: t, options: { bullet: { indent: 10 }, breakLine: i < a.length - 1, paraSpaceAfter: 4 } })), { x: 7.42, y: 1.65, w: 2.0, h: 3.25, fontSize: 10.5 });
}

// 16. Deployment + release
{
  const s = content('Deployment and release pipeline', 'Delivery',
    'Production topology on top: Cloudflare Pages for static files, one Render web service for the API and Socket.io, Neon for PostgreSQL. The backend deliberately runs a single instance because Socket.io has no cross-instance adapter yet. Bottom: the real release process used for v1.0.6 — feature branch and tests, merge to master, Render applies Prisma migrations before the new code starts, smoke checks, then a signed Android dry run that verifies the signer certificate, package, version and production API before publishing.');
  label(s, 0.5, 1.05, 2.0, 0.7, 'Cloudflare Pages', 'dashboard + portal (static)', { fill: HEX.white, line: HEX.teal });
  label(s, 3.0, 1.05, 2.6, 0.7, 'Render · 1 instance', 'API + Socket.io + cron', { fill: HEX.ice, line: HEX.blue });
  label(s, 6.1, 1.05, 1.6, 0.7, 'Neon', 'PostgreSQL', { fill: HEX.navy, line: HEX.navy, dark: true });
  label(s, 8.0, 1.05, 1.5, 0.7, 'FCM · Push · Resend', null, { ts: 10.5 });
  arrow(s, 5.6, 1.4, 6.1, 1.4, { both: true }); arrow(s, 7.7, 1.4, 8.0, 1.4); arrow(s, 2.5, 1.4, 3.0, 1.4, { dash: 'dash', color: HEX.slateLt });
  T(s, 'Single instance by design: Socket.io has no cross-instance adapter yet.', { x: 3.0, y: 1.8, w: 6.5, h: 0.3, fontSize: 10.5, color: HEX.amber });
  T(s, 'Release process (used for v1.0.6)', { x: 0.5, y: 2.3, w: 6, h: 0.3, bold: true, fontSize: 13, color: C.text2 });
  const pipe = ['Feature branch + tests', 'Merge to master', 'Render: prisma migrate deploy, then start', 'Production smoke checks', 'Signed APK dry run + verification', 'Publish GitHub Release'];
  pipe.forEach((t, i) => {
    const x = 0.5 + i * 1.53;
    label(s, x, 2.7, 1.38, 0.95, t, null, { fill: i === 4 ? HEX.ice : HEX.card, line: i === 4 ? HEX.blue : HEX.line, ts: 10 });
    if (i < 5) arrow(s, x + 1.38, 3.17, x + 1.53, 3.17, { color: HEX.blue });
  });
  box(s, 0.5, 3.95, 9.0, 1.0, { fill: HEX.card });
  T(s, [
    { text: 'APK verification on every release: ', options: { bold: true } },
    { text: 'exactly one signer · certificate pinned to 70:08:D3:…:0A:93 · package com.livequeue.mobile_app · version 1.0.6 (build 7) · not debuggable · production API compiled in. Signing keys live only in GitHub secrets — never in the repository.' },
  ], { x: 0.7, y: 4.02, w: 8.6, h: 0.86, fontSize: 11, valign: 'middle' });
}

// 17. Testing + status
{
  const s = content('Testing and current production status', 'Delivery',
    'Separate what was verified automatically from what still needs a physical device. Test counts are for production master after the 9 October rollout. Emphasize: these are correctness tests; they are not load tests, and we have not run a formal load test.');
  const stats = [['1,234', 'backend tests'], ['640', 'dashboard tests'], ['479', 'Flutter tests']];
  stats.forEach(([a, b], i) => {
    const x = 0.5 + i * 1.65;
    T(s, a, { x, y: 1.05, w: 1.6, h: 0.6, fontSize: 30, bold: true, color: C.accent1 });
    T(s, b, { x, y: 1.65, w: 1.5, h: 0.3, fontSize: 11, color: HEX.slate });
  });
  T(s, 'All passing on production master (9 Oct 2026). Typecheck, lint and production builds clean.', { x: 0.5, y: 2.05, w: 4.7, h: 0.5, fontSize: 11, color: HEX.mute });
  T(s, 'Verified automatically', { x: 0.5, y: 2.7, w: 4.6, h: 0.3, bold: true, fontSize: 13, color: HEX.green });
  bullets(s, [
    'Backend live: health, Socket.io handshake, Web Push config',
    'Both governance migrations applied; new routes respond',
    'Dashboard + portal render (headless Chromium checks)',
    'Android v1.0.6 published, Latest; APK independently verified',
    'Console + performance fixes live; per-client rate limits verified',
  ], { x: 0.5, y: 3.05, w: 4.7, h: 1.9, fontSize: 11.5 });
  box(s, 5.5, 1.05, 4.0, 3.9, { fill: HEX.amberBg, line: 'FDE68A' });
  T(s, 'Pending / not yet done', { x: 5.7, y: 1.12, w: 3.6, h: 0.3, bold: true, fontSize: 13, color: HEX.amber });
  bullets(s, [
    'Real iPhone Web Push delivery — pending physical iPhone test',
    'Physical Android device QA — pending',
    'Formal load testing — not done',
    'Console always-on-top on a real desktop OS — not verified headlessly',
    'Post-deploy DB counts recorded manually by the owner (read-only SQL)',
  ], { x: 5.7, y: 1.5, w: 3.65, h: 3.3, fontSize: 11.5 });
}

// 18. Section: capacity
section('Capacity, cost and scaling', 'Answering “How big can it run for free?” — with every number labelled', 'Transition. Everything that follows is labelled: PROVIDER LIMIT from official pages checked on 8 October 2026, HARD LIMIT from our code, MEASURED locally on a development machine, or ESTIMATE. Nothing here is a load-test result.');

// 19. Registered vs concurrent + what is free
{
  const s = content('What is actually free today?', 'Capacity',
    'Two points. First, the infrastructure costs nothing today, but the domain may have a separate registration cost that we have not verified. Second, capacity is about concurrency and traffic, not registered accounts: 100,000 accounts are just rows; what matters is how many sockets are open, how many queue events per second, and how long the queues are.');
  table(s, [
    hdr(['Service', 'Plan', 'Key free limits (PROVIDER LIMIT)']),
    ['Render (API + Socket.io)', 'Free web · Hobby', '0.1 CPU · 512 MB · 1 instance · sleeps after 15 min (≈1 min wake) · 5 GB outbound/month'],
    ['Neon (PostgreSQL)', 'Free', '100 CU-h/month (≈400 h at 0.25 CU) · 1 GB storage · 5 GB egress · sleeps after 5 min'],
    ['Cloudflare Pages', 'Free', '500 builds/month · no published static bandwidth cap'],
    ['Firebase Cloud Messaging', 'No-cost', '600k messages/min per project'],
    ['Web Push (VAPID)', 'No fee', 'iPhone/iPad Safari Home Screen PWA via Apple\'s push service; iOS/iPadOS 16.4+ and user permission'],
    ['Resend', 'Free', '100 emails/day · 3,000/month'],
    ['GitHub', 'Free (public repo)', 'Standard Actions runners free for public repos'],
  ], { x: 0.5, y: 1.05, w: 9.0, colW: [2.1, 1.5, 5.4], fs: 11.5 });
  T(s, 'Domain (tdastudbook.au): separate registration/renewal cost — not verified.   ' + CHECKED, { x: 0.5, y: 4.2, w: 9, h: 0.25, fontSize: 9.5, color: HEX.mute });
  box(s, 0.5, 4.5, 9.0, 0.6, { fill: HEX.ice, line: HEX.ice2 });
  T(s, [
    { text: 'Registered ≠ daily active ≠ waiting now ≠ open sockets ≠ requests/second. ', options: { bold: true } },
    { text: 'Infrastructure is sized by concurrency and event rate, not by accounts.' },
  ], { x: 0.65, y: 4.53, w: 8.7, h: 0.55, fontSize: 11.5, valign: 'middle' });
}

// 20. Capacity: one queue
{
  const s = content('Capacity: one queue', 'Capacity',
    'There is no software limit on people waiting. The cost of each queue event grows with the queue length, because the server recomputes everyone\'s ETA and sends each waiting person an update. The chart shows bytes one staff dashboard receives per serve cycle, measured locally. We found, in a real browser, that one Serve next with 200 waiting caused hundreds of dashboard requests, and that every iPhone visitor re-read their ticket on every event. Both are fixed and live: one Serve next now costs 2 to 4 dashboard requests and zero visitor re-reads at 50, 200 or 500 waiting. Hence: comfortable up to about 300 to 500 waiting per queue on the free server, Android and iPhone alike — an estimate, not a load test.');
  s.addChart(pres.charts.BAR, [{ name: 'KB per serve cycle', labels: ['50 waiting', '500 waiting', '2,000 waiting'], values: [53, 474, 1884] }], {
    x: 0.4, y: 1.0, w: 4.6, h: 3.0, barDir: 'col', chartColors: [HEX.blue],
    showTitle: true, title: 'Socket bytes to one staff tab per serve cycle (MEASURED, local)', titleFontSize: 11, titleColor: HEX.navy, titleFontFace: '+mn-lt',
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 10, dataLabelColor: HEX.ink, dataLabelFontFace: '+mn-lt',
    catAxisLabelColor: HEX.slate, valAxisLabelColor: HEX.slate, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', catAxisLabelFontSize: 10, valAxisLabelFontSize: 9,
    valGridLine: { color: 'E2E8F0', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: false,
  });
  T(s, 'ETA recompute per event (local): 16 ms · 103 ms · 454 ms', { x: 0.5, y: 4.05, w: 4.5, h: 0.3, fontSize: 10, color: HEX.slate });
  T(s, '1 Serve next, 200 waiting: ~400 → 4 dashboard requests · 0 visitor re-reads (MEASURED, local)', { x: 0.5, y: 4.35, w: 4.5, h: 0.45, fontSize: 10, color: HEX.green });
  table(s, [
    hdr(['', 'People waiting in one queue']),
    ['Application limit', 'None (HARD LIMIT: 32-bit token number)'],
    ['Comfortable', '~300 – 500 on free CPU (ESTIMATE)'],
    ['Caution', '> 500, or many open staff tabs (ESTIMATE)'],
    ['Before the fixes', '≤ ~50 (ESTIMATE)'],
    ['Load-tested', 'NOT LOAD-TEST VALIDATED'],
  ], { x: 5.3, y: 1.05, w: 4.2, colW: [1.55, 2.65], fs: 10.5 });
  T(s, 'Counters per queue: no limit; comfortable 1–10, caution 10–25 (ESTIMATE).', { x: 5.3, y: 3.6, w: 4.2, h: 0.45, fontSize: 10.5, color: HEX.slate });
}

// 21. Capacity pyramid (organization + platform)
{
  const s = content('Capacity at every level', 'Capacity',
    'Read top to bottom. Every row distinguishes the application rule from the infrastructure estimate. One Admin, one live queue is a product rule, not a hosting limit. No limit on organizations does not mean infinite organizations. The platform row is the one faculty will ask about: about twenty-five thousand visits a month on the free tiers, from formulas in the capacity document. SHORT ANSWER if asked: LiveQueue runs entirely on free tiers. There is no software limit on people per queue, queues per organization, or organizations. With the software fixes now live, we estimate the free deployment is comfortable for about five small organizations with similar business hours — about twenty-five thousand visits a month — and about 300 to 500 people waiting per queue. The first likely limit is Neon\'s free quotas: 5 GB of data transfer and 100 compute-hours a month. The first paid step is Neon Launch, roughly 10 to 20 dollars a month, then Render Starter at 7 dollars to remove cold starts. These are engineering estimates, not load-test results.');
  const rows = [
    ['One counter', 'One operator · one person at a time', '~12 visits/hour (5-min service)', '—'],
    ['One queue', 'No waiting limit', '~300–500 waiting · 1–10 counters', '> 500 waiting · > 25 counters'],
    ['One organization', '1 live queue per Admin; no Admin limit', '1–2 queues · ~200 visits/day', '≥ 5 busy queues'],
    ['Whole platform', 'No organization limit', '≈ 25,000 visits/month · ~5 small organizations', 'Neon free quotas exhausted'],
  ];
  table(s, [
    hdr(['Level', 'Application rule (HARD LIMIT)', 'Comfortable (ESTIMATE)', 'Upgrade trigger']),
    ...rows,
  ], { x: 0.5, y: 1.05, w: 9.0, colW: [1.6, 2.5, 2.9, 2.0], fs: 12, rowH: [0.4, 0.62, 0.62, 0.62, 0.75] });
  T(s, 'Assumptions: 4 queue events per visit, ~10 waiting, 2 staff tabs per queue, 8 h/day, 22 days/month. NOT LOAD-TEST VALIDATED.', { x: 0.5, y: 4.55, w: 9, h: 0.45, fontSize: 10, color: HEX.mute });
}

// 22. Bottlenecks
{
  const s = content('Current bottlenecks, in order', 'Capacity',
    'Three software bottlenecks we found are fixed and live since 9 October: the dashboard refetch storm, the iPhone portal\'s per-visitor re-reads, and the shared rate-limit bucket. What remains is infrastructure. Number one is Neon\'s free quotas: 5 GB of data transfer and 100 compute-hours a month — the reminder job queries every minute, so the database stays awake whenever the backend is. Then Render Free\'s small CPU and one-minute cold start, then Render\'s 5 GB outbound for long queues watched by many staff tabs, then Resend\'s 100 emails a day, but only for queues that email every visitor.');
  const b = [
    ['✓', 'Fixed and live (9 Oct 2026)', 'Dashboard refetch storm · iPhone portal re-reads · shared rate-limit bucket', HEX.green],
    ['1', 'Neon free quotas: 5 GB transfer + 100 CU-h/month', 'First likely limit; the reminder job keeps the DB awake while the backend is', HEX.red],
    ['2', 'Render Free: 0.1 CPU, ~1-minute cold start', 'Per-event ETA work grows with queue length', HEX.amber],
    ['3', 'Render outbound: 5 GB/month', 'Socket updates grow with waiting × open staff tabs', HEX.amber],
    ['4', 'Resend: 100 emails/day', 'Only if queues verify every visitor by email', HEX.slate],
    ['—', 'Not limiting now: Cloudflare Pages, FCM, Web Push, GitHub Actions', 'Free or no published cap at this scale', HEX.green],
  ];
  b.forEach(([k, a, d, c], i) => {
    const y = 1.05 + i * 0.66;
    s.addShape(pres.shapes.OVAL, { x: 0.5, y: y + 0.06, w: 0.42, h: 0.42, fill: { color: c }, line: { color: c } });
    T(s, k, { x: 0.5, y: y + 0.06, w: 0.42, h: 0.42, align: 'center', valign: 'middle', bold: true, color: C.background1, fontSize: 12 });
    T(s, [{ text: a, options: { bold: true, breakLine: true, fontSize: 12.5 } }, { text: d, options: { color: HEX.slate, fontSize: 10.5 } }], { x: 1.1, y, w: 8.4, h: 0.6 });
  });
  T(s, 'ESTIMATE from measured payloads + published quotas. ' + CHECKED, { x: 0.5, y: 5.0, w: 9, h: 0.22, fontSize: 9, color: HEX.mute });
}

// 23. Upgrade matrix
{
  const s = content('When do we need to pay?', 'Capacity',
    'The free software fixes are done and live, and bought roughly five times more headroom. The first paid step is Neon Launch — pay-as-you-go, about 10 to 20 dollars a month for one small always-busy compute, with 500 GB of egress included. Then Render Starter at 7 dollars for an always-on backend with five times the CPU. Resend Pro only if queues email every visitor. Render prices come from the pricing page as reported by third parties because the official page loads dynamically — confirm in the dashboard.');
  table(s, [
    hdr(['When this happens', 'Service', 'Upgrade to', 'Why', 'Approx. cost']),
    ['Refetch storm / shared limits', 'Code', 'Done — live 9 Oct 2026', 'Batched refetch · per-client limits', '$0'],
    ['Neon egress or hours run out', 'Neon', 'Launch (usage-based)', '500 GB egress, no hour cap', '≈ $11–20/mo*'],
    ['Cold starts / CPU busy', 'Render', 'Starter 0.5 CPU', 'Always on, 5× CPU', '$7/mo†'],
    ['Outbound > 5 GB', 'Render workspace', 'Payment method or Pro', 'Avoid suspension; 25 GB', '$0.15/GB or $25/mo'],
    ['Sustained load', 'Render', 'Standard 1 CPU · 2 GB', 'More compute, 1 instance', '$25/mo†'],
    ['> 100 emails/day', 'Resend', 'Pro', '50k/month, no daily cap', '$20/mo'],
    ['Need > 1 instance', 'Render + Redis', 'Replicas + Socket.io adapter', 'Events reach every instance', 'Size after load test'],
  ], { x: 0.5, y: 1.05, w: 9.0, colW: [1.85, 1.35, 2.05, 2.15, 1.6], fs: 11 });
  T(s, '* 0.25 CU × 400–730 h × $0.106/CU-h.  † Render pricing page is dynamic; figures corroborated by third-party listings — confirm in dashboard.  ' + CHECKED, { x: 0.5, y: 4.7, w: 9, h: 0.45, fontSize: 9, color: HEX.mute });
}

// 24. Scaling diagram
{
  const s = content('From one backend to distributed realtime', 'Scaling',
    'Today one process holds every socket, so any event it emits reaches everyone. If you simply add a second Render instance, a visitor connected to instance two will not hear an event emitted by instance one. The fix is the Socket.io Redis adapter, which relays events between instances, plus moving rate-limit counters into Redis and handling sticky sessions or WebSocket-only transport. This is future architecture, not implemented.');
  T(s, 'TODAY', { x: 0.5, y: 1.05, w: 3.8, h: 0.3, bold: true, fontSize: 12, color: HEX.green });
  label(s, 0.9, 1.45, 3.0, 0.65, 'Clients', 'app · portal · dashboard');
  label(s, 0.9, 2.5, 3.0, 0.75, 'One backend', 'REST + Socket.io + cron', { fill: HEX.ice, line: HEX.blue });
  label(s, 0.9, 3.65, 3.0, 0.65, 'PostgreSQL (Neon)', null, { fill: HEX.navy, line: HEX.navy, dark: true });
  arrow(s, 2.4, 2.1, 2.4, 2.5, { both: true }); arrow(s, 2.4, 3.25, 2.4, 3.65, { both: true });
  T(s, 'FUTURE (not implemented)', { x: 5.0, y: 1.05, w: 4.5, h: 0.3, bold: true, fontSize: 12, color: HEX.amber });
  label(s, 5.6, 1.45, 3.3, 0.55, 'Load balancer', 'sticky sessions / WebSocket-only');
  label(s, 5.2, 2.35, 1.8, 0.65, 'Backend 1', null, { fill: HEX.ice, line: HEX.blue });
  label(s, 7.5, 2.35, 1.8, 0.65, 'Backend 2', null, { fill: HEX.ice, line: HEX.blue });
  label(s, 6.35, 3.2, 1.8, 0.55, 'Redis', 'Socket.io adapter · rate limits', { fill: 'FEE2E2', line: HEX.red, ss: 8.5 });
  label(s, 6.35, 3.95, 1.8, 0.5, 'PostgreSQL', null, { fill: HEX.navy, line: HEX.navy, dark: true });
  arrow(s, 6.6, 2.0, 6.1, 2.35); arrow(s, 7.9, 2.0, 8.4, 2.35);
  arrow(s, 6.1, 3.0, 6.7, 3.2, { both: true }); arrow(s, 8.4, 3.0, 7.8, 3.2, { both: true });
  arrow(s, 7.25, 3.75, 7.25, 3.95, { both: true });
  T(s, 'Adding instances alone breaks realtime: events stay on the instance that emitted them.', { x: 0.5, y: 4.75, w: 9, h: 0.4, fontSize: 11.5, color: HEX.red });
}

// 25. Roadmap
{
  const s = content('Cost & capacity roadmap', 'Scaling',
    'Stage 0 was the free deployment before the fixes. Stage 1, software only and still free, is done and live since 9 October 2026 — that is where LiveQueue is today. Stage 2 is the first paid step at roughly 18 to 27 dollars a month. Stage 3 for a growing multi-organization platform. Stage 4 changes the architecture and should only be priced after a load test tells us how big it needs to be. All figures are estimates with pricing checked today.');
  const st = [
    ['Stage 0', 'Before fixes', '$0', 'All free tiers · 1 instance', '≈ 4k visits/mo'],
    ['Stage 1', 'Today: software fixes live', '$0', 'Batched refetch · portal payloads · per-client limits', '≈ 25k visits/mo'],
    ['Stage 2', 'First paid', '≈ $18–27/mo', 'Neon Launch · Render Starter', 'Always-on; no Neon hour cap'],
    ['Stage 3', 'Growing multi-org', '≈ $70–110/mo', 'Render Standard · Pro workspace · Resend Pro (if needed)', 'More CPU + 25 GB outbound'],
    ['Stage 4', 'High concurrency', 'Size after load test', 'Replicas · Redis · Socket.io adapter · metrics', 'Horizontal realtime'],
  ];
  st.forEach(([a, b, c, d, e], i) => {
    const x = 0.5 + i * 1.82;
    box(s, x, 1.1, 1.68, 3.55, { fill: i === 1 ? HEX.ice : HEX.card, line: i === 1 ? HEX.blue : HEX.line });
    T(s, a, { x: x + 0.12, y: 1.2, w: 1.45, h: 0.28, fontSize: 10, bold: true, color: C.accent2 });
    T(s, b, { x: x + 0.12, y: 1.48, w: 1.45, h: 0.5, fontSize: 13, bold: true, color: C.text2 });
    T(s, c, { x: x + 0.12, y: 2.05, w: 1.45, h: 0.45, fontSize: 15, bold: true, color: C.accent1 });
    T(s, d, { x: x + 0.12, y: 2.6, w: 1.45, h: 1.15, fontSize: 10.5, color: HEX.slate });
    T(s, e, { x: x + 0.12, y: 3.8, w: 1.45, h: 0.75, fontSize: 10, color: HEX.ink, italic: true });
  });
  T(s, 'ESTIMATES, not load-test validated. Fixed vs usage-based: Render plans fixed; Neon Launch usage-based. Domain cost separate. ' + CHECKED, { x: 0.5, y: 4.8, w: 9, h: 0.4, fontSize: 9.5, color: HEX.mute });
}

// 26. Limitations + future
{
  const s = content('Known limitations and future development', 'Scaling',
    'Be candid: each limitation on the left is true today. The right column is clearly future work — none of it is implemented. If asked about the desktop console: browser Picture-in-Picture already gives an always-on-top window with no install; a Tauri or Electron companion is an option only if that proves insufficient.');
  T(s, 'Limitations today', { x: 0.5, y: 1.05, w: 4.4, h: 0.3, bold: true, fontSize: 14, color: HEX.amber });
  bullets(s, [
    'Single backend instance; no Socket.io adapter',
    'Free-tier cold start (~1 minute after 15 idle minutes)',
    'Per-person socket fan-out (grows with waiting × staff tabs)',
    'In-memory rate limits; a shared NAT shares one limit',
    'No formal load test; no central metrics/alerts',
    'Physical iPhone push and Android QA pending',
  ], { x: 0.5, y: 1.5, w: 4.4, h: 3.5, fontSize: 14, paraSpaceAfter: 9 });
  T(s, 'Future (not implemented)', { x: 5.2, y: 1.05, w: 4.3, h: 0.3, bold: true, fontSize: 14, color: C.accent1 });
  bullets(s, [
    'Queue-level realtime updates instead of one per person',
    'Redis + Socket.io adapter + horizontal replicas',
    'Observability: metrics, central logs, alerts',
    'Analytics and predictive wait times',
    'Kiosk mode and institutional integrations',
    'Optional desktop (Tauri/Electron) counter companion',
  ], { x: 5.2, y: 1.5, w: 4.3, h: 3.5, fontSize: 14, paraSpaceAfter: 9 });
}

// 27. Demo plan
{
  const s = content('Live demo plan (≈ 5 minutes)', 'Demo',
    'Keep the demo short and in this order. Use a demo organization, never real data. If the backend is asleep, open the dashboard five minutes early to wake it — the cold start is about a minute. If the internet or a provider is down, use the fallback: run locally, or show the recorded screenshots in this deck.');
  const steps = ['Log in as Head: dashboard, queue, counters, services', 'Visitor scans the organization QR on a phone', 'Build a 2-step journey; get a token', 'Executive presses Serve next — phone updates live', 'Start → Complete step → person returns for step 2', 'Referral to another counter (if time allows)', 'Open the Floating Counter Console (local build)', 'Show Associates, audit log and service history'];
  steps.forEach((t, i) => {
    const col = i < 4 ? 0 : 1, row = i % 4;
    const x = 0.5 + col * 4.55, y = 1.1 + row * 0.82;
    s.addShape(pres.shapes.OVAL, { x, y: y + 0.08, w: 0.42, h: 0.42, fill: { color: HEX.blue }, line: { color: HEX.blue } });
    T(s, String(i + 1), { x, y: y + 0.08, w: 0.42, h: 0.42, align: 'center', valign: 'middle', bold: true, color: C.background1, fontSize: 12 });
    T(s, t, { x: x + 0.55, y, w: 3.8, h: 0.6, fontSize: 12, valign: 'middle' });
  });
  box(s, 0.5, 4.4, 9.0, 0.65, { fill: HEX.amberBg, line: 'FDE68A' });
  T(s, [
    { text: 'Fallback: ', options: { bold: true, color: HEX.amber } },
    { text: 'wake Render 5 minutes early · keep a local build ready · use the screenshots in this deck if a provider is down.' },
  ], { x: 0.7, y: 4.43, w: 8.6, h: 0.6, fontSize: 11.5, valign: 'middle' });
}

// 28. Conclusion
{
  ensureSection('Conclusion');
  const s = pres.addSlide({ masterName: 'TITLE_DARK', sectionTitle: 'Conclusion' }); n++;
  T(s, 'Conclusion', { x: 0.6, y: 0.5, w: 8.8, h: 0.7, fontSize: 34, bold: true, color: C.background1 });
  const pts = [
    ['Real problem', 'Physical, uncertain queues → live, multi-counter, multi-service'],
    ['Engineering', 'Server-authoritative dispatch · transactions · DB-enforced rules'],
    ['Realtime', 'Socket.io across Android, iPhone and the dashboard'],
    ['Trust', 'Instant revocation · immutable audit · governance & succession'],
    ['Honest scale', 'Free today; first limit is egress (fixable); clear upgrade path'],
  ];
  pts.forEach(([a, b], i) => {
    const y = 1.4 + i * 0.6;
    T(s, a, { x: 0.6, y, w: 2.0, h: 0.5, bold: true, fontSize: 14, color: '68CFC0', valign: 'middle' });
    T(s, b, { x: 2.7, y, w: 6.8, h: 0.5, fontSize: 14, color: C.background1, valign: 'middle' });
  });
  T(s, 'Questions?', { x: 0.6, y: 4.6, w: 8.8, h: 0.6, fontSize: 30, bold: true, color: C.background1 });
  s.addNotes('Summarize in one breath: a real problem, solved with a production system — server-authoritative dispatch, realtime sync across three clients, strong governance and security, and an honest, measured scaling path. Then invite questions; the faculty Q&A document has prepared answers.');
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT, 'slides', n);
})();
