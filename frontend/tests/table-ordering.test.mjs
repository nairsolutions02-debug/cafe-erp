// Table ordering: private QR codes, shared tables (one bill per group), table modes, held first orders,
// moving tables, and the owner-editable customer app (banners, announcement, switches).
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
async function customer(slug, name, n) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: ph(n) });
    return c;
}
const setSetting = (who, key, value) => must(who.from('settings').upsert({ key, value }));

const saEmail = `sat-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `tbl-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Tables ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
const dosa = await must(owner.from('menu_items').insert({ name: 'Dosa', price: 100, category_id: cat.id }).select().single());
const cig = await must(owner.from('menu_items').insert({ name: 'Smokes', price: 20, category_id: cat.id, is_restricted: true }).select().single());
const [t5, t7] = await must(owner.from('dining_tables').insert([{ table_number: '5' }, { table_number: '7' }]).select().order('table_number'));
const codeOf = async (t) => (await must(owner.from('table_codes').select('code').eq('table_id', t.id).single())).code;
const items = [{ menuItem: dosa.id, quantity: 1 }];

test('every table gets a private code; the public cannot read codes', async () => {
    const code = await codeOf(t5);
    assert.match(code, /^5-[A-Z2-9]{4}$/);
    const anon = client(slug);
    const rows = await must(anon.from('table_codes').select('code'));
    assert.equal(rows.length, 0);
    const r = await rpc(anon, 'resolve_table', { p_code: code.toLowerCase() });
    assert.equal(r.ok, true);
    assert.equal(r.tableNumber, '5');
    assert.equal((await rpc(anon, 'resolve_table', { p_code: '5-ZZZZ' })).reason, 'unknown');
});

test('shared table: any number of customers order at one table, each with their own bill', async () => {
    const code = await codeOf(t5);
    const a = await customer(slug, 'Rahul', 10);
    const b = await customer(slug, 'Priya', 11);
    const c = await customer(slug, 'Kiran', 12);
    const oa = await rpc(a, 'place_order', { p_items: items, p_table_code: code });
    const ob = await rpc(b, 'place_order', { p_items: items, p_table_code: code });
    const oc = await rpc(c, 'place_order', { p_items: items, p_table_code: code });
    await rpc(a, 'place_order', { p_items: items, p_table_code: code });
    const groups = (await rpc(owner, 'table_groups', {})).filter(g => g.tableId === t5.id);
    assert.deepEqual(groups.map(g => g.name).sort(), ['Kiran', 'Priya', 'Rahul']);
    assert.equal(groups.find(g => g.name === 'Rahul').orders, 2);

    // Rahul asks for the bill: only his two orders
    await rpc(a, 'request_bill', { p_order_id: oa });
    assert.ok((await rpc(a, 'my_orders')).every(o => o.status === 'bill_requested'));
    assert.equal((await rpc(b, 'get_order', { p_id: ob })).status, 'pending');

    // Kitchen shows how many groups share the table
    const k = (await rpc(owner, 'kitchen_orders', {})).find(o => o.id === oc);
    assert.equal(k.tableGroups, 3);
});

test('double tap with the same client id places one order', async () => {
    const a = await customer(slug, 'Tap', 13);
    const cid = `c-${run}-1`;
    const first = await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t7), p_client_id: cid });
    const again = await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t7), p_client_id: cid });
    assert.equal(first, again);
});

test('QR mode: picking a table id is refused; old ?table= links follow the legacy switch', async () => {
    const a = await customer(slug, 'Picker', 14);
    await assert.rejects(rpc(a, 'place_order', { p_items: items, p_table_id: t5.id }), /scan the QR code/);
    // Old printed QRs pass the table number
    const legacy = await rpc(a, 'place_order', { p_items: items, p_table_code: 'n:5' });
    assert.equal((await rpc(a, 'get_order', { p_id: legacy })).tableNumber, '5');
    await setSetting(owner, 'table_legacy_links', false);
    await assert.rejects(rpc(a, 'place_order', { p_items: items, p_table_code: 'n:5' }), /no longer in use/);
    await setSetting(owner, 'table_legacy_links', true);
    // No table at all is fine (takeaway / pickup)
    const takeaway = await rpc(a, 'place_order', { p_items: items });
    assert.equal((await rpc(a, 'get_order', { p_id: takeaway })).tableNumber, '');
});

test('customer-picks mode accepts a table id; no-tables mode ignores tables', async () => {
    const a = await customer(slug, 'Mode', 15);
    await setSetting(owner, 'table_mode', 'pick');
    const picked = await rpc(a, 'place_order', { p_items: items, p_table_id: t7.id });
    assert.equal((await rpc(a, 'get_order', { p_id: picked })).tableNumber, '7');
    await setSetting(owner, 'table_mode', 'none');
    const none = await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t7) });
    assert.equal((await rpc(a, 'get_order', { p_id: none })).tableNumber, '');
    assert.equal((await rpc(a, 'resolve_table', { p_code: await codeOf(t7) })).reason, 'no_tables');
    await setSetting(owner, 'table_mode', 'qr');
});

test('sharing switched off: a second group is told to ask the staff', async () => {
    const [t9] = await must(owner.from('dining_tables').insert([{ table_number: '9' }]).select());
    const code = await codeOf(t9);
    await setSetting(owner, 'table_shared', false);
    const a = await customer(slug, 'First', 16);
    const b = await customer(slug, 'Second', 17);
    await rpc(a, 'place_order', { p_items: items, p_table_code: code });
    await rpc(a, 'place_order', { p_items: items, p_table_code: code });
    await assert.rejects(rpc(b, 'place_order', { p_items: items, p_table_code: code }), /already has an open bill/);
    await setSetting(owner, 'table_shared', true);
});

test('staff confirm first order: held until confirmed, hidden from the kitchen', async () => {
    const [t11] = await must(owner.from('dining_tables').insert([{ table_number: '11' }]).select());
    const code = await codeOf(t11);
    await setSetting(owner, 'table_confirm_first', true);
    const a = await customer(slug, 'Remote', 18);
    const first = await rpc(a, 'place_order', { p_items: items, p_table_code: code });
    assert.equal((await rpc(a, 'get_order', { p_id: first })).held, true);
    assert.ok(!(await rpc(owner, 'kitchen_orders', {})).some(o => o.id === first));
    // A second order before staff confirm is held too
    const b = await customer(slug, 'Friend', 19);
    const second = await rpc(b, 'place_order', { p_items: items, p_table_code: code });
    assert.equal((await rpc(b, 'get_order', { p_id: second })).held, true);
    const ok = await rpc(owner, 'confirm_table_order', { p_order_id: first });
    assert.equal(ok.held, false);
    assert.equal(ok.status, 'confirmed');
    assert.ok((await rpc(owner, 'kitchen_orders', {})).some(o => o.id === first));
    // Once someone is confirmed at the table, new orders go straight through
    const third = await rpc(b, 'place_order', { p_items: items, p_table_code: code });
    assert.equal((await rpc(b, 'get_order', { p_id: third })).held, false);
    await assert.rejects(rpc(a, 'confirm_table_order', { p_order_id: second }), /permission|not allowed|Not authorized/i);
    await setSetting(owner, 'table_confirm_first', false);
});

test('re-issued QR: the old code stops working', async () => {
    const [t12] = await must(owner.from('dining_tables').insert([{ table_number: '12' }]).select());
    const old = await codeOf(t12);
    const fresh = await rpc(owner, 'reissue_table_code', { p_table_id: t12.id });
    assert.notEqual(old, fresh);
    const a = await customer(slug, 'Leak', 20);
    await assert.rejects(rpc(a, 'place_order', { p_items: items, p_table_code: old }), /no longer in use/);
    await rpc(a, 'place_order', { p_items: items, p_table_code: fresh });
});

test('switched-off table: friendly refusal', async () => {
    const [t13] = await must(owner.from('dining_tables').insert([{ table_number: '13' }]).select());
    const code = await codeOf(t13);
    await must(owner.from('dining_tables').update({ is_active: false }).eq('id', t13.id));
    assert.equal((await rpc(client(slug), 'resolve_table', { p_code: code })).reason, 'inactive');
    const a = await customer(slug, 'Off', 21);
    await assert.rejects(rpc(a, 'place_order', { p_items: items, p_table_code: code }), /not in use/);
});

test('moving tables: customer follows the new QR; staff move a group; old table frees up', async () => {
    const [t20, t21, t22] = await must(owner.from('dining_tables').insert([{ table_number: '20' }, { table_number: '21' }, { table_number: '22' }]).select().order('table_number'));
    const a = await customer(slug, 'Mover', 22);
    const o1 = await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t20) });
    await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t20) });
    const moved = await rpc(a, 'move_my_table', { p_code: await codeOf(t21) });
    assert.equal(moved.tableNumber, '21');
    assert.equal(moved.moved, 2);
    assert.ok((await rpc(a, 'my_orders')).every(o => o.tableNumber === '21'));
    let tables = await must(owner.from('dining_tables').select('table_number, status').in('id', [t20.id, t21.id]));
    assert.deepEqual(Object.fromEntries(tables.map(t => [t.table_number, t.status])), { 20: 'available', 21: 'occupied' });

    const res = await rpc(owner, 'move_order_table', { p_order_id: o1, p_table_id: t22.id });
    assert.equal(res.tableNumber, '22');
    assert.ok((await rpc(a, 'my_orders')).every(o => o.tableNumber === '22'));
    tables = await must(owner.from('dining_tables').select('table_number, status').in('id', [t21.id, t22.id]));
    assert.deepEqual(Object.fromEntries(tables.map(t => [t.table_number, t.status])), { 21: 'available', 22: 'occupied' });
});

test('banners: owner saves, customers see only live ones; restricted items cannot be promoted', async () => {
    await assert.rejects(rpc(owner, 'save_portal_banners', { p_banners: [{ title: 'Smoke break', linkType: 'item', linkTo: cig.id }] }),
        /can't be promoted/);
    await assert.rejects(rpc(owner, 'save_portal_banners', { p_banners: [{ title: 'Site', linkType: 'url', linkTo: 'http://x.test' }] }),
        /https/);
    const saved = await rpc(owner, 'save_portal_banners', { p_banners: [
        { title: 'Dosa Tuesday', text: 'Flat ₹20 off', tag: 'Today', cta: 'Order now', linkType: 'item', linkTo: dosa.id, style: 'saffron' },
        { title: 'Old offer', linkType: 'menu', to: '2020-01-01' },
        { title: 'Hidden', linkType: 'rewards', active: false },
    ] });
    assert.equal(saved.length, 3);
    assert.ok(saved.every(b => b.id));
    await setSetting(owner, 'portal_announcement', { on: true, text: 'Live music Friday 8 pm' });
    await setSetting(owner, 'portal_show', { nudgePoints: false });

    const a = await customer(slug, 'Viewer', 23);
    const cfg = await rpc(a, 'portal_config', {});
    assert.deepEqual(cfg.banners.map(b => b.title), ['Dosa Tuesday']);
    assert.equal(cfg.banners[0].item.name, 'Dosa');
    assert.equal(cfg.announcement.text, 'Live music Friday 8 pm');
    assert.equal(cfg.show.nudgePoints, false);
    assert.equal(cfg.show.nudgeMilestone, true);
    assert.equal(cfg.tables.mode, 'qr');
    // Visitors who haven't signed in yet see the same banners (the menu loads behind the login)
    assert.deepEqual((await rpc(client(slug), 'portal_config', {})).banners.map(b => b.title), ['Dosa Tuesday']);

    // Item no longer on sale: its banner hides itself
    await must(owner.from('menu_items').update({ is_available: false }).eq('id', dosa.id));
    assert.equal((await rpc(a, 'portal_config', {})).banners.length, 0);
    await must(owner.from('menu_items').update({ is_available: true }).eq('id', dosa.id));

    // Only the owner can save banners
    await assert.rejects(rpc(a, 'save_portal_banners', { p_banners: [] }));
});

test('checkout info counts orders for the milestone card', async () => {
    const a = await customer(slug, 'Regular', 24);
    assert.equal((await rpc(a, 'my_checkout_info', {})).ordersSoFar, 0);
    await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t7) });
    await rpc(a, 'place_order', { p_items: items });
    const info = await rpc(a, 'my_checkout_info', {});
    assert.equal(info.ordersSoFar, 2);
    assert.deepEqual(info.openAtTable.map(t => t.tableNumber), ['7']);
});
