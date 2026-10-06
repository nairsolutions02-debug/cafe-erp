// Customer app in English, Hindi and Hinglish: every text in all three, and the optional Hindi dish name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Every customer screen speaks three languages: each T(en, hi, hg) in these files has all three filled
const CUSTOMER_FILES = [
    'pages/Home.jsx', 'pages/Menu.jsx', 'pages/Cart.jsx', 'pages/OrderDetails.jsx', 'pages/History.jsx', 'pages/Profile.jsx',
    'pages/Rewards.jsx', 'pages/TableScan.jsx', 'components/Header.jsx', 'components/BottomNav.jsx', 'components/LoginModal.jsx',
    'components/QuickLoginForm.jsx', 'components/MenuCard.jsx', 'components/OrderStatus.jsx', 'components/DishFeedback.jsx',
    'components/FloatingCartBtn.jsx', 'components/Footer.jsx', 'components/cx/ItemSheet.jsx', 'components/cx/TableChip.jsx',
    'components/cx/RewardBar.jsx', 'pages/club/ClubCards.jsx',
];
const read = (f) => readFileSync(new globalThis.URL(`../src/${f}`, import.meta.url), 'utf8');
// T('a', 'b', 'c') with single, double or back-tick quoted strings
const STR = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|` + '`(?:[^`\\\\]|\\\\.)*`)';
const CALL = new RegExp(String.raw`\bT\(\s*(` + STR + String.raw`)\s*,\s*(` + STR + String.raw`)\s*,\s*(` + STR + String.raw`)\s*\)`, 'g');

test('every customer screen uses the language hook and has English, Hindi and Hinglish for each text', () => {
    let total = 0;
    for (const f of CUSTOMER_FILES) {
        const code = read(f);
        assert.match(code, /useCxLang/, `${f} does not use the language hook`);
        const calls = [...code.matchAll(CALL)];
        assert.ok(calls.length > 0, `${f} has no translated texts`);
        for (const m of calls) {
            for (const [i, s] of [m[1], m[2], m[3]].entries()) {
                assert.ok(s.slice(1, -1).trim().length > 0, `${f}: empty ${['en', 'hi', 'hg'][i]} in ${m[0].slice(0, 80)}`);
            }
            if (m[1] !== m[2]) assert.match(m[2], /[\u0900-\u097F]/, `${f}: Hindi is not in Devanagari: ${m[0].slice(0, 80)}`);
        }
        total += calls.length;
    }
    assert.ok(total > 150, `only ${total} translated texts`);
});

const saEmail = `sa5-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slug = `cxl-${run}`;
await rpc(sa, 'sa_create_tenant', {
    p_name: `Lang ${run}`, p_slug: slug, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner', p_owner_phone: ph(1), p_owner_pin: '1111' });
const owner = await staffLogin(slug, ph(1), '1111');

test('a dish can carry a Hindi name; customers read it, the bill keeps the main name', async () => {
    const cat = await must(owner.from('categories').insert({ name: 'Food' }).select().single());
    const dosa = await must(owner.from('menu_items').insert({ name: 'Masala Dosa', name_hi: 'मसाला डोसा', price: 120, category_id: cat.id }).select().single());
    assert.equal(dosa.name_hi, 'मसाला डोसा');
    const guest = await customer(slug, 'Priya', 31);
    const seen = await must(guest.from('menu_items').select('name, name_hi').eq('id', dosa.id).single());
    assert.equal(seen.name_hi, 'मसाला डोसा');
    const id = await rpc(guest, 'place_order', { p_items: [{ menuItem: dosa.id, quantity: 1 }] });
    const o = await rpc(guest, 'get_order', { p_id: id });
    assert.equal(o.items[0].name, 'Masala Dosa');
    // Too long is refused
    await assert.rejects(must(owner.from('menu_items').update({ name_hi: 'क'.repeat(121) }).eq('id', dosa.id)));
});
