// Fix pack 2: cash drawer rights, first names for waiters, the page each role opens on.
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

const saEmail = `sa2-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `fx2-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Fix pack 2 ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
await must(owner.from('settings').upsert({ key: 'qr_accept_all', value: false }));
const roles = await must(owner.from('roles').select('id, name, home_path'));
const roleId = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Kabir Cashier', p_phone: ph(2), p_role_id: roleId('Cashier'), p_pin: '2222' });
await rpc(owner, 'create_staff', { p_name: 'Wasim Waiter', p_phone: ph(3), p_role_id: roleId('Waiter'), p_pin: '3333' });
await rpc(owner, 'create_staff', { p_name: 'Meena Manager', p_phone: ph(4), p_role_id: roleId('Manager'), p_pin: '4444' });
await rpc(owner, 'create_staff', { p_name: 'Kiran Cashier', p_phone: ph(5), p_role_id: roleId('Cashier'), p_pin: '5555' });
const cashier = await staffLogin(slug, ph(2), '2222');
const waiter = await staffLogin(slug, ph(3), '3333');
const manager = await staffLogin(slug, ph(4), '4444');
const cashier2 = await staffLogin(slug, ph(5), '5555');
const counterOf = async (who) => (await rpc(who, 'current_shifts')).open.find(s => s.drawer === 'cash_counter');

test('drawer: only the opener and finance people see the cash; only the opener or a manager can close', async () => {
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 2 } });
    const mine = await counterOf(cashier);
    assert.equal(mine.canSee, true);
    assert.equal(mine.canClose, true);
    assert.equal(mine.expectedCash, 1000);
    for (const other of [waiter, cashier2]) {
        const s = await counterOf(other);
        assert.equal(s.canSee, false);
        assert.equal(s.canClose, false);
        assert.equal(s.expectedCash, undefined);
        assert.equal(s.openedBy, 'Kabir Cashier');
    }
    assert.ok((await rpc(waiter, 'current_shifts')).drawers.every(d => d.lastCloseCash == null));
    // A waiter can still record a pay-out, but the reply hides the drawer
    const after = await rpc(waiter, 'cash_movement_view', { p_drawer: 'cash_counter', p_kind: 'payout', p_amount: 50, p_note: 'Milk' });
    assert.equal(after.expectedCash, undefined);
    await assert.rejects(rpc(waiter, 'close_shift', { p_shift_id: mine.id, p_denoms: { 500: 1, 100: 4, 50: 1 } }), /who opened this shift|manager/);
    await assert.rejects(rpc(cashier2, 'close_shift', { p_shift_id: mine.id, p_denoms: { 500: 1, 100: 4, 50: 1 } }), /who opened this shift|manager/);
    const m = await counterOf(manager);
    assert.equal(m.canSee, true);
    assert.equal(m.canClose, true);
    assert.equal(m.expectedCash, 950);
    // The manager closes it
    const closed = await rpc(manager, 'close_shift', { p_shift_id: mine.id, p_denoms: { 500: 1, 100: 4, 50: 1 } });
    assert.equal(closed.status, 'closed');
    // The opener can close their own
    await rpc(cashier2, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 1, 100: 4, 50: 1 } });
    const own = await counterOf(cashier2);
    assert.equal((await rpc(cashier2, 'close_shift', { p_shift_id: own.id, p_denoms: { 500: 1, 100: 4, 50: 1 } })).status, 'closed');
});

test('finance lists a shift still open from an earlier day', async () => {
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 1, 100: 4, 50: 1 } });
    const s = await counterOf(cashier);
    await must(service.from('shifts').update({ opened_at: new Date(Date.now() - 30 * 3600e3).toISOString() }).eq('id', s.id));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const list = await rpc(manager, 'list_shifts', { p_from: today, p_to: today });
    assert.ok(list.some(x => x.id === s.id && x.status === 'open'));
    await rpc(manager, 'close_shift', { p_shift_id: s.id, p_denoms: { 500: 1, 100: 4, 50: 1 } });
});

test('a waiter sees the first name of the customer on an order, never the phone', async () => {
    const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
    const dosa = await must(owner.from('menu_items').insert({ name: 'Dosa', price: 100, category_id: cat.id }).select().single());
    const guest = await customer(slug, 'Ravi Kumar', 41);
    const id = await rpc(guest, 'place_order', { p_items: [{ menuItem: dosa.id, quantity: 1 }] });
    const w = await rpc(waiter, 'get_order', { p_id: id });
    assert.equal(w.user.name, 'Ravi');
    assert.equal(w.user.phone, null);
    const m = await rpc(manager, 'get_order', { p_id: id });
    assert.equal(m.user.name, 'Ravi Kumar');
    const g = await rpc(guest, 'get_order', { p_id: id });
    assert.equal(g.user.name, 'Ravi Kumar');
});

test('roles open on their page: Waiter on Orders, Chef on Kitchen, and the owner can change it', async () => {
    assert.equal(roles.find(r => r.name === 'Waiter').home_path, '/admin/orders');
    assert.equal(roles.find(r => r.name === 'Chef').home_path, '/admin/kitchen');
    assert.equal((await rpc(waiter, 'me')).homePath, '/admin/orders');
    assert.equal((await rpc(cashier, 'me')).homePath, null);
    await must(owner.from('roles').update({ home_path: '/admin/tables' }).eq('id', roleId('Waiter')));
    assert.equal((await rpc(waiter, 'me')).homePath, '/admin/tables');
    await assert.rejects(must(owner.from('roles').update({ home_path: 'https://evil.example' }).eq('id', roleId('Waiter'))));
    // A waiter cannot change roles
    await must(waiter.from('roles').update({ home_path: '/admin/pos' }).eq('id', roleId('Waiter')));
    assert.equal((await rpc(waiter, 'me')).homePath, '/admin/tables');
});
