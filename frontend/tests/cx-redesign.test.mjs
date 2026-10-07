// Customer app redesign: dish sizes and choices, combos, favourites, the usual order, look settings, banner art.
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

const saEmail = `sa7-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `cxr-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Redesign ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
// Shift balance: money is taken only inside an open shift of the drawer
await rpc(owner, 'open_shift', { p_drawer: 'cash_counter', p_denoms: {} });
await must(owner.from('settings').upsert({ key: 'qr_accept_all', value: false }));
const tenantId = (await must(service.from('tenants').select('id').eq('slug', slug).single())).id;
const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
const dosa = await must(owner.from('menu_items').insert({ name: 'Dosa', price: 300, category_id: cat.id }).select().single());
const items = [{ menuItem: dosa.id, quantity: 1 }];
const putSetting = (key, value) => must(owner.from('settings').upsert({ key, value }));
const loyalty = (patch) => must(service.from('loyalty_settings').update(patch).eq('tenant_id', tenantId));
const givePoints = async (who, n) => {
    const me = (await rpc(who, 'me'));
    await must(service.from('customers').update({ loyalty_points: n }).eq('id', me.id));
};


const latte = await must(owner.from('menu_items').insert({ name: 'Latte', price: 200, category_id: cat.id }).select().single());
const croissant = await must(owner.from('menu_items').insert({ name: 'Croissant', price: 120, category_id: cat.id }).select().single());
const milk = await must(owner.from('option_groups').insert({ name: 'Milk', pick: 'one', choices: [
    { id: 'reg', name: 'Regular', price: 0, isDefault: true }, { id: 'oat', name: 'Oat', price: 40 }] }).select().single());
const flavour = await must(owner.from('option_groups').insert({ name: 'Flavour', pick: 'many', min_pick: 0, max_pick: 2, choices: [
    { id: 'haz', name: 'Hazelnut', price: 30 }, { id: 'car', name: 'Caramel', price: 30 }, { id: 'van', name: 'Vanilla', price: 25 }] }).select().single());
await must(owner.from('menu_items').update({
    sizes: [{ id: 's', name: 'Small', price: 180 }, { id: 'm', name: 'Medium', price: 200, isDefault: true }, { id: 'l', name: 'Large', price: 240 }],
    option_groups: [milk.id, flavour.id], pairs: [croissant.id], details: { calories: 210, show: { calories: true } },
}).eq('id', latte.id));

test('owner rules on sizes, choices and combos are checked', async () => {
    await assert.rejects(must(owner.from('menu_items').update({ sizes: [{ id: 'a', name: 'A', price: 1 }, { id: 'b', name: 'B', price: 2 }] }).eq('id', croissant.id)), /exactly one size/);
    await assert.rejects(must(owner.from('option_groups').insert({ name: 'Empty', choices: [] })), /at least one choice/);
    await assert.rejects(must(owner.from('combos').insert({ name: 'Bad', price: 10, slots: [{ name: 'X', items: [{ menuItem: crypto.randomUUID() }] }] })), /not on the menu/);
});

test('a dish is priced by size and choices on the server, with the choices for the kitchen', async () => {
    const guest = await customer(slug, 'Ravi', 31);
    const q = await rpc(guest, 'quote_lines', { p_items: [
        { menuItem: latte.id, quantity: 1, size: 'l', choices: ['oat', 'haz'], note: 'extra hot' },
        { menuItem: latte.id, quantity: 1 }] });
    assert.equal(q[0].name, 'Latte (Large)');
    assert.equal(Number(q[0].price), 240 + 40 + 30);
    assert.equal(q[0].note, 'Oat, Hazelnut · extra hot');
    assert.equal(Number(q[1].price), 200, 'nothing picked = default size and default milk');
    await assert.rejects(rpc(guest, 'quote_lines', { p_items: [{ menuItem: latte.id, quantity: 1, choices: ['haz', 'car', 'van'] }] }), /up to 2/);

    const id = await rpc(guest, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 2, size: 'l', choices: ['oat'] }] });
    const line = (await must(service.from('order_items').select().eq('order_id', id)))[0];
    assert.equal(Number(line.price), 280);
    assert.equal(Number(line.total), 560);
    assert.equal(line.note, 'Oat');
    assert.equal(line.options.size, 'l');
    assert.deepEqual(line.options.choices.map(c => c.id), ['oat']);
    const detail = await rpc(guest, 'dish_detail', { p_id: latte.id });
    assert.equal(detail.last.size, 'l', 'the dish page remembers how this customer had it');
    assert.equal(detail.groups.length, 2);
    assert.equal(detail.pairs[0].name, 'Croissant');
});

test('the counter can sell a dish with choices without a picker (defaults)', async () => {
    const sale = await rpc(owner, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: latte.id, quantity: 1, size: 's', choices: ['van'] }], payFullBy: 'cash' } });
    const line = (await must(service.from('order_items').select().eq('order_id', sale.id ?? sale.orderId ?? sale)))[0];
    assert.equal(line.name, 'Latte (Small)');
    assert.equal(Number(line.price), 180 + 25);
    assert.equal(line.options.size, 's');
});

test('combos: picks, upgrades and extra for bigger sizes; closed combos are refused', async () => {
    const combo = await must(owner.from('combos').insert({ name: 'Breakfast', price: 250, double_points: true, slots: [
        { name: 'Drink', items: [{ menuItem: latte.id, extra: 0 }] },
        { name: 'Bite', items: [{ menuItem: croissant.id, extra: 20 }] }] }).select().single());
    const guest = await customer(slug, 'Meena', 32);
    const onSale = await rpc(guest, 'combos_on_sale');
    assert.equal(onSale.length, 1);
    assert.equal(Number(onSale[0].save), 200 + 120 - 250);
    const q = await rpc(guest, 'quote_lines', { p_items: [{ combo: combo.id, quantity: 1, picks: [
        { menuItem: latte.id, size: 'l', choices: ['oat'] }, { menuItem: croissant.id }] }] });
    assert.equal(Number(q[0].price), 250 + 20 + (240 + 40 - 200));
    assert.equal(q[0].note, 'Latte (Large) [Oat] + Croissant');
    await assert.rejects(rpc(guest, 'quote_lines', { p_items: [{ combo: combo.id, quantity: 1, picks: [{ menuItem: croissant.id }, { menuItem: latte.id }] }] }), /not part of/);
    await assert.rejects(rpc(guest, 'quote_lines', { p_items: [{ combo: combo.id, quantity: 1, picks: [{ menuItem: latte.id }] }] }), /each part/);

    const id = await rpc(guest, 'place_order', { p_items: [{ combo: combo.id, quantity: 1, picks: [{ menuItem: latte.id }, { menuItem: croissant.id }] }] });
    const line = (await must(service.from('order_items').select().eq('order_id', id)))[0];
    assert.equal(line.combo_id, combo.id);
    assert.equal(line.menu_item_id, null);
    assert.equal(line.options.picks.length, 2);

    await must(owner.from('combos').update({ days: [(new Date().getDay() + 3) % 7] }).eq('id', combo.id));
    assert.equal((await rpc(guest, 'combos_on_sale')).length, 0, 'not today');
    await assert.rejects(rpc(guest, 'quote_lines', { p_items: [{ combo: combo.id, quantity: 1, picks: [{ menuItem: latte.id }, { menuItem: croissant.id }] }] }), /not on right now/);
    await must(owner.from('combos').update({ days: [] }).eq('id', combo.id));
});

test('favourites, the usual and the look settings', async () => {
    const guest = await customer(slug, 'Kabir', 33);
    assert.equal(await rpc(guest, 'toggle_favourite', { p_menu_item: latte.id }), true);
    let favs = await rpc(guest, 'my_favourites');
    assert.equal(favs[0].name, 'Latte');
    assert.equal(favs[0].hasChoices, true);
    assert.equal((await rpc(guest, 'dish_detail', { p_id: latte.id })).favourite, true);
    assert.equal(await rpc(guest, 'toggle_favourite', { p_menu_item: latte.id }), false);
    assert.equal((await rpc(guest, 'my_favourites')).length, 0);
    const other = await customer(slug, 'Zoya', 34);
    await rpc(other, 'toggle_favourite', { p_menu_item: croissant.id });
    assert.equal((await must(guest.from('customer_favourites').select())).length, 0, 'nobody sees another customer favourites');

    await rpc(guest, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 1, size: 'l', choices: ['oat', 'haz'] }] });
    await rpc(guest, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 1, size: 'l', choices: ['oat', 'haz'] }, { menuItem: croissant.id, quantity: 1 }] });
    const u = await rpc(guest, 'my_usual');
    assert.equal(u.usual.name, 'Latte');
    assert.equal(u.usual.options.size, 'l');
    assert.equal(u.lastOrder.length, 2);
    assert.ok(u.lastVisit);

    await putSetting('cx_look', { enabled: ['latte', 'espresso'], first: 'espresso', glass: 70 });
    const s = await rpc(guest, 'customer_screen');
    assert.equal(s.look.first, 'espresso');
    assert.equal(s.hasCombos, true);
});

test('banners keep drawn art, words in three languages, combo links and times', async () => {
    const combo = (await must(owner.from('combos').select('id')))[0];
    const saved = await rpc(owner, 'save_portal_banners', { p_banners: [
        { title: '2 for 299', titleHi: '2 सिर्फ़ 299 में', art: 'iced', style: 'saffron', linkType: 'combo', linkTo: combo.id, timeFrom: '00:00', timeTo: '23:59' }] });
    assert.equal(saved[0].art, 'iced');
    assert.equal(saved[0].titleHi, '2 सिर्फ़ 299 में');
    const guest = await customer(slug, 'Isha', 35);
    assert.equal((await rpc(guest, 'portal_config')).banners.length, 1);
    await assert.rejects(rpc(owner, 'save_portal_banners', { p_banners: [{ title: 'x', timeFrom: '25:00', timeTo: '' }] }), /times look like/);
    await assert.rejects(rpc(owner, 'save_portal_banners', { p_banners: [{ title: 'x', linkType: 'combo', linkTo: crypto.randomUUID() }] }), /pick a combo/);
});

test('a dish keeps a Hindi description; the standard rewards text has no emoji', async () => {
    await must(owner.from('menu_items').update({ description_hi: 'ठंडी कॉफ़ी' }).eq('id', latte.id));
    const guest = await customer(slug, 'Tara', 36);
    const row = await must(guest.from('menu_items').select('description_hi').eq('id', latte.id).single());
    assert.equal(row.description_hi, 'ठंडी कॉफ़ी');
    const cfg = await rpc(guest, 'portal_config');
    assert.doesNotMatch(cfg.texts.noRewards, /\p{Extended_Pictographic}/u);
});
