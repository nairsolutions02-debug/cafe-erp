// Fix pack 4: accountant reads but does not decide, kiosk operator home page, stale kiosks free their slot.
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

const saEmail = `sa4-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `fx4-${run}`;
// Pro allows one kiosk
await rpc(sa, 'sa_create_tenant', {
    p_name: `Fix pack 4 ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Pro').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
const roles = await must(owner.from('roles').select('id, name, home_path'));
const roleId = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Anu Accountant', p_phone: ph(2), p_role_id: roleId('Accountant'), p_pin: '2222' });
await rpc(owner, 'create_staff', { p_name: 'Kiran Kiosk', p_phone: ph(3), p_role_id: roleId('Kiosk operator'), p_pin: '3333' });
await rpc(owner, 'create_staff', { p_name: 'Meena Manager', p_phone: ph(4), p_role_id: roleId('Manager'), p_pin: '4444' });
const accountant = await staffLogin(slug, ph(2), '2222');
const kiosk = await staffLogin(slug, ph(3), '3333');
const manager = await staffLogin(slug, ph(4), '4444');

test('the accountant reads profit suggestions but the owner or manager decides', async () => {
    await rpc(accountant, 'profit_suggestions', { p_status: 'open' });
    const fake = '00000000-0000-0000-0000-000000000000';
    await assert.rejects(rpc(accountant, 'decide_suggestion', { p_id: fake, p_decision: 'dismissed', p_reason: 'x' }), /Not authorized|permission/i);
    // The manager passes the rights check (and then finds no such suggestion)
    await rpc(manager, 'decide_suggestion', { p_id: fake, p_decision: 'dismissed', p_reason: 'x' })
        .then(() => {}, (e) => assert.doesNotMatch(e.message, /Not authorized|permission/i));
});

test('the kiosk operator opens on the Kiosk page', async () => {
    assert.equal(roles.find(r => r.name === 'Kiosk operator').home_path, '/admin/kiosk');
    assert.equal((await rpc(kiosk, 'me')).homePath, '/admin/kiosk');
});

test('a kiosk unused for 14 days gives its slot back; a recent one does not', async () => {
    const first = await rpc(kiosk, 'register_device', { p_kind: 'kiosk', p_name: 'Front kiosk' });
    await assert.rejects(rpc(kiosk, 'register_device', { p_kind: 'kiosk', p_name: 'New tablet' }), /plan allows 1 kiosk/);
    await must(service.from('devices').update({ last_seen_at: new Date(Date.now() - 15 * 864e5).toISOString() })
        .eq('code', first.code).eq('tenant_id', (await must(service.from('tenants').select('id').eq('slug', slug).single())).id));
    const second = await rpc(kiosk, 'register_device', { p_kind: 'kiosk', p_name: 'New tablet' });
    assert.notEqual(second.code, first.code);
    const back = await rpc(kiosk, 'touch_device', { p_code: first.code });
    assert.equal(back.ok, false);
});
