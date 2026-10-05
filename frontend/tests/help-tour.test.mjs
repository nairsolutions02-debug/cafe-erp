// Help layer: the guided tour is remembered per person (staff PIN login or owner), not per phone.
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
const slug = `tour-${run}`;
const owner = await mkCafe(slug, 71);
const roles = await must(owner.from('roles').select('id, name'));
await rpc(owner, 'create_staff', { p_name: 'Cashier Tara', p_phone: ph(72), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '7272' });
const cashier = await staffLogin(slug, ph(72), '7272');

test('the tour is offered until the person finishes or skips it, and is remembered per person', async () => {
    assert.equal(await rpc(owner, 'my_tour_done'), false);
    assert.equal(await rpc(cashier, 'my_tour_done'), false);
    await rpc(cashier, 'mark_tour_done');
    assert.equal(await rpc(cashier, 'my_tour_done'), true);
    assert.equal(await rpc(owner, 'my_tour_done'), false, 'the owner still gets their own tour');
    const again = await staffLogin(slug, ph(72), '7272');
    assert.equal(await rpc(again, 'my_tour_done'), true, 'a new phone does not start it again');
    await rpc(cashier, 'mark_tour_done');
    assert.equal(await rpc(cashier, 'my_tour_done'), true);
});
