// Phase 7 checks: menu matrix, profit suggestions with impact and working, price change from a suggestion,
// dismiss/snooze, outcomes after 4 weeks, forecast vs target, expense spike, Swiggy/Zomato CSV import.
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
const ph = (n) => `5${run}${String(n).padStart(3, '0')}`;

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

const saEmail = `sa7-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `pro-a-${run}`, slugB = `pro-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Profit A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `Profit B ${run}`, p_slug: slugB, p_plan_id: plans.find(p => p.name === 'Starter').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const owner = await staffLogin(slugA, ph(1), '1111');
const ownerB = await staffLogin(slugB, ph(2), '2222');
const roles = await must(owner.from('roles').select('id, name'));
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '1010' });
const cashier = await staffLogin(slugA, ph(10), '1010');
const today = await rpc(owner, 'day_summary', {}).then(d => d.date);
const daysAgo = (n) => new Date(new Date(today + 'T00:00:00Z').getTime() - n * 864e5).toISOString().slice(0, 10);

const cat = await must(owner.from('categories').insert({ name: 'Cafe' }).select().single());
const mk = (name, price) => must(owner.from('menu_items').insert({ name, price, category_id: cat.id, price_includes_tax: false }).select().single());
const coffee = await mk('Coffee', 100);
const tea = await mk('Masala Tea', 50);
const cake = await mk('Cheesecake', 200);
const chips = await mk('Chips', 30);
const stock = async (name, unit, cost, item, qty) => {
    const id = await rpc(owner, 'save_stock_item', { p: { name, unit, openingStock: 100000, avgCost: cost } });
    await rpc(owner, 'save_recipe', { p_menu_item: item.id, p_lines: [{ itemId: id, quantity: qty }] });
    return id;
};
const milk = await stock('Milk', 'ml', 0.05, coffee, 200);   // ₹10
await stock('Tea leaf', 'g', 0.3, tea, 100);                  // ₹30
await stock('Cream cheese', 'g', 0.4, cake, 100);             // ₹40
await stock('Chips pack', 'pc', 20, chips, 1);                // ₹20
const sell = (item, qty) => rpc(owner, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: item.id, quantity: qty }], payFullBy: 'cash' } });
for (let i = 0; i < 4; i++) { await sell(coffee, 5); await sell(tea, 5); }
await sell(cake, 5);
await sell(chips, 5);

test('menu matrix: star, plowhorse, puzzle, dog', async () => {
    const m = await rpc(owner, 'menu_matrix', { p_from: daysAgo(29), p_to: today });
    const cls = Object.fromEntries(m.items.map(i => [i.name, i.class]));
    assert.deepEqual(cls, { Coffee: 'star', 'Masala Tea': 'plowhorse', Cheesecake: 'puzzle', Chips: 'dog' });
    assert.equal(Number(m.popularityThreshold), 8.8);    // 50 units / 4 items × 70%
    await assert.rejects(rpc(cashier, 'menu_matrix', { p_from: today, p_to: today }), /Not authorized/);
});

test('profit checks: ranked suggestions with impact, formula and inputs; change price from a suggestion', async () => {
    await assert.rejects(rpc(cashier, 'run_profit_checks', {}), /Not authorized/);
    await rpc(owner, 'run_profit_checks', {});
    const s = await rpc(owner, 'profit_suggestions', {});
    const byTitle = (re) => s.items.find(i => re.test(i.title));
    const raise = byTitle(/^Raise Masala Tea from ₹50 to ₹55$/);
    assert.ok(raise, s.items.map(i => i.title).join(' | '));
    // 20 cups × 95% × (₹20 + ₹5/1.05) − 20 × ₹20
    assert.equal(Number(raise.impact), Math.round(20 * 0.95 * (20 + 5 / 1.05) - 20 * 20));
    assert.match(raise.formula, /units × 95%/);
    assert.ok(raise.inputs.some(x => x.label === 'Sold (30 days)' && Number(x.value) === 20));
    assert.ok(byTitle(/^Masala Tea food cost 60% vs 32% target$/));
    assert.ok(byTitle(/^Promote Cheesecake$/));
    assert.ok(byTitle(/^Rework or remove Chips$/));
    assert.ok(!byTitle(/Coffee/), 'stars get no suggestion');
    // biggest impact first within a priority
    const p2 = s.items.filter(i => i.priority === 2).map(i => Number(i.impact));
    assert.deepEqual(p2, [...p2].sort((a, b) => b - a));

    const price = raise.actions.find(a => a.kind === 'price');
    await assert.rejects(rpc(cashier, 'apply_suggestion_price', { p_id: raise.id, p_price: price.price }), /menu.edit/);
    await rpc(owner, 'apply_suggestion_price', { p_id: raise.id, p_price: price.price });
    assert.equal(Number((await must(owner.from('menu_items').select('price').eq('id', tea.id).single())).price), 55);
    const acc = (await rpc(owner, 'profit_suggestions', { p_status: 'decided' })).items.find(i => i.id === raise.id);
    assert.equal(acc.status, 'accepted');
    assert.equal(acc.decidedBy, 'Owner A');

    const dog = byTitle(/^Rework or remove Chips$/);
    await assert.rejects(rpc(owner, 'decide_suggestion', { p_id: dog.id, p_decision: 'dismissed' }), /Say why/);
    await rpc(owner, 'decide_suggestion', { p_id: dog.id, p_decision: 'dismissed', p_reason: 'Regulars ask for it' });
    const puzzle = byTitle(/^Promote Cheesecake$/);
    await rpc(owner, 'decide_suggestion', { p_id: puzzle.id, p_decision: 'snoozed', p_days: 14 });
    await rpc(owner, 'run_profit_checks', {});
    const after = await rpc(owner, 'profit_suggestions', {});
    assert.ok(!after.items.some(i => i.id === dog.id || i.id === puzzle.id || i.id === raise.id), 'decided ones stay out of the open list');
    assert.equal((await rpc(ownerB, 'profit_suggestions', {})).items.length, 0);
});

test('outcome after 4 weeks: what happened since the decision', async () => {
    const all = await rpc(owner, 'profit_suggestions', { p_status: 'decided' });
    const raise = all.items.find(i => /Raise Masala Tea/.test(i.title));
    await must(service.from('profit_suggestions').update({ decided_at: new Date(Date.now() - 30 * 864e5).toISOString() }).eq('id', raise.id));
    await rpc(owner, 'run_profit_checks', {});
    const again = (await rpc(owner, 'profit_suggestions', { p_status: 'decided' })).items.find(i => i.id === raise.id);
    assert.match(again.outcome, /^Done; 4 weeks later: sales [−+-]?\d+%, profit [−+]₹[\d,]+\/month$/);
});

test('forecast below the monthly target lists the biggest actions; expense spike vs its 3-month average', async () => {
    const cats = await must(owner.from('expense_categories').select('id, name'));
    const elec = cats.find(c => c.name === 'Electricity').id;
    for (const d of [40, 70, 100]) await rpc(owner, 'record_expense', { p: { categoryId: elec, amount: 1000, accountCode: 'bank', date: daysAgo(d) } });
    await rpc(owner, 'record_expense', { p: { categoryId: elec, amount: 3000, accountCode: 'bank', date: daysAgo(2) } });
    await must(owner.from('settings').upsert({ key: 'profit_target_monthly', value: 500000 }));
    await rpc(owner, 'run_profit_checks', {});
    const s = await rpc(owner, 'profit_suggestions', {});
    const f = s.items.find(i => i.check === 'forecast');
    assert.ok(f);
    assert.equal(f.priority, 1);
    assert.equal(s.items[0].priority, 1);
    assert.match(f.title, /vs ₹5,00,000 target this month/);
    assert.match(f.detail, /Biggest actions: /);
    const e = s.items.find(i => i.check === 'expense_up');
    assert.equal(e.title, 'Electricity +200% vs its average');
    assert.equal(Number(e.impact), 2000);
});

test('Swiggy CSV import: match items, orders with recipe cost and stock, payout in bank, commission as expense, no duplicates', async () => {
    const names = ['Coffee (Large)', 'Cheese cake slice'];
    const match = await rpc(owner, 'aggregator_match', { p_platform: 'swiggy', p_names: names });
    assert.equal(match.find(m => m.name === 'Coffee (Large)').menuItemId, coffee.id);
    const rows = [
        { orderId: 'SW1001', date: today, item: 'Coffee (Large)', qty: 2, amount: 240 },
        { orderId: 'SW1001', date: today, item: 'Cheese cake slice', qty: 1, amount: 220 },
        { orderId: 'SW1002', date: today, item: 'Coffee (Large)', qty: 1, amount: 120 },
    ];
    await assert.rejects(rpc(owner, 'import_aggregator', { p: { platform: 'swiggy', rows, commission: 116 } }), /Match these items to the menu first: Cheese cake slice/);
    await assert.rejects(rpc(cashier, 'import_aggregator', { p: { platform: 'swiggy', rows } }), /finance.create/);
    const milkBefore = (await rpc(owner, 'stock_overview', {})).find(i => i.id === milk).totalQuantity;
    const bank = async () => Number((await rpc(owner, 'account_balances', {})).find(b => b.code === 'bank').balance);
    const bankBefore = await bank();
    const res = await rpc(owner, 'import_aggregator', { p: { platform: 'swiggy', fileName: 'week40.csv', rows, commission: 116,
        mappings: { 'Coffee (Large)': coffee.id, 'Cheese cake slice': cake.id } } });
    assert.deepEqual([res.imported, res.skipped, Number(res.gross), Number(res.commission), Number(res.payout)], [2, 0, 580, 116, 464]);
    const milkAfter = (await rpc(owner, 'stock_overview', {})).find(i => i.id === milk).totalQuantity;
    assert.equal(Number(milkBefore) - Number(milkAfter), 600);     // 3 coffees × 200 ml
    const again = await rpc(owner, 'import_aggregator', { p: { platform: 'swiggy', rows, commission: 116 } });
    assert.deepEqual([again.imported, again.skipped, Number(again.commission)], [0, 2, 0]);
    const pnl = (await rpc(owner, 'pnl', { p_from: today, p_to: today })).current;
    const agg = pnl.channels.find(x => x.channel === 'aggregator');
    assert.equal(Number(agg.gross), 580);
    assert.equal(Number(agg.tax), 0);
    assert.ok(pnl.expenses.some(x => x.category === 'Aggregator commission' && Number(x.amount) === 116));
    assert.equal(await bank() - bankBefore, 464);
    const imports = await rpc(owner, 'list_aggregator_imports', {});
    assert.equal(imports.find(i => i.fileName === 'week40.csv').orders, 2);
    assert.equal((await rpc(ownerB, 'list_aggregator_imports', {})).length, 0);
});
