// Kitchen stations: each category belongs to the hot kitchen, the coffee bar or the cold counter;
// kitchen_orders tells the kitchen screen which station each dish is for.
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

const saEmail = `ksst-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `kst-${run}`;
await rpc(sa, 'sa_create_tenant', { p_name: `Stations ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id,
    p_paid_until: '2099-01-01', p_owner_name: 'Owner', p_owner_phone: ph(61), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(61), '1111');

test('dishes carry the station of their category, sub-categories follow the parent, no station means hot kitchen', async () => {
    const drinks = await must(owner.from('categories').insert({ name: 'Drinks', kitchen_station: 'bar' }).select().single());
    const shakes = await must(owner.from('categories').insert({ name: 'Thick ones', parent_id: drinks.id }).select().single());
    const sweets = await must(owner.from('categories').insert({ name: 'Mithai', kitchen_station: 'cold' }).select().single());
    const meals = await must(owner.from('categories').insert({ name: 'Meals' }).select().single());
    const mk = (name, cat) => must(owner.from('menu_items').insert({ name, price: 100, category_id: cat }).select().single());
    const latte = await mk('Latte', drinks.id);
    const oreo = await mk('Oreo Shake', shakes.id);
    const barfi = await mk('Barfi', sweets.id);
    const thali = await mk('Thali', meals.id);
    const loose = await mk('Water', null);
    await assert.rejects(must(owner.from('categories').update({ kitchen_station: 'grill' }).eq('id', meals.id)));

    const guest = await customer(slug, 'Neha', 62);
    await rpc(guest, 'place_order', { p_items: [latte, oreo, barfi, thali, loose].map(m => ({ menuItem: m.id, quantity: 1 })) });
    const [ticket] = await rpc(owner, 'kitchen_orders');
    const station = Object.fromEntries(ticket.items.map(i => [i.name, i.station]));
    assert.deepEqual(station, { Latte: 'bar', 'Oreo Shake': 'bar', Barfi: 'cold', Thali: 'hot', Water: 'hot' });

    await must(owner.from('categories').update({ kitchen_station: 'cold' }).eq('id', shakes.id));
    const [again] = await rpc(owner, 'kitchen_orders');
    assert.equal(again.items.find(i => i.name === 'Oreo Shake').station, 'cold');
});
