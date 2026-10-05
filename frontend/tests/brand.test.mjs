// Brand & look: the owner saves the cafe name, logo and details as settings; customers of that cafe read them,
// staff without the Settings permission cannot change them, and other cafes never see them.
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
const slugA = `brand-a-${run}`;
const slugB = `brand-b-${run}`;
const owner = await mkCafe(slugA, 81);
const other = await mkCafe(slugB, 82);
const roles = await must(owner.from('roles').select('id, name'));
await rpc(owner, 'create_staff', { p_name: 'Cashier Neel', p_phone: ph(83), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '3333' });
const cashier = await staffLogin(slugA, ph(83), '3333');
const KEYS = ['restaurant_name', 'brand_tagline', 'brand_hero', 'brand_logo', 'brand_hours_days'];
const read = async (c) => Object.fromEntries((await must(c.from('settings').select('key, value').in('key', KEYS))).map(r => [r.key, r.value]));

test('owner saves the brand in one go; a customer of that cafe reads it; the other cafe does not', async () => {
    await must(owner.from('settings').upsert([
        { key: 'restaurant_name', value: 'Chai Adda' }, { key: 'brand_tagline', value: 'Kulhad chai · Durg' },
        { key: 'brand_hero', value: 'Fresh chai every morning' }, { key: 'brand_logo', value: 'https://example.test/logo.webp' },
        { key: 'brand_hours_days', value: 'Mon - Sat' }]));
    const guest = client(slugA);
    const seen = await read(guest);
    assert.equal(seen.restaurant_name, 'Chai Adda');
    assert.equal(seen.brand_tagline, 'Kulhad chai · Durg');
    assert.equal(seen.brand_logo, 'https://example.test/logo.webp');
    const theirs = await read(client(slugB));
    assert.notEqual(theirs.restaurant_name, 'Chai Adda');
    assert.equal((await read(other)).brand_tagline, undefined);
});

test('a cashier cannot change the brand; only Settings people can upload a logo, and only to images/brand/', async () => {
    await must(cashier.from('settings').upsert({ key: 'brand_tagline', value: 'Hacked' })).catch(() => {});
    assert.equal((await read(owner)).brand_tagline, 'Kulhad chai · Durg');
    const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const up = await owner.storage.from('images').upload(`brand/${run}.png`, png, { contentType: 'image/png' });
    assert.equal(up.error, null);
    const bad = await cashier.storage.from('images').upload(`brand/${run}-x.png`, png, { contentType: 'image/png' });
    assert.ok(bad.error);
    await service.storage.from('images').remove([`brand/${run}.png`]);
});

test('the audit log names brand changes in plain words', async () => {
    await must(owner.from('settings').upsert({ key: 'brand_main', value: '#0F766E' }));
    const log = await must(owner.from('audit_log').select('summary, actor_name').eq('entity', 'settings')
        .order('at', { ascending: false }).limit(1).single());
    assert.equal(log.summary, 'Brand & look: main colour');
    assert.equal(log.actor_name, 'Owner');
});
