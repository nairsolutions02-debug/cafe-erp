// Phase 6 checks: reward rules (nth order, spend, budget pause, multiplier, birthday), customer-only coupons,
// WhatsApp to-do, customer portal, Instagram verification, dish feedback, groups, staff incentives in payroll.
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
async function customer(slug, name, phone) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone });
    return c;
}

const saEmail = `sa6-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `rew-a-${run}`, slugB = `rew-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Rewards A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `Rewards B ${run}`, p_slug: slugB, p_plan_id: plans.find(p => p.name === 'Starter').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const owner = await staffLogin(slugA, ph(1), '1111');
// Shift balance: money is taken only inside an open shift of the drawer
await rpc(owner, 'open_shift', { p_drawer: 'cash_counter', p_denoms: {} });
const ownerB = await staffLogin(slugB, ph(2), '2222');
// These checks predate the FiKA Club: neutral club rules so its tiers and monthly milestones don't add points here
await rpc(owner, 'save_club_config', { p: { tiers: [{ name: 'Member', color: '#888888', orders: 0, multiplier: 1, pct: 0 }], levels: [],
    birthday: { askAtSignin: true, before: 0, after: 7, minOrders: 0, minAccountDays: 0, bonusPoints: 0 } } });
await must(service.from('reward_rules').update({ is_active: false }).eq('trigger_kind', 'month_milestone')
    .eq('tenant_id', (await must(service.from('tenants').select('id').eq('slug', slugA).single())).id));
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
const cashierStaff = await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
const cashier = await staffLogin(slugA, ph(10), '1010');

const cat = await must(owner.from('categories').insert({ name: 'Drinks' }).select().single());
const dessertCat = await must(owner.from('categories').insert({ name: 'Desserts' }).select().single());
const coffee = await must(owner.from('menu_items').insert({ name: 'Coffee', price: 100, price_includes_tax: true, category_id: cat.id }).select().single());
const brownie = await must(owner.from('menu_items').insert({ name: 'Brownie', price: 120, price_includes_tax: true, category_id: dessertCat.id }).select().single());

const sell = (who, extra) => rpc(who, 'create_staff_order', { p: { channel: 'takeaway', payFullBy: 'cash', ...extra } });

test('every 3rd order gives a ₹50 coupon only that customer can use; WhatsApp to-do with the message', async () => {
    const ruleId = await rpc(owner, 'save_reward_rule', { p: { name: 'Every 3rd order', triggerKind: 'nth_order', triggerValue: 3,
        rewardType: 'flat_coupon', rewardValue: 50, perCustomerLimit: 0, expiryDays: 10,
        whatsappTemplate: 'Hi {name}, enjoy {reward}! Code {code} till {expiry}.' } });
    const first = await sell(cashier, { customerPhone: ph(50), customerName: 'Asha Rao', items: [{ menuItem: coffee.id, quantity: 1 }] });
    const ashaId = first.user._id;
    await sell(cashier, { customerId: ashaId, items: [{ menuItem: coffee.id, quantity: 1 }] });
    let todo = await rpc(owner, 'reward_todo', {});
    assert.equal(todo.length, 0);
    await sell(cashier, { customerId: ashaId, items: [{ menuItem: coffee.id, quantity: 1 }] });
    todo = await rpc(owner, 'reward_todo', {});
    assert.equal(todo.length, 1);
    const g = todo[0];
    assert.equal(g.title, 'Hit 3 orders');
    assert.match(g.code, /^R[0-9A-F]{6}$/);
    assert.match(g.message, new RegExp(`Hi Asha, enjoy ₹50 off coupon! Code ${g.code} till`));
    assert.equal(g.customer.phone, ph(50));
    assert.ok(g.canSend);
    const notes = await rpc(owner, 'my_notifications', { p_limit: 20 });
    assert.ok(notes.some(n => n.kind === 'reward' && /Asha Rao: Hit 3 orders/.test(n.title)));

    // Another customer can't use it; Asha can
    await assert.rejects(sell(cashier, { customerPhone: ph(51), customerName: 'Bina', items: [{ menuItem: coffee.id, quantity: 1 }], couponCode: g.code }),
        /belongs to another customer/);
    const asha = await customer(slugA, 'Asha Rao', ph(50));
    const mine = await rpc(asha, 'my_rewards', {});
    assert.equal(mine.coupons.length, 1);
    assert.equal(mine.coupons[0].code, g.code);
    assert.equal(mine.progress[0].left, 3);
    const used = await sell(cashier, { customerId: ashaId, items: [{ menuItem: coffee.id, quantity: 1 }], couponCode: g.code });
    assert.equal(used.total, 50);
    assert.equal((await rpc(asha, 'my_rewards', {})).coupons.length, 0);

    await rpc(cashier, 'mark_reward_sent', { p_grant: g.id });
    const all = await rpc(owner, 'reward_todo', { p_status: 'all' });
    assert.equal(all[0].status, 'sent');
    assert.equal(all[0].sentBy, 'Cashier Ravi');
    assert.ok(all[0].used);
    const rules = await rpc(owner, 'list_reward_rules', {});
    const r = rules.find(x => x.id === ruleId);
    assert.equal(r.thisMonth.count, 1);
    assert.equal(r.unitCost, 50);
    await rpc(owner, 'save_reward_rule', { p: { ...r, isActive: false } });
});

test('spend crosses ₹300 this month → 100 points, once; budget pauses a rule', async () => {
    await rpc(owner, 'save_reward_rule', { p: { name: 'Spend 300', triggerKind: 'spend_crosses', triggerValue: 300, triggerPeriod: 'month',
        rewardType: 'points', rewardValue: 100, perCustomerLimit: 1, perCustomerPeriod: 'month' } });
    const o = await sell(cashier, { customerPhone: ph(60), customerName: 'Chetan', items: [{ menuItem: coffee.id, quantity: 2 }] });
    const id = o.user._id;
    let c = await must(owner.from('customers').select('loyalty_points').eq('id', id).single());
    assert.equal(c.loyalty_points, 200);                       // 1 point per rupee on ₹200
    await sell(cashier, { customerId: id, items: [{ menuItem: coffee.id, quantity: 2 }] });
    c = await must(owner.from('customers').select('loyalty_points').eq('id', id).single());
    assert.equal(c.loyalty_points, 200 + 200 + 100);
    await sell(cashier, { customerId: id, items: [{ menuItem: coffee.id, quantity: 2 }] });
    c = await must(owner.from('customers').select('loyalty_points').eq('id', id).single());
    assert.equal(c.loyalty_points, 700);                       // not again this month
    const spend = (await rpc(owner, 'list_reward_rules', {})).find(x => x.name === 'Spend 300');
    await rpc(owner, 'save_reward_rule', { p: { ...spend, isActive: false } });

    // ₹60 budget, ₹50 per grant: the second grant pauses the rule
    const budgetRule = await rpc(owner, 'save_reward_rule', { p: { name: 'First order ₹50', triggerKind: 'first_order',
        rewardType: 'flat_coupon', rewardValue: 50, monthlyBudget: 60 } });
    await sell(cashier, { customerPhone: ph(61), customerName: 'D1', items: [{ menuItem: coffee.id, quantity: 1 }] });
    await sell(cashier, { customerPhone: ph(62), customerName: 'D2', items: [{ menuItem: coffee.id, quantity: 1 }] });
    const r = (await rpc(owner, 'list_reward_rules', {})).find(x => x.id === budgetRule);
    assert.equal(r.thisMonth.count, 1);
    assert.equal(r.pausedReason, 'Monthly budget used up');
    await rpc(owner, 'save_reward_rule', { p: { ...r, isActive: false } });
});

test('manual multiplier: double points for 7 days', async () => {
    const ruleId = await rpc(owner, 'save_reward_rule', { p: { name: 'Double points week', triggerKind: 'manual', rewardType: 'multiplier',
        rewardValue: 2, rewardDays: 7, perCustomerLimit: 1 } });
    const o = await sell(cashier, { customerPhone: ph(70), customerName: 'Esha', items: [{ menuItem: coffee.id, quantity: 2 }] });
    const id = o.user._id;
    await assert.rejects(rpc(cashier, 'give_reward', { p_rule: ruleId, p_customer: id }), /rewards.edit/);
    await rpc(owner, 'give_reward', { p_rule: ruleId, p_customer: id });
    await assert.rejects(rpc(owner, 'give_reward', { p_rule: ruleId, p_customer: id }), /Customer limit reached/);
    await sell(cashier, { customerId: id, items: [{ menuItem: coffee.id, quantity: 2 }] });
    const c = await must(owner.from('customers').select('loyalty_points').eq('id', id).single());
    assert.equal(c.loyalty_points, 200 + 400);
    const hist = await rpc(owner, 'customer_rewards', { p_customer: id });
    assert.ok(hist.some(h => h.reward === '200 extra points'));
});

test('Instagram: selfie + handle → queue → approve gives points; reject needs a reason', async () => {
    await rpc(owner, 'save_reward_rule', { p: { name: 'Instagram tag', triggerKind: 'instagram', rewardType: 'points', rewardValue: 50,
        perCustomerLimit: 1, perCustomerPeriod: 'week', conditions: { igKind: 'tag' } } });
    await sell(cashier, { customerPhone: ph(80), customerName: 'Farah', items: [{ menuItem: coffee.id, quantity: 1 }] });
    const farah = await customer(slugA, 'Farah', ph(80));
    const me = await rpc(farah, 'me', {});
    const custId = me._id;
    await assert.rejects(rpc(farah, 'submit_instagram_claim', { p_handle: '@farah.eats', p_kind: 'tag', p_selfie_path: '' }), /selfie/);
    const path = `${tenantA}/${custId}/ig-${run}.png`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const up = await farah.storage.from('customer-private').upload(path, png, { contentType: 'image/png' });
    assert.equal(up.error, null, up.error?.message);
    // another customer can't upload into Farah's folder
    const other = await customer(slugA, 'Gita', ph(81));
    const bad = await other.storage.from('customer-private').upload(`${tenantA}/${custId}/x-${run}.png`, png, { contentType: 'image/png' });
    assert.ok(bad.error);
    await rpc(farah, 'submit_instagram_claim', { p_handle: '@Farah.Eats', p_kind: 'tag', p_selfie_path: path });
    await assert.rejects(rpc(farah, 'submit_instagram_claim', { p_handle: 'farah.eats', p_kind: 'tag', p_selfie_path: path }), /under review/);
    assert.equal((await rpc(farah, 'my_rewards', {})).instagram[0].status, 'pending');
    const q = await rpc(owner, 'instagram_queue', {});
    assert.equal(q.length, 1);
    assert.equal(q[0].handle, 'farah.eats');
    const signed = await owner.storage.from('customer-private').createSignedUrl(q[0].selfiePath, 60);
    assert.equal(signed.error, null);
    await assert.rejects(rpc(ownerB, 'decide_instagram', { p_claim: q[0].id, p_approve: true }), /Not found/);
    const res = await rpc(owner, 'decide_instagram', { p_claim: q[0].id, p_approve: true });
    assert.equal(res.granted, 1);
    const pts = await must(owner.from('customers').select('loyalty_points').eq('id', custId).single());
    assert.equal(pts.loyalty_points, 100 + 50);

    await rpc(farah, 'submit_instagram_claim', { p_handle: 'farah.eats', p_kind: 'tag', p_selfie_path: path });
    const q2 = await rpc(owner, 'instagram_queue', {});
    await assert.rejects(rpc(owner, 'decide_instagram', { p_claim: q2[0].id, p_approve: false }), /reason/);
    await rpc(owner, 'decide_instagram', { p_claim: q2[0].id, p_approve: false, p_reason: 'Tag not found' });
    const mine = await rpc(farah, 'my_rewards', {});
    assert.equal(mine.instagram[0].status, 'rejected');
    assert.equal(mine.instagram[0].reason, 'Tag not found');
});

test('dish feedback after paying; overview per dish; low rating alert; reply and hide', async () => {
    const hina = await customer(slugA, 'Hina', ph(90));
    const id = await rpc(hina, 'place_order', { p_items: [{ menuItem: coffee.id, quantity: 1 }, { menuItem: brownie.id, quantity: 1 }] });
    await assert.rejects(rpc(hina, 'submit_dish_feedback', { p_order: id, p_ratings: [] }), /after paying/);
    await rpc(cashier, 'record_payment', { p_order_id: id, p_method: 'cash', p_amount: 220 });
    const form = await rpc(hina, 'order_feedback_form', { p_order: id });
    assert.equal(form.items.length, 2);
    assert.ok(form.canRate);
    await rpc(hina, 'submit_dish_feedback', { p_order: id, p_ratings: [
        { menuItemId: coffee.id, rating: 5 }, { menuItemId: brownie.id, rating: 2, comment: 'Too dry' }] });
    const other = await customer(slugA, 'Gita', ph(81));
    await assert.rejects(rpc(other, 'submit_dish_feedback', { p_order: id, p_ratings: [] }), /not found/);
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const ov = await rpc(owner, 'feedback_overview', { p_from: today, p_to: today });
    assert.equal(ov.dishes[0].name, 'Brownie');
    assert.equal(Number(ov.dishes[0].avg), 2);
    assert.equal(ov.comments[0].comment, 'Too dry');
    await rpc(owner, 'moderate_feedback', { p_id: ov.comments[0].id, p_reply: 'Sorry! We fixed the recipe.', p_hidden: true });
    const again = await rpc(hina, 'order_feedback_form', { p_order: id });
    assert.equal(again.items.find(i => i.name === 'Brownie').reply, 'Sorry! We fixed the recipe.');
    const notes = await rpc(owner, 'my_notifications', { p_limit: 30 });
    assert.ok(notes.some(n => n.kind === 'feedback' && /Brownie 2★/.test(n.title)));
});

test('portal texts and switches; birthday rule via the daily check; groups', async () => {
    await must(owner.from('settings').upsert({ key: 'portal_texts', value: { heading: 'Chai club' } }));
    await must(owner.from('settings').upsert({ key: 'portal_show', value: { points: false } }));
    await must(owner.from('settings').upsert({ key: 'google_review_url', value: 'https://g.page/r/test/review' }));
    const asha = await customer(slugA, 'Asha Rao', ph(50));
    const cfg = await rpc(asha, 'portal_config', {});
    assert.equal(cfg.texts.heading, 'Chai club');
    assert.equal(cfg.texts.instagram, 'Tag us on Instagram, earn a treat');
    assert.equal(cfg.show.points, false);
    assert.equal(cfg.googleReviewUrl, 'https://g.page/r/test/review');
    assert.equal((await rpc(asha, 'my_rewards', {})).points, null);

    const bday = await rpc(owner, 'save_reward_rule', { p: { name: 'Birthday', triggerKind: 'birthday', rewardType: 'flat_coupon', rewardValue: 100,
        perCustomerLimit: 1, perCustomerPeriod: 'year', expiryDays: 7, whatsappTemplate: 'Happy birthday {name}! {code}' } });
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    await rpc(asha, 'set_my_dates', { p_birthday: today, p_anniversary: null });
    await assert.rejects(rpc(asha, 'set_my_dates', { p_birthday: '2000-01-01', p_anniversary: null }), /already saved/);
    const res = await rpc(owner, 'run_reward_checks', {});
    assert.ok(res.granted >= 1);
    assert.equal((await rpc(owner, 'run_reward_checks', {})).skipped, true);
    const todo = await rpc(owner, 'reward_todo', {});
    assert.ok(todo.some(t => t.title === 'Happy birthday' && t.customer.name === 'Asha Rao'));
    assert.ok((await rpc(owner, 'list_reward_rules', {})).find(r => r.id === bday).estMonthlyCount > 0);

    const groups = await rpc(owner, 'customer_groups', { p_group: 'new' });
    assert.ok(groups.counts.new >= 1);
    assert.ok(groups.customers.length >= 1);
    // cashiers see masked phones and can't WhatsApp
    const g2 = await rpc(cashier, 'customer_groups', { p_group: 'new' });
    assert.ok(g2.customers.every(c => !c.canWhatsapp));
    // isolation
    // (every cafe starts with the FiKA Club milestone and birthday rules; cafe A's own rules never show in cafe B)
    const rulesB = await rpc(ownerB, 'list_reward_rules', {});
    assert.ok(!rulesB.some(r => r.id === bday));
    assert.ok(rulesB.filter(r => r.isActive).every(r => ['month_milestone', 'birthday'].includes(r.triggerKind)));
    assert.equal((await rpc(ownerB, 'reward_todo', {})).length, 0);
});

test('incentives: ₹5 per dessert by the cashier, target bonus, shown to the staff member and added to the payslip', async () => {
    await rpc(owner, 'save_incentive_rule', { p: { name: 'dessert sold', kind: 'per_item', categoryIds: [dessertCat.id], amount: 5 } });
    await rpc(owner, 'save_incentive_rule', { p: { name: 'Sales bonus', kind: 'target', threshold: 1000, amount: 200 } });
    await assert.rejects(rpc(cashier, 'save_incentive_rule', { p: { name: 'x', kind: 'per_item', categoryIds: [dessertCat.id], amount: 5 } }), /employees.edit/);
    await sell(cashier, { items: [{ menuItem: brownie.id, quantity: 3 }] });
    await sell(owner, { items: [{ menuItem: brownie.id, quantity: 2 }] });
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const month = today.slice(0, 8) + '01';
    const rep = await rpc(owner, 'incentive_report', { p_from: month, p_to: today });
    const ravi = rep.staff.find(s => s.name === 'Cashier Ravi');
    const dess = ravi.lines.filter(l => l.rule === 'dessert sold').reduce((a, l) => a + Number(l.amount), 0);
    assert.equal(dess, 15);
    assert.ok(ravi.lines.some(l => l.rule === 'Sales bonus' && Number(l.amount) === 200), 'cashier sold over ₹1,000 this month');
    const mine = await rpc(cashier, 'my_incentives', {});
    assert.equal(Number(mine.month), Number(ravi.total));
    assert.ok(mine.hints.some(h => /for every dessert sold/.test(h)));

    // Payroll for this month includes it for the linked employee
    const emp = await must(owner.from('employees').insert({ name: 'Ravi', phone: ph(10), role: 'cashier', salary: 15000,
        joining_date: '2026-01-01', staff_id: cashierStaff }).select().single());
    await rpc(owner, 'run_payroll', { p_month: month });
    const pr = await rpc(owner, 'get_payroll', { p_month: month });
    const slip = pr.slips.find(s => s.employeeId === emp.id);
    assert.equal(Number(slip.incentives), Number(ravi.total));
    assert.equal(Number(slip.net), Number(slip.gross) - Number(slip.deductions));
    assert.ok(Number(slip.gross) >= Number(ravi.total));
});
