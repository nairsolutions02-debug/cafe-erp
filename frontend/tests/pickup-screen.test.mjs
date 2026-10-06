// Collect-your-order screen: private screen links, Q numbers for QR orders, and a board that follows the kitchen.
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

const saEmail = `sap-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `pick-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Pickup ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
// These tests cover QR orders that reach the kitchen at once; Accept-every-order has its own test
await must(owner.from('settings').upsert({ key: 'qr_accept_all', value: false }));
const roles = await must(owner.from('roles').select('id, name'));
await rpc(owner, 'create_staff', { p_name: 'Cashier', p_phone: ph(2), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '2222' });
const cashier = await staffLogin(slug, ph(2), '2222');
const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
const dosa = await must(owner.from('menu_items').insert({ name: 'Dosa', price: 100, category_id: cat.id }).select().single());
const [t5] = await must(owner.from('dining_tables').insert([{ table_number: '5' }]).select());
const code5 = (await must(owner.from('table_codes').select('code').eq('table_id', t5.id).single())).code;
const items = [{ menuItem: dosa.id, quantity: 1 }];
const screen = await rpc(owner, 'create_pickup_screen', { p_name: 'Counter TV' });
const tv = client(); // the TV: no login at all
const board = () => rpc(tv, 'pickup_board', { p_key: screen.key });
const labels = (list) => list.map(o => o.label);

test('screen link: works without login, wrong key shows nothing, staff without settings rights cannot add screens', async () => {
    assert.equal((await rpc(tv, 'pickup_board', { p_key: 'nope' })).ok, false);
    const b = await board();
    assert.equal(b.ok, true);
    assert.equal(b.screen, 'Counter TV');
    assert.deepEqual(b.preparing, []);
    assert.equal((await must(tv.from('pickup_screens').select('key'))).length, 0);
    await assert.rejects(rpc(cashier, 'create_pickup_screen', { p_name: 'x' }));
    assert.equal((await must(cashier.from('pickup_screens').select('name'))).length, 1);
});

test('QR takeaway orders get Q1, Q2 and show as preparing with the first name; table orders stay off the board', async () => {
    const a = await customer(slug, 'Asha Verma', 10);
    const b = await customer(slug, 'Ravi', 11);
    const o1 = await rpc(a, 'place_order', { p_items: items });
    const o2 = await rpc(b, 'place_order', { p_items: items });
    const oT = await rpc(a, 'place_order', { p_items: items, p_table_code: code5 });
    assert.equal((await rpc(a, 'get_order', { p_id: o1 })).tokenNumber, 'Q1');
    assert.equal((await rpc(b, 'get_order', { p_id: o2 })).tokenNumber, 'Q2');
    assert.equal((await rpc(a, 'get_order', { p_id: oT })).tokenNumber, 'Q3');
    const bd = await board();
    assert.deepEqual(labels(bd.preparing), ['Q1', 'Q2']);
    assert.equal(bd.preparing[0].name, 'Asha');
    await must(owner.from('settings').upsert({ key: 'pickup_include_tables', value: true }));
    const withTables = await board();
    assert.deepEqual(labels(withTables.preparing), ['Q1', 'Q2', 'Q3']);
    assert.equal(withTables.preparing[2].table, '5');
    await must(owner.from('settings').upsert({ key: 'pickup_include_tables', value: false }));
});

test('counter order paid upfront follows the kitchen: preparing, then ready, then gone when collected', async () => {
    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', tokenNumber: '12', items, payFullBy: 'cash' } });
    assert.equal(o.status, 'paid');
    let bd = await board();
    assert.ok(labels(bd.preparing).includes('12'));
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'preparing' });
    assert.equal((await board()).preparing.find(x => x.label === '12').started, true);
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'ready' });
    bd = await board();
    assert.ok(!labels(bd.preparing).includes('12'));
    assert.deepEqual(labels(bd.ready), ['12']);
    // Staff see the same board, and tap Collected
    assert.deepEqual(labels((await rpc(cashier, 'pickup_staff_board', {})).ready), ['12']);
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'served' });
    bd = await board();
    assert.ok(!labels(bd.ready).includes('12'));
});

test('kiosk sales never appear; ready orders leave after the set minutes; names can be hidden', async () => {
    await rpc(cashier, 'create_staff_order', { p: { channel: 'kiosk', tokenNumber: '99', items, payFullBy: 'cash', drawer: 'cash_kiosk' } });
    const k = await board();
    assert.ok(![...labels(k.preparing), ...labels(k.ready)].includes('99'));

    const o = await rpc(cashier, 'create_staff_order', { p: { channel: 'takeaway', tokenNumber: '13', items, payFullBy: 'cash' } });
    await rpc(cashier, 'set_kitchen_status', { p_order_id: o.id, p_item_id: null, p_status: 'ready' });
    assert.ok(labels((await board()).ready).includes('13'));
    assert.ok((await must(service.from('orders').select('ready_at').eq('id', o.id).single())).ready_at, 'ready time stamped');
    await must(service.from('orders').update({ ready_at: new Date(Date.now() - 11 * 60e3).toISOString() }).eq('id', o.id));
    assert.ok(!labels((await board()).ready).includes('13'), 'gone after 10 minutes');

    await must(owner.from('settings').upsert({ key: 'pickup_show_names', value: false }));
    assert.ok((await board()).preparing.every(x => x.name === ''));
    await must(owner.from('settings').upsert({ key: 'pickup_show_names', value: true }));
});

test('held orders wait off the board; deleting a screen kills its link', async () => {
    await must(owner.from('settings').upsert({ key: 'table_confirm_first', value: true }));
    await must(owner.from('settings').upsert({ key: 'pickup_include_tables', value: true }));
    const [t9] = await must(owner.from('dining_tables').insert([{ table_number: '9' }]).select());
    const code9 = (await must(owner.from('table_codes').select('code').eq('table_id', t9.id).single())).code;
    const a = await customer(slug, 'Held', 12);
    const id = await rpc(a, 'place_order', { p_items: items, p_table_code: code9 });
    const label = (await rpc(a, 'get_order', { p_id: id })).tokenNumber;
    assert.ok(!labels((await board()).preparing).includes(label));
    await rpc(owner, 'confirm_table_order', { p_order_id: id });
    assert.ok(labels((await board()).preparing).includes(label));
    await must(owner.from('settings').upsert({ key: 'table_confirm_first', value: false }));
    await must(owner.from('settings').upsert({ key: 'pickup_include_tables', value: false }));

    await rpc(owner, 'delete_pickup_screen', { p_id: screen.id });
    assert.equal((await board()).ok, false);
});
