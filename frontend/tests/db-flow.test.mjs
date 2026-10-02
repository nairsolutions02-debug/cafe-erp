// End-to-end check of the Supabase database logic.
// Run against a local stack:  supabase start && supabase db reset && npm run test:db
// Uses SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (defaults: local CLI keys).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const client = (slug = 'default') => createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-tenant-slug': slug } },
});
const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const run = Date.now().toString().slice(-6);
const phone = (n) => `9${run}${String(n).padStart(3, '0')}`;

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

async function customer(name, n) {
    const c = client();
    const { error } = await c.auth.signInAnonymously();
    if (error) throw error;
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone(n) });
    return c;
}

async function adminClient() {
    const email = `owner${run}@example.com`;
    const password = `pw-${run}-secret`;
    const { error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    await rpc(service, 'make_admin', { p_email: email });
    const c = client();
    const { error: e2 } = await c.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    return c;
}

const admin = await adminClient();
const cat = await must(admin.from('categories').insert({ name: `Coffee ${run}` }).select().single());
const [latte, cake] = await must(admin.from('menu_items').insert([
    { name: `Latte ${run}`, price: 150, category_id: cat.id, bonus_loyalty_points: 5 },
    { name: `Cake ${run}`, price: 100, category_id: cat.id },
], { defaultToNull: false }).select());
const table = await must(admin.from('dining_tables').insert({ table_number: `T${run}` }).select().single());
await must(admin.from('coupons').insert({
    code: `save${run}`, discount_type: 'percentage', discount_value: 10, max_discount: 20,
    valid_from: new Date(Date.now() - 864e5).toISOString(), valid_until: new Date(Date.now() + 864e5).toISOString(),
}));
await must(admin.from('settings').update({ value: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }] }).eq('key', 'tax_config'));

test('customer signs in with name + phone, no OTP', async () => {
    const c = await customer('Asha', 1);
    const me = await rpc(c, 'me');
    assert.equal(me.name, 'Asha');
    assert.equal(me.phone, phone(1));
    assert.equal(me.role, 'customer');
});

test('invalid phone is rejected', async () => {
    const c = client();
    await c.auth.signInAnonymously();
    await assert.rejects(rpc(c, 'customer_sign_in', { p_name: 'X', p_phone: '12345' }), /valid 10-digit/);
});

test('same phone on a new device links to the same customer', async () => {
    const a = await customer('Ravi', 2);
    const b = await customer('Ravi K', 2);
    assert.equal((await rpc(a, 'me'))._id, (await rpc(b, 'me'))._id);
    assert.equal((await rpc(b, 'me')).name, 'Ravi K');
});

test('order totals are computed on the server, table session rules hold', async () => {
    const c = await customer('Meera', 3);
    const orderId = await rpc(c, 'place_order', {
        p_items: [{ menuItem: latte.id, quantity: 2 }, { menuItem: cake.id, quantity: 1 }],
        p_coupon_code: `SAVE${run}`, p_table_id: table.id,
    });
    const order = await rpc(c, 'get_order', { p_id: orderId });
    assert.equal(order.subtotal, 400);
    assert.equal(order.discount, 20); // 10% capped at 20
    assert.equal(order.tax, 19); // 2.5% + 2.5% of 380
    assert.equal(order.total, 399);
    assert.equal(order.items.length, 2);
    assert.equal(order.user.name, 'Meera');
    assert.equal(order.tableNumber, `T${run}`);

    // Same customer can order again at their table; someone else cannot
    await rpc(c, 'place_order', { p_items: [{ menuItem: cake.id, quantity: 1 }], p_table_id: table.id });
    const other = await customer('Stranger', 4);
    await assert.rejects(
        rpc(other, 'place_order', { p_items: [{ menuItem: cake.id, quantity: 1 }], p_table_id: table.id }),
        /occupied/);

    // Privacy: another customer cannot read this order
    assert.equal(await rpc(other, 'get_order', { p_id: orderId }), null);
    const { data: visible } = await other.from('orders').select('id');
    assert.equal(visible.length, 0);

    // Bill request covers both orders on the table
    await rpc(c, 'request_bill', { p_order_id: orderId });
    const mine = await rpc(c, 'my_orders');
    assert.ok(mine.every(o => o.status === 'bill_requested'));

    // Customer cannot mark their own order paid
    await assert.rejects(rpc(c, 'record_payment', { p_order_id: orderId, p_method: 'cash', p_amount: 999 }), /Not authorized/);

    // Admin takes payment: points awarded, table freed only after the last order
    await rpc(admin, 'record_payment', { p_order_id: orderId, p_method: 'cash', p_amount: 399 });
    let t = (await admin.from('dining_tables').select().eq('id', table.id).single()).data;
    assert.equal(t.status, 'occupied');
    const second = mine.find(o => o._id !== orderId);
    await rpc(admin, 'record_payment', { p_order_id: second._id, p_method: 'online', p_amount: second.total });
    t = (await admin.from('dining_tables').select().eq('id', table.id).single()).data;
    assert.equal(t.status, 'available');

    const points = await rpc(c, 'my_loyalty_points');
    // Points are earned on spend after discount, before tax: (400 - 20) + 2 lattes * 5 bonus = 390; second order 100
    assert.equal(points.currentPoints, 390 + 100);
});

test('loyalty offer spends points and cancellation refunds them', async () => {
    const offer = (await admin.from('loyalty_offers').insert({
        name: 'Free cake', points_required: 100, discount_value: 100,
    }).select().single()).data;
    const c = await customer('Meera', 3); // same phone as above, has points
    const before = (await rpc(c, 'my_loyalty_points')).currentPoints;
    const id = await rpc(c, 'place_order', {
        p_items: [{ menuItem: cake.id, quantity: 2 }], p_loyalty_offer_id: offer.id,
    });
    assert.equal((await rpc(c, 'get_order', { p_id: id })).discount, 100);
    assert.equal((await rpc(c, 'my_loyalty_points')).currentPoints, before - 100);
    await rpc(admin, 'update_order_status', { p_order_id: id, p_status: 'cancelled' });
    assert.equal((await rpc(c, 'my_loyalty_points')).currentPoints, before);
});

test('unavailable items cannot be ordered', async () => {
    await admin.from('menu_items').update({ is_available: false }).eq('id', cake.id);
    const c = await customer('Late', 5);
    await assert.rejects(rpc(c, 'place_order', { p_items: [{ menuItem: cake.id, quantity: 1 }] }), /not available/);
    await admin.from('menu_items').update({ is_available: true }).eq('id', cake.id);
});

test('back office data is admin-only', async () => {
    const c = await customer('Nosy', 6);
    await admin.from('employees').insert({ name: 'Chef', phone: '9000000000' });
    const { data } = await c.from('employees').select();
    assert.equal(data.length, 0);
    const { error } = await c.from('menu_items').update({ price: 1 }).eq('id', latte.id).select();
    const { data: still } = await c.from('menu_items').select('price').eq('id', latte.id).single();
    assert.ok(error || still.price === 150);
    await assert.rejects(rpc(c, 'dashboard_stats'), /Not authorized/);
    await assert.rejects(rpc(c, 'admin_orders', {}), /Not authorized/);
});

test('admin analytics return the expected shapes', async () => {
    const dash = await rpc(admin, 'dashboard_stats');
    assert.ok(dash.today.revenue >= 504);
    const rev = await rpc(admin, 'revenue_series', { p_period: 'week' });
    assert.ok(rev.length >= 1 && rev[0]._id && 'profit' in rev[0]);
    const cats = await rpc(admin, 'category_sales', { p_period: 'month' });
    assert.ok(cats.find(x => x._id === `Coffee ${run}`));
    const top = await rpc(admin, 'top_items');
    assert.ok(top[0].totalQuantity > 0);
    const users = await rpc(admin, 'user_analytics', { p_period: 'month' });
    assert.ok(users.totalUsers >= 5 && Array.isArray(users.topCustomers));
    const custs = await rpc(admin, 'customer_analytics', { p_search: 'Meera' });
    assert.equal(custs.customers[0].name, 'Meera');
    const detail = await rpc(admin, 'customer_detail', { p_customer_id: custs.customers[0]._id });
    assert.ok(detail.recentOrders.length >= 2);
    const found = await rpc(admin, 'search_orders', { p_search: 'meera' });
    assert.ok(found.pagination.total >= 3);
});

test('attendance on a holiday is marked holiday', async () => {
    const emp = (await admin.from('employees').insert({ name: 'Waiter', phone: '9000000001' }).select().single()).data;
    const day = `2030-01-${String(Number(run) % 28 + 1).padStart(2, '0')}`;
    await admin.from('holidays').insert({ date: day, name: 'Festival' });
    const { data } = await admin.from('attendance')
        .upsert({ employee_id: emp.id, date: day, status: 'present' }, { onConflict: 'employee_id,date' })
        .select().single();
    assert.equal(data.status, 'holiday');
});

test('turning on OTP login blocks the no-OTP sign in', async () => {
    await must(admin.from('settings').update({ value: true }).eq('key', 'otp_login_enabled'));
    try {
        const c = client();
        await c.auth.signInAnonymously();
        await assert.rejects(rpc(c, 'customer_sign_in', { p_name: 'X', p_phone: phone(8) }), /OTP verification required/);
    } finally {
        await must(admin.from('settings').update({ value: false }).eq('key', 'otp_login_enabled'));
    }
});

test('customer receives live order updates', async () => {
    const c = await customer('Live', 7);
    const id = await rpc(c, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 1 }] });
    const got = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no realtime event')), 15000);
        c.channel('t').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (p) => {
            if (p.new.id === id && p.new.status !== 'pending') { clearTimeout(timer); resolve(p.new.status); }
        }).subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await new Promise(r => setTimeout(r, 1000));
                await rpc(admin, 'update_order_status', { p_order_id: id, p_status: 'preparing' });
            }
        });
    });
    assert.equal(await got, 'preparing');
    await c.removeAllChannels();
});

// Realtime sockets keep the process alive; exit once all tests have reported
after(() => setTimeout(() => process.exit(), 100));
