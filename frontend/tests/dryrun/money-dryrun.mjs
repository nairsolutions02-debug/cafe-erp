// MONEY DRY RUN: three realistic cafe days on a fresh tenant, every number computed independently in JS
// and compared with what the app reports (day_summary, dashboard, P&L, GST pack, ledger, shifts, khata, stock, points).
//
// Run:  cd frontend && node tests/dryrun/money-dryrun.mjs
// Needs the local Supabase stack (API on :54321) and `docker` access to the DB container (to move days back in time).
// Writes <DRYRUN_OUT>/result.json (expected vs app, used by screens.mjs) and <DRYRUN_OUT>/tables.md.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const DBC = process.env.DB_CONTAINER || 'supabase_db_cafe-erp';
const OUT = process.env.DRYRUN_OUT || '/tmp/cafe-dryrun';
fs.mkdirSync(OUT, { recursive: true });

const client = (slug) => createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: slug ? { 'x-tenant-slug': slug } : {} },
});
const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const run = Date.now().toString().slice(-6);
const ph = (n) => `6${run}${String(n).padStart(3, '0')}`;
const log = (...a) => console.log(...a);

async function rpc(c, fn, args) {
    const { data, error } = await c.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
}
async function must(query) {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
}
async function staffLogin(slug, phone, pin) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    const res = await rpc(c, 'staff_pin_login', { p_phone: phone, p_pin: pin });
    if (!res.ok) throw new Error(res.message);
    return c;
}
async function customerLogin(slug, name, phone) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone });
    return c;
}
const psql = (sql) => execFileSync('docker', ['exec', '-i', DBC, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'],
    { input: sql, encoding: 'utf8' });

// ---------- money maths, the way an accountant would do it (round half away from zero) ----------
const r2 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7) / 100;
const r4 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 10000 + 1e-7) / 10000;
const sum = (a, f = (x) => x) => r2(a.reduce((s, x) => s + f(x), 0));
const floor = (x) => Math.floor(x + 1e-9);

// ---------- scenario: tenant ----------
const saEmail = `dry-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `dryrun-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Dry Run Cafe ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Pravin Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const tenantId = (await must(service.from('tenants').select('id').eq('slug', slug).single())).id;
log('tenant', slug, tenantId);
const owner = await staffLogin(slug, ph(1), '1111');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
await rpc(owner, 'create_staff', { p_name: 'Kiosk Kiran', p_phone: ph(12), p_role_id: role('Kiosk operator'), p_pin: '1313' });
const cashier = await staffLogin(slug, ph(10), '1010');
const kiosk = await staffLogin(slug, ph(12), '1313');
const MGR = { approverPhone: ph(11), approverPin: '1212' };
const setSetting = (key, value) => must(owner.from('settings').upsert({ key, value }));
await setSetting('qr_accept_all', false);
await must(service.from('reward_rules').update({ is_active: false }).eq('tenant_id', tenantId)); // milestone gifts off: points must follow the base rule only
const LOY = { points_per_rupee: 0.1, min_order_for_points: 100, points_to_rupee_ratio: 10, min_points_to_redeem: 100,
              max_redemption_percent: 20, points_as_cash: true, deals_on: true, is_active: true };
await must(service.from('loyalty_settings').update(LOY).eq('tenant_id', tenantId));

// ---------- menu ----------
const G5 = [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }];
const G18 = [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }];
const G28 = [{ name: 'CGST', rate: 14 }, { name: 'SGST', rate: 14 }];
const tg18 = await must(owner.from('tax_groups').insert({ name: 'Packaged 18%', components: G18 }).select().single());
const tg28 = await must(owner.from('tax_groups').insert({ name: 'Tobacco 28%', components: G28 }).select().single());
const cats = {};
for (const n of ['Coffee', 'Food', 'Packaged', 'Kiosk']) cats[n] = (await must(owner.from('categories').insert({ name: n }).select().single())).id;
const milkGroup = await must(owner.from('option_groups').insert({ name: 'Milk', pick: 'one', min_pick: 1, max_pick: 1, choices: [
    { id: 'reg', name: 'Regular', price: 0, isDefault: true }, { id: 'oat', name: 'Oat milk', price: 40 }] }).select().single());
const extraGroup = await must(owner.from('option_groups').insert({ name: 'Extras', pick: 'many', min_pick: 0, max_pick: 2, choices: [
    { id: 'haz', name: 'Hazelnut', price: 30 }, { id: 'car', name: 'Caramel', price: 30 }] }).select().single());

// JS copy of the menu (the expected side never asks the server for a price)
const MENU = {
    capp: { name: 'Cappuccino', price: 120, incl: false, comps: G5, cat: 'Coffee', recipe: [['milk', 150], ['beans', 18]] },
    latte: { name: 'Latte', price: 160, incl: false, comps: G5, cat: 'Coffee', recipe: [['milk', 200], ['beans', 18]],
             sizes: [{ id: 's', name: 'Small', price: 140 }, { id: 'm', name: 'Medium', price: 160, isDefault: true }, { id: 'l', name: 'Large', price: 190 }],
             groups: [{ id: 'milk', min: 1, max: 1, pick: 'one', choices: { reg: 0, oat: 40 }, def: ['reg'] },
                      { id: 'extra', min: 0, max: 2, pick: 'many', choices: { haz: 30, car: 30 }, def: [] }] },
    dosa: { name: 'Masala Dosa', price: 150, incl: false, comps: G5, cat: 'Food', recipe: [['batter', 250]] },
    sandwich: { name: 'Veg Sandwich', price: 130, incl: false, comps: G5, cat: 'Food', costPrice: 45 },
    croissant: { name: 'Croissant', price: 110, incl: true, comps: G5, cat: 'Food', recipe: [['croissant', 1]] },
    water: { name: 'Water 500ml', price: 20, incl: true, comps: G18, tg: tg18.id, hsn: '2201', cat: 'Packaged', costPrice: 8 },
    coke: { name: 'Coke 300ml', price: 40, incl: true, comps: G18, tg: tg18.id, hsn: '2202', cat: 'Packaged', costPrice: 25 },
    gold: { name: 'Gold Flake King', price: 20, incl: true, comps: G28, tg: tg28.id, hsn: '2402', cat: 'Kiosk', restricted: true,
            costPrice: 15, recipe: [['goldStock', 1]], units: { pack: { name: 'Pack', factor: 10, price: 190 } } },
    mint: { name: 'Mint', price: 5, incl: true, comps: G5, cat: 'Kiosk', costPrice: 2 },
};
for (const [k, m] of Object.entries(MENU)) {
    const row = await must(owner.from('menu_items').insert({
        name: m.name, price: m.price, price_includes_tax: m.incl, category_id: cats[m.cat], tax_group_id: m.tg || null,
        hsn_code: m.hsn || '', is_restricted: !!m.restricted, cost_price: m.costPrice || 0,
        item_type: k === 'gold' ? 'resale' : undefined, mrp: m.incl && m.cat !== 'Food' ? m.price : undefined,
    }).select().single());
    m.id = row.id;
}
await must(owner.from('menu_items').update({ sizes: MENU.latte.sizes, option_groups: [milkGroup.id, extraGroup.id] }).eq('id', MENU.latte.id));
const pack = await must(owner.from('item_units').insert({ menu_item_id: MENU.gold.id, name: 'Pack', factor: 10, sale_price: 190 }).select().single());
MENU.gold.units.pack.id = pack.id;
const COMBO = { name: 'Breakfast Combo', price: 230, doublePoints: true,
    slots: [{ name: 'Drink', items: [['capp', 0], ['latte', 20]] }, { name: 'Bite', items: [['croissant', 0], ['sandwich', 10]] }] };
COMBO.id = (await must(owner.from('combos').insert({ name: COMBO.name, price: COMBO.price, double_points: true,
    slots: COMBO.slots.map(s => ({ name: s.name, items: s.items.map(([k, extra]) => ({ menuItem: MENU[k].id, extra })) })) }).select().single())).id;

// ---------- stock: opening, recipes, kiosk stock ----------
const STOCK = { // JS stock book: qty (all locations), avg cost per base unit
    milk: { name: 'Milk', unit: 'ml', qty: 30000, cost: 0.05 },
    beans: { name: 'Coffee beans', unit: 'g', qty: 3000, cost: 0.8 },
    batter: { name: 'Dosa batter', unit: 'g', qty: 15000, cost: 0.04 },
    croissant: { name: 'Croissant (bought)', unit: 'pc', qty: 60, cost: 35 },
};
for (const s of Object.values(STOCK)) s.id = await rpc(owner, 'save_stock_item', { p: { name: s.name, unit: s.unit, openingStock: s.qty, avgCost: s.cost } });
for (const [k, m] of Object.entries(MENU)) {
    if (!m.recipe || k === 'gold') continue;
    await rpc(owner, 'save_recipe', { p_menu_item: m.id, p_lines: m.recipe.map(([s, q]) => ({ itemId: STOCK[s].id, quantity: q })) });
}
const goldStockId = await rpc(owner, 'track_menu_item_stock', { p_menu_item: MENU.gold.id });
STOCK.goldStock = { id: goldStockId, name: 'Gold Flake King', unit: 'pc', qty: 0, cost: 15 };
const locs = await must(owner.from('stock_locations').select());
const kioskLoc = locs.find(l => l.default_for_kiosk).id;
await rpc(owner, 'record_purchase', { p: { locationId: kioskLoc, vendorName: 'ITC distributor', billNumber: 'ITC-1',
    lines: [{ itemId: goldStockId, quantity: 200, rate: 15 }] } });
const purchaseBook = []; // JS purchases
function bookPurchase(day, lines, paid, mode, label) {
    let sub = 0, tax = 0;
    for (const l of lines) {
        const net = r2(l.qty * l.rate); const t = r2(net * (l.tax || 0) / 100);
        sub += net; tax += t;
        const s = STOCK[l.stock]; const base = l.qty * (l.factor || 1);
        s.cost = r4((Math.max(s.qty, 0) * s.cost + net + t) / (Math.max(s.qty, 0) + base));
        s.qty += base;
    }
    const total = r2(sub + tax);
    purchaseBook.push({ day, label, subtotal: r2(sub), tax: r2(tax), total, paid, due: r2(total - paid), mode });
    return total;
}
STOCK.goldStock.qty = 0;
// the ITC purchase is paid in full in cash from the office (record_purchase default)

// ---------- staff payroll: one salaried employee ----------
const emp = await must(owner.from('employees').insert({ name: 'Ravi', phone: ph(10), role: 'cashier', salary: 31000,
    joining_date: '2026-01-01', weekly_off: 0 }).select().single());

// ---------- coupons and deals ----------
await must(owner.from('coupons').insert({ code: 'CAFE10', discount_type: 'percentage', discount_value: 10, max_discount: 40,
    valid_from: '2020-01-01', valid_until: '2099-01-01' }));
const COUPONS = { CAFE10: { pct: 10, max: 40 } };
const offer = await must(owner.from('loyalty_offers').insert({ name: '₹50 off', points_required: 300, discount_value: 50, min_order_value: 200 }).select().single());
const OFFER = { id: offer.id, points: 300, value: 50, min: 200 };

// ---------- customers ----------
const CUST = {
    meera: { name: 'Meera', phone: ph(31), points: 1600, qr: true },
    arjun: { name: 'Arjun', phone: ph(32), points: 0, qr: true },
    kavya: { name: 'Kavya', phone: ph(33), points: 250, qr: true },
    sanjay: { name: 'Sanjay', phone: ph(41), points: 0, limit: 1000 },
    raju: { name: 'Raju', phone: ph(42), points: 0, limit: 500 },
};
for (const c of Object.values(CUST)) {
    if (c.qr) {
        c.client = await customerLogin(slug, c.name, c.phone);
        c.id = (await rpc(c.client, 'me')).id;
    } else {
        c.id = (await must(service.from('customers').insert({ tenant_id: tenantId, name: c.name, phone: c.phone }).select().single())).id;
    }
    if (c.points) await must(service.from('customers').update({ loyalty_points: c.points }).eq('id', c.id));
    if (c.limit) await rpc(owner, 'set_credit_limit', { p_customer: c.id, p_limit: c.limit });
    c.startPoints = c.points;
}
const expCats = await must(owner.from('expense_categories').select('id, name'));
const expCat = (n) => expCats.find(c => c.name === n).id;

// ======================================================================================
// Expected-side engine
// ======================================================================================
const SET = { roundOff: false, scPct: 0 }; // bill settings in force (changed per day)

function dishPrice(m, size, choices = []) {
    let p = m.price, sizeName = '';
    if (m.sizes) {
        const s = m.sizes.find(x => x.id === size) || m.sizes.find(x => x.isDefault) || m.sizes[0];
        p = s.price; sizeName = s.name;
    }
    for (const g of m.groups || []) {
        let picked = choices.filter(c => c in g.choices);
        if (picked.length === 0 && g.min > 0) picked = g.def.slice(0, g.pick === 'one' ? 1 : 99);
        for (const c of picked) p += g.choices[c];
    }
    return { price: p, sizeName };
}
function recipeCost(m) {
    if (!m.recipe) return null;
    return m.recipe.reduce((s, [k, q]) => s + q * STOCK[k].cost, 0);
}
// Build the expected lines for an order (prices, cost snapshot, stock use)
function buildLines(items) {
    return items.map((it) => {
        if (it.combo) {
            let unit = COMBO.price, cost = 0;
            const uses = [];
            it.picks.forEach((pk, i) => {
                const m = MENU[pk.k];
                const extra = COMBO.slots[i].items.find(([k]) => k === pk.k)[1];
                unit += extra + Math.max(dishPrice(m, pk.size, pk.choices).price - dishPrice(m).price, 0);
                const rc = recipeCost(m);
                cost += rc == null ? (m.costPrice || 0) : rc;
                for (const [k, q] of m.recipe || []) uses.push([k, q * it.qty]);
            });
            const first = MENU[it.picks[0].k];
            return { name: COMBO.name, unit, qty: it.qty, t: r2(unit * it.qty), incl: first.incl, comps: first.comps,
                     rate: first.comps.reduce((s, c) => s + c.rate, 0), restricted: false, combo: true, unitCost: r2(cost), uses,
                     hsn: first.hsn || '996331' };
        }
        const m = MENU[it.k];
        let unit = dishPrice(m, it.size, it.choices).price, factor = 1;
        if (it.unit) { unit = m.units[it.unit].price; factor = m.units[it.unit].factor; }
        const rc = recipeCost(m);
        const unitCost = rc == null ? r2((m.costPrice || 0) * factor) : r2(rc * factor);
        const uses = (m.recipe || []).map(([k, q]) => [k, q * it.qty * factor]);
        return { name: m.name, unit, qty: it.qty, t: r2(unit * it.qty), incl: m.incl, comps: m.comps,
                 rate: m.comps.reduce((s, c) => s + c.rate, 0), restricted: !!m.restricted, combo: false, unitCost, uses,
                 hsn: m.hsn || '996331' };
    });
}
function allocate(lines, total, base, ok) {
    let cum = 0;
    return lines.map(l => {
        if (!ok(l) || base <= 0) return 0;
        cum += l.t;
        return r2(r2(total * cum / base) - r2(total * (cum - l.t) / base));
    });
}
// Price an order the way the bill should come out
function priceJS(items, { coupon, manual = 0, offer: useOffer, pointsCash, cust, channel }) {
    const lines = buildLines(items);
    const subtotal = sum(lines, l => l.t);
    const eligible = sum(lines.filter(l => !l.restricted), l => l.t);
    let couponDisc = 0;
    if (coupon) {
        const c = COUPONS[coupon];
        const base = sum(lines.filter(l => !l.restricted), l => l.t);
        couponDisc = r2(Math.min(Math.min(base * c.pct / 100, c.max), eligible));
    }
    let offerDisc = 0, pointsUsed = 0;
    if (pointsCash) {
        offerDisc = floor(Math.min(cust.points / LOY.points_to_rupee_ratio, eligible * LOY.max_redemption_percent / 100, Math.max(eligible - couponDisc, 0)));
        pointsUsed = Math.ceil(offerDisc * LOY.points_to_rupee_ratio - 1e-9);
    }
    if (useOffer) { offerDisc = r2(Math.min(OFFER.value, eligible - couponDisc)); pointsUsed = OFFER.points; }
    const man = r2(Math.min(Math.max(manual, 0), Math.max(eligible - couponDisc - offerDisc, 0)));
    const eligDisc = offerDisc + man;
    const cd = allocate(lines, couponDisc, sum(lines.filter(l => !l.restricted), l => l.t), l => !l.restricted);
    const ed = allocate(lines, eligDisc, eligible, l => !l.restricted);
    const buckets = {};
    lines.forEach((l, i) => {
        l.disc = r2(cd[i] + ed[i]);
        l.gross = r2(l.t - l.disc);
        l.net = l.incl ? r2(l.gross / (1 + l.rate / 100)) : l.gross;
        l.tax = l.incl ? r2(l.gross - l.net) : r2(l.net * l.rate / 100);
        for (const c of l.comps) {
            const k = `${c.name}@${c.rate}`;
            buckets[k] = buckets[k] || { name: c.name, rate: c.rate, amt: 0, excl: 0 };
            const a = l.incl ? (l.rate > 0 ? (l.gross - l.net) * c.rate / l.rate : 0) : l.net * c.rate / 100;
            buckets[k].amt += a;
            if (!l.incl) buckets[k].excl += a;
        }
    });
    const tax = sum(Object.values(buckets), b => r2(b.amt));
    const exclTax = sum(Object.values(buckets), b => r2(b.excl));
    const base = r2(sum(lines, l => (l.incl ? l.gross : l.net)) + exclTax);
    let sc = 0, scTax = 0, ro = 0;
    if (SET.scPct > 0 && ['qr', 'dine_in'].includes(channel)) {
        sc = r2(sum(lines, l => l.net) * SET.scPct / 100);
        scTax = r2(sc * 5 / 100);
    }
    const pre = r2(base + sc + scTax);
    if (SET.roundOff) ro = r2(Math.round(pre) - pre);
    const total = r2(pre + ro);
    const discount = r2(couponDisc + offerDisc + man);
    return { lines, subtotal, eligible, couponDisc, offerDisc, manual: man, discount, tax, exclTax, base, sc, scTax, ro, total, pointsUsed,
             taxBuckets: Object.values(buckets).map(b => ({ name: b.name, rate: b.rate, amount: r2(b.amt) })) };
}
function pointsFor(calc) {
    const base = r2(calc.lines.filter(l => !l.restricted).reduce((s, l) => s + l.t - l.disc, 0));
    if (!(base > 0 && base >= LOY.min_order_for_points)) return 0;
    let p = floor(base * LOY.points_per_rupee);
    if (p > 0) {
        const cb = r2(calc.lines.filter(l => l.combo).reduce((s, l) => s + l.t - l.disc, 0));
        p += floor(cb * LOY.points_per_rupee);
    }
    return p;
}

// ---------- the expected book ----------
const DAYS = []; // { n, date, orders[], ledger[], expenses[], shifts{counter,kiosk}, live{} }
let D; // current day
const ORD = {}; // key -> order record
const LEDGER = []; // { day, account, amount, kind, method, shift: 'counter'|'kiosk'|null, ownerShift }
const EXPENSES = []; // { day, category, amount, account }
const post = (account, amount, kind, method, shift, extra = {}) => {
    if (r2(amount) !== 0) LEDGER.push({ day: D.n, account, amount: r2(amount), kind, method, shift, ownerShift: extra.ownerShift ?? shift, ...extra });
};
const drawerAcc = (drawer) => (drawer === 'kiosk' ? 'cash_kiosk' : 'cash_counter');
const PROBLEMS = []; // things the run itself tripped over

function applyStock(lines, sign) {
    for (const l of lines) for (const [k, q] of l.uses) STOCK[k].qty = r2(STOCK[k].qty - sign * q);
}

async function sale(key, { by, channel, items, pay, coupon, manual, approve, useOffer, pointsCash, cust, table, tender }) {
    const who = by === 'kiosk' ? kiosk : by === 'owner' ? owner : cashier;
    const drawer = by === 'kiosk' ? 'kiosk' : 'counter';
    const c = cust ? CUST[cust] : null;
    const calc = priceJS(items, { coupon, manual, offer: useOffer, pointsCash, cust: c, channel });
    const payload = items.map(it => it.combo
        ? { combo: COMBO.id, quantity: it.qty, picks: it.picks.map(p => ({ menuItem: MENU[p.k].id, size: p.size, choices: p.choices })) }
        : { menuItem: MENU[it.k].id, quantity: it.qty, size: it.size, choices: it.choices, unitId: it.unit ? MENU[it.k].units[it.unit].id : undefined });
    const rec = { key, day: D.n, by, channel, calc, cust, status: 'open', payments: [], pointsExpected: 0 };
    ORD[key] = rec; D.orders.push(rec);
    applyStock(calc.lines, 1);
    if (c && calc.pointsUsed) c.points -= calc.pointsUsed;
    let res;
    if (channel === 'qr') {
        const id = await rpc(c.client, 'place_order', { p_items: payload, p_coupon_code: coupon || '', p_loyalty_offer_id: useOffer ? OFFER.id : null,
                                                         p_points_cash: !!pointsCash, p_client_id: `${key}-${run}` });
        res = await rpc(c.client, 'get_order', { p_id: id });
        rec.customerSaw = res.total;
    } else {
        const p = { clientId: `${key}-${run}`, channel, items: payload, couponCode: coupon || undefined,
                    customerId: c ? c.id : undefined, drawer: drawerAcc(drawer), deviceCode: by === 'kiosk' ? 'K1' : 'C1' };
        if (manual) { p.manualDiscount = manual; p.discountReason = 'Regular customer'; if (approve) Object.assign(p, MGR); }
        res = await rpc(who, 'create_staff_order', { p });
    }
    rec.id = res.id; rec.server = { total: Number(res.total), tax: Number(res.tax), discount: Number(res.discount), status: res.status };
    if (Math.abs(rec.server.total - calc.total) > 0.001) PROBLEMS.push(`${key}: server total ${rec.server.total} vs expected ${calc.total}`);
    if (pay) await settle(key, pay, { by, tender });
    return rec;
}
// pay: 'cash' | 'upi' | 'card' | 'khata' | [{method, amount}] ; tender = cash handed over (change back)
async function settle(key, pay, { by, tender, via } = {}) {
    const rec = ORD[key];
    const drawer = (by || rec.by) === 'kiosk' ? 'kiosk' : 'counter';
    const who = (by || rec.by) === 'kiosk' ? kiosk : cashier;
    const total = rec.calc.total;
    let parts = typeof pay === 'string' ? [{ method: pay, amount: total }] : pay.map(p => ({ ...p }));
    if (typeof pay !== 'string') { // last part takes the remainder of the expected bill
        const rest = r2(total - sum(parts.slice(0, -1), p => p.amount));
        parts[parts.length - 1].amount = rest;
    }
    let sent = parts.map(p => ({ ...p }));
    if (tender && parts.length === 1 && parts[0].method === 'cash') sent = [{ method: 'cash', amount: tender }];
    let res;
    if (via === 'record_payment') res = await rpc(who, 'record_payment', { p_order_id: rec.id, p_method: parts[0].method, p_amount: parts[0].amount });
    else res = await rpc(who, 'settle_order', { p_order_id: rec.id, p_payments: sent, p_drawer: drawerAcc(drawer) });
    for (const p of parts) {
        if (p.method === 'khata') post('khata', p.amount, 'khata_sale', 'khata', drawer, { customer: rec.cust, order: key });
        else post(p.method === 'cash' ? drawerAcc(drawer) : p.method, p.amount, 'sale', p.method, drawer, { order: key });
        rec.payments.push({ ...p, drawer });
    }
    rec.status = 'paid';
    if (rec.cust) {
        const c = CUST[rec.cust];
        const pts = pointsFor(rec.calc);
        rec.pointsExpected = pts;
        c.points += pts;
        // FiKA Club tiers (defaults): paid orders of ₹100+ this month, this one included -> points multiplier
        if (rec.calc.total >= 100) c.monthOrders = (c.monthOrders || 0) + 1;
        const mult = c.monthOrders >= 15 ? 2 : c.monthOrders >= 8 ? 1.5 : c.monthOrders >= 4 ? 1.25 : 1;
        if (mult > 1 && pts > 0) { rec.clubExtra = floor(pts * (mult - 1)); c.points += rec.clubExtra; }
    }
    rec.server.status = res.status;
    rec.change = Number(res.change || 0);
    if (tender) rec.changeExpected = r2(tender - total);
    return res;
}
async function cancel(key, by, reason) {
    const rec = ORD[key];
    const who = by === 'owner' ? owner : by === 'kiosk' ? kiosk : cashier;
    const args = { p_order_id: rec.id, p_reason: reason };
    if (by !== 'owner') Object.assign(args, { p_approver_phone: MGR.approverPhone, p_approver_pin: MGR.approverPin });
    await rpc(who, 'cancel_order', args);
    const counterOrKiosk = by === 'kiosk' ? 'kiosk' : 'counter';
    for (const p of rec.payments) {
        const acc = p.method === 'cash' ? drawerAcc(p.drawer) : p.method;
        const appShift = p.method === 'cash' ? p.drawer : null; // the app only knows shifts on cash drawers
        post(acc, -p.amount, 'refund', p.method, appShift, { ownerShift: p.method === 'cash' ? p.drawer : counterOrKiosk, order: key, customer: rec.cust });
    }
    if (rec.status === 'paid' && rec.cust) CUST[rec.cust].points += 0; // points stay (app rule: earned points are not taken back)
    if (rec.cust && rec.calc.pointsUsed) CUST[rec.cust].points += rec.calc.pointsUsed; // redeemed points come back
    applyStock(rec.calc.lines, -1);
    rec.status = 'cancelled'; rec.cancelledOn = D.n;
}
async function cashMove(drawer, kind, amount, note, category) {
    const who = drawer === 'kiosk' ? kiosk : cashier;
    await rpc(who, 'cash_movement', { p_drawer: drawerAcc(drawer), p_kind: kind, p_amount: amount, p_note: note,
                                      p_category_id: category ? expCat(category) : null });
    if (kind === 'payout') {
        post(drawerAcc(drawer), -amount, category ? 'expense' : 'payout', 'cash', drawer);
        if (category) EXPENSES.push({ day: D.n, category, amount, account: drawerAcc(drawer) });
    } else if (kind === 'drop') {
        post(drawerAcc(drawer), -amount, 'drop', 'cash', drawer);
        post('cash_office', amount, 'drop', 'cash', null);
    } else {
        post(drawerAcc(drawer), amount, 'pay_in', 'cash', drawer);
        post('cash_office', -amount, 'pay_in', 'cash', null);
    }
}
async function openShift(drawer, denoms) {
    const who = drawer === 'kiosk' ? kiosk : cashier;
    const s = await rpc(who, 'open_shift', { p_drawer: drawerAcc(drawer), p_denoms: denoms });
    const opening = Object.entries(denoms).reduce((t, [d, n]) => t + Number(d) * n, 0);
    D.shifts[drawer] = { id: s.id, opening, appOpen: s.openingCash };
}
function expectedShift(day, drawer) {
    const sh = DAYS[day - 1].shifts[drawer];
    const mine = LEDGER.filter(e => e.day === day && e.shift === drawer);
    const cashAcc = drawerAcc(drawer);
    const cash = mine.filter(e => e.account === cashAcc);
    const ownerMine = LEDGER.filter(e => e.day === day && e.ownerShift === drawer);
    return {
        openingCash: sh.opening,
        cashSales: sum(cash.filter(e => ['sale', 'refund'].includes(e.kind)), e => e.amount),
        payouts: -sum(cash.filter(e => ['payout', 'expense', 'purchase_payment'].includes(e.kind)), e => e.amount),
        drops: -sum(cash.filter(e => e.kind === 'drop'), e => e.amount),
        khataSettled: sum(cash.filter(e => e.kind === 'khata_settle'), e => e.amount),
        expectedCash: r2(sh.opening + sum(cash, e => e.amount)),
        // owner view: every UPI / card rupee taken or given back at this drawer during the shift
        upiExpected: sum(ownerMine.filter(e => e.account === 'upi' && ['sale', 'refund', 'khata_settle'].includes(e.kind)), e => e.amount),
        cardExpected: sum(ownerMine.filter(e => e.account === 'card' && ['sale', 'refund', 'khata_settle'].includes(e.kind)), e => e.amount),
        orders: new Set(mine.filter(e => e.kind === 'sale').map(e => e.order)).size,
    };
}
async function closeShift(drawer, offBy, reason) {
    const who = drawer === 'kiosk' ? kiosk : cashier;
    const exp = expectedShift(D.n, drawer);
    const counted = r2(exp.expectedCash + offBy);
    // count in notes: as many 500s as fit, then 100s, 50s, 20s, 10s, then 1s
    let left = Math.round(counted); const denoms = {};
    for (const d of [500, 100, 50, 20, 10, 1]) { const n = Math.floor(left / d); if (n) { denoms[d] = n; left -= n * d; } }
    const closed = await rpc(who, 'close_shift', { p_shift_id: D.shifts[drawer].id, p_denoms: denoms, p_upi_reported: exp.upiExpected,
                                                   p_card_reported: exp.cardExpected, p_reason: reason || '' });
    Object.assign(D.shifts[drawer], { counted, offBy, expected: exp, app: closed });
}
async function settleKhata(custKey, amount, method, drawer) {
    const who = drawer === 'kiosk' ? kiosk : cashier;
    await rpc(who, 'settle_khata', { p_customer: CUST[custKey].id, p_amount: amount, p_method: method, p_drawer: drawerAcc(drawer) });
    post('khata', -amount, 'khata_settle', method, null, { customer: custKey });
    const acc = method === 'cash' ? drawerAcc(drawer) : method;
    post(acc, amount, 'khata_settle', method, method === 'cash' ? drawer : null, { ownerShift: drawer, customer: custKey });
}
async function expense(category, amount, accountCode, note) {
    await rpc(owner, 'record_expense', { p: { categoryId: expCat(category), amount, accountCode, note } });
    post(accountCode, -amount, 'expense', '', null);
    EXPENSES.push({ day: D.n, category, amount, account: accountCode });
}
async function liveSnapshot() {
    D.live = {
        day: await rpc(owner, 'day_summary', {}),
        dash: await rpc(owner, 'dashboard_stats'),
        ledgerCount: (await rpc(owner, 'list_ledger', { p: { from: D.date, to: D.date, limit: 2000 } })).length,
    };
}

// Move every dated row of this tenant back by one day (the app always stamps now(); this makes yesterday out of today).
// Triggers (ledger_immutable, stock_moves_immutable, shifts close guard, audit, order triggers) are off for this
// transaction only, via session_replication_role = replica.
function shiftTenantBackOneDay() {
    const sql = `
begin;
set local session_replication_role = replica;
do $$
declare r record; v_t uuid := '${tenantId}';
begin
  for r in
    select c.table_name,
           string_agg(format('%I = %I - interval ''1 day''', c.column_name, c.column_name), ', ') as sets
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.is_generated = 'NEVER'
       and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone')
       and c.column_name not in ('birthday', 'anniversary', 'old_birthday', 'new_birthday', 'month', 'locked_until', 'paid_until')
       and c.table_name not in ('tenants')
       and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'tenant_id')
     group by c.table_name
  loop
    begin
      execute format('update public.%I set %s where tenant_id = $1', r.table_name, r.sets) using v_t;
    exception when unique_violation then
      execute format('update public.%I set %s where tenant_id = $1', r.table_name, replace(r.sets, '''1 day''', '''10000 days''')) using v_t;
      execute format('update public.%I set %s where tenant_id = $1', r.table_name, replace(replace(r.sets, '- interval', '+ interval'), '''1 day''', '''9999 days''')) using v_t;
    end;
  end loop;
end $$;
commit;`;
    psql(sql);
}

// ======================================================================================
// DAY 1  (no round-off, no service charge)
// ======================================================================================
const today0 = (await rpc(owner, 'day_summary', {})).date;
D = { n: 1, orders: [], shifts: {}, settings: { roundOff: false, scPct: 0 } }; DAYS.push(D);
await setSetting('round_off', false); await setSetting('service_charge_pct', 0);
Object.assign(SET, { roundOff: false, scPct: 0 });
// the ITC bill for kiosk stock was paid from the office cash
bookPurchase(1, [{ stock: 'goldStock', qty: 200, rate: 15 }], 3000, 'cash', 'ITC-1');
post('cash_office', -3000, 'purchase_payment', 'cash', null);
await rpc(owner, 'give_advance', { p_employee: emp.id, p_amount: 1000, p_instalment: 500, p_account_code: 'cash_office' });
post('cash_office', -1000, 'advance', '', null);

await openShift('counter', { 500: 2, 100: 10 });
await openShift('kiosk', { 100: 10 });
const C = (k, qty, o = {}) => ({ k, qty, ...o });
const CMB = (qty, picks) => ({ combo: true, qty, picks });
await sale('d1-01', { by: 'cashier', channel: 'takeaway', items: [C('capp', 2)], pay: 'cash', tender: 300 });
await sale('d1-02', { by: 'cashier', channel: 'dine_in', items: [C('dosa', 1), C('capp', 1)], pay: 'upi' });
await sale('d1-03', { by: 'cashier', channel: 'takeaway', items: [C('latte', 1, { size: 'l', choices: ['oat', 'haz'] }), C('croissant', 1)], pay: 'card' });
await sale('d1-04', { by: 'cashier', channel: 'dine_in', cust: 'sanjay', items: [CMB(1, [{ k: 'latte' }, { k: 'croissant' }])], pay: 'cash' });
await sale('d1-05', { by: 'cashier', channel: 'takeaway', items: [C('sandwich', 2), C('water', 2)], pay: [{ method: 'cash', amount: 100 }, { method: 'upi' }] });
await sale('d1-06', { by: 'cashier', channel: 'takeaway', items: [C('capp', 3), C('dosa', 1)], manual: 80, approve: true, pay: 'cash' });
await sale('d1-07', { by: 'cashier', channel: 'takeaway', items: [C('latte', 2), C('croissant', 2)], coupon: 'CAFE10', pay: 'upi' });
await sale('d1-08', { by: 'cashier', channel: 'dine_in', items: [C('dosa', 2)], pay: 'cash' });
await cancel('d1-08', 'cashier', 'Customer left before food');
await sale('d1-09', { by: 'cashier', channel: 'takeaway', cust: 'sanjay', items: [C('coke', 2), C('sandwich', 1)], pay: 'cash' });
await sale('d1-10', { by: 'cashier', channel: 'dine_in', items: [C('capp', 2), C('croissant', 2)], pay: 'cash' }); // refunded tomorrow
await sale('d1-11', { channel: 'qr', cust: 'meera', items: [C('latte', 1, { size: 's' }), C('dosa', 1)], useOffer: true });
await settle('d1-11', 'cash', { by: 'cashier', via: 'record_payment' });
await sale('d1-12', { channel: 'qr', cust: 'arjun', items: [C('capp', 2), C('croissant', 1)] });
await rpc(CUST.arjun.client, 'request_payment', { p_order_id: ORD['d1-12'].id, p_mode: 'qr' });
await settle('d1-12', 'upi', { by: 'cashier', via: 'record_payment' });
await sale('d1-13', { channel: 'qr', cust: 'kavya', items: [CMB(1, [{ k: 'capp' }, { k: 'sandwich' }])], pointsCash: true });
await settle('d1-13', 'upi', { by: 'cashier', via: 'record_payment' });
await sale('d1-14', { by: 'cashier', channel: 'takeaway', items: [C('dosa', 1), C('water', 1)], pay: 'card' });
await sale('d1-15', { by: 'cashier', channel: 'dine_in', items: [C('latte', 1, { choices: ['car'] }), C('capp', 1)], pay: 'cash' });
// kiosk
await sale('d1-k1', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 1, { unit: 'pack' }), C('mint', 2)], pay: 'cash' });
await sale('d1-k2', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 3), C('water', 1)], pay: 'upi' });
await sale('d1-k3', { by: 'kiosk', channel: 'kiosk', cust: 'raju', items: [C('gold', 1, { unit: 'pack' }), C('coke', 1)], pay: 'khata' });
await sale('d1-k4', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 2), C('mint', 1)], pay: 'cash', tender: 50 });
await sale('d1-k5', { by: 'kiosk', channel: 'kiosk', items: [C('coke', 2)], pay: 'upi' });
await sale('d1-k6', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 5), C('mint', 4)], pay: 'cash' });
// drawer money
await cashMove('counter', 'payout', 300, 'Milk from the dairy boy', 'Consumables');
await cashMove('counter', 'drop', 1500, 'To the owner');
await cashMove('kiosk', 'payout', 50, 'Tea for staff');
await closeShift('counter', 0);
await closeShift('kiosk', 0);
D.date = today0;
await liveSnapshot();
log('day 1 done', D.live.day.sales);
shiftTenantBackOneDay();

// ======================================================================================
// DAY 2  (round-off on)
// ======================================================================================
D = { n: 2, orders: [], shifts: {}, settings: { roundOff: true, scPct: 0 } }; DAYS.push(D);
await setSetting('round_off', true); Object.assign(SET, { roundOff: true, scPct: 0 });
await openShift('counter', { 500: 2, 100: 10 });
await openShift('kiosk', { 100: 10 });
await cancel('d1-10', 'cashier', 'Cold coffee yesterday, refunded'); // a day-1 sale refunded in cash today
await sale('d2-01', { by: 'cashier', channel: 'takeaway', items: [C('capp', 1), C('croissant', 1)], pay: 'cash', tender: 500 });
await sale('d2-02', { by: 'cashier', channel: 'dine_in', items: [C('dosa', 2), C('capp', 2)], pay: [{ method: 'cash', amount: 200 }, { method: 'upi' }] });
await sale('d2-03', { by: 'cashier', channel: 'takeaway', items: [C('latte', 2, { size: 'l' })], pay: 'upi' });
await cancel('d2-03', 'cashier', 'Wrong size, customer refused'); // UPI refund
await sale('d2-04', { by: 'cashier', channel: 'dine_in', cust: 'sanjay', items: [C('dosa', 1), C('capp', 1)], pay: 'khata' });
await sale('d2-05', { by: 'cashier', channel: 'takeaway', items: [CMB(2, [{ k: 'latte', size: 'l', choices: ['oat'] }, { k: 'sandwich' }])], pay: 'card' });
await sale('d2-06', { by: 'cashier', channel: 'takeaway', items: [C('sandwich', 1), C('coke', 1), C('water', 1)], pay: 'cash' });
await sale('d2-07', { by: 'cashier', channel: 'dine_in', items: [C('capp', 2), C('dosa', 2)], manual: 100, approve: true, pay: 'upi' });
await sale('d2-08', { by: 'cashier', channel: 'takeaway', items: [C('croissant', 3)], coupon: 'CAFE10', pay: 'cash' });
await sale('d2-09', { by: 'cashier', channel: 'takeaway', items: [C('latte', 1), C('capp', 1)], manual: 10, pay: 'cash' }); // within cashier limit
await sale('d2-10', { channel: 'qr', cust: 'meera', items: [C('latte', 2), C('croissant', 1)], pointsCash: true });
await rpc(CUST.meera.client, 'request_payment', { p_order_id: ORD['d2-10'].id, p_mode: 'qr' });
await settle('d2-10', 'upi', { by: 'cashier', via: 'record_payment' });
await sale('d2-11', { channel: 'qr', cust: 'arjun', items: [C('dosa', 1), C('latte', 1, { size: 's' })], coupon: 'CAFE10' });
await settle('d2-11', 'cash', { by: 'cashier', via: 'record_payment' });
await sale('d2-12', { by: 'cashier', channel: 'dine_in', items: [C('capp', 4)], pay: 'cash' });
await sale('d2-13', { by: 'cashier', channel: 'takeaway', items: [C('water', 3)], pay: 'cash' });
// kiosk
await sale('d2-k1', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 1, { unit: 'pack' })], pay: 'upi' });
await sale('d2-k2', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 4), C('mint', 3)], pay: 'cash' });
await sale('d2-k3', { by: 'kiosk', channel: 'kiosk', cust: 'raju', items: [C('gold', 2), C('water', 1)], pay: 'khata' });
await sale('d2-k4', { by: 'kiosk', channel: 'kiosk', items: [C('coke', 1), C('mint', 2)], pay: 'cash' });
await sale('d2-k5', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 2, { unit: 'pack' })], pay: 'cash' });
await settleKhata('raju', 200, 'cash', 'kiosk');
// money out
const dairy = await must(owner.from('vendors').insert({ name: 'Nandini Dairy & Beans', gstin: '29ABCDE1234F1Z5', payment_terms_days: 7 }).select().single());
const bill = await rpc(owner, 'record_purchase', { p: { vendorId: dairy.id, billNumber: 'ND-77', paidAmount: 500, paymentMode: 'drawer',
    lines: [{ itemId: STOCK.milk.id, unitName: 'Litre', factor: 1000, quantity: 10, rate: 55 },
            { itemId: STOCK.beans.id, unitName: 'kg', factor: 1000, quantity: 1, rate: 900, taxRate: 5 }] } });
bookPurchase(2, [{ stock: 'milk', qty: 10, factor: 1000, rate: 55 }, { stock: 'beans', qty: 1, factor: 1000, rate: 900, tax: 5 }], 500, 'drawer', 'ND-77');
post('cash_counter', -500, 'purchase_payment', 'drawer', 'counter');
await expense('Gas', 900, 'cash_office', 'Cylinder');
await cashMove('counter', 'payout', 120, 'Lemons and chillies', 'Consumables');
await cashMove('counter', 'drop', 2000, 'To the owner');
await closeShift('counter', -50, 'Gave wrong change to a table');
await closeShift('kiosk', 20, 'Extra in drawer');
D.date = today0;
await liveSnapshot();
log('day 2 done', D.live.day.sales);
shiftTenantBackOneDay();

// ======================================================================================
// DAY 3 = today (service charge 5% on dine-in/QR + round-off)
// ======================================================================================
D = { n: 3, orders: [], shifts: {}, settings: { roundOff: true, scPct: 5 } }; DAYS.push(D);
await setSetting('service_charge_pct', 5); Object.assign(SET, { roundOff: true, scPct: 5 });
await openShift('counter', { 500: 2, 100: 10 });
await openShift('kiosk', { 100: 5 });
await sale('d3-01', { by: 'cashier', channel: 'dine_in', items: [C('dosa', 2), C('capp', 2)], pay: 'cash' });
await sale('d3-02', { by: 'cashier', channel: 'takeaway', items: [C('latte', 1, { size: 'l', choices: ['oat', 'haz', 'car'].slice(0, 2) }), C('croissant', 2)], pay: 'upi' });
await sale('d3-03', { by: 'cashier', channel: 'dine_in', items: [CMB(1, [{ k: 'capp' }, { k: 'croissant' }]), C('water', 1)], pay: [{ method: 'card', amount: 100 }, { method: 'cash' }] });
await sale('d3-04', { by: 'cashier', channel: 'takeaway', items: [C('sandwich', 3)], manual: 90, approve: true, pay: 'cash' });
await sale('d3-05', { by: 'cashier', channel: 'dine_in', cust: 'sanjay', items: [C('capp', 2), C('sandwich', 1)], coupon: 'CAFE10', pay: 'card' });
await sale('d3-06', { by: 'cashier', channel: 'takeaway', items: [C('dosa', 1), C('coke', 2)], pay: 'cash', tender: 300 });
await sale('d3-07', { channel: 'qr', cust: 'kavya', items: [C('latte', 2), C('dosa', 1)] });
await settle('d3-07', 'cash', { by: 'cashier', via: 'record_payment' });
await sale('d3-08', { channel: 'qr', cust: 'meera', items: [CMB(1, [{ k: 'latte', size: 'l' }, { k: 'croissant' }]), C('capp', 1)], useOffer: true });
await rpc(CUST.meera.client, 'request_payment', { p_order_id: ORD['d3-08'].id, p_mode: 'qr' });
await settle('d3-08', 'upi', { by: 'cashier', via: 'record_payment' });
await sale('d3-09', { channel: 'qr', cust: 'arjun', items: [C('sandwich', 1), C('capp', 1)] });
await cancel('d3-09', 'owner', 'Kitchen out of bread'); // cancelled before paying
await sale('d3-10', { channel: 'qr', cust: 'arjun', items: [C('dosa', 1), C('capp', 2)] }); // still unpaid tonight
await sale('d3-11', { by: 'cashier', channel: 'dine_in', items: [C('capp', 1), C('latte', 1)], pay: 'upi' });
await sale('d3-12', { by: 'cashier', channel: 'takeaway', items: [C('croissant', 4), C('water', 4)], pay: 'cash' });
await settleKhata('sanjay', sum(LEDGER.filter(x => x.account === 'khata' && x.customer === 'sanjay'), x => x.amount), 'cash', 'counter'); // pays off the day-2 khata in full
// kiosk
await sale('d3-k1', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 1, { unit: 'pack' }), C('mint', 1)], pay: 'cash' });
await sale('d3-k2', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 6)], pay: 'upi' });
await sale('d3-k3', { by: 'kiosk', channel: 'kiosk', items: [C('coke', 3), C('water', 2)], pay: 'cash' });
await cancel('d3-k3', 'kiosk', 'Rang up twice');
await sale('d3-k4', { by: 'kiosk', channel: 'kiosk', items: [C('gold', 3), C('mint', 2)], pay: 'cash' });
await settleKhata('raju', sum(LEDGER.filter(x => x.account === 'khata' && x.customer === 'raju'), x => x.amount), 'upi', 'kiosk'); // clears the rest by UPI
await rpc(owner, 'pay_purchase', { p_id: bill.id, p_amount: 400, p_mode: 'upi' });
purchaseBook.find(p => p.label === 'ND-77').paid += 400; purchaseBook.find(p => p.label === 'ND-77').due = r2(purchaseBook.find(p => p.label === 'ND-77').due - 400);
post('upi', -400, 'purchase_payment', 'upi', null);
await expense('Electricity', 2400, 'bank', 'October bill');
await cashMove('counter', 'payout', 250, 'Ice and milk', 'Consumables');
await cashMove('kiosk', 'drop', 300, 'To the owner');
await closeShift('counter', 20, 'Customer left extra');
await closeShift('kiosk', -30, 'Short, will check CCTV');
D.date = today0;
await liveSnapshot();
log('day 3 done', D.live.day.sales);

// dates after the moves
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
DAYS[0].date = addDays(today0, -2); DAYS[1].date = addDays(today0, -1); DAYS[2].date = today0;

// ======================================================================================
// Compare
// ======================================================================================
const rows = []; // { scope, area, item, expected, app, ok, note }
const cmp = (scope, area, item, expected, app, note = '') => {
    const e = typeof expected === 'number' ? r2(expected) : expected;
    const a = typeof app === 'number' ? r2(app) : app;
    const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v);
    const ok = typeof e === 'number' ? Math.abs(e - Number(a)) < 0.005 : JSON.stringify(norm(e)) === JSON.stringify(norm(a));
    rows.push({ scope, area, item, expected: e, app: a, ok, note });
};
const num = (x) => Number(x ?? 0);
const dayOrders = (n) => Object.values(ORD).filter(o => o.day === n);
const live = (o) => o.status !== 'cancelled';

// per-order: customer-visible total and points
for (const o of Object.values(ORD)) {
    const srv = await rpc(owner, 'get_order', { p_id: o.id });
    o.final = srv;
    cmp(`Day ${o.day}`, 'Order', `${o.key} total (${o.channel})`, o.calc.total, num(srv.total));
    if (o.customerSaw !== undefined) cmp(`Day ${o.day}`, 'Customer app', `${o.key} total shown to ${o.cust}`, o.calc.total, num(o.customerSaw));
    if (o.changeExpected !== undefined) cmp(`Day ${o.day}`, 'Order', `${o.key} change returned`, o.changeExpected, o.change);
    if (o.cust) cmp(`Day ${o.day}`, 'Loyalty', `${o.key} points awarded`, o.status === 'paid' || (o.status === 'cancelled' && o.payments.length) ? o.pointsExpected : 0, num(srv.pointsAwarded));
    cmp(`Day ${o.day}`, 'Order', `${o.key} status`, o.status === 'open' ? 'pending' : o.status, srv.status === 'bill_requested' ? 'pending' : srv.status);
}

const salesOf = (orders) => {
    const lv = orders.filter(live);
    const byCh = {};
    for (const o of lv) { byCh[o.channel] = byCh[o.channel] || { orders: 0, total: 0 }; byCh[o.channel].orders++; byCh[o.channel].total = r2(byCh[o.channel].total + o.calc.total); }
    const disc = { coupon: sum(lv, o => o.calc.couponDisc), manual: sum(lv, o => o.calc.manual), points: sum(lv, o => o.calc.offerDisc) };
    const rate = {};
    for (const o of lv) for (const l of o.calc.lines) {
        rate[l.rate] = rate[l.rate] || { taxable: 0, tax: 0 };
        rate[l.rate].taxable = r2(rate[l.rate].taxable + l.net); rate[l.rate].tax = r2(rate[l.rate].tax + l.tax);
    }
    for (const o of lv) if (o.calc.sc) { rate[5] = rate[5] || { taxable: 0, tax: 0 }; rate[5].taxable = r2(rate[5].taxable + o.calc.sc); rate[5].tax = r2(rate[5].tax + o.calc.scTax); }
    return {
        orders: lv.length, gross: sum(lv, o => o.calc.total), tax: sum(lv, o => o.calc.tax + o.calc.scTax), discounts: sum(lv, o => o.calc.discount),
        serviceCharge: sum(lv, o => o.calc.sc), roundOff: sum(lv, o => o.calc.ro),
        unpaid: sum(lv.filter(o => o.status !== 'paid'), o => o.calc.total),
        cancelled: orders.filter(o => !live(o)).length, cancelledValue: sum(orders.filter(o => !live(o)), o => o.calc.total),
        netSales: sum(lv, o => o.calc.total - o.calc.tax - o.calc.scTax - o.calc.ro),
        netSalesLines: sum(lv, o => sum(o.calc.lines, l => l.net) + o.calc.sc),
        cogs: sum(lv, o => sum(o.calc.lines, l => l.unitCost * l.qty)),
        paidRevenue: sum(lv.filter(o => o.status === 'paid'), o => o.calc.total), paidOrders: lv.filter(o => o.status === 'paid').length,
        byCh, disc, rate,
    };
};
// "owner view" of a day: a sale refunded on a later day stays in the day it was sold
const ownerSalesOf = (n) => salesOf(dayOrders(n).map(o => (o.status === 'cancelled' && o.cancelledOn > o.day && o.payments.length ? { ...o, status: 'paid' } : o)));

const moneyOf = (filter) => {
    const acc = {};
    for (const e of LEDGER.filter(filter)) {
        acc[e.account] = acc[e.account] || { in: 0, out: 0 };
        if (e.amount > 0) acc[e.account].in = r2(acc[e.account].in + e.amount); else acc[e.account].out = r2(acc[e.account].out - e.amount);
    }
    return acc;
};
const staffPerDay = 31000 / 31; // October has 31 days
const expensesOf = (filter) => EXPENSES.filter(filter);

for (const d of DAYS) {
    const S = `Day ${d.n} (${d.date})`;
    const ds = await rpc(owner, 'day_summary', { p_date: d.date });
    d.appDay = ds;
    const ex = salesOf(dayOrders(d.n));
    const exOwner = ownerSalesOf(d.n);
    const crossDay = dayOrders(d.n).some(o => o.status === 'cancelled' && o.cancelledOn > o.day && o.payments.length);
    const note = crossDay ? 'B1: expected keeps the sale refunded on a later day' : '';
    cmp(S, 'Sales', 'Orders (not cancelled)', exOwner.orders, num(ds.sales.orders), note);
    cmp(S, 'Sales', 'Sales total incl. GST', exOwner.gross, num(ds.sales.gross), note);
    cmp(S, 'Sales', 'GST collected (items + service charge)', exOwner.tax, num(ds.sales.tax), note);
    cmp(S, 'Sales', 'Discounts (all types)', exOwner.discounts, num(ds.sales.discounts), note);
    cmp(S, 'Sales', 'Service charge', exOwner.serviceCharge, num(ds.sales.serviceCharge));
    cmp(S, 'Sales', 'Not paid yet', exOwner.unpaid, num(ds.sales.unpaid));
    cmp(S, 'Sales', 'Cancelled orders', exOwner.cancelled, num(ds.sales.cancelled), note);
    cmp(S, 'Sales', 'Cancelled value', exOwner.cancelledValue, num(ds.sales.cancelledValue), note);
    cmp(S, 'Sales', 'Average bill', exOwner.orders ? r2(exOwner.gross / exOwner.orders) : 0, num(ds.sales.avgBill), note);
    const manualList = dayOrders(d.n).filter(o => o.calc.manual > 0).map(o => o.calc.manual).sort((a, b) => a - b);
    cmp(S, 'Sales', 'Manual discounts listed', manualList, (ds.discounts || []).map(x => num(x.amount)).sort((a, b) => a - b));
    for (const ch of ['takeaway', 'dine_in', 'qr', 'kiosk']) {
        const e = exOwner.byCh[ch] || { orders: 0, total: 0 };
        const a = (ds.channels || []).find(x => x.channel === ch) || { orders: 0, total: 0 };
        cmp(S, 'Channel', `${ch} orders / total`, `${e.orders} / ${r2(e.total)}`, `${num(a.orders)} / ${r2(num(a.total))}`, note);
    }
    // money by account for the day
    const em = moneyOf(e => e.day === d.n);
    for (const code of ['cash_counter', 'cash_kiosk', 'cash_office', 'upi', 'card', 'bank', 'khata']) {
        const e = em[code] || { in: 0, out: 0 };
        const a = (ds.money || []).find(x => x.code === code) || { in: 0, out: 0 };
        cmp(S, 'Money by account', `${code} in / out`, `${r2(e.in)} / ${r2(e.out)}`, `${r2(num(a.in))} / ${r2(num(a.out))}`);
    }
    // expenses of the day
    const ee = {}; for (const x of expensesOf(x => x.day === d.n)) ee[x.category] = r2((ee[x.category] || 0) + x.amount);
    const ae = {}; for (const x of ds.expenses || []) ae[x.category] = num(x.amount);
    cmp(S, 'Expenses', 'Expenses by category', ee, ae);
    cmp(S, 'Purchases', 'Vendor bills dated this day', sum(purchaseBook.filter(p => p.day === d.n), p => p.total), num(ds.purchases));
    // shifts, counter and kiosk separately
    for (const drawer of ['counter', 'kiosk']) {
        const sh = d.shifts[drawer];
        const app = (ds.shifts || []).find(s => s.id === sh.id);
        const e = expectedShift(d.n, drawer);
        const T = drawer === 'counter' ? 'Counter drawer' : 'Kiosk drawer';
        if (!app) { cmp(S, T, 'shift listed in day summary', 'yes', 'no'); continue; }
        cmp(S, T, 'Opening float', e.openingCash, num(app.openingCash));
        cmp(S, T, 'Cash sales (net of refunds)', e.cashSales, num(app.cashSales));
        cmp(S, T, 'Khata collected in cash', e.khataSettled, num(app.khataSettled));
        cmp(S, T, 'Pay-outs / expenses / vendor cash', e.payouts, num(app.payouts));
        cmp(S, T, 'Drops to safe', e.drops, num(app.drops));
        cmp(S, T, 'Expected cash in drawer', e.expectedCash, num(app.expectedCash));
        cmp(S, T, 'Counted cash', sh.counted, num(app.countedCash));
        cmp(S, T, 'Variance (counted − expected)', sh.offBy, num(app.difference));
        cmp(S, T, 'UPI taken at this drawer (net of refunds, incl. khata)', e.upiExpected, num(app.upiExpected));
        cmp(S, T, 'Card taken at this drawer', e.cardExpected, num(app.cardExpected));
        cmp(S, T, 'Paid orders in shift', e.orders, num(app.orders));
        cmp(S, T, 'close_shift result = day_summary shift', num(sh.app.expectedCash), num(app.expectedCash));
    }
    // GST pack for the day
    const g = await rpc(owner, 'gst_pack', { p_from: d.date, p_to: d.date });
    d.appGst = g;
    for (const [rate, v] of Object.entries(exOwner.rate)) {
        const a = (g.byRate || []).find(x => num(x.rate) === Number(rate)) || { taxable: 0, tax: 0, cgst: 0, sgst: 0 };
        cmp(S, 'GST pack', `${rate}% taxable / tax`, `${r2(v.taxable)} / ${r2(v.tax)}`, `${r2(num(a.taxable))} / ${r2(num(a.tax))}`, note);
        cmp(S, 'GST pack', `${rate}% CGST + SGST adds up to the tax on the same row`, r2(num(a.tax)), r2(num(a.cgst) + num(a.sgst)), 'app vs app');
    }
    cmp(S, 'GST pack', 'GST pack tax = day summary GST', num(ds.sales.tax), sum(g.byRate || [], x => num(x.tax)), 'app vs app');
    // P&L for the day
    const p = (await rpc(owner, 'pnl', { p_from: d.date, p_to: d.date })).current;
    d.appPnl = p;
    const expTotal = sum(expensesOf(x => x.day === d.n), x => x.amount);
    cmp(S, 'P&L', 'Net sales (excl. GST)', exOwner.netSalesLines, num(p.netSales), note);
    cmp(S, 'P&L', 'GST', exOwner.tax, num(p.taxes), note);
    cmp(S, 'P&L', 'COGS (recipe cost snapshots)', exOwner.cogs, num(p.cogs), note);
    cmp(S, 'P&L', 'Gross profit', r2(exOwner.netSalesLines - exOwner.cogs), num(p.grossProfit), note);
    cmp(S, 'P&L', 'Expenses', expTotal, num(p.expensesTotal));
    cmp(S, 'P&L', 'Staff cost (estimate 31000/31 per day)', r2(staffPerDay), num(p.staffCost));
    cmp(S, 'P&L', 'Net profit', r2(exOwner.netSalesLines - exOwner.cogs - expTotal - staffPerDay), num(p.netProfit), note);
    // ledger rows of the day
    const led = await rpc(owner, 'list_ledger', { p: { from: d.date, to: d.date, limit: 2000 } });
    cmp(S, 'Ledger', 'Ledger rows', LEDGER.filter(e => e.day === d.n).length, led.length);
    cmp(S, 'Ledger', 'Ledger net movement', sum(LEDGER.filter(e => e.day === d.n), e => e.amount), sum(led, e => num(e.amount)));
    cmp(S, 'Ledger', 'Ledger rows still dated this day after moving days (live count)', d.live.ledgerCount, led.length, 'shift check');
    // shifting check: day summary for the moved day = live summary on that day
    cmp(S, 'Day-move check', 'day_summary now = day_summary taken live that day (gross)', num(d.live.day.sales.gross), num(ds.sales.gross),
        d.n === 1 ? 'differs only by the day-2 refund of d1-10 (B1)' : '');
    // dashboard on the live day
    cmp(S, 'Dashboard (live that day)', "Today's revenue (paid orders)", exOwner.paidRevenue - (d.n === 1 ? 0 : 0), num(d.live.dash.today.revenue), 'dashboard counts paid orders only');
    cmp(S, 'Dashboard (live that day)', "Today's revenue = Finance day sales", num(d.live.day.sales.gross), num(d.live.dash.today.revenue), 'app vs app');
    cmp(S, 'Dashboard (live that day)', "Today's orders = Finance day orders", num(d.live.day.sales.orders), num(d.live.dash.today.orders), 'app vs app');
}

// ---------- 3-day range ----------
{
    const S = '3 days';
    const all = Object.values(ORD);
    const ex = salesOf(all);
    const from = DAYS[0].date, to = DAYS[2].date;
    const p = (await rpc(owner, 'pnl', { p_from: from, p_to: to })).current;
    const g = await rpc(owner, 'gst_pack', { p_from: from, p_to: to });
    const expTotal = sum(EXPENSES, x => x.amount);
    cmp(S, 'P&L', 'Gross sales incl. GST', ex.gross, num(p.grossSales));
    cmp(S, 'P&L', 'GST', ex.tax, num(p.taxes));
    cmp(S, 'P&L', 'Net sales (sum of line taxable values + service charge)', ex.netSalesLines, num(p.netSales));
    cmp(S, 'P&L', 'COGS', ex.cogs, num(p.cogs));
    cmp(S, 'P&L', 'Gross profit', r2(ex.netSalesLines - ex.cogs), num(p.grossProfit));
    const ee = {}; for (const x of EXPENSES) ee[x.category] = r2((ee[x.category] || 0) + x.amount);
    const ae = {}; for (const x of p.expenses || []) ae[x.category] = num(x.amount);
    cmp(S, 'P&L', 'Expenses by category', ee, ae);
    cmp(S, 'P&L', 'Expenses total', expTotal, num(p.expensesTotal));
    cmp(S, 'P&L', 'Staff cost (3 × 1000)', r2(staffPerDay * 3), num(p.staffCost));
    cmp(S, 'P&L', 'Net profit', r2(ex.netSalesLines - ex.cogs - expTotal - staffPerDay * 3), num(p.netProfit));
    cmp(S, 'P&L', 'Cash paid out of drawers without a category (not in P&L)', 50, 0, 'kiosk “Tea for staff” payout');
    for (const ch of ['takeaway', 'dine_in', 'qr', 'kiosk']) {
        const e = ex.byCh[ch] || { orders: 0, total: 0 };
        const a = (p.channels || []).find(x => x.channel === ch) || { orders: 0, gross: 0 };
        cmp(S, 'Channel', `${ch} orders / gross`, `${e.orders} / ${r2(e.total)}`, `${num(a.orders)} / ${r2(num(a.gross))}`);
    }
    for (const [rate, v] of Object.entries(ex.rate)) {
        const a = (g.byRate || []).find(x => num(x.rate) === Number(rate)) || { taxable: 0, tax: 0 };
        cmp(S, 'GST pack', `${rate}% taxable / tax`, `${r2(v.taxable)} / ${r2(v.tax)}`, `${r2(num(a.taxable))} / ${r2(num(a.tax))}`);
    }
    cmp(S, 'GST pack', 'Total GST in pack = P&L GST', num(p.taxes), sum(g.byRate || [], x => num(x.tax)), 'app vs app');
    cmp(S, 'GST pack', 'Total GST in pack = expected invoice GST', ex.tax, sum(g.byRate || [], x => num(x.tax)));
    cmp(S, 'GST pack', 'Orders in period / cancelled', `${all.length} / ${all.filter(o => !live(o)).length}`, `${g.orders.count} / ${g.orders.cancelled}`);
    cmp(S, 'GST pack', 'Purchase bills with GSTIN', purchaseBook.length, (g.purchases || []).length);
    const hsnExp = {};
    for (const o of all.filter(live)) for (const l of o.calc.lines) { hsnExp[l.hsn] = r2((hsnExp[l.hsn] || 0) + l.tax); }
    const hsnApp = {}; for (const h of g.hsn || []) hsnApp[h.code] = r2((hsnApp[h.code] || 0) + num(h.tax));
    cmp(S, 'GST pack', 'Tax by HSN/SAC', hsnExp, hsnApp, 'combos: HSN of the first pick; service charge not in HSN');
    // cash flow and balances
    const cf = await rpc(owner, 'cash_flow', { p_from: from, p_to: to });
    const em = moneyOf(() => true);
    const bal = await rpc(owner, 'account_balances');
    for (const code of ['cash_counter', 'cash_kiosk', 'cash_office', 'upi', 'card', 'bank', 'khata']) {
        const e = em[code] || { in: 0, out: 0 };
        const a = cf.find(x => x.code === code) || {};
        cmp(S, 'Cash flow', `${code} in / out / closing`, `${r2(e.in)} / ${r2(e.out)} / ${r2(e.in - e.out)}`, `${r2(num(a.in))} / ${r2(num(a.out))} / ${r2(num(a.closing))}`);
        cmp(S, 'Balances', `${code} balance`, r2(e.in - e.out), num((bal.find(x => x.code === code) || {}).balance));
    }
    // shifts listed for the 3 days
    const ls = await rpc(owner, 'list_shifts', { p_from: from, p_to: to });
    cmp(S, 'Shifts', 'Shifts listed (2 drawers × 3 days)', 6, ls.length);
    for (const drawer of ['counter', 'kiosk']) {
        const T = drawer === 'counter' ? 'Counter drawer' : 'Kiosk drawer';
        const mine = ls.filter(s => s.drawer === drawerAcc(drawer));
        cmp(S, T, 'Sum of variances', sum(DAYS, d => d.shifts[drawer].offBy), sum(mine, s => num(s.difference)));
        cmp(S, T, 'Sum of cash sales', sum(DAYS, d => expectedShift(d.n, drawer).cashSales), sum(mine, s => num(s.cashSales)));
        cmp(S, T, 'Sum of UPI taken', sum(DAYS, d => expectedShift(d.n, drawer).upiExpected), sum(mine, s => num(s.upiExpected)));
    }
    // khata
    const kh = await rpc(owner, 'khata_accounts');
    for (const ck of ['sanjay', 'raju']) {
        const e = sum(LEDGER.filter(x => x.account === 'khata' && x.customer === ck), x => x.amount);
        cmp(S, 'Khata', `${CUST[ck].name} balance`, e, num((kh.find(a => a.customerId === CUST[ck].id) || {}).balance));
    }
    // payables
    const pay = await rpc(owner, 'payables');
    const nd = (pay.bills || []).find(b => b.id === bill.id) || {};
    cmp(S, 'Payables', 'Nandini bill ND-77 total / due', `${purchaseBook[1].total} / ${purchaseBook[1].due}`, `${num(nd.total)} / ${num(nd.due)}`);
    // stock
    const so = await rpc(owner, 'stock_overview', {});
    for (const [k, s] of Object.entries(STOCK)) {
        const a = so.find(i => i.id === s.id) || {};
        cmp(S, 'Stock', `${s.name} quantity (${s.unit})`, r2(s.qty), r2(num(a.totalQuantity)));
        cmp(S, 'Stock', `${s.name} average cost`, r4(s.cost), r4(num(a.avgCost)));
    }
    // loyalty
    for (const [k, c] of Object.entries(CUST)) {
        const row = await must(service.from('customers').select('loyalty_points').eq('id', c.id).single());
        cmp(S, 'Loyalty', `${c.name} points now (start ${c.startPoints})`, c.points, row.loyalty_points);
    }
    // dashboard now (day 3 is today)
    const dash = await rpc(owner, 'dashboard_stats');
    const d3 = salesOf(dayOrders(3));
    cmp('Day 3', 'Dashboard (now)', "Today's revenue", d3.paidRevenue, num(dash.today.revenue), 'paid orders only');
    cmp('Day 3', 'Dashboard (now)', "Today's orders", d3.paidOrders, num(dash.today.orders), 'paid orders only');
    cmp('Day 3', 'Dashboard (now)', "Today's revenue = Finance > Today sales", num(DAYS[2].appDay.sales.gross), num(dash.today.revenue), 'app vs app');
    cmp('Day 3', 'Dashboard (now)', 'This month revenue (paid, 3 days)', ex.paidRevenue, num(dash.month.revenue));
    const notes = await rpc(owner, 'my_notifications', { p_limit: 100 });
    const mism = notes.filter(n => n.kind === 'shift_mismatch').map(n => n.title).sort();
    cmp(S, 'Alerts', 'Shift mismatch alerts (only real cash variances above ₹50 tolerance: none expected)', [], mism,
        'cash variances were 0, -50, +20 (counter) and 0, +20, -30 (kiosk); UPI reported = true UPI');
    // the range result for screens.mjs
    DAYS.range = { from, to, pnl: p, gst: g };
}

// ---------- write results ----------
const fmt = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
let md = '';
const scopes = [...new Set(rows.map(r => r.scope))];
for (const s of scopes) {
    md += `\n### ${s}\n\n| Area | Number | Expected | App | Match |\n|---|---|---|---|---|\n`;
    for (const r of rows.filter(x => x.scope === s)) md += `| ${r.area} | ${r.item}${r.note ? ` _(${r.note})_` : ''} | ${fmt(r.expected)} | ${fmt(r.app)} | ${r.ok ? 'yes' : '**NO**'} |\n`;
}
const result = {
    slug, tenantId, ownerPhone: ph(1), ownerPin: '1111', dates: DAYS.map(d => d.date), problems: PROBLEMS,
    days: DAYS.map(d => ({ n: d.n, date: d.date, settings: d.settings, sales: ownerSalesOf(d.n), appSales: d.appDay.sales,
        shifts: Object.fromEntries(Object.entries(d.shifts).map(([k, v]) => [k, { ...expectedShift(d.n, k), counted: v.counted, offBy: v.offBy, app: (d.appDay.shifts || []).find(s => s.id === v.id) }])),
        pnl: d.appPnl })),
    orders: Object.values(ORD).map(o => ({ key: o.key, day: o.day, channel: o.channel, by: o.by, cust: o.cust, status: o.status, total: o.calc.total,
        tax: o.calc.tax, discount: o.calc.discount, sc: o.calc.sc, ro: o.calc.ro, payments: o.payments, app: { total: num(o.final.total), status: o.final.status, pointsAwarded: o.final.pointsAwarded } })),
    ledger: LEDGER, expenses: EXPENSES, purchases: purchaseBook, stock: STOCK, customers: Object.fromEntries(Object.entries(CUST).map(([k, c]) => [k, { name: c.name, points: c.points, start: c.startPoints }])),
    range: { from: DAYS.range.from, to: DAYS.range.to },
    rows,
};
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(OUT, 'tables.md'), md);
const bad = rows.filter(r => !r.ok);
log(`\n${rows.length} checks, ${bad.length} mismatches. Tenant ${slug}. Output in ${OUT}`);
for (const r of bad) log(`  MISMATCH [${r.scope}] ${r.area} · ${r.item}: expected ${fmt(r.expected)} app ${fmt(r.app)} ${r.note}`);
if (PROBLEMS.length) log('Run problems:', PROBLEMS);
