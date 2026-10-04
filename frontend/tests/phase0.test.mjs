// Phase 0 checks: superadmin + plans, cafe isolation, roles and permissions, staff PIN logins,
// auto-lock, catalogue v2 (tax groups, MRP, restricted items), global search, audit log, terms.
// Run against a local stack: supabase db reset && npm run test:db
import { test, after } from 'node:test';
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
const ph = (n) => `8${run}${String(n).padStart(3, '0')}`;

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

// Superadmin
const saEmail = `sa${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });

const plans = (await rpc(sa, 'sa_overview')).plans;
const starter = plans.find(p => p.name === 'Starter');
const slugA = `cafe-a-${run}`, slugB = `cafe-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Cafe A ${run}`, p_slug: slugA, p_plan_id: starter.id, p_paid_until: '2099-01-01',
    p_owner_name: 'Asha Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const tenantB = await rpc(sa, 'sa_create_tenant', {
    p_name: `Cafe B ${run}`, p_slug: slugB, p_plan_id: starter.id, p_paid_until: '2099-01-01',
    p_owner_name: 'Bala Owner', p_owner_phone: ph(2), p_owner_pin: '2222' });

async function staffLogin(slug, phone, pin) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    const res = await rpc(c, 'staff_pin_login', { p_phone: phone, p_pin: pin });
    return { c, res };
}
async function customer(slug, name, phone) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone });
    return c;
}

const ownerA = (await staffLogin(slugA, ph(1), '1111')).c;
const ownerB = (await staffLogin(slugB, ph(2), '2222')).c;
const rolesA = await must(ownerA.from('roles').select('id, name'));
const roleId = (n) => rolesA.find(r => r.name === n).id;

const catA = await must(ownerA.from('categories').insert({ name: 'Beverages' }).select().single());
const brand = await must(ownerA.from('brands').insert({ name: 'Gold Flake' }).select().single());
const tobacco = await must(ownerA.from('tax_groups').insert({
    name: 'Tobacco 28%', components: [{ name: 'CGST', rate: 14 }, { name: 'SGST', rate: 14 }] }).select().single());
const coffee = await must(ownerA.from('menu_items').insert({ name: 'Cappuccino', price: 100, category_id: catA.id }).select().single());
const cig = await must(ownerA.from('menu_items').insert({
    name: 'Gold Flake King', price: 20, mrp: 20, price_includes_tax: true, item_type: 'resale',
    is_restricted: true, brand_id: brand.id, tax_group_id: tobacco.id, category_id: catA.id }).select().single());
await must(ownerA.from('coupons').insert({ code: 'HALF', discount_type: 'percentage', discount_value: 50,
    valid_from: new Date(Date.now() - 864e5).toISOString(), valid_until: new Date(Date.now() + 864e5).toISOString() }));
const tableA = await must(ownerA.from('dining_tables').insert({ table_number: '1' }).select().single());
await must(ownerA.from('loyalty_settings').update({ min_order_for_points: 0 }).eq('tenant_id', tenantA));

test('superadmin sees both cafes; others cannot use superadmin functions', async () => {
    const ov = await rpc(sa, 'sa_overview');
    assert.ok(ov.tenants.find(t => t.slug === slugA && t.staffActive === 1 && t.status === 'active'));
    await assert.rejects(rpc(ownerA, 'sa_overview'), /Not authorized/);
    await assert.rejects(rpc(ownerA, 'sa_record_payment', { p_id: tenantA, p_months: 1, p_amount: 1 }), /Not authorized/);
});

test('staff PIN login: wrong PIN rejected, 5 wrong locks for 15 minutes', async () => {
    await rpc(ownerA, 'create_staff', { p_name: 'Lock Test', p_phone: ph(9), p_role_id: roleId('Waiter'), p_pin: '4321' });
    const { res: bad } = await staffLogin(slugA, ph(9), '0000');
    assert.equal(bad.ok, false);
    for (let i = 0; i < 4; i++) await staffLogin(slugA, ph(9), '0000');
    const { res: locked } = await staffLogin(slugA, ph(9), '4321');
    assert.match(locked.message, /Too many wrong PINs/);
    const staff = (await rpc(ownerA, 'list_staff')).staff.find(s => s.phone === ph(9));
    await rpc(ownerA, 'set_staff_pin', { p_staff_id: staff.id, p_pin: '9999' });
    const { res: ok } = await staffLogin(slugA, ph(9), '9999');
    assert.equal(ok.ok, true);
    // Same phone + PIN on the other cafe's site does not work
    const { res: wrongCafe } = await staffLogin(slugB, ph(9), '9999');
    assert.equal(wrongCafe.ok, false);
});

test('plan limit: Starter allows 5 staff users, the 6th is blocked', async () => {
    // Owner + Lock Test = 2 so far
    for (let i = 3; i <= 5; i++) {
        await rpc(ownerA, 'create_staff', { p_name: `Staff ${i}`, p_phone: ph(10 + i), p_role_id: roleId('Cashier'), p_pin: '1234' });
    }
    await assert.rejects(
        rpc(ownerA, 'create_staff', { p_name: 'Staff 6', p_phone: ph(16), p_role_id: roleId('Cashier'), p_pin: '1234' }),
        /plan allows 5 staff/);
    const usage = (await rpc(ownerA, 'list_staff')).usage;
    assert.deepEqual([usage.active, usage.max], [5, 5]);
});

test('a cashier cannot see profit, reports, staff or audit; the owner can', async () => {
    const cashier = (await staffLogin(slugA, ph(13), '1234')).c;
    const me = await rpc(cashier, 'me');
    assert.equal(me.roleName, 'Cashier');
    assert.ok(me.permissions.includes('orders.view') && !me.permissions.includes('reports.view'));
    await assert.rejects(rpc(cashier, 'dashboard_stats'), /reports.view/);
    await assert.rejects(rpc(cashier, 'list_staff'), /staff.view/);
    assert.equal((await must(cashier.from('audit_log').select('id'))).length, 0);
    assert.ok(Array.isArray(await rpc(cashier, 'admin_orders', { p_scope: 'active' })));
    // Menu prices can't be changed by a cashier
    await cashier.from('menu_items').update({ price: 1 }).eq('id', coffee.id);
    assert.equal((await must(ownerA.from('menu_items').select('price').eq('id', coffee.id).single())).price, 100);
    // Owner sees everything
    assert.ok((await rpc(ownerA, 'me')).permissions.includes('*'));
    await rpc(ownerA, 'dashboard_stats');
});

test('per-person override grants a single permission', async () => {
    const staff = (await rpc(ownerA, 'list_staff')).staff.find(s => s.phone === ph(14));
    await must(ownerA.from('staff_overrides').insert({ staff_id: staff.id, perm: 'reports.view', allow: true }));
    const c = (await staffLogin(slugA, ph(14), '1234')).c;
    await rpc(c, 'dashboard_stats');
    const other = (await staffLogin(slugA, ph(15), '1234')).c;
    await assert.rejects(rpc(other, 'dashboard_stats'), /reports.view/);
});

test('cafes are isolated: menus, orders and staff never cross', async () => {
    await must(ownerB.from('menu_items').insert({ name: 'B Only Tea', price: 10 }));
    const menuA = await must(client(slugA).from('menu_items').select('name'));
    assert.ok(menuA.some(m => m.name === 'Cappuccino') && !menuA.some(m => m.name === 'B Only Tea'));
    const menuB = await must(client(slugB).from('menu_items').select('name'));
    assert.deepEqual(menuB.map(m => m.name), ['B Only Tea']);
    // B's owner can't read or touch A's data even without the header
    assert.equal((await must(ownerB.from('staff_users').select('id').eq('tenant_id', tenantA))).length, 0);
    await ownerB.from('menu_items').update({ price: 1 }).eq('id', coffee.id);
    assert.equal((await must(ownerA.from('menu_items').select('price').eq('id', coffee.id).single())).price, 100);
    // The same phone is a separate customer in each cafe
    const ca = await customer(slugA, 'Same Phone', ph(50));
    const cb = await customer(slugB, 'Same Phone', ph(50));
    assert.notEqual((await rpc(ca, 'me'))._id, (await rpc(cb, 'me'))._id);
});

test('MRP item includes tax; restricted item gets no coupon and no points', async () => {
    const c = await customer(slugA, 'Ravi', ph(60));
    const quote = await rpc(c, 'quote_order', {
        p_items: [{ menuItem: coffee.id, quantity: 1 }, { menuItem: cig.id, quantity: 2 }], p_coupon_code: 'HALF' });
    // Coffee 100 - 50% = 50 + 5% = 52.50 ; 2 cigarettes at MRP 20 incl. 28% = 40.00 exactly
    assert.equal(quote.discount, 50);
    assert.equal(quote.total, 92.5);
    const id = await rpc(c, 'place_order', {
        p_items: [{ menuItem: coffee.id, quantity: 1 }, { menuItem: cig.id, quantity: 2 }],
        p_coupon_code: 'HALF',
        p_table_code: (await must(ownerA.from('table_codes').select('code').eq('table_id', tableA.id).single())).code });
    const order = await rpc(c, 'get_order', { p_id: id });
    assert.equal(order.total, 92.5);
    assert.deepEqual(order.taxDetails.map(t => `${t.name} ${t.rate}`).sort(), ['CGST 14', 'CGST 2.5', 'SGST 14', 'SGST 2.5']);
    assert.equal(order.items.find(i => i.name === 'Gold Flake King').discount, 0);
    await rpc(ownerA, 'record_payment', { p_order_id: id, p_method: 'cash', p_amount: 92.5 });
    // Points: only the coffee after discount (50) -> 50 points; cigarettes earn nothing
    assert.equal((await rpc(c, 'my_loyalty_points')).currentPoints, 50);
});

test('global search finds items by typo, customers by last digits, orders by number', async () => {
    const s1 = await rpc(ownerA, 'global_search', { p_query: 'capuchino' });
    assert.equal(s1.items[0].title, 'Cappuccino');
    const s2 = await rpc(ownerA, 'global_search', { p_query: ph(60).slice(-4) });
    assert.ok(s2.customers.some(c => c.title === 'Ravi'));
    const order = (await rpc(ownerA, 'admin_orders', {}))[0];
    const s3 = await rpc(ownerA, 'global_search', { p_query: order.orderNumber.slice(-6) });
    assert.equal(s3.orders[0].title, order.orderNumber);
    const s4 = await rpc(ownerA, 'global_search', { p_query: 'gold flake' });
    assert.ok(s4.brands.some(b => b.title === 'Gold Flake'));
    // A cashier without customer phone permission sees a masked number
    const cashier = (await staffLogin(slugA, ph(13), '1234')).c;
    const s5 = await rpc(cashier, 'global_search', { p_query: 'ravi' });
    assert.match(s5.customers[0].subtitle, /^\*{6}\d{4}/);
});

test('audit log records price changes with who did them', async () => {
    await must(ownerA.from('menu_items').update({ price: 110 }).eq('id', coffee.id));
    const log = await must(ownerA.from('audit_log').select('*').eq('entity', 'menu_items').eq('action', 'update')
        .order('at', { ascending: false }).limit(1).single());
    assert.equal(log.actor_name, 'Asha Owner');
    assert.equal(log.old_data.price, 100);
    assert.equal(log.new_data.price, 110);
    await must(ownerA.from('menu_items').update({ price: 100 }).eq('id', coffee.id));
});

test('staff must accept terms once; the acceptance is stored', async () => {
    const c = (await staffLogin(slugA, ph(15), '1234')).c;
    const me = await rpc(c, 'me');
    assert.equal(me.pendingTerms.kind, 'staff');
    await rpc(c, 'accept_terms', { p_kind: 'staff', p_version: me.pendingTerms.version, p_user_agent: 'test' });
    assert.equal((await rpc(c, 'me')).pendingTerms, null);
    const staff = (await rpc(ownerA, 'list_staff')).staff.find(s => s.phone === ph(15));
    assert.equal(staff.acceptedTerms.version, me.pendingTerms.version);
});

test('unpaid cafe locks: staff blocked, ordering paused; payment unlocks', async () => {
    const c = await customer(slugB, 'Late', ph(70));
    const tea = (await must(client(slugB).from('menu_items').select('id').limit(1).single())).id;
    await rpc(sa, 'sa_update_tenant', { p_id: tenantB, p_patch: { paidUntil: '2020-01-01' } });
    await assert.rejects(rpc(ownerB, 'admin_orders', {}), /Not authorized/);
    await assert.rejects(rpc(c, 'place_order', { p_items: [{ menuItem: tea, quantity: 1 }] }), /paused/);
    const { res } = await staffLogin(slugB, ph(2), '2222');
    assert.match(res.message, /locked/);
    const until = await rpc(sa, 'sa_record_payment', { p_id: tenantB, p_months: 1, p_amount: 5000, p_note: 'UPI' });
    assert.ok(until > new Date().toISOString().slice(0, 10));
    await rpc(c, 'place_order', { p_items: [{ menuItem: tea, quantity: 1 }] });
});

test('staff with orders.view get live new orders for their own cafe only', async () => {
    const staffA = (await staffLogin(slugA, ph(13), '1234')).c;
    const ownerOfB = (await staffLogin(slugB, ph(2), '2222')).c;
    const seen = { a: [], b: [] };
    const listen = (c, key) => new Promise((resolve) => {
        c.channel(`o-${key}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
            (p) => seen[key].push(p.new.id)).subscribe((s) => s === 'SUBSCRIBED' && resolve());
    });
    await Promise.all([listen(staffA, 'a'), listen(ownerOfB, 'b')]);
    await new Promise(r => setTimeout(r, 1000));
    const c = await customer(slugA, 'Live A', ph(80));
    const id = await rpc(c, 'place_order', { p_items: [{ menuItem: coffee.id, quantity: 1 }] });
    await new Promise(r => setTimeout(r, 3000));
    assert.ok(seen.a.includes(id), 'cafe A staff saw the order');
    assert.ok(!seen.b.includes(id), 'cafe B did not');
});

after(() => setTimeout(() => process.exit(), 100));
