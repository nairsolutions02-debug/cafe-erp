// Phase 3 checks: kiosk sales (packs, kiosk stock and drawer), khata limits with manager approval,
// settlement, aging, reminders, cafe isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const client = (slug) => createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: slug ? { 'x-tenant-slug': slug } : {} },
});
const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const run = Date.now().toString().slice(-6);
const ph = (n) => `7${run}${String(n).padStart(3, '0')}`;

async function rpc(c, fn, args) {
    const { data, error } = await c.rpc(fn, args);
    if (error) throw new Error(error.message);
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
    assert.ok(res.ok, res.message);
    return c;
}
async function customer(slug, name, phone) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone });
    return c;
}
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} ≠ ${b}`);

const saEmail = `sa3-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `kiosk-a-${run}`, slugB = `kiosk-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Kiosk A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `Kiosk B ${run}`, p_slug: slugB, p_plan_id: plans.find(p => p.name === 'Starter').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const owner = await staffLogin(slugA, ph(1), '1111');
const ownerB = await staffLogin(slugB, ph(2), '2222');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
const cashier = await staffLogin(slugA, ph(10), '1010');
const manager = await staffLogin(slugA, ph(11), '1212');


await rpc(owner, 'create_staff', { p_name: 'Kiosk Kiran', p_phone: ph(12), p_role_id: role('Kiosk operator'), p_pin: '1313' });
const kiosk = await staffLogin(slugA, ph(12), '1313');

const cat = await must(owner.from('categories').insert({ name: 'Kiosk' }).select().single());
const brand = await must(owner.from('brands').insert({ name: 'Gold Flake' }).select().single());
const cig = await must(owner.from('menu_items').insert({ name: 'Gold Flake King', price: 20, mrp: 20, price_includes_tax: true,
    item_type: 'resale', is_restricted: true, category_id: cat.id, brand_id: brand.id }).select().single());
const pack = await must(owner.from('item_units').insert({ menu_item_id: cig.id, name: 'Pack', factor: 10, sale_price: 190 }).select().single());
const mint = await must(owner.from('menu_items').insert({ name: 'Mint', price: 5, price_includes_tax: true, category_id: cat.id }).select().single());
const cigStock = await rpc(owner, 'track_menu_item_stock', { p_menu_item: cig.id });
const locs = await must(owner.from('stock_locations').select());
const kioskLoc = locs.find(l => l.default_for_kiosk).id;
await rpc(owner, 'record_purchase', { p: { locationId: kioskLoc, lines: [{ itemId: cigStock, quantity: 100, rate: 15 }] } });
// Shift balance: a sale needs an open shift of its drawer (the owner opens one for this first sale and closes it)
const s0 = await rpc(owner, 'open_shift', { p_drawer: 'cash_kiosk', p_denoms: {} });
const raju = await rpc(owner, 'create_staff_order', { p: { channel: 'kiosk', customerPhone: ph(70), customerName: 'Raju',
    items: [{ menuItem: mint.id, quantity: 1 }], payFullBy: 'cash', drawer: 'cash_kiosk' } });
await rpc(owner, 'close_shift', { p_shift_id: s0.id, p_denoms: { 5: 1 } });
const rajuId = raju.user._id;

test('kiosk sale: pack of 10 at the pack price + loose pieces, stock from the kiosk, cash into the kiosk drawer', async () => {
    await rpc(kiosk, 'open_shift', { p_drawer: 'cash_kiosk', p_denoms: { 100: 5 } });
    const o = await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', clientId: `k-${run}-1`, deviceCode: 'K1',
        items: [{ menuItem: cig.id, quantity: 1, unitId: pack.id }, { menuItem: cig.id, quantity: 2 }], payFullBy: 'cash', drawer: 'cash_kiosk' } });
    assert.equal(o.total, 230);
    assert.equal(o.status, 'paid');
    const stock = (await rpc(owner, 'stock_overview', {})).find(i => i.id === cigStock);
    assert.deepEqual(stock.levels.map(l => [l.name, l.quantity]), [['Kiosk', 88]]);
    const shift = (await rpc(kiosk, 'current_shifts')).open.find(s => s.drawer === 'cash_kiosk');
    assert.equal(shift.expectedCash, 730);
    // Kiosk orders never reach the kitchen screen
    assert.ok(!(await rpc(kiosk, 'kitchen_orders')).some(k => k.id === o.id));
});

test('kiosk grid lists most-sold first with pieces left; regulars show their khata', async () => {
    const items = await rpc(kiosk, 'kiosk_items');
    assert.equal(items[0].name, 'Gold Flake King');
    assert.equal(items[0].left, 88);
    assert.equal(items[0].units[0].price, 190);
    const regs = await rpc(kiosk, 'kiosk_regulars');
    assert.ok(regs.some(r => r.name === 'Raju'));
});

test('khata: sale within the limit; over the limit needs a manager PIN; settle by UPI', async () => {
    await assert.rejects(rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', items: [{ menuItem: mint.id, quantity: 1 }], payFullBy: 'khata', drawer: 'cash_kiosk' } }),
        /Pick the customer/);
    await assert.rejects(rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: rajuId, items: [{ menuItem: cig.id, quantity: 1, unitId: pack.id }], payFullBy: 'khata', drawer: 'cash_kiosk' } }),
        /limit reached for Raju/);
    await rpc(owner, 'set_credit_limit', { p_customer: rajuId, p_limit: 300 });
    const o = await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: rajuId,
        items: [{ menuItem: cig.id, quantity: 1, unitId: pack.id }], payFullBy: 'khata', drawer: 'cash_kiosk' } });
    assert.equal(o.status, 'paid');
    assert.deepEqual(o.payments, [{ method: 'khata', amount: 190 }]);
    await assert.rejects(rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: rajuId,
        items: [{ menuItem: cig.id, quantity: 1, unitId: pack.id }], payFullBy: 'khata', drawer: 'cash_kiosk' } }), /A manager must approve/);
    await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: rajuId, approverPhone: ph(11), approverPin: '1212',
        items: [{ menuItem: cig.id, quantity: 1, unitId: pack.id }], payFullBy: 'khata', drawer: 'cash_kiosk' } });
    let acc = (await rpc(owner, 'khata_accounts')).find(a => a.customerId === rajuId);
    assert.equal(acc.balance, 380);
    assert.equal(acc.oldestDays, 0);
    await assert.rejects(rpc(kiosk, 'settle_khata', { p_customer: rajuId, p_amount: 500, p_method: 'upi' }), /Only ₹380 is due/);
    await rpc(kiosk, 'settle_khata', { p_customer: rajuId, p_amount: 200, p_method: 'upi', p_drawer: 'cash_kiosk', p_client_id: `ks-${run}` });
    await rpc(kiosk, 'settle_khata', { p_customer: rajuId, p_amount: 200, p_method: 'upi', p_drawer: 'cash_kiosk', p_client_id: `ks-${run}` });
    acc = (await rpc(owner, 'khata_accounts')).find(a => a.customerId === rajuId);
    assert.equal(acc.balance, 180, 'the repeated offline settlement counted once');
    const hist = await rpc(owner, 'khata_history', { p_customer: rajuId });
    assert.ok(hist.some(h => h.kind === 'khata_settle' && h.amount === -200));
    const found = await rpc(kiosk, 'find_customers', { p_query: ph(70).slice(-4) });
    assert.equal(found[0].balance, 180);
});

test('cancelling a khata sale takes it off the khata', async () => {
    const o = await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: rajuId, items: [{ menuItem: mint.id, quantity: 2 }], payFullBy: 'khata', drawer: 'cash_kiosk' } });
    assert.equal((await rpc(owner, 'khata_accounts')).find(a => a.customerId === rajuId).balance, 190);
    await rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'Wrong customer' });
    assert.equal((await rpc(owner, 'khata_accounts')).find(a => a.customerId === rajuId).balance, 180);
});

test('khata due over 7 days creates one reminder a day', async () => {
    const acct = (await must(service.from('money_accounts').select('id').eq('tenant_id', tenantA).eq('code', 'khata').single())).id;
    const old = await must(service.from('customers').insert({ tenant_id: tenantA, phone: ph(71), name: 'Old Debt', credit_limit: 500 }).select().single());
    await must(service.from('ledger_entries').insert({ tenant_id: tenantA, entry_date: '2026-09-01', account_id: acct, amount: 50,
        kind: 'khata_sale', customer_id: old.id, created_at: '2026-09-01T10:00:00Z' }));
    const acc = (await rpc(owner, 'khata_accounts')).find(a => a.customerId === old.id);
    // Raju's earlier ₹200 payment cleared his oldest credit first, so only fresh credit is left
    assert.equal((await rpc(owner, 'khata_accounts')).find(a => a.customerId === rajuId).oldestDays, 0);
    assert.ok(acc.oldestDays > 7, `oldest ${acc.oldestDays}`);
    assert.ok(await rpc(owner, 'daily_reminders') >= 1);
    assert.equal(await rpc(owner, 'daily_reminders'), 0);
    assert.ok((await rpc(owner, 'my_notifications', {})).some(n => n.kind === 'khata_due'));
});

test('kiosk devices follow the plan; low-stock level per location', async () => {
    assert.equal((await rpc(kiosk, 'register_device', { p_kind: 'kiosk', p_name: 'Paan counter' })).code, 'K1');
    await assert.rejects(rpc(ownerB, 'register_device', { p_kind: 'kiosk' }), /plan allows 0 kiosks/);
    await rpc(owner, 'set_location_min', { p_item: cigStock, p_location: kioskLoc, p_min: 100 });
    assert.equal((await rpc(kiosk, 'kiosk_items')).find(i => i.name === 'Gold Flake King').low, true);
});

test('cafes are isolated: B cannot see or settle A\'s khata', async () => {
    assert.equal((await rpc(ownerB, 'khata_accounts')).length, 0);
    await assert.rejects(rpc(ownerB, 'settle_khata', { p_customer: rajuId, p_amount: 1, p_method: 'cash' }), /not found/);
});
