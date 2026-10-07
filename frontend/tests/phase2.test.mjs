// Phase 2 checks: counter orders (offline-safe), manual discounts with manager PIN, pack units,
// split payments and change, shifts with expected vs counted cash, refunds on cancel, kitchen
// screen, service charge + round-off, payment requests, expenses, recurring bills, payables.
// Run against a local stack: supabase db reset && npm run test:db
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

const saEmail = `sa2-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `pos-a-${run}`, slugB = `pos-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `POS A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `POS B ${run}`, p_slug: slugB, p_plan_id: plans.find(p => p.name === 'Starter').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const owner = await staffLogin(slugA, ph(1), '1111');
const ownerB = await staffLogin(slugB, ph(2), '2222');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
const cashier = await staffLogin(slugA, ph(10), '1010');
const manager = await staffLogin(slugA, ph(11), '1212');

const cat = await must(owner.from('categories').insert({ name: 'Coffee' }).select().single());
const coffee = await must(owner.from('menu_items').insert({ name: 'Cappuccino', price: 100, category_id: cat.id }).select().single());
const chips = await must(owner.from('menu_items').insert({ name: 'Chips', price: 20, price_includes_tax: true, mrp: 20, category_id: cat.id }).select().single());
const box = await must(owner.from('item_units').insert({ menu_item_id: chips.id, name: 'Box', factor: 6, sale_price: 110 }).select().single());
const table = await must(owner.from('dining_tables').insert({ table_number: '7' }).select().single());
const denoms = (n500, n100) => ({ 500: n500, 100: n100 });

test('cashier opens a shift with a denomination count', async () => {
    const s = await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: denoms(2, 5) });
    assert.equal(s.openingCash, 1500);
    await assert.rejects(rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: {} }), /already has an open shift/);
});

test('counter takeaway with cash: 5% GST, change returned, cash lands in the drawer', async () => {
    const r = await rpc(cashier, 'create_staff_order', { p: {
        clientId: `c-${run}-1`, orderNumber: `C1-261003-${run.slice(-3)}1`, deviceCode: 'C1', channel: 'takeaway',
        items: [{ menuItem: coffee.id, quantity: 2 }], payments: [{ method: 'cash', amount: 500 }] } });
    assert.equal(r.total, 210);
    assert.equal(r.status, 'paid');
    assert.equal(r.change, 290);
    assert.equal(r.staffName, 'Cashier Ravi');
    assert.deepEqual(r.payments, [{ method: 'cash', amount: 210 }]);
    // The same offline sale synced twice is stored once
    const again = await rpc(cashier, 'create_staff_order', { p: {
        clientId: `c-${run}-1`, channel: 'takeaway', items: [{ menuItem: coffee.id, quantity: 2 }], payments: [{ method: 'cash', amount: 210 }] } });
    assert.equal(again.id, r.id);
    assert.equal(again.duplicate, true);
    const shift = (await rpc(cashier, 'current_shifts')).open[0];
    assert.equal(shift.expectedCash, 1710);
});

test('pack sale: a box of 6 at the box price; split payment UPI + cash', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: {
        clientId: `c-${run}-2`, channel: 'dine_in', tableId: table.id, customerPhone: ph(50), customerName: 'Asha',
        items: [{ menuItem: chips.id, quantity: 1, unitId: box.id }, { menuItem: coffee.id, quantity: 1 }] } });
    assert.equal(o.items.find(i => i.unitName === 'Box').name, 'Chips (Box)');
    assert.equal(o.total, 215);
    const paid = await rpc(cashier, 'settle_order', { p_order_id: o.id, p_payments: [{ method: 'upi', amount: 115 }, { method: 'cash', amount: 100 }] });
    assert.equal(paid.status, 'paid');
    assert.equal(paid.paymentMethod, 'split');
    const shift = (await rpc(cashier, 'current_shifts')).open[0];
    assert.equal(shift.upiExpected, 115);
    assert.equal(shift.expectedCash, 1810);
});

test('discount above the cashier limit needs a manager PIN and a reason', async () => {
    const items = [{ menuItem: coffee.id, quantity: 2 }];
    await assert.rejects(rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items, manualDiscount: 10 } }), /reason/);
    const ok = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items, manualDiscount: 20, discountReason: 'Regular' } });
    assert.equal(ok.manualDiscount, 20);
    await assert.rejects(rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items, manualDiscount: 50, discountReason: 'Friend' } }), /above your limit/);
    await assert.rejects(rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items, manualDiscount: 50, discountReason: 'Friend',
        approverPhone: ph(11), approverPin: '0000' } }), /Manager PIN not accepted/);
    const approved = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items, manualDiscount: 50, discountReason: 'Friend',
        approverPhone: ph(11), approverPin: '1212' } });
    assert.equal(approved.total, 157.5);
    const day = await rpc(owner, 'day_summary', {});
    assert.ok(day.discounts.some(d => d.amount === 50 && d.reason === 'Friend'));
});

test('kitchen screen: chef marks lines ready, the order becomes ready', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', tokenNumber: '12',
        items: [{ menuItem: coffee.id, quantity: 1, note: 'less sugar' }, { menuItem: chips.id, quantity: 1 }] } });
    let k = (await rpc(cashier, 'kitchen_orders')).find(x => x.id === o.id);
    assert.equal(k.tokenNumber, '12');
    assert.ok(k.items.some(i => i.note === 'less sugar'));
    const coffeeLine = k.items.find(i => i.name === 'Cappuccino').id;
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: coffeeLine, p_status: 'ready' });
    assert.equal((await rpc(cashier, 'get_order', { p_id: o.id })).status, 'preparing');
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'ready' });
    assert.equal((await rpc(cashier, 'get_order', { p_id: o.id })).status, 'ready');
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'served' });
    assert.ok(!(await rpc(cashier, 'kitchen_orders')).some(x => x.id === o.id));
});

test('cancelling a paid order refunds the drawer and flags a void after the kitchen started', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: coffee.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: 105 }] } });
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'preparing' });
    await assert.rejects(rpc(cashier, 'cancel_order', { p_order_id: o.id, p_reason: '' }), /reason/);
    await assert.rejects(rpc(cashier, 'cancel_order', { p_order_id: o.id, p_reason: 'Spilled' }), /manager must approve/);
    const c = await rpc(cashier, 'cancel_order', { p_order_id: o.id, p_reason: 'Spilled', p_approver_phone: ph(11), p_approver_pin: '1212' });
    assert.equal(c.status, 'cancelled');
    assert.ok(c.cancelledAfterKitchen);
    assert.match(c.cancelReason, /approved by Manager Mona/);
    const shift = (await rpc(cashier, 'current_shifts')).open[0];
    assert.equal(shift.expectedCash, 1810, 'refund took the ₹105 back out');
    const notes = await rpc(owner, 'my_notifications', {});
    assert.ok(notes.some(n => n.kind === 'void'));
});

test('payout and drop move cash; closing short needs a reason and alerts the owner', async () => {
    const cats = await must(cashier.from('expense_categories').select('id, name'));
    await rpc(cashier, 'cash_movement', { p_drawer: 'cash_counter', p_kind: 'payout', p_amount: 200, p_note: 'Milk',
        p_category_id: cats.find(c => c.name === 'Consumables').id });
    await rpc(cashier, 'cash_movement', { p_drawer: 'cash_counter', p_kind: 'drop', p_amount: 1000, p_note: 'To safe' });
    const s = (await rpc(cashier, 'current_shifts')).open[0];
    assert.equal(s.expectedCash, 610);
    // Shift balance: bills still open in the shift stop the close; the cashier settles them first (here: cancels them)
    await assert.rejects(rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: { 500: 1 }, p_upi_reported: 115 }), /Bills still open in this shift/);
    for (const b of s.openBills) {
        await rpc(cashier, 'cancel_order', { p_order_id: b.id, p_reason: 'Test bill', p_approver_phone: ph(11), p_approver_pin: '1212' });
    }
    await assert.rejects(rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: { 500: 1 }, p_upi_reported: 115 }), /cash short by ₹110\). Write the reason/);
    // Shift balance: a difference above the tolerance also needs another person with the manager PIN
    await assert.rejects(rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: { 500: 1 }, p_upi_reported: 115, p_reason: 'Gave extra change' }),
        /manager or the owner must check/);
    const closed = await rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: { 500: 1 }, p_upi_reported: 115, p_reason: 'Gave extra change',
        p_approver_phone: ph(11), p_approver_pin: '1212' });
    assert.equal(closed.varianceApprovedBy, 'Manager Mona');
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 1 } }); // the next shift, for the tests below
    assert.equal(closed.difference, -110);
    assert.equal(closed.status, 'closed');
    const notes = await rpc(owner, 'my_notifications', {});
    assert.ok(notes.some(n => n.kind === 'shift_mismatch' && /short by ₹110/.test(n.title)));
    assert.ok(!(await rpc(cashier, 'my_notifications', {})).some(n => n.kind === 'shift_mismatch'), 'cashier does not see finance alerts');
    const bal = await rpc(owner, 'account_balances');
    assert.equal(bal.find(b => b.code === 'cash_office').balance, 1000);
    const ex = await rpc(owner, 'list_expenses', {});
    assert.ok(ex.some(e => e.category === 'Consumables' && e.amount === 200));
});

test('QR order: optional service charge with its GST and round-off; customer asks to pay by UPI', async () => {
    await must(owner.from('settings').update({ value: 10 }).eq('key', 'service_charge_pct'));
    await must(owner.from('settings').update({ value: true }).eq('key', 'round_off'));
    const c = await customer(slugA, 'Kavya', ph(60));
    const id = await rpc(c, 'place_order', { p_items: [{ menuItem: coffee.id, quantity: 1 }, { menuItem: chips.id, quantity: 1 }] });
    let o = await rpc(c, 'get_order', { p_id: id });
    // Coffee 100 + 5 GST; chips 20 incl. tax; SC 10% of net (100 + 19.05) = 11.91 + 5% = 0.60; 137.51 → 138
    close(o.serviceCharge, 11.91, 'service charge');
    close(o.serviceChargeTax, 0.6, 'sc tax');
    assert.equal(o.total, 138);
    close(o.roundOff, 0.49, 'round off');
    o = await rpc(cashier, 'remove_service_charge', { p_order_id: id });
    assert.equal(o.total, 125);
    o = await rpc(c, 'request_payment', { p_order_id: id, p_mode: 'qr' });
    assert.equal(o.paymentRequest, 'qr');
    const n = (await rpc(cashier, 'my_notifications', {})).find(x => x.kind === 'payment_request');
    assert.match(n.title, /wants to pay ₹125 by UPI/);
    assert.equal(n.priority, 'alarm');
    await rpc(cashier, 'ack_notification', { p_id: n.id });
    await rpc(cashier, 'record_payment', { p_order_id: id, p_method: 'online', p_amount: 125 });
    assert.equal((await rpc(c, 'get_order', { p_id: id })).status, 'paid');
    await must(owner.from('settings').update({ value: 0 }).eq('key', 'service_charge_pct'));
    await must(owner.from('settings').update({ value: false }).eq('key', 'round_off'));
});

test('expenses, recurring rent and vendor bills feed payables; paying writes the ledger', async () => {
    const cats = await must(owner.from('expense_categories').select('id, name'));
    const rent = cats.find(c => c.name === 'Rent').id;
    await must(owner.from('recurring_expenses').insert({ name: 'Shop rent', category_id: rent, amount: 25000, day_of_month: 1,
        next_due: new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10) }));
    const pay = await rpc(owner, 'payables');
    assert.ok(pay.expenses.filter(e => e.category === 'Rent').length >= 2, 'two months of rent are due');
    await rpc(owner, 'pay_expense', { p_id: pay.expenses[0].id, p_account_code: 'bank' });
    const milk = await rpc(owner, 'save_stock_item', { p: { name: 'Milk', unit: 'ml' } });
    const pur = await rpc(owner, 'record_purchase', { p: { vendorName: 'Dairy', paidAmount: 40, paymentMode: 'upi',
        lines: [{ itemId: milk, quantity: 2000, rate: 0.06 }] } });
    const after = await rpc(owner, 'payables');
    assert.ok(after.bills.some(b => b.id === pur.id && b.due === 80));
    assert.equal(after.aging.d0_7, 80);
    const ledger = await rpc(owner, 'list_ledger', { p: {} });
    assert.ok(ledger.some(l => l.kind === 'purchase_payment' && l.amount === -40 && l.accountCode === 'upi'));
    assert.ok(ledger.some(l => l.kind === 'expense' && l.amount === -25000 && l.accountCode === 'bank'));
    const id = await rpc(owner, 'record_expense', { p: { clientId: `e-${run}`, categoryId: rent, amount: 500, accountCode: 'cash_office', note: 'Deposit' } });
    assert.equal(await rpc(owner, 'record_expense', { p: { clientId: `e-${run}`, categoryId: rent, amount: 500 } }), id, 'offline sync stores once');
    await rpc(owner, 'void_expense', { p_id: id, p_reason: 'Entered twice' });
    assert.ok((await rpc(owner, 'list_ledger', { p: {} })).some(l => l.kind === 'reversal' && l.amount === 500));
});

test('the ledger cannot be edited; cashiers cannot read money reports', async () => {
    await assert.rejects(rpc(cashier, 'list_ledger', { p: {} }), /finance.view/);
    await assert.rejects(rpc(cashier, 'day_summary', {}), /finance.view/);
    assert.equal((await must(cashier.from('ledger_entries').select('id'))).length, 0);
    await rpc(manager, 'list_ledger', { p: {} });
    const row = (await rpc(owner, 'list_ledger', { p: { limit: 1 } }))[0];
    const { error } = await service.from('ledger_entries').update({ amount: 1 }).eq('id', row.id);
    assert.match(error.message, /cannot be changed/);
});

test('devices get codes; kiosks are limited by the plan', async () => {
    assert.equal((await rpc(owner, 'register_device', { p_kind: 'counter', p_name: 'Billing' })).code, 'C1');
    assert.equal((await rpc(owner, 'register_device', { p_kind: 'kiosk' })).code, 'K1');
    await assert.rejects(rpc(ownerB, 'register_device', { p_kind: 'kiosk' }), /plan allows 0 kiosks/);
});

test('cafes are isolated: B cannot settle or see A\'s money', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: coffee.id, quantity: 1 }] } });
    await assert.rejects(rpc(ownerB, 'settle_order', { p_order_id: o.id, p_payments: [{ method: 'cash', amount: 105 }] }), /not found/);
    assert.equal((await rpc(ownerB, 'list_ledger', { p: {} })).length, 0);
    assert.ok(tenantA);
});
