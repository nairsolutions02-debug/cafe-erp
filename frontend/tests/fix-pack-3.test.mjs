// Fix pack 3: kitchen versus front of house rights, no direct order edits, refunds of paid bills.
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
async function customer(slug, name, n) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: ph(n) });
    return c;
}
const setSetting = (who, key, value) => must(who.from('settings').upsert({ key, value }));

const saEmail = `sa3-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `fx3-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Fix pack 3 ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
await must(owner.from('settings').upsert({ key: 'qr_accept_all', value: true }));
const roles = await must(owner.from('roles').select('id, name'));
const roleId = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Kabir Cashier', p_phone: ph(2), p_role_id: roleId('Cashier'), p_pin: '2222' });
await rpc(owner, 'create_staff', { p_name: 'Chotu Chef', p_phone: ph(3), p_role_id: roleId('Chef'), p_pin: '3333' });
await rpc(owner, 'create_staff', { p_name: 'Meena Manager', p_phone: ph(4), p_role_id: roleId('Manager'), p_pin: '4444' });
await rpc(owner, 'create_staff', { p_name: 'Wasim Waiter', p_phone: ph(5), p_role_id: roleId('Waiter'), p_pin: '5555' });
const cashier = await staffLogin(slug, ph(2), '2222');
const chef = await staffLogin(slug, ph(3), '3333');
const waiter = await staffLogin(slug, ph(5), '5555');
const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
const dosa = await must(owner.from('menu_items').insert({ name: 'Dosa', price: 100, category_id: cat.id }).select().single());
const items = [{ menuItem: dosa.id, quantity: 1 }];

test('the chef cooks but does not accept orders, take money, cancel or touch the drawer', async () => {
    const guest = await customer(slug, 'Neha', 21);
    const id = await rpc(guest, 'place_order', { p_items: items });
    await assert.rejects(rpc(chef, 'confirm_table_order', { p_order_id: id }), /Not authorized|permission/i);
    await rpc(waiter, 'confirm_table_order', { p_order_id: id });
    // Kitchen work is fine
    await rpc(chef, 'update_order_status', { p_order_id: id, p_status: 'preparing' });
    await rpc(chef, 'update_order_status', { p_order_id: id, p_status: 'ready' });
    await rpc(chef, 'update_order_status', { p_order_id: id, p_status: 'served' });
    // Money and front-of-house work is not
    await assert.rejects(rpc(chef, 'update_order_status', { p_order_id: id, p_status: 'bill_generated' }), /Not authorized|permission/i);
    await assert.rejects(rpc(chef, 'record_payment', { p_order_id: id, p_method: 'cash', p_amount: 105 }), /Not authorized|permission/i);
    await assert.rejects(rpc(chef, 'cancel_order', { p_order_id: id, p_reason: 'x' }), /Not authorized|permission/i);
    await assert.rejects(rpc(chef, 'update_order_status', { p_order_id: id, p_status: 'cancelled' }), /Not authorized|permission/i);
    await assert.rejects(rpc(chef, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 100: 1 } }), /Not authorized|permission/i);
    await assert.rejects(rpc(chef, 'current_shifts'), /Not authorized|permission/i);
    // The waiter takes the money
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 2 } });
    const paid = await rpc(waiter, 'record_payment', { p_order_id: id, p_method: 'cash', p_amount: 105 });
    assert.equal(paid.status, 'paid');
});

test('nobody edits order rows directly: totals and payments only change through the app', async () => {
    const guest = await customer(slug, 'Ravi', 22);
    const id = await rpc(guest, 'place_order', { p_items: items });
    for (const who of [chef, waiter, cashier, owner]) {
        await must(who.from('orders').update({ total: 1, amount_paid: 1, status: 'paid' }).eq('id', id));
        await must(who.from('orders').delete().eq('id', id));
    }
    const o = await rpc(owner, 'get_order', { p_id: id });
    assert.equal(o.total, 105);
    assert.equal(o.amountPaid, 0);
    assert.notEqual(o.status, 'paid');
});

test('a paid counter bill can be refunded from history; a cashier needs the manager PIN', async () => {
    const sale = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', items, payFullBy: 'cash' } });
    const id = sale.id || sale._id;
    assert.equal(sale.status, 'paid');
    await assert.rejects(rpc(cashier, 'cancel_order', { p_order_id: id, p_reason: 'Wrong item' }), /manager|PIN|approv/i);
    const done = await rpc(cashier, 'cancel_order', { p_order_id: id, p_reason: 'Wrong item', p_approver_phone: ph(4), p_approver_pin: '4444' });
    assert.equal(done.status, 'cancelled');
    const refunds = await must(service.from('ledger_entries').select('amount, kind').eq('order_id', id).eq('kind', 'refund'));
    assert.equal(refunds.reduce((s, r) => s + Number(r.amount), 0), -105);
});

test('bill and UPI requests ring for people who take money, not the kitchen', async () => {
    const kinds = await rpc(owner, 'notification_kinds');
    assert.equal(kinds.find(k => k.kind === 'payment_request').perm, 'orders.create');
});
