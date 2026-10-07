// Money fixes from the 3-day money dry run: returns on the day they happen, UPI/card refunds and khata in the right
// shift, dashboard = finance, shift alerts by money type, one GST rounding, uncategorised pay-outs, cafe-time dates,
// khata points on payment, points taken back on cancel.
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
const ph = (n) => `6${run}${String(n).padStart(3, '0')}`;
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

const saEmail = `mf-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `mf-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Money Fixes ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
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
await must(service.from('loyalty_settings').update({ points_per_rupee: 0.1, min_order_for_points: 0 }).eq('tenant_id', tenantId));

const cat = await must(owner.from('categories').insert({ name: 'Cafe' }).select().single());
const coffee = await must(owner.from('menu_items').insert({ name: 'Coffee', price: 100, category_id: cat.id }).select().single());
const water = await must(owner.from('menu_items').insert({ name: 'Water', price: 20, price_includes_tax: true, category_id: cat.id }).select().single());
const g18 = await must(owner.from('tax_groups').insert({ name: '18%', components: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] }).select().single());
const chips = await must(owner.from('menu_items').insert({ name: 'Chips', price: 35, price_includes_tax: true, tax_group_id: g18.id, category_id: cat.id }).select().single());
const today = (await rpc(owner, 'day_summary', {})).date;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const yesterday = addDays(today, -1);
const customerId = async (name, n, limit = 0) => {
    const c = await must(service.from('customers').insert({ tenant_id: tenantId, name, phone: ph(n), credit_limit: limit }).select().single());
    return c.id;
};
const pointsOf = async (id) => (await must(service.from('customers').select('loyalty_points').eq('id', id).single())).loyalty_points;
const orderRow = async (id) => must(service.from('orders').select('*').eq('id', id).single());

await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 2 } });
await rpc(kiosk, 'open_shift', { p_drawer: 'cash_kiosk', p_denoms: { 100: 5 } });
const shiftOf = async (drawer) => (await rpc(owner, 'current_shifts')).open.find(s => s.drawer === drawer);

test('B6/B7: one GST rounding: bill tax = sum of line tax, total = net + tax, CGST + SGST = tax', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway',
        items: [{ menuItem: water.id, quantity: 3 }, { menuItem: chips.id, quantity: 1 }, { menuItem: coffee.id, quantity: 1 }], payFullBy: 'cash' } });
    const lines = await must(service.from('order_items').select('net_amount, tax_amount, total, discount, price_includes_tax').eq('order_id', o.id));
    const lineTax = r2(lines.reduce((s, l) => s + Number(l.tax_amount), 0));
    const lineNet = r2(lines.reduce((s, l) => s + Number(l.net_amount), 0));
    assert.equal(Number(o.tax), lineTax, 'bill tax = sum of line tax');
    assert.equal(r2(lineNet + lineTax), Number(o.total), 'net + tax = total');
    for (const l of lines.filter(x => x.price_includes_tax)) assert.equal(r2(Number(l.net_amount) + Number(l.tax_amount)), Number(l.total));
    const details = r2(o.taxDetails.reduce((s, t) => s + Number(t.amount), 0));
    assert.equal(details, Number(o.tax), 'CGST/SGST on the bill add up to the tax');
    // water 60 incl 5%: 2.857 -> 2.86 split 1.43 + 1.43; chips 35 incl 18%: 5.339 -> 5.34 split 2.67 + 2.67; coffee 5.00
    assert.equal(Number(o.tax), 13.2);
    const g = await rpc(owner, 'gst_pack', { p_from: today, p_to: today });
    for (const r of g.byRate) assert.equal(r2(Number(r.cgst) + Number(r.sgst)), Number(r.tax), `rate ${r.rate}`);
    const day = await rpc(owner, 'day_summary', {});
    assert.equal(r2(g.byRate.reduce((s, r) => s + Number(r.tax), 0)), Number(day.sales.tax), 'GST pack = Finance GST');
    const p = (await rpc(owner, 'pnl', { p_from: today, p_to: today })).current;
    assert.equal(r2(g.byRate.reduce((s, r) => s + Number(r.taxable), 0)), Number(p.netSales), 'GST pack taxable = P&L net sales');
});

test('B7: an odd-paise tax still splits exactly (odd paisa on CGST)', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: water.id, quantity: 1 }], payFullBy: 'cash' } });
    assert.equal(Number(o.tax), 0.95);
    const c = o.taxDetails.find(t => t.name === 'CGST'); const s = o.taxDetails.find(t => t.name === 'SGST');
    assert.deepEqual([Number(c.amount), Number(s.amount)], [0.48, 0.47]);
});

test('B1: a bill from an earlier day cancelled today stays on its day and shows as a return today', async () => {
    const before = await rpc(owner, 'day_summary', {});
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: coffee.id, quantity: 2 }] } });
    await must(service.from('orders').update({ created_at: new Date(Date.now() - 864e5).toISOString() }).eq('id', o.id));
    const y0 = await rpc(owner, 'day_summary', { p_date: yesterday });
    assert.equal(Number(y0.sales.gross), 210);
    await rpc(cashier, 'cancel_order', { p_order_id: o.id, p_reason: 'Returned', ...approve });
    const y1 = await rpc(owner, 'day_summary', { p_date: yesterday });
    assert.deepEqual([Number(y1.sales.gross), y1.sales.orders, y1.sales.cancelled], [210, 1, 0], 'the earlier day does not change');
    const t = await rpc(owner, 'day_summary', {});
    assert.equal(r2(Number(t.sales.gross) - Number(before.sales.gross)), -210, 'today shows the return');
    assert.equal(r2(Number(t.sales.tax) - Number(before.sales.tax)), -10);
    assert.equal(t.sales.returns, 1);
    assert.equal(Number(t.sales.returnsValue), 210);
    assert.ok(t.voids.some(v => v.earlierDay && Number(v.total) === 210));
    const g = await rpc(owner, 'gst_pack', { p_from: today, p_to: today });
    assert.ok(g.creditNotes.some(c => Number(c.total) === 210 && c.orderDate === yesterday));
    const gy = await rpc(owner, 'gst_pack', { p_from: yesterday, p_to: yesterday });
    assert.equal(Number(gy.byRate.find(r => Number(r.rate) === 5).taxable), 200);
    const py = (await rpc(owner, 'pnl', { p_from: yesterday, p_to: yesterday })).current;
    assert.equal(Number(py.netSales), 200);
    const both = (await rpc(owner, 'pnl', { p_from: yesterday, p_to: today })).current;
    const todayOnly = (await rpc(owner, 'pnl', { p_from: today, p_to: today })).current;
    assert.equal(r2(Number(both.netSales) - Number(todayOnly.netSales)), 200, 'over both days the sale and the return cancel out');
    assert.equal(todayOnly.returns.count, 1);
    // a same-day cancel is just left out, as before
    const s = await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: coffee.id, quantity: 1 }] } });
    const mid = await rpc(owner, 'day_summary', {});
    await rpc(cashier, 'cancel_order', { p_order_id: s.id, p_reason: 'Wrong table', ...approve });
    const after = await rpc(owner, 'day_summary', {});
    assert.equal(r2(Number(mid.sales.gross) - Number(after.sales.gross)), 105);
    assert.equal(after.sales.returns, 1, 'not a return');
});

test('B4: dashboard today = Finance today, unpaid bills included', async () => {
    await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: coffee.id, quantity: 1 }] } }); // open bill
    const d = await rpc(owner, 'day_summary', {});
    const dash = await rpc(owner, 'dashboard_stats');
    assert.equal(Number(dash.today.revenue), Number(d.sales.gross));
    assert.equal(dash.today.orders, d.sales.orders);
    assert.ok(Number(dash.today.collected) > 0, 'money collected is a separate number');
});

test('B2: a UPI refund comes off the UPI expected of the shift doing the refund', async () => {
    const s0 = await shiftOf('cash_counter');
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: coffee.id, quantity: 1 }], payFullBy: 'upi' } });
    assert.equal(r2((await shiftOf('cash_counter')).upiExpected - s0.upiExpected), 105);
    await rpc(cashier, 'cancel_order', { p_order_id: o.id, p_reason: 'Refused', ...approve });
    assert.equal((await shiftOf('cash_counter')).upiExpected, s0.upiExpected);
    // card at the kiosk, refunded at the kiosk device
    const k0 = await shiftOf('cash_kiosk');
    const k = await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', items: [{ menuItem: water.id, quantity: 1 }], payFullBy: 'card', drawer: 'cash_kiosk' } });
    await rpc(kiosk, 'cancel_order', { p_order_id: k.id, p_reason: 'Rang twice', p_drawer: 'cash_kiosk', ...approve });
    assert.equal((await shiftOf('cash_kiosk')).cardExpected, k0.cardExpected);
});

test('B3 + points: khata earns points only as it is paid; UPI khata counts in the kiosk shift', async () => {
    const raju = await customerId('Raju', 40, 1000);
    const o = await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: raju, items: [{ menuItem: coffee.id, quantity: 4 }], payFullBy: 'khata', drawer: 'cash_kiosk' } });
    const row = await orderRow(o.id);
    assert.equal(row.points_awarded, 40, 'earned on the bill');
    assert.equal(row.points_held, 40, 'held until paid');
    assert.equal(await pointsOf(raju), 0);
    const k0 = await shiftOf('cash_kiosk');
    await rpc(kiosk, 'settle_khata', { p_customer: raju, p_amount: 210, p_method: 'upi', p_drawer: 'cash_kiosk' });
    assert.equal(r2((await shiftOf('cash_kiosk')).upiExpected - k0.upiExpected), 210, 'UPI khata in the kiosk shift');
    assert.equal(await pointsOf(raju), 20, 'half paid, half the points');
    await rpc(kiosk, 'settle_khata', { p_customer: raju, p_amount: 210, p_method: 'cash', p_drawer: 'cash_kiosk' });
    assert.equal(await pointsOf(raju), 40);
    assert.equal((await orderRow(o.id)).points_held, 0);
    // split bill: 105 cash + 105 khata -> half the points now
    const s = await rpc(kiosk, 'create_staff_order', { p: { channel: 'kiosk', customerId: raju, items: [{ menuItem: coffee.id, quantity: 2 }], drawer: 'cash_kiosk',
        payments: [{ method: 'cash', amount: 105 }, { method: 'khata', amount: 105 }] } });
    assert.equal((await orderRow(s.id)).points_held, 10);
    assert.equal(await pointsOf(raju), 50);
});

test('points: a cancelled paid order gives back the points it earned; spent points stop the balance at 0', async () => {
    const asha = await customerId('Asha', 41);
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', customerId: asha, items: [{ menuItem: coffee.id, quantity: 3 }], payFullBy: 'cash' } });
    assert.equal(await pointsOf(asha), 30);
    await rpc(cashier, 'cancel_order', { p_order_id: o.id, p_reason: 'Refund', ...approve });
    assert.equal(await pointsOf(asha), 0);
    assert.equal((await orderRow(o.id)).points_reversed, 30);
    const o2 = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', customerId: asha, items: [{ menuItem: coffee.id, quantity: 3 }], payFullBy: 'cash' } });
    await must(service.from('customers').update({ loyalty_points: 12 }).eq('id', asha)); // spent 18 of the 30
    await rpc(cashier, 'cancel_order', { p_order_id: o2.id, p_reason: 'Refund', ...approve });
    assert.equal(await pointsOf(asha), 0);
    const r = await orderRow(o2.id);
    assert.deepEqual([r.points_reversed, r.points_shortfall], [30, 18]);
});

test('B8: cash paid out without a category is an expense in P&L and Finance', async () => {
    await rpc(kiosk, 'cash_movement', { p_drawer: 'cash_kiosk', p_kind: 'payout', p_amount: 50, p_note: 'Tea for staff' });
    const p = (await rpc(owner, 'pnl', { p_from: today, p_to: today })).current;
    assert.equal(Number(p.expenses.find(e => e.category === 'Other / uncategorised').amount), 50);
    const d = await rpc(owner, 'day_summary', {});
    assert.equal(Number(d.expenses.find(e => e.category === 'Other / uncategorised').amount), 50);
});

test('B9: vendor bill dates and advances use the cafe date', async () => {
    const v = await must(owner.from('vendors').insert({ name: 'Dairy', payment_terms_days: 7 }).select().single());
    const milk = await rpc(owner, 'save_stock_item', { p: { name: 'Milk', unit: 'ml' } });
    const pur = await rpc(owner, 'record_purchase', { p: { vendorId: v.id, paidAmount: 0, lines: [{ itemId: milk, quantity: 1000, rate: 0.05 }] } });
    const row = await must(service.from('purchases').select('bill_date, due_date').eq('id', pur.id).single());
    assert.equal(row.bill_date, today);
    assert.equal(row.due_date, addDays(today, 7));
    const emp = await must(owner.from('employees').insert({ name: 'Ravi', phone: ph(70), role: 'waiter', salary: 10000 }).select().single());
    assert.equal(emp.joining_date, today);
    await rpc(owner, 'give_advance', { p_employee: emp.id, p_amount: 100, p_instalment: 100, p_account_code: 'cash_office' });
    const adv = await must(service.from('advances').select('given_on').eq('employee_id', emp.id).single());
    assert.equal(adv.given_on, today);
});

test('B5: the close alert names the money that is off and respects the tolerance', async () => {
    const s = await shiftOf('cash_counter');
    const counted = Math.round(s.expectedCash) - 40; // cash short by about 40: inside the 50 tolerance
    let left = counted; const denoms = {};
    for (const d of [500, 100, 10, 1]) { const n = Math.floor(left / d); if (n) { denoms[d] = n; left -= n * d; } }
    // Shift balance: open bills of the shift are settled first, and a difference above the tolerance needs a reason and a manager
    for (const b of s.openBills) await rpc(cashier, 'cancel_order', { p_order_id: b.id, p_reason: 'Test bill', ...approve });
    await rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: denoms, p_upi_reported: s.upiExpected - 300, p_card_reported: s.cardExpected,
                                        p_reason: 'UPI app not refreshed', ...approve });
    const n = (await rpc(owner, 'my_notifications', { p_limit: 50 })).filter(x => x.kind === 'shift_mismatch');
    assert.equal(n.length, 1);
    assert.match(n[0].title, /UPI short by ₹300/);
    assert.doesNotMatch(n[0].title, /cash/);
    const k = await shiftOf('cash_kiosk');
    await rpc(kiosk, 'close_shift', { p_shift_id: k.id, p_denoms: { 1: Math.round(k.expectedCash) - 30 }, p_upi_reported: k.upiExpected, p_card_reported: k.cardExpected });
    assert.equal((await rpc(owner, 'my_notifications', { p_limit: 50 })).filter(x => x.kind === 'shift_mismatch').length, 1, 'within tolerance: no alert');
});
