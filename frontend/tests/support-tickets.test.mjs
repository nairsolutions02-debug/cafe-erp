// Support tickets: staff raise a problem from the app, N.A.I.R. replies from the platform console.
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
const setSetting = (who, key, value) => must(who.from('settings').upsert({ key, value }));

const saEmail = `sast-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const mk = async (slug, n) => {
    await rpc(sa, 'sa_create_tenant', { p_name: `Help ${slug}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id,
        p_paid_until: '2099-01-01', p_owner_name: 'Owner', p_owner_phone: ph(n), p_owner_pin: '1111' });
    return staffLogin(slug, ph(n), '1111');
};
const ownerA = await mk(`help-a-${run}`, 1);
const ownerB = await mk(`help-b-${run}`, 2);
const roles = await must(ownerA.from('roles').select('id, name'));
await rpc(ownerA, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(3), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '3333' });
const cashier = await staffLogin(`help-a-${run}`, ph(3), '3333');

test('any staff member raises a ticket; numbers go 1, 2 per cafe; checks the text', async () => {
    await assert.rejects(rpc(cashier, 'create_support_ticket', { p: { subject: 'x', message: 'Printer not printing' } }), /short title/);
    const t1 = await rpc(cashier, 'create_support_ticket', { p: { category: 'problem', urgent: true, subject: 'Printer not printing',
        message: 'KOT button does nothing since morning', page: '/admin/pos', device: { ua: 'test', w: 360 } } });
    assert.equal(t1.number, 1);
    assert.equal(t1.author, 'Cashier Ravi');
    assert.equal(t1.status, 'open');
    const t2 = await rpc(ownerA, 'create_support_ticket', { p: { category: 'question', subject: 'How to add GST number', message: 'Where do I enter it?' } });
    assert.equal(t2.number, 2);
    // the other cafe sees none of them, and a customer cannot raise one
    assert.equal((await rpc(ownerB, 'my_support_tickets', {})).length, 0);
    const cust = await customer(`help-a-${run}`, 'Asha', 10);
    await assert.rejects(rpc(cust, 'create_support_ticket', { p: { subject: 'Hello there', message: 'test message' } }), /log in to the admin/);
    assert.equal((await must(cashier.from('support_tickets').select('id'))).length, 0, 'tables are not readable directly');
});

test('N.A.I.R. sees all tickets, replies; the cafe sees the reply and can answer back', async () => {
    const list = await rpc(sa, 'sa_support_tickets', { p_status: 'active' });
    const t = list.find(x => x.subject === 'Printer not printing' && x.cafe.slug === `help-a-${run}`);
    assert.ok(t.unread);
    assert.equal(t.authorPhone, ph(3));
    const r = await rpc(sa, 'reply_support_ticket', { p_id: t.id, p_body: 'Please restart the printer and try once.', p_status: 'waiting' });
    assert.equal(r.status, 'waiting');
    const mine = (await rpc(ownerA, 'my_support_tickets', {})).find(x => x.id === t.id);
    assert.equal(mine.unread, true);
    assert.equal(mine.messages[0].author, 'N.A.I.R. Solutions');
    assert.equal(mine.authorPhone, '');
    const back = await rpc(cashier, 'reply_support_ticket', { p_id: t.id, p_body: 'Restarted, still not printing' });
    assert.equal(back.status, 'open');
    await assert.rejects(rpc(cashier, 'reply_support_ticket', { p_id: t.id, p_body: '', p_status: 'resolved' }), /Only N.A.I.R./);
    await assert.rejects(rpc(ownerB, 'reply_support_ticket', { p_id: t.id, p_body: 'sneaky' }), /not found/);
    await rpc(sa, 'reply_support_ticket', { p_id: t.id, p_body: 'Fixed the printer setting remotely.', p_status: 'resolved' });
    assert.equal((await rpc(sa, 'sa_support_tickets', { p_status: 'resolved' })).some(x => x.id === t.id), true);
    await assert.rejects(rpc(ownerA, 'sa_support_tickets', {}), /Not authorized/);
});
