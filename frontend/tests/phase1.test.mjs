// Phase 1 checks: stock locations, purchases with weighted average cost, recipes and automatic
// deduction on sale (and put back on cancel), wastage, transfers, counts with variance in ₹,
// reorder alerts, usage breakdown, menu costing, permissions and cafe isolation.
// Run against a local stack: supabase db reset && npm run test:db
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
const ph = (n) => `7${run}${String(n).padStart(3, '0')}`;

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

// Platform + two cafes
const saEmail = `sa1-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const custom = (await rpc(sa, 'sa_overview')).plans.find(p => p.name === 'Custom');
const slugA = `stock-a-${run}`, slugB = `stock-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Stock A ${run}`, p_slug: slugA, p_plan_id: custom.id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `Stock B ${run}`, p_slug: slugB, p_plan_id: custom.id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const ownerA = await staffLogin(slugA, ph(1), '1111');
const ownerB = await staffLogin(slugB, ph(2), '2222');

const locs = await must(ownerA.from('stock_locations').select().order('sort_order'));
const loc = (n) => locs.find(l => l.name === n).id;
const stockOf = async (id, c = ownerA) => (await rpc(c, 'stock_overview', {})).find(i => i.id === id);
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} ≠ ${b}`);

// Catalogue
const cat = await must(ownerA.from('categories').insert({ name: 'Coffee' }).select().single());
const kioskCat = await must(ownerA.from('categories').insert({ name: 'Kiosk', stock_location_id: loc('Kiosk') }).select().single());
const latte = await must(ownerA.from('menu_items').insert({ name: 'Latte', price: 150, category_id: cat.id }).select().single());
const coke = await must(ownerA.from('menu_items').insert({
    name: 'Coke 300ml', price: 40, mrp: 40, price_includes_tax: true, item_type: 'resale', category_id: kioskCat.id,
}).select().single());
const vendor = await must(ownerA.from('vendors').insert({ name: 'Amul Dairy', phone: '9000000001', lead_time_days: 1, order_cycle_days: 2 }).select().single());

const milk = await rpc(ownerA, 'save_stock_item', { p: { name: 'Milk', category: 'ingredient', unit: 'ml', minimumStock: 0, vendorId: vendor.id } });
const beans = await rpc(ownerA, 'save_stock_item', { p: { name: 'Coffee beans', unit: 'g', openingStock: 1000, avgCost: 1.2 } });
await rpc(ownerA, 'save_stock_item', { p: { id: milk, name: 'Milk', unit: 'ml', units: [{ name: 'Litre', factor: 1000 }, { name: 'Crate', factor: 12000 }] } });

test('new cafes get Main store, Kitchen and Kiosk; opening stock lands at the main store', async () => {
    assert.deepEqual(locs.map(l => l.name), ['Main store', 'Kitchen', 'Kiosk']);
    assert.ok(locs.find(l => l.name === 'Main store').receives_purchases);
    assert.ok(locs.find(l => l.name === 'Kitchen').default_for_sales);
    const b = await stockOf(beans);
    assert.equal(b.quantity, 1000);
    assert.deepEqual(b.levels.map(l => [l.name, l.quantity]), [['Main store', 1000]]);
    close(b.value, 1200, 'opening value');
});

test('purchase in pack units: stock up, weighted average cost, payable, price alert', async () => {
    // 2 litres at ₹60 → 2000 ml at ₹0.06
    const p1 = await rpc(ownerA, 'record_purchase', { p: {
        vendorId: vendor.id, billNumber: 'A-1', lines: [{ itemId: milk, unitName: 'Litre', factor: 1000, quantity: 2, rate: 60 }] } });
    assert.equal(p1.total, 120);
    assert.equal(p1.due, 0);
    let m = await stockOf(milk);
    assert.equal(m.quantity, 2000);
    close(m.avgCost, 0.06, 'first avg');
    // 3 litres at ₹70 + 5% GST, paid ₹100 now → avg = (2000×0.06 + 220.5) ÷ 5000
    const p2 = await rpc(ownerA, 'record_purchase', { p: {
        vendorId: vendor.id, billNumber: 'A-2', paidAmount: 100,
        lines: [{ itemId: milk, unitName: 'Litre', factor: 1000, quantity: 3, rate: 70, taxRate: 5 }] } });
    assert.equal(p2.total, 220.5);
    assert.equal(p2.due, 120.5);
    assert.equal(p2.priceAlerts.length, 1, 'price rose more than 10%');
    assert.equal(p2.priceAlerts[0].item, 'Milk');
    m = await stockOf(milk);
    assert.equal(m.quantity, 5000);
    close(m.avgCost, (120 + 220.5) / 5000, 'weighted avg');
    const vendors = await rpc(ownerA, 'list_vendors');
    assert.equal(vendors.find(v => v.id === vendor.id).due, 120.5);
    await rpc(ownerA, 'pay_purchase', { p_id: p2.id, p_amount: 120.5, p_mode: 'upi' });
    assert.equal((await rpc(ownerA, 'list_vendors')).find(v => v.id === vendor.id).due, 0);
    await assert.rejects(rpc(ownerA, 'pay_purchase', { p_id: p2.id, p_amount: 1 }), /due/);
});

test('recipes set dish cost; each sale deducts from the right location; cancel puts it back', async () => {
    // Latte: 200 ml milk + 18 g beans with 10% waste
    const recipe = await rpc(ownerA, 'save_recipe', { p_menu_item: latte.id, p_lines: [
        { itemId: milk, quantity: 200 }, { itemId: beans, quantity: 18, wastePct: 10 }] });
    const milkAvg = (await stockOf(milk)).avgCost;
    close(recipe.cost, Math.round((200 * milkAvg + 18 * 1.1 * 1.2) * 100) / 100, 'recipe cost');
    assert.equal(recipe.saleLocation, 'Kitchen');
    // Coke: resale item tracked as its own stock, sold from the Kiosk (category location)
    const cokeStock = await rpc(ownerA, 'track_menu_item_stock', { p_menu_item: coke.id });
    await rpc(ownerA, 'record_purchase', { p: { locationId: loc('Kiosk'), lines: [{ itemId: cokeStock, unitName: 'Crate', factor: 24, quantity: 1, rate: 720 }] } });
    close((await stockOf(cokeStock)).avgCost, 30, 'coke cost per piece');

    // Milk and beans start at the main store; move some to the kitchen
    await rpc(ownerA, 'transfer_stock', { p: { fromId: loc('Main store'), toId: loc('Kitchen'),
        lines: [{ itemId: milk, quantity: 3000 }, { itemId: beans, quantity: 500 }] } });

    const c = await customer(slugA, 'Meera', ph(30));
    const orderId = await rpc(c, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 2 }, { menuItem: coke.id, quantity: 3 }] });
    let m = await stockOf(milk);
    assert.equal(m.quantity, 4600);
    assert.deepEqual(m.levels.map(l => [l.name, l.quantity]), [['Main store', 2000], ['Kitchen', 2600]]);
    assert.equal((await stockOf(beans)).quantity, 1000 - 39.6);
    const ck = await stockOf(cokeStock);
    assert.deepEqual(ck.levels.map(l => [l.name, l.quantity]), [['Kiosk', 21]]);
    // The order line remembers its cost
    const lines = await must(ownerA.from('order_items').select('name, unit_cost').eq('order_id', orderId));
    close(lines.find(l => l.name === 'Coke 300ml').unit_cost, 30, 'coke unit cost snapshot');

    await rpc(ownerA, 'update_order_status', { p_order_id: orderId, p_status: 'cancelled' });
    assert.equal((await stockOf(milk)).quantity, 5000);
    assert.equal((await stockOf(cokeStock)).quantity, 24);
    const moves = await rpc(ownerA, 'list_stock_moves', { p: { itemId: milk } });
    assert.ok(moves.some(x => x.kind === 'sale' && x.orderNumber) && moves.some(x => x.kind === 'sale_reversal'));
});

test('wastage, staff meal and adjustment are recorded with reasons; usage shows which dishes', async () => {
    const c = await customer(slugA, 'Kiran', ph(31));
    await rpc(c, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 1 }] });
    await rpc(ownerA, 'record_stock_change', { p: { kind: 'wastage', itemId: milk, locationId: loc('Kitchen'), quantity: 100, reason: 'Spoiled' } });
    await rpc(ownerA, 'record_stock_change', { p: { kind: 'staff_meal', itemId: milk, locationId: loc('Kitchen'), quantity: 100 } });
    await assert.rejects(rpc(ownerA, 'record_stock_change', { p: { kind: 'adjustment', itemId: milk, locationId: loc('Kitchen'), newQuantity: 2500 } }), /reason/);
    const usage = await rpc(ownerA, 'usage_breakdown', { p_item: milk, p_days: 7 });
    assert.equal(usage.total, 400);
    assert.deepEqual(usage.rows.map(r => [r.label, r.quantity, r.pct]), [['Latte', 200, 50], ['Staff meals', 100, 25], ['Wastage', 100, 25]]);
});

test('a count shows variance in ₹ and corrects stock; sales after counting are not a loss', async () => {
    const countId = await rpc(ownerA, 'start_count', { p_location: loc('Kitchen'), p_scope: 'all' });
    assert.equal(await rpc(ownerA, 'start_count', { p_location: loc('Kitchen'), p_scope: 'all' }), countId, 'one open count per location');
    const before = (await rpc(ownerA, 'get_count', { p_id: countId })).lines.find(l => l.itemId === milk).expected;
    assert.equal(before, 2600);
    await rpc(ownerA, 'save_count', { p_id: countId, p_lines: [{ itemId: milk, counted: 2500 }] });
    // A latte sold after the milk was counted
    const c = await customer(slugA, 'Late', ph(32));
    await rpc(c, 'place_order', { p_items: [{ menuItem: latte.id, quantity: 1 }] });
    const avg = (await stockOf(milk)).avgCost;
    const res = await rpc(ownerA, 'post_count', { p_id: countId });
    assert.equal(res.itemsOff, 1);
    close(res.varianceValue, -100 * avg, 'variance value');
    // 2600 expected − 100 missing − 200 sold after = 2300 in the kitchen
    const m = await stockOf(milk);
    assert.equal(m.levels.find(l => l.name === 'Kitchen').quantity, 2300);
    const leaks = await rpc(ownerA, 'stock_leaks', { p_days: 7 });
    const milkLeak = leaks.find(l => l.itemId === milk);
    assert.equal(milkLeak.countVariance, -100);
    assert.equal(milkLeak.wastage, 100);
    await assert.rejects(rpc(ownerA, 'post_count', { p_id: countId }), /closed/);
});

test('reorder alert fires before running out, with a suggested quantity', async () => {
    // Milk used ~700 ml over the item's first day; vendor lead 1 day + cycle 2 days
    const m = await stockOf(milk);
    assert.ok(m.dailyUse > 0);
    assert.equal(m.reorder, m.daysLeft <= 2);
    // Raise the reorder level above the stock: the alert must fire
    await rpc(ownerA, 'save_stock_item', { p: { id: milk, name: 'Milk', unit: 'ml', minimumStock: 99999 } });
    const m2 = await stockOf(milk);
    assert.ok(m2.reorder);
    assert.equal(m2.suggestedQty, Math.ceil(Math.max(m2.dailyUse * 3, 99999 * 2) - m2.totalQuantity));
    const alerts = await rpc(ownerA, 'inventory_alerts');
    assert.ok(alerts.reorder.some(x => x.id === milk));
    await rpc(ownerA, 'save_stock_item', { p: { id: milk, name: 'Milk', unit: 'ml', minimumStock: 0 } });
});

test('menu costing shows cost, margin and food cost %', async () => {
    const rows = await rpc(ownerA, 'menu_costing');
    const l = rows.find(r => r.name === 'Latte');
    assert.equal(l.costSource, 'recipe');
    close(l.margin, 150 - l.cost, 'margin');
    close(l.foodCostPct, Math.round(l.cost / 150 * 1000) / 10, 'food cost %');
    // Coke price includes 5% default tax → net 38.10, cost 30
    const k = rows.find(r => r.name === 'Coke 300ml');
    close(k.netPrice, 38.1, 'net price');
    close(k.cost, 30, 'coke cost');
});

test('the ledger cannot be edited and quantities only change through it', async () => {
    const { error } = await ownerA.from('inventory').update({ current_stock: 1 }).eq('id', milk);
    assert.ok(error || true);
    assert.notEqual((await stockOf(milk)).quantity, 1);
    const anyMove = (await rpc(ownerA, 'list_stock_moves', { p: { itemId: milk, limit: 1 } }))[0];
    await ownerA.from('stock_moves').update({ quantity: 1 }).eq('id', anyMove.id);
    await ownerA.from('stock_moves').delete().eq('id', anyMove.id);
    assert.equal((await rpc(ownerA, 'list_stock_moves', { p: { itemId: milk, limit: 1 } }))[0].quantity, anyMove.quantity);
    await assert.rejects(rpc(ownerA, 'delete_stock_item', { p_id: milk }), /recipes/);
    await assert.rejects(rpc(ownerA, 'save_stock_item', { p: { id: milk, name: 'Milk', unit: 'L' } }), /unit can't change/);
});

test('undoing a purchase takes the stock back out and unwinds the average cost', async () => {
    const sugar = await rpc(ownerA, 'save_stock_item', { p: { name: 'Sugar', unit: 'g' } });
    await rpc(ownerA, 'record_purchase', { p: { lines: [{ itemId: sugar, quantity: 1000, rate: 0.05 }] } });
    const p = await rpc(ownerA, 'record_purchase', { p: { lines: [{ itemId: sugar, quantity: 1000, rate: 0.07 }] } });
    close((await stockOf(sugar)).avgCost, 0.06, 'avg after two');
    await rpc(ownerA, 'void_purchase', { p_id: p.id });
    const s = await stockOf(sugar);
    assert.equal(s.quantity, 1000);
    close(s.avgCost, 0.05, 'avg after undo');
    await assert.rejects(rpc(ownerA, 'void_purchase', { p_id: p.id }), /already/);
});

test('permissions: chef sees stock without costs and can record wastage, not purchases; cashier sees nothing', async () => {
    const roles = await must(ownerA.from('roles').select('id, name'));
    const chefRole = roles.find(r => r.name === 'Chef').id;
    await must(ownerA.from('role_permissions').insert({ role_id: chefRole, perm: 'inventory.create' }));
    await rpc(ownerA, 'create_staff', { p_name: 'Chef Raju', p_phone: ph(40), p_role_id: chefRole, p_pin: '4040' });
    await rpc(ownerA, 'create_staff', { p_name: 'Cash Rani', p_phone: ph(41), p_role_id: roles.find(r => r.name === 'Cashier').id, p_pin: '4141' });
    const chef = await staffLogin(slugA, ph(40), '4040');
    const m = await stockOf(milk, chef);
    assert.equal(m.avgCost, null);
    assert.equal(m.value, null);
    assert.equal((await must(chef.from('inventory').select('id'))).length, 0, 'raw rows need see_cost');
    await rpc(chef, 'record_stock_change', { p: { kind: 'wastage', itemId: beans, locationId: loc('Kitchen'), quantity: 5, reason: 'Dropped' } });
    // Chef has inventory.create, so can enter a purchase but the list hides amounts
    const list = await rpc(chef, 'list_purchases', {});
    assert.ok(list.length > 0 && list[0].total === null);
    await assert.rejects(rpc(chef, 'post_count', { p_id: '00000000-0000-0000-0000-000000000000' }), /inventory.edit/);
    const cashier = await staffLogin(slugA, ph(41), '4141');
    await assert.rejects(rpc(cashier, 'stock_overview', {}), /inventory.view/);
    assert.equal((await must(cashier.from('stock_levels').select('item_id'))).length, 0);
});

test('cafes are isolated: B cannot see or move A\'s stock', async () => {
    assert.equal((await rpc(ownerB, 'stock_overview', {})).length, 0);
    assert.equal((await must(ownerB.from('vendors').select('id'))).length, 0);
    await assert.rejects(rpc(ownerB, 'record_stock_change', { p: { kind: 'wastage', itemId: milk, locationId: loc('Kitchen'), quantity: 1 } }), /not found/);
    await assert.rejects(rpc(ownerB, 'save_recipe', { p_menu_item: latte.id, p_lines: [] }), /not found/);
    const bLocs = await must(ownerB.from('stock_locations').select('id'));
    await assert.rejects(rpc(ownerB, 'transfer_stock', { p: { fromId: bLocs[0].id, toId: bLocs[1].id, lines: [{ itemId: milk, quantity: 1 }] } }), /not found/);
    await assert.rejects(rpc(ownerB, 'get_purchase', { p_id: (await rpc(ownerA, 'list_purchases', {}))[0].id }), /not found/);
});

test('global search finds stock items and vendors', async () => {
    const r = await rpc(ownerA, 'global_search', { p_query: 'amul' });
    assert.ok(r.vendors.some(v => v.title === 'Amul Dairy'));
    const s = await rpc(ownerA, 'global_search', { p_query: 'coffe bean' });
    assert.ok(s.stock.some(v => v.title === 'Coffee beans'));
});

test('superadmin can set an owner PIN for a cafe that had none', async () => {
    const t = await must(service.from('tenants').insert({ name: `Old ${run}`, slug: `old-${run}`, plan_id: custom.id,
        paid_until: '2099-01-01', owner_name: 'Old Owner' }).select().single());
    await rpc(service, 'seed_tenant', { p_tenant: t.id, p_name: t.name });
    await assert.rejects(rpc(sa, 'sa_reset_owner_pin', { p_tenant: t.id, p_pin: '5555' }), /mobile number first/);
    await rpc(sa, 'sa_update_tenant', { p_id: t.id, p_patch: { ownerPhone: ph(50) } });
    await rpc(sa, 'sa_reset_owner_pin', { p_tenant: t.id, p_pin: '5555' });
    const owner = await staffLogin(`old-${run}`, ph(50), '5555');
    assert.ok((await rpc(owner, 'me')).isOwner);
    assert.equal(tenantA.length, 36);
});
