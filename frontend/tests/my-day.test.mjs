// My day: the cafe daily task list (owner edits, anyone ticks, everyone sees who) and my numbers for today.
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
const ph = (n) => `8${run}${String(n + 500).padStart(3, '0')}`;

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

const saEmail = `mdst-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const mkCafe = async (slug, n) => {
    await rpc(sa, 'sa_create_tenant', { p_name: `Day ${slug}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id,
        p_paid_until: '2099-01-01', p_owner_name: 'Owner', p_owner_phone: ph(n), p_owner_pin: '1111' });
    return staffLogin(slug, ph(n), '1111');
};
const slug = `day-a-${run}`;
const owner = await mkCafe(slug, 71);
const other = await mkCafe(`day-b-${run}`, 72);
const roles = await must(owner.from('roles').select('id, name'));
await rpc(owner, 'create_staff', { p_name: 'Cashier Sonu', p_phone: ph(73), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '3333' });
const cashier = await staffLogin(slug, ph(73), '3333');

test('owner sets the list, cashier ticks, everyone sees who did it; cashier cannot edit; other cafes see nothing', async () => {
    let list = await rpc(owner, 'save_daily_tasks', { p: [{ title: 'Count milk' }, { title: 'Clean steam wand' }, { title: '  ' }] });
    assert.deepEqual(list.map(t => t.title), ['Count milk', 'Clean steam wand']);
    await assert.rejects(rpc(cashier, 'save_daily_tasks', { p: [{ title: 'Nap' }] }), /owner or a manager/);

    const extras = await rpc(cashier, 'my_day_extras');
    assert.equal(extras.canEditTasks, false);
    assert.equal(extras.tasks.length, 2);
    list = await rpc(cashier, 'tick_daily_task', { p_id: extras.tasks[0].id, p_done: true });
    assert.equal(list[0].done, true);
    assert.equal(list[0].by, 'Cashier Sonu');
    const seen = await rpc(owner, 'my_day_extras');
    assert.equal(seen.canEditTasks, true);
    assert.equal(seen.tasks[0].done, true);

    // Reorder and rename keeps the tick on the task with the same id; a dropped task disappears
    list = await rpc(owner, 'save_daily_tasks', { p: [{ id: seen.tasks[1].id, title: 'Clean the steam wand' }, { id: seen.tasks[0].id, title: 'Count milk' }] });
    assert.deepEqual(list.map(t => [t.title, t.done]), [['Clean the steam wand', false], ['Count milk', true]]);
    list = await rpc(owner, 'save_daily_tasks', { p: [{ id: seen.tasks[0].id, title: 'Count milk' }] });
    assert.equal(list.length, 1);
    list = await rpc(cashier, 'tick_daily_task', { p_id: seen.tasks[0].id, p_done: false });
    assert.equal(list[0].done, false);

    assert.equal((await rpc(other, 'my_day_extras')).tasks.length, 0);
    await assert.rejects(rpc(other, 'tick_daily_task', { p_id: seen.tasks[0].id, p_done: true }), /not found/);
    assert.equal((await must(other.from('daily_tasks').select('id'))).length, 0);
});

test('my numbers count only my own orders today', async () => {
    const cat = await must(owner.from('categories').insert({ name: 'Snacks' }).select().single());
    const samosa = await must(owner.from('menu_items').insert({ name: 'Samosa', price: 20, category_id: cat.id }).select().single());
    const before = (await rpc(cashier, 'my_day_extras')).today;
    assert.deepEqual(before, { orders: 0, sales: 0 });
    await rpc(cashier, 'open_shift', { p_drawer: 'cash_counter', p_denoms: { 500: 2 } }).catch(() => {});
    await rpc(cashier, 'create_staff_order', { p: {
        clientId: `md-${run}`, orderNumber: `C9-261004-${run.slice(-3)}1`, deviceCode: 'C9', channel: 'takeaway',
        items: [{ menuItem: samosa.id, quantity: 2 }], payments: [{ method: 'cash', amount: 100 }] } });
    const after = (await rpc(cashier, 'my_day_extras')).today;
    assert.equal(after.orders, 1);
    assert.ok(after.sales > 0);
    assert.deepEqual((await rpc(owner, 'my_day_extras')).today, { orders: 0, sales: 0 });
});
