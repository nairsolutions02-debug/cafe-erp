// Shift close must balance and the owner day close: every bill belongs to a shift, a shift closes only when every bill
// is in an end state, the balance sheet adds up, UPI and card totals are counted, a big difference needs another person,
// handed-over bills reach the next shift, the day close adds up both drawers and QR, a closed day is locked, and a paid
// bill cannot be changed.
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

const saEmail = `sb-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `sb-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Shift Balance ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner Pravin', p_owner_phone: ph(1), p_owner_pin: '1111' });
const tenantId = (await must(service.from('tenants').select('id').eq('slug', slug).single())).id;
const owner = await staffLogin(slug, ph(1), '1111');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
await rpc(owner, 'create_staff', { p_name: 'Kiosk Kiran', p_phone: ph(12), p_role_id: role('Kiosk operator'), p_pin: '1313' });
const cashier = await staffLogin(slug, ph(10), '1010');
const manager = await staffLogin(slug, ph(11), '1212');
const kiosk = await staffLogin(slug, ph(12), '1313');
const MGR = { p_approver_phone: ph(11), p_approver_pin: '1212' };
const OWNER = { p_approver_phone: ph(1), p_approver_pin: '1111' };
await must(service.from('reward_rules').update({ is_active: false }).eq('tenant_id', tenantId));

const cat = await must(owner.from('categories').insert({ name: 'Cafe' }).select().single());
const tea = await must(owner.from('menu_items').insert({ name: 'Tea', price: 100, price_includes_tax: true, category_id: cat.id }).select().single());
const mint = await must(owner.from('menu_items').insert({ name: 'Mint', price: 10, price_includes_tax: true, category_id: cat.id }).select().single());
const table = await must(owner.from('dining_tables').insert({ table_number: '7' }).select().single());
const tableCode = (await must(owner.from('table_codes').select('code').eq('table_id', table.id).single())).code;
const today = (await rpc(owner, 'day_summary', {})).date;
const raju = (await must(service.from('customers').insert({ tenant_id: tenantId, name: 'Raju', phone: ph(40), credit_limit: 1000 }).select().single())).id;

const sell = (who, p) => rpc(who, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: tea.id, quantity: 1 }], ...p } });
const shiftOf = async (who, drawer) => (await rpc(who, 'current_shifts')).open.find(s => s.drawer === drawer);
// Count the expected cash in notes (500s, 100s, 10s, 1s) plus or minus a difference
const notes = (amount) => {
    let left = Math.round(amount); const d = {};
    for (const n of [500, 100, 10, 1]) { const k = Math.floor(left / n); if (k) { d[n] = k; left -= k * n; } }
    return d;
};
const B = (s) => s.balance.bills;
const outcome = (b) => r2(b.paidCash + b.paidUpi + b.paidCard + b.khata + b.online + b.otherDrawer + b.cancelled + b.refunded + b.handedOver + b.open);

test('no open shift: no bill and no money at that drawer', async () => {
    await assert.rejects(sell(cashier, { payFullBy: 'cash' }), /Cash – Counter has no open shift/);
    await assert.rejects(rpc(cashier, 'cash_movement', { p_drawer: 'cash_counter', p_kind: 'payout', p_amount: 10, p_note: 'x' }), /Open a shift/);
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 2 } });
    await rpc(kiosk, 'open_shift', { p_drawer: 'cash_kiosk', p_denoms: { 100: 5 } });
    const o = await sell(cashier, { payFullBy: 'cash', drawer: 'cash_counter' });
    const s = await shiftOf(cashier, 'cash_counter');
    assert.equal((await must(service.from('orders').select('shift_id, made_shift_id').eq('id', o.id).single())).made_shift_id, s.id);
});

test('close is refused while bills are open; the close screen lists them', async () => {
    const open1 = await sell(cashier, { channel: 'dine_in' }); // eating, not paid yet
    let s = await shiftOf(cashier, 'cash_counter');
    assert.ok(s.openBills.some(b => b.id === open1.id && b.due === 100));
    await assert.rejects(rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: notes(s.expectedCash) }),
        new RegExp(`Bills still open in this shift: ${open1.orderNumber} \\(₹100\\)`));
    // collect it at the counter: now it is paid by UPI in this shift
    await rpc(cashier, 'settle_order', { p_order_id: open1.id, p_payments: [{ method: 'upi', amount: 100 }], p_drawer: 'cash_counter' });
    s = await shiftOf(cashier, 'cash_counter');
    assert.equal(s.openBills.length, 0);
    assert.equal(B(s).paidUpi, 100);
});

test('hand-over needs a manager PIN and the bill shows on the next shift of the drawer', async () => {
    const o = await sell(cashier, { channel: 'dine_in', items: [{ menuItem: tea.id, quantity: 2 }] });
    await rpc(cashier, 'settle_order', { p_order_id: o.id, p_payments: [{ method: 'cash', amount: 50 }], p_drawer: 'cash_counter' }); // part paid
    await assert.rejects(rpc(cashier, 'handover_bill', { p_order_id: o.id, p_reason: 'Table still eating' }), /manager must approve the hand-over/);
    await assert.rejects(rpc(cashier, 'handover_bill', { p_order_id: o.id, p_reason: '', ...MGR }), /Write why/);
    const h = await rpc(cashier, 'handover_bill', { p_order_id: o.id, p_reason: 'Table still eating', ...MGR });
    assert.equal(h.approvedBy, 'Manager Mona');
    let s = await shiftOf(cashier, 'cash_counter');
    assert.equal(B(s).handedOver, 150);
    assert.ok(s.handedBills.some(b => b.orderNumber === o.orderNumber && b.due === 150));
    // a handed-over bill waits for the next shift: it cannot be cancelled in between
    await assert.rejects(rpc(owner, 'cancel_order', { p_order_id: o.id, p_reason: 'x' }), /handed over to the next shift/);
    // close this shift (UPI 100 was taken: the UPI total is needed)
    await assert.rejects(rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: notes(s.expectedCash) }), /UPI total from the UPI app/);
    const closed = await rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: notes(s.expectedCash), p_upi_reported: s.upiExpected });
    assert.equal(closed.status, 'closed');
    assert.ok(closed.balance.balanced);
    const drawers = (await rpc(manager, 'current_shifts')).drawers;
    assert.ok(drawers.find(d => d.code === 'cash_counter').handedOver.some(b => b.orderNumber === o.orderNumber));
    // the next shift receives it, collects the rest, and its balance sheet shows it as received
    const next = await rpc(manager, 'open_shift', { p_drawer: 'cash_counter', p_denoms: notes(closed.countedCash) });
    assert.ok(next.receivedBills.some(b => b.orderNumber === o.orderNumber && b.due === 150));
    assert.ok(next.openBills.some(b => b.id === o.id));
    await rpc(manager, 'settle_order', { p_order_id: o.id, p_payments: [{ method: 'cash', amount: 150 }], p_drawer: 'cash_counter' });
    s = await shiftOf(manager, 'cash_counter');
    assert.equal(B(s).receivedTotal, 150);
    assert.equal(B(s).paidCash, 150);
    assert.ok(s.balance.balanced);
});

test('UPI and card totals are required when that money was taken', async () => {
    const o = await sell(kiosk, { channel: 'kiosk', items: [{ menuItem: mint.id, quantity: 3 }], payments: [{ method: 'card', amount: 30 }], drawer: 'cash_kiosk' });
    assert.equal(o.status, 'paid');
    const k = await shiftOf(kiosk, 'cash_kiosk');
    assert.ok(k.cardTaken);
    await assert.rejects(rpc(kiosk, 'close_shift', { p_shift_id: k.id, p_denoms: notes(k.expectedCash) }), /card machine total/);
    assert.equal((await shiftOf(kiosk, 'cash_kiosk')).status, 'open');
});

test('a big difference needs a reason and another person with the manager PIN; the owner is alerted', async () => {
    const s = await shiftOf(manager, 'cash_counter');
    const short = notes(s.expectedCash - 300);
    await assert.rejects(rpc(manager, 'close_shift', { p_shift_id: s.id, p_denoms: short }), /cash short by ₹300\)\. Write the reason/);
    await assert.rejects(rpc(manager, 'close_shift', { p_shift_id: s.id, p_denoms: short, p_reason: 'Change mistake' }), /manager or the owner must check/);
    // the manager cannot approve the close of their own shift
    await assert.rejects(rpc(manager, 'close_shift', { p_shift_id: s.id, p_denoms: short, p_reason: 'Change mistake', ...MGR }), /Another person must approve/);
    // the cashier may not approve (no void right)
    await assert.rejects(rpc(manager, 'close_shift', { p_shift_id: s.id, p_denoms: short, p_reason: 'Change mistake',
        p_approver_phone: ph(10), p_approver_pin: '1010' }), /not allowed to approve/);
    const closed = await rpc(manager, 'close_shift', { p_shift_id: s.id, p_denoms: short, p_reason: 'Change mistake', ...OWNER });
    assert.equal(closed.difference, -300);
    assert.equal(closed.varianceApprovedBy, 'Owner Pravin');
    assert.equal(closed.reason, 'Change mistake');
    const n = (await rpc(owner, 'my_notifications', { p_limit: 50 })).find(x => x.kind === 'shift_mismatch' && /cash short by ₹300/.test(x.title));
    assert.ok(n, 'loud alert names the money and the amount');
    assert.match(n.body, /approved by Owner Pravin/);
    // a small difference (inside the ₹50 tolerance) closes without anyone else
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: notes(closed.countedCash) });
    const s2 = await shiftOf(cashier, 'cash_counter');
    const ok = await rpc(cashier, 'close_shift', { p_shift_id: s2.id, p_denoms: notes(s2.expectedCash - 20) });
    assert.equal(ok.difference, -20);
    assert.equal(ok.varianceApprovedBy, '');
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: notes(ok.countedCash) });
});

test('balance equation: bills made = paid cash + UPI + card + khata + cancelled + refunded + handed over', async () => {
    const a = await sell(cashier, { payFullBy: 'cash' });                                           // 100 cash
    await sell(cashier, { payments: [{ method: 'upi', amount: 60 }, { method: 'cash', amount: 40 }] }); // split
    await sell(cashier, { customerId: raju, payFullBy: 'khata' });                                  // khata
    const c = await sell(cashier, { channel: 'dine_in' });                                           // cancelled unpaid
    await rpc(cashier, 'cancel_order', { p_order_id: c.id, p_reason: 'Left', ...MGR });
    const d = await sell(cashier, { items: [{ menuItem: tea.id, quantity: 2 }], payFullBy: 'card' });  // partly refunded
    const items = await must(service.from('order_items').select('id').eq('order_id', d.id));
    await rpc(cashier, 'refund_items', { p_order_id: d.id, p_lines: [{ orderItemId: items[0].id, quantity: 1 }], p_method: 'card',
                                         p_reason: 'Cold', p_drawer: 'cash_counter', ...MGR });
    await rpc(cashier, 'cancel_order', { p_order_id: a.id, p_reason: 'Wrong order', ...MGR }); // paid then cancelled: cash goes back
    const s = await shiftOf(cashier, 'cash_counter');
    const b = B(s);
    assert.equal(b.madeCount, 5);
    assert.equal(b.madeTotal, 600);
    assert.equal(b.paidCash, 40);
    assert.equal(b.paidUpi, 60);
    assert.equal(b.paidCard, 100);
    assert.equal(b.khata, 100);
    assert.equal(b.cancelled, 200);
    assert.equal(b.refunded, 100);
    assert.equal(outcome(b), b.madeTotal + b.receivedTotal);
    assert.ok(s.balance.balanced);
    // expected money follows the payment modes chosen
    assert.equal(s.balance.cash.fromBills, 40);
    assert.equal(s.balance.upi.expected, 60);
    assert.equal(s.balance.card.expected, 100);
    // safety net: a money entry that does not match its bill makes the shift refuse to close and alerts the owner
    const paid = await sell(cashier, { payFullBy: 'upi' });
    await must(service.from('ledger_entries').insert({ tenant_id: tenantId, entry_date: today, account_id:
        (await must(service.from('money_accounts').select('id').eq('tenant_id', tenantId).eq('code', 'upi').single())).id,
        amount: 7, kind: 'sale', method: 'upi', order_id: paid.id, shift_id: s.id }));
    const s2 = await shiftOf(cashier, 'cash_counter');
    assert.equal(s2.balance.balanced, false);
    assert.equal(s2.balance.bills.problems[0].orderNumber, paid.orderNumber);
    const refused = await rpc(cashier, 'close_shift', { p_shift_id: s.id, p_denoms: notes(s2.expectedCash), p_upi_reported: s2.upiExpected, p_card_reported: s2.cardExpected });
    assert.equal(refused.refused, true);
    assert.equal(refused.status, 'open');
    assert.ok((await rpc(owner, 'my_notifications', { p_limit: 50 })).some(x => x.kind === 'shift_mismatch' && /do not add up/.test(x.title)));
    // put it right (a matching entry back), so the rest of the day can close
    await must(service.from('ledger_entries').insert({ tenant_id: tenantId, entry_date: today, account_id:
        (await must(service.from('money_accounts').select('id').eq('tenant_id', tenantId).eq('code', 'upi').single())).id,
        amount: -7, kind: 'sale', method: 'upi', order_id: paid.id, shift_id: s.id }));
    assert.ok((await shiftOf(cashier, 'cash_counter')).balance.balanced);
});

test('a paid bill cannot be changed: only refund or cancel', async () => {
    const o = await sell(cashier, { payFullBy: 'cash' });
    await assert.rejects(must(service.from('orders').update({ total: 50 }).eq('id', o.id)), /cannot be changed/);
    await assert.rejects(must(service.from('orders').update({ status: 'served' }).eq('id', o.id)), /cannot be opened again/);
    await assert.rejects(must(service.from('order_items').insert({ order_id: o.id, name: 'Extra', price: 10, quantity: 1, total: 10 })), /cannot be changed/);
    await assert.rejects(must(service.from('order_items').update({ price: 1 }).eq('order_id', o.id)), /cannot be changed/);
    await assert.rejects(must(service.from('order_items').delete().eq('order_id', o.id)), /cannot be changed/);
    await assert.rejects(rpc(cashier, 'remove_service_charge', { p_order_id: o.id }), /already closed/);
    await assert.rejects(rpc(cashier, 'settle_order', { p_order_id: o.id, p_payments: [{ method: 'cash', amount: 10 }] }), /already paid/);
    // kitchen progress may still move on a paid bill
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'ready' });
    // staff cannot write orders directly either
    const { error } = await cashier.from('orders').update({ total: 1 }).eq('id', o.id).select();
    assert.ok(error || true);
    assert.equal((await must(service.from('orders').select('total').eq('id', o.id).single())).total, 100);
});

test('reprints are logged on the bill', async () => {
    const o = await sell(cashier, { payFullBy: 'cash' });
    assert.equal((await rpc(cashier, 'log_bill_print', { p_order: o.id })).reprint, false);
    const r = await rpc(cashier, 'log_bill_print', { p_order: o.id });
    assert.equal(r.prints, 2);
    assert.equal(r.reprint, true);
    const row = await must(service.from('orders').select('print_count, last_print_by').eq('id', o.id).single());
    assert.equal(row.print_count, 2);
    assert.equal(row.last_print_by, 'Cashier Ravi');
});

test('an offline bill replays into the shift it was made in, or the open shift with a note', async () => {
    const k = await shiftOf(kiosk, 'cash_kiosk');
    const o1 = await sell(kiosk, { channel: 'kiosk', items: [{ menuItem: mint.id, quantity: 1 }], payFullBy: 'cash', drawer: 'cash_kiosk',
                                   shiftId: k.id, clientId: `off-${run}-1` });
    assert.equal((await must(service.from('orders').select('shift_id').eq('id', o1.id).single())).shift_id, k.id);
    // the kiosk shift closes while another device still had a bill queued for it
    const kk = await shiftOf(kiosk, 'cash_kiosk');
    const closed = await rpc(kiosk, 'close_shift', { p_shift_id: kk.id, p_denoms: notes(kk.expectedCash), p_upi_reported: kk.upiExpected, p_card_reported: kk.cardExpected });
    const fresh = await rpc(kiosk, 'open_shift', { p_drawer: 'cash_kiosk', p_denoms: notes(closed.countedCash) });
    const o2 = await sell(kiosk, { channel: 'kiosk', items: [{ menuItem: mint.id, quantity: 2 }], payFullBy: 'cash', drawer: 'cash_kiosk',
                                   shiftId: kk.id, clientId: `off-${run}-2` });
    const row = await must(service.from('orders').select('shift_id, shift_note').eq('id', o2.id).single());
    assert.equal(row.shift_id, fresh.id);
    assert.match(row.shift_note, /Made offline in the shift opened .* which closed before the bill reached the server/);
});

test('day close: both drawers and QR add up; the owner closes the day and it is locked', async () => {
    // a QR order: accepted at the counter (joins the counter shift) and paid at the counter by UPI
    const cust = client(slug);
    await cust.auth.signInAnonymously();
    await rpc(cust, 'customer_sign_in', { p_name: 'Meera', p_phone: ph(60) });
    const q1 = await rpc(cust, 'place_order', { p_items: [{ menuItem: tea.id, quantity: 1 }], p_table_code: tableCode, p_client_id: `q1-${run}` });
    await rpc(cashier, 'confirm_table_order', { p_order_id: q1, p_drawer: 'cash_counter' });
    const counterShift = await shiftOf(cashier, 'cash_counter');
    assert.equal((await must(service.from('orders').select('made_shift_id').eq('id', q1).single())).made_shift_id, counterShift.id);
    await rpc(cashier, 'record_payment', { p_order_id: q1, p_method: 'upi', p_amount: 100 });
    // a QR order paid online (UPI straight to the cafe account): a cashier may not mark it, a manager may
    const q2 = await rpc(cust, 'place_order', { p_items: [{ menuItem: tea.id, quantity: 2 }], p_table_code: tableCode, p_client_id: `q2-${run}` });
    await assert.rejects(rpc(cashier, 'settle_order', { p_order_id: q2, p_payments: [{ method: 'upi', amount: 200 }], p_drawer: 'online' }), /Only a manager or the owner/);
    await rpc(manager, 'settle_order', { p_order_id: q2, p_payments: [{ method: 'upi', amount: 200 }], p_drawer: 'online' });
    // a QR order nobody took: open, so the day is not balanced yet
    const q3 = await rpc(cust, 'place_order', { p_items: [{ menuItem: mint.id, quantity: 1 }], p_table_code: tableCode, p_client_id: `q3-${run}` });
    let r = await rpc(owner, 'day_close_report', { p_from: today, p_to: today });
    assert.equal(r.status.balanced, false);
    assert.ok(r.status.reasons.some(x => /shifts? still open/.test(x)));
    assert.ok(r.status.reasons.some(x => /1 bill still open/.test(x)));
    assert.equal(r.canClose, false);
    await assert.rejects(rpc(owner, 'close_day', { p_day: today }), /Not balanced/);
    await rpc(owner, 'cancel_order', { p_order_id: q3, p_reason: 'Customer left' });

    // close both drawers
    for (const [who, drawer] of [[cashier, 'cash_counter'], [kiosk, 'cash_kiosk']]) {
        const s = await shiftOf(who, drawer);
        assert.equal(s.openBills.length, 0);
        await rpc(who, 'close_shift', { p_shift_id: s.id, p_denoms: notes(s.expectedCash), p_upi_reported: s.upiExpected, p_card_reported: s.cardExpected });
    }
    r = await rpc(owner, 'day_close_report', { p_from: today, p_to: today });
    // the day = the two drawers + QR, mode by mode
    const sum = (k) => r2(r.drawers.reduce((t, d) => t + Number(d.bills[k] || 0), 0));
    assert.equal(r.combined.madeTotal, r2(sum('madeTotal') + r.qr.madeTotal));
    assert.equal(r.combined.madeCount, sum('madeCount') + r.qr.madeCount);
    assert.equal(r.combined.paidCash, r2(sum('paidCash') + sum('otherCash')));
    assert.equal(r.combined.upiOnline, r2(sum('online') + r.qr.online));
    assert.equal(r.qr.online, 200);
    assert.equal(r.qr.cancelled, 10);
    assert.equal(r.modes.upi.online, 200);
    const allOrders = await must(service.from('orders').select('total, created_at').eq('tenant_id', tenantId));
    assert.equal(r.combined.madeTotal, r2(allOrders.reduce((t, o) => t + Number(o.total), 0)), 'every bill of the day is counted once');
    assert.equal(r.combined.difference, 0);
    assert.equal(r.combined.balanced, true);
    assert.equal(r.modes.cash.expected, r2(r.shifts.reduce((t, s) => t + s.expectedCash, 0)));
    assert.equal(r.money.totalVariance, -320);
    assert.ok(r.exceptions.variances.some(v => v.cash === -300 && v.approvedBy === 'Owner Pravin' && v.reason === 'Change mistake' && v.over));
    assert.ok(r.exceptions.handedOver.some(h => h.due === 150 && h.approvedBy === 'Manager Mona' && h.billStatus === 'paid'));
    assert.ok(r.exceptions.reprints.some(x => x.prints === 2));
    assert.ok(r.exceptions.refunds.length >= 2);
    assert.equal(r.status.balanced, true, r.status.reasons.join('; '));
    assert.equal(r.canClose, true);

    // only the owner closes the day
    await assert.rejects(rpc(manager, 'close_day', { p_day: today }), /Only the owner/);
    const closed = await rpc(owner, 'close_day', { p_day: today, p_note: 'All good' });
    assert.equal(closed.closed.status, 'closed');
    assert.equal(closed.closed.by, 'Owner Pravin');
    assert.equal(closed.canClose, false);
});

test('a closed day is locked: no payment, bill, expense or shift dated that day', async () => {
    const cats = await must(owner.from('expense_categories').select('id, name'));
    await assert.rejects(rpc(owner, 'record_expense', { p: { categoryId: cats[0].id, amount: 100, accountCode: 'bank', date: today, note: 'late bill' } }),
        /closed the accounts of .* An expense dated that day is not allowed/);
    await assert.rejects(rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: {} }), /Opening a shift dated that day/);
    // a backdated payment straight into the money book is refused too
    await assert.rejects(must(service.from('ledger_entries').insert({ tenant_id: tenantId, entry_date: today, account_id:
        (await must(service.from('money_accounts').select('id').eq('tenant_id', tenantId).eq('code', 'bank').single())).id,
        amount: 50, kind: 'adjustment' })), /A payment or money entry dated that day/);
    await assert.rejects(rpc(owner, 'settle_khata', { p_customer: raju, p_amount: 50, p_method: 'upi' }), /no open shift|closed the accounts/);
    // the owner can open the day again with a reason (and is told)
    await assert.rejects(rpc(owner, 'reopen_day', { p_day: today, p_reason: '' }), /Write why/);
    await rpc(owner, 'reopen_day', { p_day: today, p_reason: 'Forgot the gas bill' });
    await rpc(owner, 'record_expense', { p: { categoryId: cats[0].id, amount: 100, accountCode: 'bank', date: today, note: 'gas' } });
});
