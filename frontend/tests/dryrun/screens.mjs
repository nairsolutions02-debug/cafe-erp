// Owner screens for the money dry run: logs in as the dry-run owner, screenshots Dashboard, Cash & Shifts, Finance (each day),
// Reports (each day + the 3 days, P&L and GST), Khata and Kiosk, and checks the numbers on screen against the expected ones.
//
// Run after money-dryrun.mjs, with vite serving the dry-run tenant:
//   VITE_TENANT_SLUG=<slug from result.json> npx vite --port 5206 --strictPort
//   DRYRUN_OUT=<same dir> PW=/path/to/node_modules/playwright node tests/dryrun/screens.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const OUT = process.env.DRYRUN_OUT || '/tmp/cafe-dryrun';
const BASE = process.env.APP_URL || 'http://localhost:5206';
const R = JSON.parse(fs.readFileSync(path.join(OUT, 'result.json'), 'utf8'));
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const checks = [];
const shots = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
const page = await ctx.newPage();
const shot = async (name) => {
    const f = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: f, fullPage: true });
    shots.push(f);
};
const text = async () => page.locator('main, .admin-content, body').first().innerText();
const has = async (screen, label, value, money = true) => {
    const t = await text();
    const needle = money ? inr(value) : String(value);
    checks.push({ screen, label, expected: needle, onScreen: t.includes(needle) });
};
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200); };

// Log in with the owner's mobile + PIN
await page.goto(`${BASE}/admin/login`);
await settle();
await page.fill('input[placeholder="10-digit mobile"]', R.ownerPhone);
await page.fill('input.pin-input', R.ownerPin);
await page.click('button[type=submit]');
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 20000 });
await settle();
// first login: staff terms
if (await page.getByRole('button', { name: 'I agree' }).count()) {
    const box = page.locator('input[type=checkbox]');
    if (await box.count()) await box.first().check();
    await page.getByRole('button', { name: 'I agree' }).click();
    await settle();
}

const dismissTour = async () => {
    const no = page.getByRole('button', { name: 'No thanks' });
    if (await no.count()) { await no.first().click(); await settle(); }
};
await page.goto(`${BASE}/admin`); await settle(); await dismissTour();
const [d1, d2, d3] = R.days;
// Dashboard (today = day 3)
await page.goto(`${BASE}/admin`); await settle();
await shot('01-dashboard-day3');
{
    const t = await text();
    const m = t.match(/Today's Sales\s*₹([\d.,]+)/i);
    const o = t.match(/Today's Orders\s*(\d+)/i);
    checks.push({ screen: 'Dashboard', label: "Today's Sales (on screen) vs Finance day-3 sales", expected: inr(d3.sales.gross), onScreen: m ? `₹${m[1]}` : '?', match: m && Number(m[1].replace(/,/g, '')) === d3.sales.gross });
    checks.push({ screen: 'Dashboard', label: "Today's Orders (on screen) vs Finance day-3 orders", expected: String(d3.sales.orders), onScreen: o ? o[1] : '?', match: o && Number(o[1]) === d3.sales.orders });
}

// Finance > Today, one screenshot per day
for (const d of R.days) {
    await page.goto(`${BASE}/admin/finance?tab=today`); await settle();
    await page.fill('input[aria-label="Day"]', d.date); await settle();
    await shot(`02-finance-day${d.n}-${d.date}`);
    const S = `Finance day ${d.n}`;
    await has(S, 'Sales total', d.sales.gross);
    await has(S, 'GST collected', d.sales.tax);
    await has(S, 'Discounts', d.sales.discounts);
    await has(S, 'Not paid yet', d.sales.unpaid);
    await has(S, `Orders count "(${d.sales.orders} orders)"`, `(${d.sales.orders} orders)`, false);
    if (d.sales.refunds > 0) await has(S, `Items refunded tile (${d.sales.refunds})`, d.sales.refundsValue); // part 2
    for (const k of ['counter', 'kiosk']) {
        await has(S, `${k} shift expected cash`, d.shifts[k].expectedCash);
        await has(S, `${k} shift counted cash`, d.shifts[k].counted);
    }
}

// Cash & Shifts
await page.goto(`${BASE}/admin/shifts`); await settle();
await shot('03-cash-shifts');
for (const d of R.days) for (const k of ['counter', 'kiosk']) {
    await has('Cash & Shifts', `day ${d.n} ${k} expected`, d.shifts[k].expectedCash);
    await has('Cash & Shifts', `day ${d.n} ${k} UPI expected (true UPI)`, d.shifts[k].upiExpected);
}

// Cash & Shifts > Day close (part 3): one per day; the numbers on screen = the day close checked against the book
for (const d of R.days) {
    const dc = d.dayClose;
    if (!dc) continue;
    await page.goto(`${BASE}/admin/shifts?tab=day`); await settle();
    await page.fill('input[aria-label="Day"]', d.date); await settle();
    await shot(`12-day-close-day${d.n}-${d.date}`);
    const S = `Day close day ${d.n}`;
    await has(S, 'Bills made (counter + kiosk + QR)', dc.combined.madeTotal);
    await has(S, 'Paid cash', dc.combined.paidCash);
    await has(S, 'Paid UPI', dc.combined.paidUpi);
    await has(S, 'Paid card', dc.combined.paidCard);
    if (dc.combined.upiOnline) await has(S, 'UPI online', dc.combined.upiOnline);
    if (dc.combined.handedOver) await has(S, 'Handed over, still open at the end', dc.combined.handedOver);
    if (dc.combined.receivedBefore) await has(S, 'Received from an earlier day', dc.combined.receivedBefore);
    await has(S, 'Cash expected (all drawers)', dc.modes.cash.expected);
    await has(S, 'Cash counted (all drawers)', dc.modes.cash.counted);
    await has(S, 'Total difference', dc.money.totalVariance);
    await has(S, `Status "${dc.status.balanced ? 'Balanced' : 'Not balanced'}"`, dc.status.balanced ? '✓ Balanced' : '✗ Not balanced', false);
    if (dc.closed?.status === 'closed') await has(S, 'Closed by the owner', `Day closed by ${dc.closed.by}`, false);
    // the same numbers as the book kept by the dry run
    const exp = R.rows.find(r => r.scope.startsWith(`Day ${d.n} `) && r.area === 'Day close' && r.item === 'All bills: madeTotal');
    checks.push({ screen: S, label: 'Bills made on screen = dry-run book', expected: inr(exp.expected), onScreen: (await text()).includes(inr(exp.expected)) });
}

// Reports: P&L per day and for the 3 days, GST pack for the 3 days
const period = async (from, to) => {
    await page.fill('input[aria-label="From"]', from); await settle();
    await page.fill('input[aria-label="To"]', to); await settle();
};
const pnlRows = R.rows.filter(r => r.area === 'P&L');
for (const [label, from, to, scope] of [...R.days.map(d => [`day${d.n}-${d.date}`, d.date, d.date, `Day ${d.n} (${d.date})`]),
                                       ['3days', R.range.from, R.range.to, '3 days']]) {
    await page.goto(`${BASE}/admin/reports?tab=pnl`); await settle();
    await period(from, to);
    await shot(`04-reports-pnl-${label}`);
    for (const r of pnlRows.filter(x => x.scope === scope && typeof x.expected === 'number' && !/without a category/.test(x.item))) {
        const t = await text();
        checks.push({ screen: `Reports P&L ${label}`, label: r.item, expected: inr(Math.abs(r.expected)), onScreen: t.includes(inr(Math.abs(r.expected))),
                      appValue: inr(Math.abs(r.app)), appOnScreen: t.includes(inr(Math.abs(r.app))) });
    }
}
await page.goto(`${BASE}/admin/reports?tab=gst`); await settle();
await period(R.range.from, R.range.to);
await shot('05-reports-gst-3days');
for (const r of R.rows.filter(x => x.scope === '3 days' && x.area === 'GST pack' && /taxable \/ tax/.test(x.item))) {
    const [tx, tax] = String(r.expected).split(' / ').map(Number);
    await has('Reports GST 3 days', `${r.item} taxable`, tx);
    await has('Reports GST 3 days', `${r.item} tax`, tax);
}
for (const d of R.days) {
    await page.goto(`${BASE}/admin/reports?tab=gst`); await settle();
    await period(d.date, d.date);
    await shot(`05-reports-gst-day${d.n}-${d.date}`);
}
await page.goto(`${BASE}/admin/reports?tab=cash`); await settle();
await period(R.range.from, R.range.to);
await shot('06-reports-cashflow-3days');

// Analytics (part 2): "week" net sales = the 3 days of net sales in P&L (only these days have sales)
await page.goto(`${BASE}/admin/analytics`); await settle();
await page.getByRole('button', { name: 'Week' }).click(); await settle();
await shot('11-analytics-week');
{
    const net = R.days.reduce((t, d) => t + d.sales.netSalesLines, 0);
    await has('Analytics week', 'Net sales (without GST) = 3-day P&L net sales', `₹${net.toFixed(2)}`, false);
}

// Khata, Kiosk, Finance ledger + payables
await page.goto(`${BASE}/admin/khata`); await settle();
await shot('07-khata');
await page.goto(`${BASE}/admin/kiosk`); await settle();
await shot('08-kiosk');
await page.goto(`${BASE}/admin/finance?tab=payables`); await settle();
await shot('09-finance-payables');
await page.goto(`${BASE}/admin/finance?tab=accounts`); await settle();
await shot('10-finance-accounts');

await browser.close();
for (const c of checks) if (c.match === undefined) c.match = c.onScreen === true;
fs.writeFileSync(path.join(OUT, 'screens.json'), JSON.stringify({ checks, shots }, null, 2));
const bad = checks.filter(c => !c.match);
console.log(`${checks.length} on-screen checks, ${bad.length} not found`);
for (const b of bad) console.log('  NOT ON SCREEN', b.screen, '·', b.label, 'expected', b.expected, b.appValue ? `(app value ${b.appValue} on screen: ${b.appOnScreen})` : `(screen: ${b.onScreen})`);
console.log(shots.join('\n'));
