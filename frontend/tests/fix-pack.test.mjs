// Fix pack after the full test run: staff logins linked to employees, the owner setup checklist,
// and blocked deletes that remove nothing.
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

const saEmail = `brst-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const mkCafe = async (slug, n) => {
    await rpc(sa, 'sa_create_tenant', { p_name: `Brand ${slug}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id,
        p_paid_until: '2099-01-01', p_owner_name: 'Owner', p_owner_phone: ph(n), p_owner_pin: '1111' });
    return staffLogin(slug, ph(n), '1111');
};
const slug = `fix-${run}`;
const owner = await mkCafe(slug, 91);
const roles = await must(owner.from('roles').select('id, name'));
const roleId = (n) => roles.find(r => r.name === n).id;

test('a new staff login gets an employee record, so check-in works without linking by hand', async () => {
    await rpc(owner, 'create_staff', { p_name: 'Waiter Ravi', p_phone: ph(92), p_role_id: roleId('Waiter'), p_pin: '2222' });
    const emp = await must(owner.from('employees').select('name, role, staff_id').eq('phone', ph(92)));
    assert.equal(emp.length, 1);
    assert.equal(emp[0].role, 'waiter');
    assert.ok(emp[0].staff_id);
    const waiter = await staffLogin(slug, ph(92), '2222');
    assert.equal((await rpc(waiter, 'my_day')).linked, true);
});

test('an employee already on the books with the same phone is linked instead of duplicated', async () => {
    await must(owner.from('employees').insert({ name: 'Chef Sunita', phone: ph(93), role: 'chef', salary: 15000 }));
    await rpc(owner, 'create_staff', { p_name: 'Sunita', p_phone: ph(93), p_role_id: roleId('Chef'), p_pin: '3333' });
    const emp = await must(owner.from('employees').select('name, salary, staff_id').eq('phone', ph(93)));
    assert.equal(emp.length, 1);
    assert.equal(emp[0].name, 'Chef Sunita');
    assert.equal(Number(emp[0].salary), 15000);
    assert.ok(emp[0].staff_id);
});

test('setup status counts what is missing; link-all fixes unlinked logins; a cashier cannot read it', async () => {
    await rpc(owner, 'create_staff', { p_name: 'Cashier Neha', p_phone: ph(94), p_role_id: roleId('Cashier'), p_pin: '4444' });
    const neha = (await must(owner.from('employees').select('id').eq('phone', ph(94))))[0];
    await must(owner.from('employees').delete().eq('id', neha.id));
    let st = await rpc(owner, 'setup_status');
    assert.deepEqual(st.staffUnlinked, ['Cashier Neha']);
    assert.ok(st.staff >= 3);
    assert.equal(await rpc(owner, 'link_all_staff_employees'), 1);
    st = await rpc(owner, 'setup_status');
    assert.deepEqual(st.staffUnlinked, []);
    const cashier = await staffLogin(slug, ph(94), '4444');
    await assert.rejects(rpc(cashier, 'setup_status'), /Not authorized/);
    await assert.rejects(rpc(cashier, 'link_all_staff_employees'), /Not authorized/);
});

test('a blocked delete removes nothing (the app now says so instead of "deleted")', async () => {
    await must(owner.from('coupons').insert({ code: `FIX${run}`, discount_type: 'percentage', discount_value: 10,
        valid_from: new Date().toISOString(), valid_until: new Date(Date.now() + 864e5).toISOString() }));
    const cashier = await staffLogin(slug, ph(94), '4444');
    const c = (await must(owner.from('coupons').select('id').eq('code', `FIX${run}`)))[0];
    const del = await cashier.from('coupons').delete().eq('id', c.id).select('id');
    assert.equal(del.error, null);
    assert.equal(del.data.length, 0);
    assert.equal((await must(owner.from('coupons').select('id').eq('id', c.id))).length, 1);
});
