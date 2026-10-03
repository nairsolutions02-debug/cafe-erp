// Phase 5 checks: geofenced check-in/out with selfie, pings and breaks, staff-left alarms,
// stopped-reporting and escalation, auto check-out, notification matrix, consent, push targets.
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
async function customer(slug, name, phone) {
    const c = client(slug);
    await c.auth.signInAnonymously();
    await rpc(c, 'customer_sign_in', { p_name: name, p_phone: phone });
    return c;
}
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} ≠ ${b}`);

const saEmail = `sa5-${run}@nair.test`;
await service.auth.admin.createUser({ email: saEmail, password: `sa-${run}-pw`, email_confirm: true });
await rpc(service, 'make_superadmin', { p_email: saEmail });
const sa = client();
await sa.auth.signInWithPassword({ email: saEmail, password: `sa-${run}-pw` });
const plans = (await rpc(sa, 'sa_overview')).plans;
const slugA = `att-a-${run}`, slugB = `att-b-${run}`;
const tenantA = await rpc(sa, 'sa_create_tenant', {
    p_name: `Att A ${run}`, p_slug: slugA, p_plan_id: plans.find(p => p.name === 'Custom').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner A', p_owner_phone: ph(1), p_owner_pin: '1111' });
await rpc(sa, 'sa_create_tenant', {
    p_name: `Att B ${run}`, p_slug: slugB, p_plan_id: plans.find(p => p.name === 'Starter').id, p_paid_until: '2099-01-01',
    p_owner_name: 'Owner B', p_owner_phone: ph(2), p_owner_pin: '2222' });
const owner = await staffLogin(slugA, ph(1), '1111');
const ownerB = await staffLogin(slugB, ph(2), '2222');
const roles = await must(owner.from('roles').select('id, name'));
const role = (n) => roles.find(r => r.name === n).id;
await rpc(owner, 'create_staff', { p_name: 'Cashier Ravi', p_phone: ph(10), p_role_id: role('Cashier'), p_pin: '1010' });
await rpc(owner, 'create_staff', { p_name: 'Manager Mona', p_phone: ph(11), p_role_id: role('Manager'), p_pin: '1212' });
const cashier = await staffLogin(slugA, ph(10), '1010');
const manager = await staffLogin(slugA, ph(11), '1212');


// Cafe at Bhilai; 75 m radius; 10 min grace
const CAFE = { lat: 21.2094, lng: 81.3801 };
const near = { lat: 21.2096, lng: 81.3802 };   // ~25 m
const far = { lat: 21.2200, lng: 81.3801 };    // ~1.2 km
for (const [k, v] of [['geofence_lat', CAFE.lat], ['geofence_lng', CAFE.lng], ['leave_grace_minutes', 0]]) {
    await must(owner.from('settings').update({ value: v }).eq('key', k));
}
const staffRows = await rpc(owner, 'list_staff');
const ravi = staffRows.staff.find(s => s.phone === ph(10));
const emp = await must(owner.from('employees').insert({ name: 'Cashier Ravi', phone: ph(10), role: 'cashier', salary: 15000, shift_start: '00:00' }).select().single());

test('a login not linked to an employee cannot check in', async () => {
    assert.equal((await rpc(cashier, 'my_day')).linked, false);
    await assert.rejects(rpc(cashier, 'staff_check_in', { p_lat: near.lat, p_lng: near.lng, p_accuracy: 10, p_selfie: 'x.jpg' }), /not linked/);
    await rpc(owner, 'link_employee_login', { p_employee: emp.id, p_staff: ravi.id });
    assert.equal((await rpc(cashier, 'my_day')).linked, true);
});

test('check-in only inside the geofence, with a selfie; late minutes recorded', async () => {
    await assert.rejects(rpc(cashier, 'staff_check_in', { p_lat: near.lat, p_lng: near.lng, p_accuracy: 10, p_selfie: '' }), /selfie/);
    await assert.rejects(rpc(cashier, 'staff_check_in', { p_lat: far.lat, p_lng: far.lng, p_accuracy: 10, p_selfie: 's.jpg' }), /m from the cafe/);
    const d = await rpc(cashier, 'staff_check_in', { p_lat: near.lat, p_lng: near.lng, p_accuracy: 10, p_selfie: 'selfie-in.jpg' });
    assert.ok(d.today.checkInAt);
    assert.ok(d.today.lateMinutes > 0, 'shift starts 00:00 so the check-in is late');
    await assert.rejects(rpc(cashier, 'staff_check_in', { p_lat: near.lat, p_lng: near.lng, p_accuracy: 10, p_selfie: 's.jpg' }), /already checked in/);
});

test('leaving the cafe beyond the grace period alarms the owner once; a break pauses it', async () => {
    const r = await rpc(cashier, 'staff_ping', { p_lat: far.lat, p_lng: far.lng, p_accuracy: 20 });
    assert.equal(r.inside, false);
    await rpc(cashier, 'staff_ping', { p_lat: far.lat, p_lng: far.lng, p_accuracy: 20 });
    const alerts = (await rpc(owner, 'my_notifications', {})).filter(n => n.kind === 'staff_left');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].priority, 'alarm');
    assert.match(alerts[0].title, /Cashier Ravi left the cafe/);
    assert.ok(!(await rpc(cashier, 'my_notifications', {})).some(n => n.kind === 'staff_left'), 'staff without employees.edit do not get it');
    await rpc(cashier, 'staff_ping', { p_lat: near.lat, p_lng: near.lng, p_accuracy: 20 });
    await rpc(cashier, 'staff_break', { p_minutes: 15, p_reason: 'Delivery' });
    await rpc(cashier, 'staff_ping', { p_lat: far.lat, p_lng: far.lng, p_accuracy: 20 });
    assert.equal((await rpc(owner, 'my_notifications', {})).filter(n => n.kind === 'staff_left').length, 1, 'no alert during a break');
    const board = await rpc(owner, 'attendance_board', {});
    const row = board.find(b => b.name === 'Cashier Ravi');
    assert.equal(row.onPremises, 'break');
    assert.equal(row.breaks[0].reason, 'Delivery');
    assert.ok((await rpc(owner, 'location_trail', { p_attendance: row.attendanceId })).length >= 4);
});

test('a phone that stops reporting is flagged; unanswered alarms escalate', async () => {
    const t = await must(service.from('attendance').select('id').eq('employee_id', emp.id).single());
    await must(service.from('attendance').update({ last_ping_at: new Date(Date.now() - 3600e3).toISOString(), break_until: null }).eq('id', t.id));
    await must(service.from('notification_events').update({ created_at: new Date(Date.now() - 600e3).toISOString() }).eq('tenant_id', tenantA).eq('kind', 'staff_left'));
    assert.ok(await rpc(owner, 'check_presence') >= 2);
    const n = await rpc(owner, 'my_notifications', {});
    assert.ok(n.some(x => x.kind === 'staff_silent' && /stopped reporting/.test(x.title)));
    assert.ok(n.some(x => x.kind === 'escalation' && /Not answered/.test(x.title)));
    assert.equal(await rpc(owner, 'check_presence'), 0, 'each case is alerted once');
});

test('check-out records the time; a forgotten check-out is closed at shift end', async () => {
    const d = await rpc(cashier, 'staff_check_out', { p_lat: near.lat, p_lng: near.lng, p_accuracy: 10, p_selfie: 'out.jpg' });
    assert.ok(d.today.checkOutAt);
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const old = await must(service.from('attendance').insert({ tenant_id: tenantA, employee_id: emp.id, date: '2026-09-15', status: 'present',
        check_in: '09:00', check_in_at: '2026-09-15T03:30:00Z' }).select().single());
    await rpc(owner, 'check_presence');
    const fixed = await must(service.from('attendance').select('auto_closed, check_out').eq('id', old.id).single());
    assert.equal(fixed.auto_closed, true);
    assert.equal(fixed.check_out, '18:00');
    assert.ok(yesterday);
});

test('tracking off: check in without location (selfie still needed)', async () => {
    await rpc(owner, 'link_employee_login', { p_employee: emp.id, p_staff: ravi.id, p_track: false });
    await must(service.from('attendance').delete().eq('employee_id', emp.id));
    const d = await rpc(cashier, 'staff_check_in', { p_lat: null, p_lng: null, p_accuracy: null, p_selfie: 's.jpg' });
    assert.ok(d.today.checkInAt);
    assert.equal((await rpc(cashier, 'staff_ping', { p_lat: far.lat, p_lng: far.lng, p_accuracy: 5 })).tracking, false);
});

test('notification matrix: per-person style, quiet hours, defaults', async () => {
    const m = await rpc(owner, 'notification_matrix');
    assert.ok(m.kinds.some(k => k.kind === 'payment_request' && k.default === 'alarm'));
    assert.ok(m.people.some(p => p.person === `staff:${ravi.id}`));
    await rpc(owner, 'set_notification_pref', { p_person: `staff:${ravi.id}`, p_kind: 'payment_request', p_style: 'loud' });
    assert.equal((await rpc(cashier, 'my_notification_prefs')).styles.payment_request, 'loud');
    assert.equal((await rpc(cashier, 'my_notification_prefs')).styles.new_order, 'alarm');
    await rpc(cashier, 'set_quiet_hours', { p_person: `staff:${ravi.id}`, p_from: '00:00', p_to: '23:59' });
    assert.equal((await rpc(cashier, 'my_notification_prefs')).quietNow, true);
    await assert.rejects(rpc(cashier, 'set_notification_pref', { p_person: `staff:${roles[0].id}`, p_kind: 'new_order', p_style: 'off' }), /staff.edit/);
});

test('consent v2 (location) must be accepted by staff', async () => {
    const me = await rpc(cashier, 'me');
    assert.equal(me.pendingTerms?.version, 2);
    assert.match(me.pendingTerms.body, /location/);
});

test('push targets respect the matrix and permissions', async () => {
    await rpc(cashier, 'save_push_subscription', { p_endpoint: `https://push.test/${run}`, p_keys: { p256dh: 'x', auth: 'y' } });
    const c = await customer(slugA, 'Push', ph(80));
    await rpc(c, 'place_order', { p_items: [{ menuItem: (await must(owner.from('menu_items').insert({ name: 'Tea', price: 10 }).select().single())).id, quantity: 1 }] });
    const ev = await must(service.from('notification_events').select('id').eq('tenant_id', tenantA).eq('kind', 'new_order').single());
    const t = await rpc(service, 'push_targets', { p_event: ev.id });
    assert.equal(t.length, 1);
    assert.equal(t[0].style, 'alarm');
    await rpc(owner, 'set_notification_pref', { p_person: `staff:${ravi.id}`, p_kind: 'new_order', p_style: 'off' });
    assert.equal((await rpc(service, 'push_targets', { p_event: ev.id })).length, 0);
});

test('cafes are isolated: B cannot see A\'s attendance or trails', async () => {
    assert.equal((await rpc(ownerB, 'attendance_board', {})).length, 0);
    assert.equal((await must(ownerB.from('location_pings').select('id'))).length, 0);
    assert.ok(manager);
});
