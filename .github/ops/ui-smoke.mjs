// Read-only production UI smoke: renders pages and never submits anything
// that writes. Counts the API requests a visitor ticket page makes.
import { chromium } from 'playwright';
const WEB = 'https://livequeue-dashboard.pages.dev';
const browser = await chromium.launch();
const errors = [];
let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} ${extra}`); if (!ok) fail = 1; };

const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
check('login renders', (await page.locator('input[type="email"], input[name="email"]').count()) > 0);
await page.goto(`${WEB}/accept-invitation?token=${'d'.repeat(64)}`, { waitUntil: 'networkidle' });
await page.getByText(/expired or is no longer valid/i).first().waitFor({ timeout: 20000 }).catch(() => {});
check('invalid invitation: generic message, no password field', /expired or is no longer valid/i.test(await page.locator('body').innerText()) && (await page.locator('input[type="password"]').count()) === 0);
await page.goto(`${WEB}/accept-leadership?token=${'e'.repeat(64)}`, { waitUntil: 'networkidle' });
await page.getByText(/handover link/i).first().waitFor({ timeout: 20000 }).catch(() => {});
check('invalid handover link: no password field', (await page.locator('input[type="password"]').count()) === 0);

// iPhone Safari portal, unknown ticket: renders a plain message, and the page
// makes a bounded number of ticket reads (no refetch loop).
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, hasTouch: true });
const v = await ctx.newPage();
v.on('pageerror', (e) => errors.push(String(e)));
let reads = 0;
v.on('request', (r) => { if (/\/api\/tokens\/[0-9a-f-]{36}$/.test(r.url())) reads++; });
await v.goto(`${WEB}/visit/token/00000000-0000-4000-8000-000000000000`, { waitUntil: 'networkidle' });
await v.getByText(/Visit not found/i).first().waitFor({ timeout: 30000 }).catch(() => {});
check('portal unknown ticket: "Visit not found"', /Visit not found/i.test(await v.locator('body').innerText()));
const r0 = reads; await v.waitForTimeout(15000);
check('portal makes no further ticket reads while idle (15 s)', reads === r0, `| reads on open ${r0}, after 15 s ${reads}`);
await v.goto(`${WEB}/visit`, { waitUntil: 'networkidle' });
check('portal landing renders for iPhone Safari', (await v.locator('body').innerText()).trim().length > 0);

check('no uncaught page errors', errors.length === 0, errors.join(' ; '));
await browser.close();
process.exit(fail);
