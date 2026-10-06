// Full-screen order alert: customer bill requests ring once; staff requests do not.
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

const saEmail = `sao-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `oal-${run}`;
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

const alerts = async () => (await rpc(owner, 'my_notifications', {})).filter(n => n.kind === 'payment_request');

test('a customer asking for the bill raises one full-screen alert with the amount; asking again does not ring twice', async () => {
    const a = await customer(slug, 'Asha', 11);
    await setSetting(owner, 'table_confirm_first', false).catch(() => {});
    const o = await rpc(a, 'place_order', { p_items: items, p_table_code: await codeOf(t5) });
    const before = (await alerts()).length;
    await rpc(a, 'request_bill', { p_order_id: o });
    const after = await alerts();
    assert.equal(after.length, before + 1);
    const n = after.find(x => x.payload?.orderId === o);
    assert.ok(n, 'alert points at the order');
    assert.equal(n.priority, 'alarm');
    assert.match(n.title, /^Table 5 asks for the bill · ₹/);
    assert.equal(n.payload.mode, 'bill');
    await rpc(a, 'request_bill', { p_order_id: o });
    assert.equal((await alerts()).length, before + 1, 'no second ring');
});

test('staff asking for a bill do not raise an alert', async () => {
    const b = await customer(slug, 'Bina', 12);
    const o = await rpc(b, 'place_order', { p_items: items, p_table_code: await codeOf(t7) });
    const before = (await alerts()).length;
    await rpc(owner, 'request_bill', { p_order_id: o });
    assert.equal((await alerts()).length, before);
});
