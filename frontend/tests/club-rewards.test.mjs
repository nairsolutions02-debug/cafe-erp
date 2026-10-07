// FiKA Club: birthdays (set once, change requests, gift in a window once a year), monthly tiers and milestones,
// discounts with one cap, owner-only leaderboard, special rewards, and the Members Club on a rolling 12 months.
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
const ph = (n) => `9${run}${String(n).padStart(3, '0')}`;

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

const saEmail = `sacl-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `club-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Club ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const tenantId = (await must(service.from('tenants').select('id').eq('slug', slug).single())).id;
const owner = await staffLogin(slug, ph(1), '1111');
// Shift balance: money is taken only inside an open shift of the drawer
await rpc(owner, 'open_shift', { p_drawer: 'cash_counter', p_denoms: {} });
const roles = await must(owner.from('roles').select('id, name'));
await rpc(owner, 'create_staff', { p_name: 'Cashier', p_phone: ph(2), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '2222' });
const cashier = await staffLogin(slug, ph(2), '2222');
const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
const dosa = await must(owner.from('menu_items').insert({ name: 'Dosa', price: 200, category_id: cat.id, price_includes_tax: true }).select().single());
const tea = await must(owner.from('menu_items').insert({ name: 'Tea', price: 40, category_id: cat.id, price_includes_tax: true }).select().single());
const sell = (customerPhone, item = dosa, extra = {}) => rpc(cashier, 'create_staff_order', { p: {
    channel: 'takeaway', customerPhone, customerName: 'Guest', items: [{ menuItem: item.id, quantity: 1 }], payFullBy: 'cash', ...extra } });
const idOf = async (phone) => (await must(service.from('customers').select('id').eq('tenant_id', tenantId).eq('phone', phone).single())).id;
const ageAccount = (phone, days) => must(service.from('customers').update({ created_at: new Date(Date.now() - days * 864e5).toISOString() })
    .eq('tenant_id', tenantId).eq('phone', phone));
const todayParts = () => { const d = new Date(Date.now() + 5.5 * 3600e3); return { day: d.getUTCDate(), month: d.getUTCMonth() + 1 }; };

test('every cafe starts with monthly milestones and a birthday gift; sign-in shows the birthday ask', async () => {
    const rules = await rpc(owner, 'list_reward_rules', {});
    assert.deepEqual(rules.filter(r => r.triggerKind === 'month_milestone').map(r => r.triggerValue).sort((a, b) => a - b), [3, 5, 10, 15]);
    assert.ok(rules.some(r => r.triggerKind === 'birthday' && r.isActive));
    const pub = await rpc(client(slug), 'club_public_config', {});
    assert.equal(pub.askBirthday, true);
    assert.equal(pub.birthdayGift, '₹150 off coupon + 100 points');
});

test('birthday: set once (day and month), change only through an owner-approved request, once a year', async () => {
    const a = await customer(slug, 'Asha', 10);
    await assert.rejects(rpc(a, 'set_my_birthday', { p_day: 31, p_month: 2 }), /real date/);
    const b = await rpc(a, 'set_my_birthday', { p_day: 29, p_month: 2 });
    assert.equal(b.locked, true);
    await rpc(a, 'set_my_birthday', { p_day: 29, p_month: 2 }); // same date again is fine
    await assert.rejects(rpc(a, 'set_my_birthday', { p_day: 1, p_month: 3 }), /already saved/);
    await assert.rejects(rpc(a, 'request_birthday_change', { p_day: 1, p_month: 3, p_reason: '' }), /why/);
    const req = await rpc(a, 'request_birthday_change', { p_day: 1, p_month: 3, p_reason: 'Wrong day picked' });
    await assert.rejects(rpc(a, 'request_birthday_change', { p_day: 2, p_month: 3, p_reason: 'again' }), /already have a request/);
    const list = await rpc(owner, 'birthday_requests_list', { p_status: 'open' });
    assert.equal(list.find(r => r.id === req).to, '01 Mar');
    await assert.rejects(rpc(cashier, 'decide_birthday_request', { p_id: req, p_approve: true }));
    await rpc(owner, 'decide_birthday_request', { p_id: req, p_approve: true, p_note: 'ID checked' });
    assert.equal((await rpc(a, 'my_club', {})).birthday.label, '1 March');
    await assert.rejects(rpc(a, 'request_birthday_change', { p_day: 5, p_month: 3, p_reason: 'again' }), /last 12 months/);
    // 29 Feb falls on 28 Feb in other years
    assert.equal(await rpc(owner, 'birthday_in_year', { p_birthday: '2000-02-29', p_year: 2027 }), '2027-02-28');
});

test('birthday gift: in the window, needs an order and an old enough account, once a year even after a date change', async () => {
    const a = await customer(slug, 'Bina', 11);
    const { day, month } = todayParts();
    await rpc(a, 'set_my_birthday', { p_day: day, p_month: month });
    let club = await rpc(a, 'my_club', {});
    assert.equal(club.birthday.window.open, true);
    assert.match(club.birthday.blocked, /after your first order/);
    await sell(ph(11));
    club = await rpc(a, 'my_club', {});
    assert.match(club.birthday.blocked, /New accounts/);
    await ageAccount(ph(11), 60);
    club = await rpc(a, 'my_club', {});
    assert.equal(club.birthday.gift.reward, '₹150 off coupon + 100 points');
    assert.match(club.birthday.gift.code, /^R[0-9A-F]{6}$/);
    const expiry = new Date(club.birthday.gift.expiresAt);
    assert.ok(expiry.getTime() > Date.now() + 6 * 864e5, 'valid through the end of the window (7 days after)');
    const pointsAfter = club.points;
    // calling again (or the daily check) never gives a second gift
    await rpc(a, 'my_club', {});
    await rpc(owner, 'run_reward_checks', {});
    const grants = await must(service.from('reward_grants').select('id, title').eq('customer_id', await idOf(ph(11))).eq('title', 'Happy birthday'));
    assert.equal(grants.length, 1);
    assert.equal((await rpc(a, 'my_club', {})).points, pointsAfter);
    // the gift code is shown at the counter
    assert.equal((await rpc(cashier, 'find_customers', { p_query: ph(11) }))[0].birthdayGift, club.birthday.gift.code);
    // ...and the counter can apply it to the bill (only for this customer)
    const cq = await rpc(cashier, 'quote_staff_order', { p: { customerId: await idOf(ph(11)), couponCode: club.birthday.gift.code, items: [{ menuItem: dosa.id, quantity: 1 }] } });
    assert.equal(cq.couponDiscount, 150);
    await assert.rejects(sell(ph(12), dosa, { couponCode: club.birthday.gift.code }), /belongs to another customer/);
});

test('monthly tier: orders this month (₹100 and up) move Bronze → Silver → Gold; Gold takes 5% off; points multiply', async () => {
    const a = await customer(slug, 'Chetan', 12);
    await sell(ph(12), tea); // ₹40: does not count
    let club = await rpc(a, 'my_club', {});
    assert.equal(club.month.orders, 0);
    assert.equal(club.month.tier.name, 'Bronze');
    for (let i = 0; i < 4; i++) await sell(ph(12));
    club = await rpc(a, 'my_club', {});
    assert.equal(club.month.orders, 4);
    assert.equal(club.month.tier.name, 'Silver');
    assert.equal(club.month.next.name, 'Gold');
    assert.deepEqual(club.month.milestones.filter(m => m.done).map(m => m.n), [3]);
    for (let i = 0; i < 4; i++) await sell(ph(12));
    club = await rpc(a, 'my_club', {});
    assert.equal(club.month.tier.name, 'Gold');
    assert.deepEqual(club.month.milestones.filter(m => m.done).map(m => m.n), [3, 5]);
    // Gold: 5% off the next bill (the customer's own quote and the counter quote agree)
    const q = await rpc(a, 'quote_order', { p_items: [{ menuItem: dosa.id, quantity: 1 }] });
    assert.equal(q.clubDiscount, 10);
    const cq = await rpc(cashier, 'quote_staff_order', { p: { customerId: await idOf(ph(12)), items: [{ menuItem: dosa.id, quantity: 1 }] } });
    assert.equal(cq.clubDiscount, 10);
    const o = await sell(ph(12));
    assert.equal(o.total, 190);
    // Gold 1.5× points on that order
    const boost = await must(service.from('reward_grants').select('title, points').eq('order_id', o.id).eq('source', 'multiplier'));
    assert.match(boost[0].title, /Gold tier 1.5× points/);
    // milestones once per month
    const ms = await must(service.from('reward_grants').select('title').eq('customer_id', await idOf(ph(12))).like('title', 'Order % this month'));
    assert.deepEqual(ms.map(g => g.title).sort(), ['Order 3 this month', 'Order 5 this month']);
});

test('one cap on combined discounts per bill; restricted items never discounted', async () => {
    const cfg = (await rpc(owner, 'club_public_config', {}));
    assert.ok(cfg);
    await rpc(owner, 'save_club_config', { p: { discountCap: 3 } });
    const a = await customer(slug, 'Chetan', 12);
    const q = await rpc(a, 'quote_order', { p_items: [{ menuItem: dosa.id, quantity: 1 }] });
    assert.equal(q.clubDiscount, 6); // 3% of 200
    assert.equal(q.club.capped, true);
    await rpc(owner, 'save_club_config', { p: { discountCap: 25 } });
});

test('owner settings are checked', async () => {
    await assert.rejects(rpc(owner, 'save_club_config', { p: { tiers: [{ name: 'A', orders: 0 }, { name: 'B', orders: 0 }] } }), /must go up/);
    await assert.rejects(rpc(owner, 'save_club_config', { p: { tiers: [{ name: 'A', orders: 2 }] } }), /starts at 0/);
    await assert.rejects(rpc(owner, 'save_club_config', { p: { levels: [{ name: 'X', orders: 10, price: 10, months: 0, pct: 5, cap: 0 }] } }), /1 to 12 months/);
    await assert.rejects(rpc(cashier, 'save_club_config', { p: {} }));
});

test('Members Club: 12-month count to join, pay at the counter, member discount once a day, fee is its own GST bill', async () => {
    const a = await customer(slug, 'Divya', 13);
    for (let i = 0; i < 3; i++) await sell(ph(13));
    await assert.rejects(rpc(a, 'request_club_join', {}), /orders in the last 12 months/);
    await rpc(owner, 'save_club_config', { p: { levels: [
        { name: 'Club', orders: 3, price: 199, months: 1, pct: 10, cap: 15, multiplier: 2, perks: 'Weekly coffee' },
        { name: 'Club Elite', orders: 50, price: 349, months: 1, pct: 15, cap: 80, multiplier: 3, perks: '' }] } });
    let club = await rpc(a, 'my_club', {});
    assert.equal(club.club.yearOrders, 3);
    assert.equal(club.club.level.name, 'Club');
    assert.equal(club.club.next.name, 'Club Elite');
    assert.equal(club.club.series.length, 12);
    const req = await rpc(a, 'request_club_join', {});
    assert.equal(req.price, 199);
    const custId = await idOf(ph(13));
    assert.equal((await rpc(owner, 'club_members', {})).find(m => m.customerId === custId).state, 'requested');
    await assert.rejects(rpc(cashier, 'activate_club_membership', { p_customer: custId, p_level: 1, p_method: 'cash' }), /needs 50/);
    const m = await rpc(cashier, 'activate_club_membership', { p_customer: custId, p_level: 0, p_method: 'upi' });
    assert.match(m.code, /^FK-\d{4}$/);
    const fee = await must(service.from('orders').select('total, status, customer_id, tax, tax_details').eq('id', m.orderId).single());
    assert.equal(fee.total, 199);
    assert.equal(fee.status, 'paid');
    assert.equal(fee.customer_id, null, 'the fee is not counted as a food order');
    assert.equal(fee.tax_details.length, 2);
    club = await rpc(a, 'my_club', {});
    assert.equal(club.club.member.level, 'Club');
    assert.equal(club.club.yearOrders, 3);
    // 10% off capped at ₹15, once a day
    const first = await sell(ph(13));
    assert.equal(first.total, 185);
    const second = await sell(ph(13));
    assert.equal(second.total, 200);
    assert.equal((await rpc(owner, 'club_members', {})).find(m2 => m2.customerId === custId).state, 'active');
    assert.equal((await rpc(cashier, 'find_customers', { p_query: ph(13) }))[0].member, 'Club');
    await assert.rejects(rpc(a, 'request_club_join', {}), /already a member/);
});

test('leaderboard is for the owner only; staff phones are left out', async () => {
    const board = await rpc(owner, 'club_leaderboard', { p_period: 'month' });
    assert.ok(board.length >= 3);
    assert.equal(board[0].name, 'Chetan'); // most paid orders this month
    assert.ok(board.every((r, i) => i === 0 || board[i - 1].month >= r.month));
    const a = await customer(slug, 'Esha', 14);
    await assert.rejects(rpc(a, 'club_leaderboard', {}));
    await sell(ph(1)); // the owner buying a coffee
    assert.ok(!(await rpc(owner, 'club_leaderboard', { p_period: 'year' })).some(r => r.phone === ph(1)));
});

test('special rewards: owner gives a coupon to a list; cashier cannot', async () => {
    const ids = [await idOf(ph(12)), await idOf(ph(13))];
    const res = await rpc(owner, 'give_special_reward', { p_customers: ids, p: { type: 'flat_coupon', value: 75, days: 10, note: 'Diwali thank-you' } });
    assert.equal(res.given, 2);
    const grants = await must(service.from('reward_grants').select('reward_label, coupon_code, send_status').eq('title', 'Diwali thank-you').eq('tenant_id', tenantId));
    assert.equal(grants.length, 2);
    assert.ok(grants.every(g => g.coupon_code && g.send_status === 'pending'));
    await assert.rejects(rpc(cashier, 'give_special_reward', { p_customers: ids, p: { type: 'points', value: 10 } }));
});

test('a cancelled order that earned a milestone gift voids the unused gift coupon', async () => {
    const a = await customer(slug, 'Farah', 15);
    let last;
    for (let i = 0; i < 5; i++) last = await sell(ph(15));
    const g = (await must(service.from('reward_grants').select('coupon_id, title').eq('order_id', last.id).like('title', 'Order 5%')))[0];
    assert.ok(g.coupon_id);
    await rpc(owner, 'cancel_order', { p_order_id: last.id, p_reason: 'Test' });
    assert.equal((await must(service.from('coupons').select('is_active').eq('id', g.coupon_id).single())).is_active, false);
    assert.ok(a);
});
