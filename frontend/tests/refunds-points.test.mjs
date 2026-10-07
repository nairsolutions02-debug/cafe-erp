// Partial refunds (refund some items), points and deals at the counter, and sales trends that match Finance.
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
const r2 = (x) => Math.round(Number(x) * 100) / 100;

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

const saEmail = `rp-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `rp-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Refunds ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const tenantId = (await must(service.from('tenants').select('id').eq('slug', slug).single())).id;
const owner = await staffLogin(slug, ph(1), '1111');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
await rpc(owner, 'create_staff', { p_name: 'Kiosk Kiran', p_phone: ph(12), p_role_id: role('Kiosk operator'), p_pin: '1313' });
const cashier = await staffLogin(slug, ph(10), '1010');
const kiosk = await staffLogin(slug, ph(12), '1313');
const approve = { p_approver_phone: ph(11), p_approver_pin: '1212' };
await must(service.from('reward_rules').update({ is_active: false }).eq('tenant_id', tenantId));
await must(service.from('loyalty_settings').update({ points_per_rupee: 0.1, min_order_for_points: 0, points_to_rupee_ratio: 10,
    min_points_to_redeem: 100, max_redemption_percent: 20, points_as_cash: false, deals_on: true, is_active: true }).eq('tenant_id', tenantId));

const cat = await must(owner.from('categories').insert({ name: 'Cafe' }).select().single());
const snacks = await must(owner.from('categories').insert({ name: 'Snacks' }).select().single());
const coffee = await must(owner.from('menu_items').insert({ name: 'Coffee', price: 100, category_id: cat.id }).select().single());
const g18 = await must(owner.from('tax_groups').insert({ name: '18%', components: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] }).select().single());
const chips = await must(owner.from('menu_items').insert({ name: 'Chips', price: 35, price_includes_tax: true, tax_group_id: g18.id,
    category_id: snacks.id, item_type: 'resale', cost_price: 20 }).select().single());
const milk = await rpc(owner, 'save_stock_item', { p: { name: 'Milk', unit: 'ml', openingStock: 10000, avgCost: 0.05 } });
await rpc(owner, 'save_recipe', { p_menu_item: coffee.id, p_lines: [{ itemId: milk, quantity: 200 }] });
const chipsStock = await rpc(owner, 'track_menu_item_stock', { p_menu_item: chips.id });
await rpc(owner, 'record_purchase', { p: { vendorName: 'Snack co', lines: [{ itemId: chipsStock, quantity: 50, rate: 20 }] } });
const combo = await must(owner.from('combos').insert({ name: 'Coffee + Chips', price: 120,
    slots: [{ name: 'Drink', items: [{ menuItem: coffee.id, extra: 0 }] }, { name: 'Bite', items: [{ menuItem: chips.id, extra: 0 }] }] }).select().single());

const today = (await rpc(owner, 'day_summary', {})).date;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const yesterday = addDays(today, -1);
const customer = async (name, n, points = 0, limit = 0) => (await must(service.from('customers')
    .insert({ tenant_id: tenantId, name, phone: ph(n), loyalty_points: points, credit_limit: limit }).select().single())).id;
const pointsOf = async (id) => (await must(service.from('customers').select('loyalty_points').eq('id', id).single())).loyalty_points;
const stockOf = async (id) => Number((await must(service.from('inventory').select('current_stock').eq('id', id).single())).current_stock);
const lines = async (orderId) => must(service.from('order_items').select('*').eq('order_id', orderId).order('name'));
const sell = (who, items, extra = {}) => rpc(who, 'create_staff_order', { p: { channel: 'takeaway', items, payFullBy: 'cash', ...extra } });
const moveToYesterday = (orderId) => must(service.from('orders').update({ created_at: new Date(Date.now() - 864e5).toISOString() }).eq('id', orderId));

await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 2 } });
await rpc(kiosk, 'open_shift', { p_drawer: 'cash_kiosk', p_denoms: { 100: 5 } });
const shiftOf = async (drawer) => (await rpc(owner, 'current_shifts')).open.find(s => s.drawer === drawer);
const pnl = async (from, to = from) => (await rpc(owner, 'pnl', { p_from: from, p_to: to })).current;

test('refund some items the same day: exact amount, the day goes down, the drawer pays it, nothing back in stock', async () => {
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 3 }, { menuItem: chips.id, quantity: 2 }], { manualDiscount: 10, discountReason: 'Regular' });
    const [ch, co] = await lines(o.id);
    const before = await rpc(owner, 'day_summary', {});
    const s0 = await shiftOf('cash_counter');
    const p0 = await pnl(today);
    const milk0 = await stockOf(milk);
    const quote = await rpc(cashier, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_preview: true });
    const want = r2((Number(co.net_amount) + Number(co.tax_amount)) / 3);
    assert.equal(Number(quote.amount), want, 'one coffee = a third of the line (net + GST), discount share included');
    assert.ok(Number(quote.discount) > 0, 'the discount share is shown');
    await assert.rejects(rpc(cashier, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_reason: 'Cold' }),
        /manager must approve/i);
    const res = await rpc(cashier, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1, restock: false }],
        p_method: 'cash', p_reason: 'Cold', ...approve });
    assert.equal(Number(res.refund.amount), want);
    assert.equal(Number(res.refunded), want);
    assert.equal(res.items.find(i => i.name === 'Coffee').refundedQty, 1);
    const after = await rpc(owner, 'day_summary', {});
    assert.equal(r2(after.sales.gross - before.sales.gross), -want, 'Finance today goes down by the refund');
    assert.equal(after.sales.refunds, 1);
    assert.equal(Number(after.sales.refundsValue), want);
    assert.equal(after.refundList[0].items, '1 × Coffee');
    assert.equal(after.sales.orders, before.sales.orders, 'still one bill');
    assert.equal(r2((await shiftOf('cash_counter')).expectedCash - s0.expectedCash), -want, 'cash comes out of the counter drawer');
    const p1 = await pnl(today);
    assert.equal(r2(p1.netSales - p0.netSales), -r2(Number(res.refund.lines[0].net)), 'net sales down by the taxable value');
    assert.equal(r2(p1.cogs), r2(p0.cogs), 'not put back in stock: the cost stays');
    assert.equal(await stockOf(milk), milk0, 'milk not put back');
    // The rest of the line, then too much
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 3 }], p_reason: 'x' }), /only 2 left/);
    // Chips are packaged: put back in stock, COGS goes down
    const chips0 = await stockOf(chipsStock);
    const r2nd = await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: ch.id, quantity: 1, restock: true }], p_method: 'upi', p_reason: 'Damaged pack' });
    assert.equal(await stockOf(chipsStock), chips0 + 1, 'one pack back on the shelf');
    const p2 = await pnl(today);
    assert.equal(r2(p1.cogs - p2.cogs), Number(ch.unit_cost), 'COGS down by the cost of the pack');
    assert.equal(Number(r2nd.refund.amount), r2((Number(ch.net_amount) + Number(ch.tax_amount)) / 2));
    // GST pack = P&L, CGST + SGST = tax
    const g = await rpc(owner, 'gst_pack', { p_from: today, p_to: today });
    assert.equal(r2(g.byRate.reduce((s, r) => s + Number(r.taxable), 0)), Number(p2.netSales));
    for (const r of g.byRate) assert.equal(r2(Number(r.cgst) + Number(r.sgst)), Number(r.tax));
});

test('refund on a later day: the sale day stays, the refund day goes down, credit note, UPI out of the shift doing it', async () => {
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 2 }], { payFullBy: 'upi' });
    await moveToYesterday(o.id);
    const y0 = await rpc(owner, 'day_summary', { p_date: yesterday });
    const t0 = await rpc(owner, 'day_summary', {});
    const k0 = await shiftOf('cash_kiosk');
    const [co] = await lines(o.id);
    const res = await rpc(kiosk, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_method: 'upi',
        p_reason: 'Spilled', p_drawer: 'cash_kiosk', ...approve });
    assert.equal(Number(res.refund.amount), 105);
    const y1 = await rpc(owner, 'day_summary', { p_date: yesterday });
    assert.equal(Number(y1.sales.gross), Number(y0.sales.gross), 'yesterday does not change');
    const t1 = await rpc(owner, 'day_summary', {});
    assert.equal(r2(t1.sales.gross - t0.sales.gross), -105);
    assert.ok(t1.refundList.some(r => r.earlierDay && Number(r.amount) === 105));
    assert.equal(r2((await shiftOf('cash_kiosk')).upiExpected - k0.upiExpected), -105, 'UPI refund in the kiosk shift');
    const g = await rpc(owner, 'gst_pack', { p_from: today, p_to: today });
    const cn = g.creditNotes.find(c => c.kind === 'refund' && c.orderNumber === o.orderNumber);
    assert.deepEqual([Number(cn.taxable), Number(cn.tax), Number(cn.total), cn.orderDate, cn.items], [100, 5, 105, yesterday, '1 × Coffee']);
    const both = await pnl(yesterday, today);
    const y = await pnl(yesterday);
    assert.ok(Number(y.netSales) >= 200, 'yesterday keeps the sale');
    // full cancel later: only the coffee left goes back
    const t2 = await rpc(owner, 'day_summary', {});
    const c = await rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'Customer wants all back' });
    assert.equal(c.status, 'cancelled');
    const net = await must(service.from('ledger_entries').select('amount').eq('order_id', o.id));
    assert.equal(r2(net.reduce((s, e) => s + Number(e.amount), 0)), 0, 'money in = money out');
    const t3 = await rpc(owner, 'day_summary', {});
    assert.equal(r2(t3.sales.gross - t2.sales.gross), -105, 'the cancel only returns what was left');
    const both2 = await pnl(yesterday, today);
    assert.equal(r2(both2.netSales - both.netSales), -100);
});

test('refunds are only for paid bills, never more than sold, not on cancelled bills', async () => {
    const open = await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: coffee.id, quantity: 1 }] } });
    const [l] = await lines(open.id);
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: open.id, p_lines: [{ orderItemId: l.id, quantity: 1 }], p_reason: 'x' }),
        /not paid yet/);
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 1 }]);
    const [m] = await lines(o.id);
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: m.id, quantity: 2 }], p_reason: 'x' }), /only 1 left/);
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: l.id, quantity: 1 }], p_reason: 'x' }), /not on this bill/);
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: m.id, quantity: 1 }], p_reason: '' }), /reason/);
    await rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'Wrong' });
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: m.id, quantity: 1 }], p_reason: 'x' }), /cancelled/);
});

test('refunding everything bit by bit adds up to the bill exactly (round-off and service charge too)', async () => {
    await must(owner.from('settings').upsert({ key: 'round_off', value: true }));
    await must(owner.from('settings').upsert({ key: 'service_charge_pct', value: 5 }));
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: coffee.id, quantity: 3 }, { menuItem: chips.id, quantity: 1 }],
        payFullBy: 'cash' } });
    await must(owner.from('settings').upsert({ key: 'round_off', value: false }));
    await must(owner.from('settings').upsert({ key: 'service_charge_pct', value: 0 }));
    const full = await rpc(owner, 'get_order', { p_id: o.id });
    assert.ok(Number(full.serviceCharge) > 0);
    const [ch, co] = await lines(o.id);
    let back = 0;
    for (const [id, q] of [[co.id, 1], [co.id, 1], [ch.id, 1], [co.id, 1]]) {
        back += Number((await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: id, quantity: q }], p_reason: 'Closing early' })).refund.amount);
    }
    assert.equal(r2(back), Number(full.total), 'every rupee of the bill, no more');
    const day = await rpc(owner, 'day_summary', {});
    assert.ok(day.refundList.filter(r => r.orderNumber === o.orderNumber).length === 4);
    const ev = await rpc(owner, 'gst_pack', { p_from: today, p_to: today });
    assert.equal(ev.creditNotes.filter(c => c.orderNumber === o.orderNumber && c.kind === 'refund').length, 4, 'each refund is a credit note');
    assert.equal(r2(ev.creditNotes.filter(c => c.orderNumber === o.orderNumber).reduce((t, c) => t + Number(c.total), 0)), Number(full.total));
});

test('points: taken back in proportion, balance stops at 0; a cancel after a refund takes only the rest', async () => {
    const asha = await customer('Asha', 40);
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 4 }], { customerId: asha });
    assert.equal(await pointsOf(asha), 40, 'points base ₹400 before GST x 0.1');
    const [co] = await lines(o.id);
    const r = await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_reason: 'One cold' });
    assert.equal(r.refund.pointsReversed, 10);
    assert.equal(await pointsOf(asha), 30);
    await must(service.from('customers').update({ loyalty_points: 5 }).eq('id', asha)); // spent most of them
    const r2nd = await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_reason: 'Another' });
    assert.deepEqual([r2nd.refund.pointsReversed, r2nd.refund.pointsShortfall], [10, 5]);
    assert.equal(await pointsOf(asha), 0);
    await must(service.from('customers').update({ loyalty_points: 50 }).eq('id', asha));
    await rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'All back' });
    const row = await must(service.from('orders').select('points_reversed, points_shortfall').eq('id', o.id).single());
    assert.equal(row.points_reversed, 40, 'all 40 taken back in the end, never twice');
    assert.equal(await pointsOf(asha), 30, '50 less the 20 still credited');
});

test('khata: a refund can reduce the khata of that bill, never more than is still owed on it', async () => {
    const raju = await customer('Raju', 41, 0, 1000);
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 4 }], { customerId: raju, payFullBy: 'khata' });
    const [co] = await lines(o.id);
    const bal0 = (await rpc(owner, 'khata_accounts')).find(a => a.customerId === raju).balance;
    assert.equal(Number(bal0), 420);
    await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_method: 'khata', p_reason: 'Short' });
    assert.equal(Number((await rpc(owner, 'khata_accounts')).find(a => a.customerId === raju).balance), 315);
    await rpc(cashier, 'settle_khata', { p_customer: raju, p_amount: 300, p_method: 'cash', p_drawer: 'cash_counter' });
    await assert.rejects(rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_method: 'khata', p_reason: 'x' }),
        /still on the khata/);
    const ok = await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_method: 'cash', p_reason: 'x' });
    assert.equal(Number(ok.refund.amount), 105);
});

test('a combo is refunded as a whole line; restocking puts back both picks', async () => {
    const o = await sell(cashier, [{ combo: combo.id, quantity: 2, picks: [{ menuItem: coffee.id }, { menuItem: chips.id }] }]);
    const [cl] = await lines(o.id);
    const milk0 = await stockOf(milk); const chips0 = await stockOf(chipsStock);
    const r = await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: cl.id, quantity: 1, restock: true }], p_reason: 'Wrong order' });
    assert.equal(Number(r.refund.amount), r2((Number(cl.net_amount) + Number(cl.tax_amount)) / 2));
    assert.equal(await stockOf(milk), milk0 + 200);
    assert.equal(await stockOf(chipsStock), chips0 + 1);
});

test('same-day cancel after a refund: the bill is left out, the food thrown away still costs', async () => {
    const before = await pnl(today);
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 2 }]);
    const [co] = await lines(o.id);
    await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1, restock: false }], p_reason: 'Spilled' });
    const milk0 = await stockOf(milk);
    await rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'Left' });
    assert.equal(await stockOf(milk), milk0 + 200, 'only the coffee not thrown away goes back');
    const after = await pnl(today);
    assert.equal(r2(after.netSales), r2(before.netSales), 'no sale, no refund');
    assert.equal(r2(after.cogs - before.cogs), Number(co.unit_cost), 'the spilled coffee is a cost');
});

test('the customer sees what was refunded', async () => {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: 'Meera', p_phone: ph(50) });
    const meId = (await rpc(c, 'me')).id;
    const o = await sell(cashier, [{ menuItem: coffee.id, quantity: 2 }], { customerId: meId });
    const [co] = await lines(o.id);
    await rpc(owner, 'refund_items', { p_order_id: o.id, p_lines: [{ orderItemId: co.id, quantity: 1 }], p_reason: 'Cold' });
    const seen = await rpc(c, 'get_order', { p_id: o.id });
    assert.equal(Number(seen.refunded), 105);
    assert.equal(seen.refunds[0].lines[0].name, 'Coffee');
});

test('counter: a loyalty deal for the attached customer, points taken, one reward only', async () => {
    const offer = await must(owner.from('loyalty_offers').insert({ name: '₹50 off', points_required: 300, discount_value: 50, min_order_value: 200 }).select().single());
    const kavya = await customer('Kavya', 42, 400);
    const rw = await rpc(cashier, 'counter_rewards', { p_customer: kavya });
    assert.equal(rw.points, 400);
    assert.ok(rw.offers.find(x => x.id === offer.id).eligible);
    assert.equal(rw.pointsCash.on, false);
    const items = [{ menuItem: coffee.id, quantity: 3 }];
    const q = await rpc(cashier, 'quote_staff_order', { p: { items, customerId: kavya, loyaltyOfferId: offer.id } });
    assert.equal(Number(q.offerDiscount), 50);
    await assert.rejects(rpc(cashier, 'quote_staff_order', { p: { items, loyaltyOfferId: offer.id } }), /Add the customer/);
    await assert.rejects(rpc(cashier, 'quote_staff_order', { p: { items, customerId: kavya, loyaltyOfferId: offer.id, pointsCash: true } }), /Pick one reward/);
    await assert.rejects(rpc(cashier, 'quote_staff_order', { p: { items: [{ menuItem: coffee.id, quantity: 1 }], customerId: kavya, loyaltyOfferId: offer.id } }), /Minimum order/);
    const o = await sell(cashier, items, { customerId: kavya, loyaltyOfferId: offer.id });
    assert.equal(Number(o.total), Number(q.total));
    assert.equal(Number(o.total), 262.5, '(300 - 50) + 5% GST');
    assert.equal(o.pointsRedeemed, 300);
    assert.equal(await pointsOf(kavya), 400 - 300 + 25, 'deal paid with 300 points, 25 earned on ₹250');
    await assert.rejects(sell(cashier, items, { customerId: kavya, loyaltyOfferId: offer.id }), /Not enough loyalty points/);
    // deals switched off
    await must(service.from('loyalty_settings').update({ deals_on: false }).eq('tenant_id', tenantId));
    await assert.rejects(rpc(cashier, 'quote_staff_order', { p: { items, customerId: kavya, loyaltyOfferId: offer.id } }), /switched off/);
    assert.deepEqual((await rpc(cashier, 'counter_rewards', { p_customer: kavya })).offers, []);
    await must(service.from('loyalty_settings').update({ deals_on: true }).eq('tenant_id', tenantId));
    // a cancel gives the redeemed points back
    await rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'Wrong customer' });
    assert.equal(await pointsOf(kavya), 400);
});

test('counter: points as cash only when the owner switched it on, within the bill limit', async () => {
    const sonu = await customer('Sonu', 43, 1000);
    const items = [{ menuItem: coffee.id, quantity: 2 }];
    await assert.rejects(sell(cashier, items, { customerId: sonu, pointsCash: true }), /switched off/);
    await must(service.from('loyalty_settings').update({ points_as_cash: true }).eq('tenant_id', tenantId));
    const rw = await rpc(cashier, 'counter_rewards', { p_customer: sonu });
    assert.equal(rw.pointsCash.canUse, true);
    assert.equal(rw.pointsCash.worth, 100);
    const o = await sell(cashier, items, { customerId: sonu, pointsCash: true });
    // 20% of ₹200 = ₹40 off, 400 points; (200 - 40) + 5% = 168
    assert.equal(Number(o.total), 168);
    assert.equal(o.pointsRedeemed, 400);
    assert.equal(await pointsOf(sonu), 1000 - 400 + 16);
    const poor = await customer('Poor', 44, 50);
    await assert.rejects(sell(cashier, items, { customerId: poor, pointsCash: true }), /at least 100 points/);
    await must(service.from('loyalty_settings').update({ points_as_cash: false }).eq('tenant_id', tenantId));
});

test('sales trends = Finance: revenue series, categories, top items and item economics tie to P&L', async () => {
    // an open bill and a later-day cancel are in the book the same way as Finance
    await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: chips.id, quantity: 2 }] } });
    const from = yesterday, to = today;
    const p = await pnl(from, to);
    const series = await rpc(owner, 'revenue_series', { p_from: from, p_to: to });
    assert.equal(r2(series.reduce((s, d) => s + Number(d.revenue), 0)), Number(p.netSales), 'sum of the trend = P&L net sales');
    assert.equal(r2(series.reduce((s, d) => s + Number(d.gross), 0)), Number(p.grossSales), 'with GST = P&L gross sales');
    const dToday = await rpc(owner, 'day_summary', {});
    const sToday = series.find(d => d._id === today);
    assert.equal(Number(sToday.gross), Number(dToday.sales.gross), 'today on the trend = Finance today');
    assert.equal(sToday.orders, dToday.sales.orders);
    const cats = await rpc(owner, 'category_sales', { p_from: from, p_to: to });
    const day = await rpc(owner, 'gst_pack', { p_from: from, p_to: to });
    const lineNet = r2(day.byRate.reduce((s, r) => s + Number(r.taxable), 0));
    const sc = r2(Number(p.netSales) - r2(cats.reduce((s, c) => s + Number(c.total), 0)));
    const scTaxable = r2(lineNet - r2(cats.reduce((s, c) => s + Number(c.total), 0)));
    assert.equal(sc, scTaxable, 'categories = line net amounts; the rest is service charge');
    assert.ok(cats.some(c => c._id === 'Combos'));
    const eco = await rpc(owner, 'item_economics', { p_from: from, p_to: to });
    assert.equal(r2(eco.reduce((s, i) => s + Number(i.revenue), 0)), r2(cats.reduce((s, c) => s + Number(c.total), 0)));
    assert.equal(r2(eco.reduce((s, i) => s + Number(i.cost), 0)), Number(p.cogs), 'item costs = P&L COGS');
    const top = await rpc(owner, 'top_items', { p_from: from, p_to: to });
    assert.ok(top.length > 0 && top[0].totalQuantity >= top[top.length - 1].totalQuantity);
    // period names still work
    const week = await rpc(owner, 'revenue_series', { p_period: 'week' });
    const pw = await pnl(addDays(today, -6), today);
    assert.equal(r2(week.reduce((s, d) => s + Number(d.revenue), 0)), Number(pw.netSales));
    const dash = await rpc(owner, 'dashboard_stats');
    assert.equal(Number(dash.today.revenue), Number(dToday.sales.gross));
});
