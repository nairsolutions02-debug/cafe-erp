// Kiosk vs main shop menus: each item says where it is sold; the kiosk list, the counter and the customer
// menu follow it, and the server refuses orders for items not sold at that place.
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
async function staffLogin(slug, phone, pin) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    const res = await rpc(c, 'staff_pin_login', { p_phone: phone, p_pin: pin });
    assert.ok(res.ok, res.message);
    return c;
}

const saEmail = `sak-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `km-a-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `KioskMenu A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slugA, ph(1), '1111');
const cat = await must(owner.from('categories').insert({ name: 'Mixed' }).select().single());
const mk = (name, extra = {}) => must(owner.from('menu_items').insert({ name, price: 50, category_id: cat.id, ...extra }).select().single());
const both = await mk('Water bottle');
const shopOnly = await mk('Masala Dosa', { sold_at_kiosk: false });
const kioskOnly = await mk('Gold Flake', { sold_in_shop: false, is_restricted: true });

test('kiosk list shows only items sold at the kiosk', async () => {
    const names = (await rpc(owner, 'kiosk_items', {})).map(i => i.name);
    assert.ok(names.includes('Water bottle'));
    assert.ok(names.includes('Gold Flake'));
    assert.ok(!names.includes('Masala Dosa'));
});

test('server refuses an item at the wrong place', async () => {
    await assert.rejects(rpc(owner, 'create_staff_order', { p: { channel: 'kiosk', items: [{ menuItem: shopOnly.id, quantity: 1 }], payFullBy: 'cash', drawer: 'cash_kiosk' } }),
        /Masala Dosa is not sold at the kiosk/);
    await assert.rejects(rpc(owner, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: kioskOnly.id, quantity: 1 }], payFullBy: 'cash' } }),
        /Gold Flake is sold only at the kiosk/);
    const k = await rpc(owner, 'create_staff_order', { p: { channel: 'kiosk', items: [{ menuItem: kioskOnly.id, quantity: 1 }, { menuItem: both.id, quantity: 1 }], payFullBy: 'cash', drawer: 'cash_kiosk' } });
    assert.equal(k.status, 'paid');
    const t = await rpc(owner, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: shopOnly.id, quantity: 1 }], payFullBy: 'cash' } });
    assert.equal(t.status, 'paid');
});

test('customer QR menu: kiosk-only items are hidden and refused', async () => {
    const c = client(slugA);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: 'Asha', p_phone: ph(50) });
    const shown = await must(c.from('menu_items').select('name').eq('is_available', true).eq('sold_in_shop', true));
    assert.ok(!shown.some(i => i.name === 'Gold Flake'));
    await assert.rejects(rpc(c, 'place_order', { p_items: [{ menuItem: kioskOnly.id, quantity: 1 }] }), /sold only at the kiosk/);
    await rpc(c, 'place_order', { p_items: [{ menuItem: shopOnly.id, quantity: 1 }] });
});
