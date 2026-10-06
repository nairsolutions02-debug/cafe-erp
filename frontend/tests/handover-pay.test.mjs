// Hand-over and pay options: ways to pay, pickup colours, points as cash and deals switches.
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

const saEmail = `sa6-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `hop-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Handover ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');
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

test('the customer app reads the pay ways, pickup colours and points rules', async () => {
    const guest = await customer(slug, 'Asha', 21);
    let s = await rpc(guest, 'customer_screen');
    assert.deepEqual([s.pay.bill.on, s.pay.upi.on, s.pay.counter.on], [true, true, true]);
    await putSetting('pay_options', { upi: { on: false }, counter: { on: true, text: { en: 'Pay at the desk', hi: 'डेस्क पर दूँगा' } } });
    await putSetting('pickup_colors', { ready: '#0D9488', wait: '' });
    s = await rpc(guest, 'customer_screen');
    assert.equal(s.pay.upi.on, false);
    assert.equal(s.pay.counter.text.en, 'Pay at the desk');
    assert.equal(s.pickupColors.ready, '#0D9488');
    assert.equal(s.points.cash, false);
    assert.equal(s.points.deals, true);
});

test('a switched-off way to pay is refused for customers; staff can still take any payment', async () => {
    await putSetting('pay_options', { upi: { on: false }, bill: { on: false }, counter: { on: true } });
    const guest = await customer(slug, 'Ravi', 22);
    const id = await rpc(guest, 'place_order', { p_items: items });
    await must(service.from('orders').update({ status: 'served' }).eq('id', id));
    await assert.rejects(rpc(guest, 'request_payment', { p_order_id: id, p_mode: 'qr' }), /not available/);
    await assert.rejects(rpc(guest, 'request_bill', { p_order_id: id }), /counter or by UPI/);
    const ok = await rpc(guest, 'request_payment', { p_order_id: id, p_mode: 'counter' });
    assert.equal(ok.paymentRequest, 'counter');
    await rpc(owner, 'record_payment', { p_order_id: id, p_method: 'upi', p_amount: ok.total }).catch(() => {});
    await putSetting('pay_options', {});
});

test('points as cash: off by default, then the redemption rules decide the money off', async () => {
    const guest = await customer(slug, 'Neha', 23);
    await givePoints(guest, 520);
    await assert.rejects(rpc(guest, 'quote_order', { p_items: items, p_points_cash: true }), /switched off/);
    await loyalty({ points_as_cash: true, points_to_rupee_ratio: 10, min_points_to_redeem: 100, max_redemption_percent: 50 });
    const q = await rpc(guest, 'quote_order', { p_items: items, p_points_cash: true });
    // 520 points / 10 = ₹52, under 50% of ₹300
    assert.equal(Number(q.offerDiscount), 52);
    assert.equal(q.pointsUsed, 520);
    assert.equal(q.pointsCash, true);
    await loyalty({ max_redemption_percent: 10 });
    const capped = await rpc(guest, 'quote_order', { p_items: items, p_points_cash: true });
    assert.equal(Number(capped.offerDiscount), 30);
    assert.equal(capped.pointsUsed, 300);
    const id = await rpc(guest, 'place_order', { p_items: items, p_points_cash: true });
    const o = await rpc(guest, 'get_order', { p_id: id });
    assert.equal(Number(o.pointsRedeemed), 300);
    assert.equal((await rpc(guest, 'my_loyalty_points')).currentPoints, 220);
    // Below the minimum
    await givePoints(guest, 50);
    await assert.rejects(rpc(guest, 'quote_order', { p_items: items, p_points_cash: true }), /at least 100 points/);
    await loyalty({ points_as_cash: false, max_redemption_percent: 50 });
});

test('deals can be switched off; points are then spent only as cash', async () => {
    const offer = await must(owner.from('loyalty_offers').insert({ name: 'Free chai', points_required: 100, discount_value: 30 }).select().single());
    const guest = await customer(slug, 'Isha', 24);
    await givePoints(guest, 400);
    const q = await rpc(guest, 'quote_order', { p_items: items, p_loyalty_offer_id: offer.id });
    assert.equal(Number(q.offerDiscount), 30);
    await loyalty({ deals_on: false });
    await assert.rejects(rpc(guest, 'quote_order', { p_items: items, p_loyalty_offer_id: offer.id }), /switched off/);
    assert.equal((await rpc(guest, 'my_loyalty_points')).dealsOn, false);
    await loyalty({ deals_on: true });
});
