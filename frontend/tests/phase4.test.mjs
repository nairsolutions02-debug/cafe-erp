// Phase 4 checks: P&L (spread expenses, staff cost), cash flow, profit targets, GST pack and due dates,
// item economics, payroll with leave, overtime, advances and penalties, salary privacy.
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
async function customer(slug, name, phone) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone });
    return c;
}
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} ≠ ${b}`);

const saEmail = `sa4-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `fin-a-${run}`, slugB = `fin-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Fin A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `Fin B ${run}`, p_slug: slugB, p_plan_id: plans.find(p => p.name === 'Starter').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const owner = await staffLogin(slugA, ph(1), '1111');
const ownerB = await staffLogin(slugB, ph(2), '2222');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
const cashier = await staffLogin(slugA, ph(10), '1010');
const manager = await staffLogin(slugA, ph(11), '1212');


await rpc(owner, 'create_staff', { p_name: 'Acc Anil', p_phone: ph(13), p_role_id: role('Accountant'), p_pin: '1414' });
const accountant = await staffLogin(slugA, ph(13), '1414');
const today = await rpc(owner, 'day_summary', {}).then(d => d.date);

const cat = await must(owner.from('categories').insert({ name: 'Coffee' }).select().single());
const coffee = await must(owner.from('menu_items').insert({ name: 'Latte', price: 100, category_id: cat.id }).select().single());
const g18 = await must(owner.from('tax_groups').insert({ name: 'Packaged 18%', components: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] }).select().single());
const chips = await must(owner.from('menu_items').insert({ name: 'Chips', price: 100, tax_group_id: g18.id, hsn_code: '2106', category_id: cat.id }).select().single());
const milk = await rpc(owner, 'save_stock_item', { p: { name: 'Milk', unit: 'ml', openingStock: 10000, avgCost: 0.05 } });
await rpc(owner, 'save_recipe', { p_menu_item: coffee.id, p_lines: [{ itemId: milk, quantity: 200 }] });
for (let i = 0; i < 3; i++) {
    await rpc(owner, 'create_staff_order', { p: { channel: 'takeaway', items: [{ menuItem: coffee.id, quantity: 2 }], payFullBy: 'cash' } });
}
await rpc(owner, 'create_staff_order', { p: { channel: 'dine_in', items: [{ menuItem: chips.id, quantity: 1 }], payFullBy: 'upi' } });
const cats = await must(owner.from('expense_categories').select('id, name'));
const catId = (n) => cats.find(c => c.name === n).id;
await rpc(owner, 'record_expense', { p: { categoryId: catId('Licences'), amount: 12000, accountCode: 'bank', date: '2026-10-01', spreadMonths: 12 } });
await rpc(owner, 'record_expense', { p: { categoryId: catId('Gas'), amount: 900, accountCode: 'cash_office', date: today } });

const emp = await must(owner.from('employees').insert({ name: 'Ravi', phone: '9000000011', role: 'waiter', salary: 30000,
    joining_date: '2026-01-01', weekly_off: 0, ot_rate: 100 }).select().single());
const daily = await must(owner.from('employees').insert({ name: 'Sita', phone: '9000000012', role: 'cleaner', salary: 0,
    pay_type: 'daily', daily_rate: 800, joining_date: '2026-01-01' }).select().single());

test('P&L: net sales, recipe cost, spread licence, estimated staff cost, net profit', async () => {
    const { current: p } = await rpc(owner, 'pnl', { p_from: '2026-10-01', p_to: '2026-10-31' });
    assert.equal(p.netSales, 700);
    assert.equal(p.taxes, 48);
    assert.equal(p.cogs, 60);
    assert.equal(p.grossProfit, 640);
    const lic = p.expenses.find(e => e.category === 'Licences').amount;
    close(lic, 12000 * 31 / 365, 'licence spread');
    assert.equal(p.expenses.find(e => e.category === 'Gas').amount, 900);
    assert.ok(p.staffCostEstimated);
    close(p.staffCost, 30000 + 800 * 26, 'staff estimate for a whole month');
    close(p.netProfit, 640 - lic - 900 - (30000 + 800 * 26), 'net profit');
    await assert.rejects(rpc(cashier, 'pnl', { p_from: today, p_to: today }), /finance.view/);
    await rpc(accountant, 'pnl', { p_from: today, p_to: today });
});

test('cash flow: opening + in − out = closing per account', async () => {
    const cf = await rpc(owner, 'cash_flow', { p_from: today, p_to: today });
    const bank = cf.find(a => a.code === 'bank');
    assert.equal(bank.closing, bank.opening + bank.in - bank.out);
    assert.equal(cf.find(a => a.code === 'upi').in, 118);
});

test('profit target shows progress and a forecast', async () => {
    await must(owner.from('settings').update({ value: 20000 }).eq('key', 'profit_target_monthly'));
    const t = await rpc(owner, 'profit_targets');
    assert.equal(t.month.target, 20000);
    close(t.month.forecast, t.month.profit * t.month.days / t.month.daysGone, 'forecast');
});

test('GST pack: sales by rate with CGST/SGST, HSN summary, purchases with vendor GSTIN', async () => {
    const v = await must(owner.from('vendors').insert({ name: 'Metro', gstin: '22ABCDE1234F1Z5' }).select().single());
    await rpc(owner, 'record_purchase', { p: { vendorId: v.id, billNumber: 'M-9', lines: [{ itemId: milk, quantity: 1000, rate: 0.05, taxRate: 5 }] } });
    const g = await rpc(owner, 'gst_pack', { p_from: today, p_to: today });
    const r5 = g.byRate.find(r => r.rate === 5);
    assert.deepEqual([r5.taxable, r5.cgst, r5.sgst], [600, 15, 15]);
    const r18 = g.byRate.find(r => r.rate === 18);
    assert.deepEqual([r18.taxable, r18.tax], [100, 18]);
    assert.ok(g.hsn.some(h => h.code === '2106') && g.hsn.some(h => h.code === '996331'));
    assert.equal(g.purchases[0].gstin, '22ABCDE1234F1Z5');
    const due = await rpc(owner, 'gst_due_dates');
    assert.ok(due.some(d => d.form === 'GSTR-3B'));
    await must(owner.from('settings').update({ value: 'composition' }).eq('key', 'gst_filing'));
    assert.ok((await rpc(owner, 'gst_due_dates')).every(d => /CMP-08|GSTR-4/.test(d.form)));
});

test('item economics: contribution, share and per-unit profit', async () => {
    const rows = await rpc(owner, 'item_economics', { p_from: today, p_to: today });
    const latte = rows.find(r => r.name === 'Latte');
    assert.deepEqual([latte.units, latte.revenue, latte.cost, latte.contribution, latte.perUnit], [6, 600, 60, 540, 90]);
    assert.equal(rows.find(r => r.name === 'Chips').costKnown, false);
    assert.ok(Math.abs(latte.sharePct - 540 / 640 * 100) < 0.06);
});

test('payroll: attendance, weekly offs, paid leave, overtime, advance and penalty', async () => {
    // September 2026: 30 days, Sundays 6/13/20/27 are weekly offs
    const att = [];
    let presentDays = 0;
    for (let d = 1; d <= 30; d++) {
        const date = `2026-09-${String(d).padStart(2, '0')}`;
        if (new Date(date + 'T00:00:00Z').getUTCDay() === 0) continue;
        if (d === 2 || d === 3) att.push({ employee_id: emp.id, date, status: 'half-day', check_in: '', check_out: '' });
        else if (d === 4) att.push({ employee_id: emp.id, date, status: 'absent', check_in: '', check_out: '' });
        else if (d === 5) continue; // leave below
        else if (presentDays < 20) {
            presentDays++;
            att.push({ employee_id: emp.id, date, status: 'present', check_in: '09:00', check_out: presentDays <= 5 ? '19:00' : '18:00' });
        } else att.push({ employee_id: emp.id, date, status: 'absent', check_in: '', check_out: '' });
    }
    for (let d = 1; d <= 10; d++) att.push({ employee_id: daily.id, date: `2026-09-${String(d).padStart(2, '0')}`, status: 'present', check_in: '', check_out: '' });
    await must(owner.from('attendance').insert(att));
    const types = (await rpc(owner, 'leave_overview', {})).types;
    const casual = types.find(t => t.name === 'Casual').id;
    const req = await rpc(owner, 'request_leave', { p_employee: emp.id, p_type: casual, p_from: '2026-09-05', p_to: '2026-09-05' });
    await rpc(owner, 'decide_leave', { p_id: req, p_approve: true });
    await rpc(owner, 'give_advance', { p_employee: emp.id, p_amount: 3000, p_instalment: 1000, p_account_code: 'cash_office' });
    const pen = await rpc(owner, 'add_penalty', { p_employee: emp.id, p_date: '2026-09-10', p_reason: 'Broke a glass', p_amount: 200 });
    await rpc(owner, 'decide_penalty', { p_id: pen, p_approve: true });

    await rpc(owner, 'run_payroll', { p_month: '2026-09-01' });
    const pr = await rpc(owner, 'get_payroll', { p_month: '2026-09-01' });
    const r = pr.slips.find(s => s.name === 'Ravi');
    assert.deepEqual([r.present, r.halfDays, r.paidLeave, r.weeklyOffs, r.payableDays], [20, 2, 1, 4, 26]);
    assert.equal(r.basePay, 26000);
    assert.equal(r.otHours, 5);
    assert.equal(r.otPay, 500);
    assert.deepEqual([r.advanceRecovery, r.penalties, r.net], [1000, 200, 25300]);
    assert.equal(pr.slips.find(s => s.name === 'Sita').net, 8000);
    const lo = await rpc(owner, 'leave_overview', {});
    assert.equal(lo.balances.find(b => b.name === 'Ravi').leave.find(l => l.type === 'Casual').used, 1);

    await assert.rejects(rpc(owner, 'pay_payslips', { p_month: '2026-09-01', p_account_code: 'bank' }), /finalize/);
    await rpc(owner, 'finalize_payroll', { p_month: '2026-09-01' });
    await assert.rejects(rpc(owner, 'run_payroll', { p_month: '2026-09-01' }), /is final/);
    assert.equal(await rpc(owner, 'pay_payslips', { p_month: '2026-09-01', p_account_code: 'bank' }), 2);
    const ledger = await rpc(owner, 'list_ledger', { p: { kind: 'salary' } });
    assert.deepEqual(ledger.map(l => l.amount).sort(), [-25300, -8000]);
    assert.equal((await rpc(owner, 'list_penalties_advances')).advances[0].remaining, 2000);
    // September P&L now uses the real payroll
    const { current: sep } = await rpc(owner, 'pnl', { p_from: '2026-09-01', p_to: '2026-09-30' });
    assert.equal(sep.staffCost, 26500 + 8000);
    assert.equal(sep.staffCostEstimated, false);
});

test('salaries stay private: a cashier cannot run or read payroll', async () => {
    await assert.rejects(rpc(cashier, 'get_payroll', { p_month: '2026-09-01' }), /Not authorized/);
    assert.equal((await must(cashier.from('payslips').select('id'))).length, 0);
    await rpc(accountant, 'get_payroll', { p_month: '2026-09-01' });
    await assert.rejects(rpc(accountant, 'run_payroll', { p_month: '2026-10-01' }), /employees.edit/);
});

test('cafes are isolated: B sees none of A\'s reports or payroll', async () => {
    const { current } = await rpc(ownerB, 'pnl', { p_from: today, p_to: today });
    assert.equal(current.netSales, 0);
    assert.equal((await rpc(ownerB, 'get_payroll', { p_month: '2026-09-01' })).status, 'none');
    assert.ok(tenantA && manager);
});
