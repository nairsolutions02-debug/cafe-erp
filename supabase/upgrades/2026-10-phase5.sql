-- Cafe ERP · Phase 5 (staff app, attendance, alerts) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261009000001_attendance_alerts.sql ====
-- Phase 5: staff app — geofenced check-in/out with selfie, on-premises pings while checked in,
-- breaks, presence alerts, consent v2, notification matrix (style per person per event),
-- escalation, push subscriptions.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.employees
    add column track_location boolean not null default true,
    add column shift_start time not null default '09:00';

alter table public.attendance
    add column check_in_lat double precision,
    add column check_in_lng double precision,
    add column check_in_distance integer,
    add column check_out_lat double precision,
    add column check_out_lng double precision,
    add column check_out_distance integer,
    add column selfie_in text not null default '',
    add column selfie_out text not null default '',
    add column late_minutes integer not null default 0,
    add column auto_closed boolean not null default false,
    add column break_until timestamptz,
    add column last_ping_at timestamptz,
    add column outside_since timestamptz,
    add column outside_alerted_at timestamptz,
    add column silent_alerted_at timestamptz;

create table public.location_pings (
    id bigint generated always as identity primary key,
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    attendance_id uuid references public.attendance (id) on delete cascade,
    at timestamptz not null default now(),
    lat double precision,
    lng double precision,
    accuracy integer,
    distance integer,
    inside boolean
);
create index location_pings_att_idx on public.location_pings (attendance_id, at desc);
create index location_pings_tenant_idx on public.location_pings (tenant_id, at);

create table public.attendance_breaks (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    attendance_id uuid not null references public.attendance (id) on delete cascade,
    started_at timestamptz not null default now(),
    minutes integer not null check (minutes between 1 and 240),
    reason text not null default ''
);

-- Style per person per event: alarm (full screen, loops), loud, normal, digest, off
create table public.notification_prefs (
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    person text not null,
    kind text not null,
    style text not null check (style in ('alarm', 'loud', 'normal', 'digest', 'off')),
    primary key (tenant_id, person, kind)
);

create table public.person_settings (
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    person text not null,
    quiet_from time,
    quiet_to time,
    primary key (tenant_id, person)
);

create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    person text not null,
    endpoint text not null unique,
    keys jsonb not null default '{}',
    platform text not null default 'web' check (platform in ('web', 'android')),
    created_at timestamptz not null default now()
);

-- Private files (attendance selfies): readable only through signed links
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-private', 'staff-private', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff upload private" on storage.objects for insert to authenticated
    with check (bucket_id = 'staff-private' and public.is_admin()
                and (storage.foldername(name))[1] = public.current_tenant_id()::text);
create policy "managers read private" on storage.objects for select to authenticated
    using (bucket_id = 'staff-private' and (storage.foldername(name))[1] = public.current_tenant_id()::text
           and (public.has_perm('employees.view') or (storage.foldername(name))[2] = coalesce(public.my_staff_id()::text, '-')));

-- Location consent (staff accept again on their next login)
insert into public.terms_versions (kind, version, title, body) values
('staff', 2, 'Staff terms and location consent',
 E'1. Use the app only for work at this cafe; keep your PIN private.\n'
 '2. Attendance: you check in and out on your phone inside the cafe, with a selfie. The time, the place (GPS) and the selfie are stored with your attendance.\n'
 '3. On-premises check: only between check-in and check-out, the app notes your phone''s location every few minutes while it is open, to confirm you are at the cafe. If you are outside the cafe for longer than the allowed time, the owner and manager are alerted. Use the Break button for deliveries or breaks.\n'
 '4. Who sees it: the owner and managers of this cafe, and N.A.I.R. Solutions for support. It is not shared with anyone else.\n'
 '5. How long: location points are deleted after 30 days; attendance records are kept for payroll.\n'
 '6. You can ask the owner to switch location tracking off for you; you will then check in at the counter with your PIN and a selfie.\n'
 '7. GPS indoors can be off by 20–50 metres; a switched-off phone stops reporting and is shown as "stopped reporting", not as absent.')
on conflict (kind, version) do nothing;

-- Default settings for this phase
create or replace function public.seed_phase5(p_tenant uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.settings (tenant_id, key, value, description) values
        (p_tenant, 'geofence_lat', 'null', 'Cafe location latitude for check-in'),
        (p_tenant, 'geofence_lng', 'null', 'Cafe location longitude for check-in'),
        (p_tenant, 'geofence_radius_m', '75', 'Check-in radius around the cafe (metres)'),
        (p_tenant, 'ping_minutes', '10', 'How often the staff app checks location while checked in'),
        (p_tenant, 'leave_grace_minutes', '10', 'Minutes outside the cafe before the owner is alerted'),
        (p_tenant, 'late_grace_minutes', '10', 'Minutes after shift start before a check-in counts as late'),
        (p_tenant, 'escalation_minutes', '5', 'Unacknowledged alarms go to the owner/manager after this many minutes'),
        (p_tenant, 'selfie_required', 'true', 'Selfie required at check-in and check-out')
    on conflict (tenant_id, key) do nothing;
$$;
revoke execute on function public.seed_phase5(uuid) from public, anon, authenticated;
do $$ begin perform public.seed_phase5(id) from public.tenants; end $$;

create function public.tenants_seed_phase5() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.seed_phase5(new.id);
    return null;
end;
$$;
create trigger tenants_seed_phase5 after insert on public.tenants for each row execute function public.tenants_seed_phase5();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The signed-in person as a stable key: staff:<staff id> or user:<auth user id> (owner email login)
create function public.my_person() returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select case when p.staff_id is not null then 'staff:' || p.staff_id else 'user:' || p.id end
      from public.profiles p where p.id = auth.uid();
$$;

create function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns integer
language sql immutable as $$
    select round(6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
                 + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::integer;
$$;

create function public.my_employee() returns public.employees
language sql stable security definer set search_path = public, pg_temp as $$
    select e.* from public.employees e
     where e.staff_id = public.my_staff_id() and e.tenant_id = public.current_tenant_id() and e.is_active
     limit 1;
$$;
revoke execute on function public.my_employee() from public, anon, authenticated;

create function public.geofence(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'lat', (public.get_setting('geofence_lat', 'null', p_tenant) #>> '{}')::double precision,
        'lng', (public.get_setting('geofence_lng', 'null', p_tenant) #>> '{}')::double precision,
        'radius', coalesce((public.get_setting('geofence_radius_m', '75', p_tenant) #>> '{}')::integer, 75),
        'pingMinutes', coalesce((public.get_setting('ping_minutes', '10', p_tenant) #>> '{}')::integer, 10),
        'graceMinutes', coalesce((public.get_setting('leave_grace_minutes', '10', p_tenant) #>> '{}')::integer, 10),
        'selfieRequired', coalesce((public.get_setting('selfie_required', 'true', p_tenant) #>> '{}')::boolean, true));
$$;
revoke execute on function public.geofence(uuid) from public, anon, authenticated;

-- Inside = within the radius, allowing up to 50 m for GPS accuracy
create function public.place_check(p_tenant uuid, p_lat double precision, p_lng double precision, p_accuracy integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_g jsonb := public.geofence(p_tenant);
    v_d integer;
begin
    if v_g ->> 'lat' is null then
        return jsonb_build_object('configured', false, 'inside', true, 'distance', null);
    end if;
    if p_lat is null or p_lng is null then
        return jsonb_build_object('configured', true, 'inside', false, 'distance', null);
    end if;
    v_d := public.distance_m(p_lat, p_lng, (v_g ->> 'lat')::double precision, (v_g ->> 'lng')::double precision);
    return jsonb_build_object('configured', true, 'distance', v_d,
                              'inside', v_d <= (v_g ->> 'radius')::integer + least(coalesce(p_accuracy, 0), 50));
end;
$$;
revoke execute on function public.place_check(uuid, double precision, double precision, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff app: my day, check in/out, pings, breaks
-- ---------------------------------------------------------------------------
create function public.my_day() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_e public.employees := public.my_employee();
    v_tenant uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
    v_a public.attendance;
begin
    perform public.require_admin();
    if v_e.id is null then
        return jsonb_build_object('linked', false, 'geofence', public.geofence(v_tenant), 'tenantId', v_tenant, 'staffId', public.my_staff_id());
    end if;
    select * into v_a from public.attendance where employee_id = v_e.id and date = v_today;
    return jsonb_build_object(
        'linked', true, 'tenantId', v_tenant, 'staffId', public.my_staff_id(), 'employeeId', v_e.id, 'name', v_e.name, 'trackLocation', v_e.track_location,
        'shiftStart', to_char(v_e.shift_start, 'HH24:MI'), 'shiftHours', v_e.shift_hours, 'geofence', public.geofence(v_tenant),
        'today', case when v_a.id is null then null else jsonb_build_object(
            'id', v_a.id, 'status', v_a.status, 'checkInAt', v_a.check_in_at, 'checkOutAt', v_a.check_out_at,
            'lateMinutes', v_a.late_minutes, 'breakUntil', v_a.break_until, 'outsideSince', v_a.outside_since) end,
        'month', (select jsonb_build_object('present', count(*) filter (where status = 'present'),
                                            'halfDays', count(*) filter (where status = 'half-day'),
                                            'leave', count(*) filter (where status = 'leave'),
                                            'late', count(*) filter (where late_minutes > 0))
                    from public.attendance where employee_id = v_e.id and date >= date_trunc('month', v_today)::date),
        'leaveTypes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
                         from public.leave_types where tenant_id = v_tenant and is_active),
        'requests', (select coalesce(jsonb_agg(jsonb_build_object('from', r.from_date, 'to', r.to_date, 'type', lt.name, 'status', r.status)
                                               order by r.created_at desc), '[]'::jsonb)
                       from public.leave_requests r join public.leave_types lt on lt.id = r.leave_type_id
                      where r.employee_id = v_e.id and r.created_at > now() - interval '60 days'));
end;
$$;

create function public.staff_check_in(p_lat double precision, p_lng double precision, p_accuracy integer, p_selfie text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.employees := public.my_employee();
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_today date := public.cafe_today(public.current_tenant_id());
    v_place jsonb;
    v_g jsonb := public.geofence(public.current_tenant_id());
    v_late integer;
    v_a public.attendance;
begin
    if v_e.id is null then
        raise exception 'Your login is not linked to an employee yet. Ask the owner (Employees → App login).';
    end if;
    if coalesce((v_g ->> 'selfieRequired')::boolean, true) and coalesce(p_selfie, '') = '' then
        raise exception 'Take a selfie to check in';
    end if;
    v_place := public.place_check(v_tenant, p_lat, p_lng, p_accuracy);
    if v_e.track_location and not (v_place ->> 'inside')::boolean then
        raise exception 'You are % m from the cafe. Check in when you are inside.', coalesce(v_place ->> 'distance', '?');
    end if;
    select * into v_a from public.attendance where employee_id = v_e.id and date = v_today;
    if v_a.check_in_at is not null and v_a.check_out_at is null then
        raise exception 'You are already checked in';
    end if;
    v_late := greatest(0, floor(extract(epoch from ((now() at time zone v_tz)::time - v_e.shift_start)) / 60)::integer
                          - coalesce((public.get_setting('late_grace_minutes', '10', v_tenant) #>> '{}')::integer, 10));
    insert into public.attendance (tenant_id, employee_id, date, status, check_in, check_in_at, check_in_lat, check_in_lng,
                                   check_in_distance, selfie_in, late_minutes, last_ping_at, notes)
    values (v_tenant, v_e.id, v_today, 'present', to_char(now() at time zone v_tz, 'HH24:MI'), now(), p_lat, p_lng,
            (v_place ->> 'distance')::integer, coalesce(p_selfie, ''), case when v_late > 0 then v_late + coalesce((public.get_setting('late_grace_minutes', '10', v_tenant) #>> '{}')::integer, 10) else 0 end,
            now(), case when v_e.track_location then '' else 'Checked in without location (tracking off)' end)
    on conflict (employee_id, date) do update
       set status = 'present', check_in = excluded.check_in, check_in_at = excluded.check_in_at, check_in_lat = excluded.check_in_lat,
           check_in_lng = excluded.check_in_lng, check_in_distance = excluded.check_in_distance, selfie_in = excluded.selfie_in,
           late_minutes = excluded.late_minutes, last_ping_at = now(), check_out = '', check_out_at = null,
           outside_since = null, outside_alerted_at = null, silent_alerted_at = null
    returning * into v_a;
    if p_lat is not null then
        insert into public.location_pings (tenant_id, employee_id, attendance_id, lat, lng, accuracy, distance, inside)
        values (v_tenant, v_e.id, v_a.id, p_lat, p_lng, p_accuracy, (v_place ->> 'distance')::integer, (v_place ->> 'inside')::boolean);
    end if;
    return public.my_day();
end;
$$;

create function public.staff_check_out(p_lat double precision, p_lng double precision, p_accuracy integer, p_selfie text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.employees := public.my_employee();
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_place jsonb;
    v_a public.attendance;
begin
    if v_e.id is null then
        raise exception 'Your login is not linked to an employee yet';
    end if;
    select * into v_a from public.attendance
     where employee_id = v_e.id and check_in_at is not null and check_out_at is null order by date desc limit 1 for update;
    if v_a.id is null then
        raise exception 'You are not checked in';
    end if;
    if coalesce((public.geofence(v_tenant) ->> 'selfieRequired')::boolean, true) and coalesce(p_selfie, '') = '' then
        raise exception 'Take a selfie to check out';
    end if;
    v_place := public.place_check(v_tenant, p_lat, p_lng, p_accuracy);
    if v_e.track_location and not (v_place ->> 'inside')::boolean then
        raise exception 'You are % m from the cafe. Check out at the cafe.', coalesce(v_place ->> 'distance', '?');
    end if;
    update public.attendance
       set check_out = to_char(now() at time zone v_tz, 'HH24:MI'), check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
           check_out_distance = (v_place ->> 'distance')::integer, selfie_out = coalesce(p_selfie, ''), outside_since = null, break_until = null,
           status = case when extract(epoch from now() - check_in_at) / 3600 < v_e.shift_hours / 2 then 'half-day' else status end
     where id = v_a.id;
    return public.my_day();
end;
$$;

-- Called by the staff app every few minutes while checked in. Outside longer than the grace
-- period (and not on a break) alerts the owner and managers once.
create function public.staff_ping(p_lat double precision, p_lng double precision, p_accuracy integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.employees := public.my_employee();
    v_tenant uuid := public.current_tenant_id();
    v_a public.attendance;
    v_place jsonb;
    v_grace integer := coalesce((public.get_setting('leave_grace_minutes', '10', public.current_tenant_id()) #>> '{}')::integer, 10);
    v_out integer;
begin
    if v_e.id is null then
        return jsonb_build_object('tracking', false);
    end if;
    select * into v_a from public.attendance
     where employee_id = v_e.id and check_in_at is not null and check_out_at is null order by date desc limit 1 for update;
    if v_a.id is null or not v_e.track_location then
        return jsonb_build_object('tracking', false);
    end if;
    v_place := public.place_check(v_tenant, p_lat, p_lng, p_accuracy);
    insert into public.location_pings (tenant_id, employee_id, attendance_id, lat, lng, accuracy, distance, inside)
    values (v_tenant, v_e.id, v_a.id, p_lat, p_lng, p_accuracy, (v_place ->> 'distance')::integer, (v_place ->> 'inside')::boolean);
    if (v_place ->> 'inside')::boolean or (v_a.break_until is not null and v_a.break_until > now()) then
        update public.attendance set last_ping_at = now(), outside_since = null, outside_alerted_at = null, silent_alerted_at = null where id = v_a.id;
        return jsonb_build_object('tracking', true, 'inside', (v_place ->> 'inside')::boolean, 'onBreak', v_a.break_until > now());
    end if;
    update public.attendance set last_ping_at = now(), outside_since = coalesce(outside_since, now()), silent_alerted_at = null
     where id = v_a.id returning * into v_a;
    v_out := floor(extract(epoch from now() - v_a.outside_since) / 60)::integer;
    if v_out >= v_grace and v_a.outside_alerted_at is null then
        perform public.notify(v_tenant, 'staff_left', v_e.name || ' left the cafe ' || v_out || ' min ago',
            coalesce((v_place ->> 'distance') || ' m away', 'Location unknown'), '/admin/attendance', 'employees.edit', 'alarm',
            jsonb_build_object('employeeId', v_e.id, 'map', case when p_lat is not null then 'https://maps.google.com/?q=' || p_lat || ',' || p_lng end));
        update public.attendance set outside_alerted_at = now() where id = v_a.id;
    end if;
    return jsonb_build_object('tracking', true, 'inside', false, 'outsideMinutes', v_out, 'graceMinutes', v_grace,
                              'distance', (v_place ->> 'distance')::integer);
end;
$$;

create function public.staff_break(p_minutes integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.employees := public.my_employee();
    v_a public.attendance;
begin
    if v_e.id is null then
        raise exception 'Your login is not linked to an employee yet';
    end if;
    if coalesce(p_minutes, 0) not between 1 and 240 then
        raise exception 'Pick 1 to 240 minutes';
    end if;
    select * into v_a from public.attendance
     where employee_id = v_e.id and check_in_at is not null and check_out_at is null order by date desc limit 1 for update;
    if v_a.id is null then
        raise exception 'Check in first';
    end if;
    insert into public.attendance_breaks (tenant_id, attendance_id, minutes, reason) values (v_a.tenant_id, v_a.id, p_minutes, coalesce(p_reason, ''));
    update public.attendance set break_until = now() + make_interval(mins => p_minutes), outside_since = null, outside_alerted_at = null
     where id = v_a.id;
    return public.my_day();
end;
$$;

-- Leave request from the staff app
create function public.my_leave_request(p_type uuid, p_from date, p_to date, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.employees := public.my_employee();
begin
    if v_e.id is null then
        raise exception 'Your login is not linked to an employee yet';
    end if;
    return public.request_leave(v_e.id, p_type, p_from, coalesce(p_to, p_from), false, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner / manager: attendance board, trails, presence checks, linking
-- ---------------------------------------------------------------------------
create function public.attendance_board(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_day date := coalesce(p_date, public.cafe_today(public.current_tenant_id()));
begin
    perform public.require_perm('employees.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'employeeId', e.id, 'name', e.name, 'role', e.role, 'trackLocation', e.track_location,
                   'linked', e.staff_id is not null, 'shiftStart', to_char(e.shift_start, 'HH24:MI'),
                   'attendanceId', a.id, 'status', a.status, 'checkIn', a.check_in, 'checkOut', a.check_out,
                   'checkInAt', a.check_in_at, 'checkOutAt', a.check_out_at,
                   'distanceIn', a.check_in_distance, 'distanceOut', a.check_out_distance,
                   'selfieIn', a.selfie_in, 'selfieOut', a.selfie_out, 'late', a.late_minutes, 'autoClosed', a.auto_closed,
                   'lastPing', a.last_ping_at, 'outsideSince', a.outside_since, 'breakUntil', a.break_until,
                   'onPremises', case when a.check_in_at is null or a.check_out_at is not null then null
                                      when a.break_until > now() then 'break'
                                      when a.outside_since is not null then 'outside'
                                      when not e.track_location then 'not tracked'
                                      when a.last_ping_at < now() - interval '30 minutes' then 'stopped reporting'
                                      else 'inside' end,
                   'breaks', (select coalesce(jsonb_agg(jsonb_build_object('at', b.started_at, 'minutes', b.minutes, 'reason', b.reason)), '[]'::jsonb)
                                from public.attendance_breaks b where b.attendance_id = a.id))
                   order by e.name), '[]'::jsonb)
          from public.employees e
          left join public.attendance a on a.employee_id = e.id and a.date = v_day
         where e.tenant_id = v_tenant and e.is_active);
end;
$$;

create function public.location_trail(p_attendance uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object('at', p.at, 'lat', p.lat, 'lng', p.lng, 'accuracy', p.accuracy,
                                                     'distance', p.distance, 'inside', p.inside) order by p.at), '[]'::jsonb)
          from public.location_pings p
         where p.attendance_id = p_attendance and p.tenant_id = public.current_tenant_id());
end;
$$;

create function public.link_employee_login(p_employee uuid, p_staff uuid, p_track boolean default null, p_shift_start time default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.edit');
    if p_staff is not null and not exists (select 1 from public.staff_users where id = p_staff and tenant_id = public.current_tenant_id()) then
        raise exception 'Staff login not found';
    end if;
    update public.employees set staff_id = null where staff_id = p_staff and id <> p_employee and tenant_id = public.current_tenant_id();
    update public.employees
       set staff_id = p_staff, track_location = coalesce(p_track, track_location), shift_start = coalesce(p_shift_start, shift_start)
     where id = p_employee and tenant_id = public.current_tenant_id();
    if not found then
        raise exception 'Employee not found';
    end if;
end;
$$;

-- Run by any open admin screen every couple of minutes (no server cron needed):
--   phones that stopped reporting, forgotten check-outs, unacknowledged alarms, old location points
create function public.check_presence() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_ping integer := coalesce((public.get_setting('ping_minutes', '10', public.current_tenant_id()) #>> '{}')::integer, 10);
    v_esc integer := coalesce((public.get_setting('escalation_minutes', '5', public.current_tenant_id()) #>> '{}')::integer, 5);
    v_r record;
    v_n integer := 0;
begin
    perform public.require_admin();
    -- Phones that stopped reporting while checked in
    for v_r in select a.id, e.name, a.last_ping_at from public.attendance a join public.employees e on e.id = a.employee_id
                where a.tenant_id = v_tenant and e.track_location and a.check_in_at is not null and a.check_out_at is null
                  and (a.break_until is null or a.break_until < now())
                  and a.last_ping_at < now() - make_interval(mins => greatest(v_ping * 3, 15)) and a.silent_alerted_at is null loop
        perform public.notify(v_tenant, 'staff_silent', v_r.name || '''s phone stopped reporting',
            'Last seen ' || to_char(v_r.last_ping_at at time zone public.cafe_timezone(v_tenant), 'HH24:MI') || '. The app may be closed or the battery saver stopped it.',
            '/admin/attendance', 'employees.edit', 'loud');
        update public.attendance set silent_alerted_at = now() where id = v_r.id;
        v_n := v_n + 1;
    end loop;
    -- Forgotten check-outs from earlier days are closed at shift end and flagged
    update public.attendance a
       set check_out_at = a.check_in_at + make_interval(secs => (e.shift_hours * 3600)::integer),
           check_out = to_char((a.check_in_at + make_interval(secs => (e.shift_hours * 3600)::integer)) at time zone public.cafe_timezone(v_tenant), 'HH24:MI'),
           auto_closed = true, notes = trim(a.notes || ' Auto-closed: no check-out')
      from public.employees e
     where e.id = a.employee_id and a.tenant_id = v_tenant and a.check_in_at is not null and a.check_out_at is null
       and a.date < public.cafe_today(v_tenant);
    -- Alarms nobody acknowledged go to the owner / manager
    for v_r in select * from public.notification_events n
                where n.tenant_id = v_tenant and n.priority = 'alarm' and n.acknowledged_at is null
                  and n.created_at < now() - make_interval(mins => v_esc) and n.created_at > now() - interval '12 hours'
                  and not coalesce((n.payload ->> 'escalated')::boolean, false) loop
        perform public.notify(v_tenant, 'escalation', 'Not answered for ' || v_esc || ' min: ' || v_r.title, v_r.body, v_r.link, 'reports.view', 'alarm',
                              jsonb_build_object('escalated', true, 'from', v_r.id));
        update public.notification_events set payload = payload || '{"escalated": true}' where id = v_r.id;
        v_n := v_n + 1;
    end loop;
    delete from public.location_pings where tenant_id = v_tenant and at < now() - interval '30 days';
    return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification matrix
-- ---------------------------------------------------------------------------
create function public.notification_kinds() returns jsonb
language sql immutable as $$
    select '[
      {"kind": "new_order", "label": "New order", "default": "alarm", "perm": "orders.view"},
      {"kind": "payment_request", "label": "Bill / UPI payment requested", "default": "alarm", "perm": "orders.edit"},
      {"kind": "staff_left", "label": "Staff left the cafe", "default": "alarm", "perm": "employees.edit"},
      {"kind": "staff_silent", "label": "Staff phone stopped reporting", "default": "loud", "perm": "employees.edit"},
      {"kind": "escalation", "label": "Alarm not answered (escalation)", "default": "alarm", "perm": "reports.view"},
      {"kind": "low_stock", "label": "Stock below reorder point", "default": "loud", "perm": "inventory.view"},
      {"kind": "shift_mismatch", "label": "Shift close cash mismatch", "default": "loud", "perm": "finance.view"},
      {"kind": "void", "label": "Order cancelled after kitchen started", "default": "loud", "perm": "reports.view"},
      {"kind": "approval", "label": "Approval needed (leave, penalty)", "default": "loud", "perm": "employees.edit"},
      {"kind": "reward", "label": "Reward triggered (WhatsApp to send)", "default": "loud", "perm": "customers.view"},
      {"kind": "instagram", "label": "Instagram verification waiting", "default": "normal", "perm": "customers.view"},
      {"kind": "khata_due", "label": "Khata due", "default": "normal", "perm": "customers.view"},
      {"kind": "gst_due", "label": "GST / bills due", "default": "normal", "perm": "finance.view"},
      {"kind": "subscription", "label": "Subscription due", "default": "normal", "perm": "settings.edit"}
    ]'::jsonb;
$$;

create function public.notification_matrix() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
begin
    perform public.require_perm('staff.view');
    return jsonb_build_object(
        'kinds', public.notification_kinds(),
        'people', (select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
                       select jsonb_build_object('person', 'staff:' || s.id, 'name', s.name, 'role', r.name) x
                         from public.staff_users s join public.roles r on r.id = s.role_id
                        where s.tenant_id = v_tenant and s.is_active
                       union all
                       select jsonb_build_object('person', 'user:' || p.id, 'name', coalesce(u.email, 'Owner'), 'role', 'Owner (email login)')
                         from public.profiles p join auth.users u on u.id = p.id
                        where p.tenant_id = v_tenant and p.role = 'admin') s),
        'prefs', (select coalesce(jsonb_object_agg(person || '|' || kind, style), '{}'::jsonb) from public.notification_prefs where tenant_id = v_tenant),
        'quiet', (select coalesce(jsonb_object_agg(person, jsonb_build_object('from', to_char(quiet_from, 'HH24:MI'), 'to', to_char(quiet_to, 'HH24:MI'))), '{}'::jsonb)
                    from public.person_settings where tenant_id = v_tenant));
end;
$$;

create function public.set_notification_pref(p_person text, p_kind text, p_style text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not (public.has_perm('staff.edit') or p_person = public.my_person()) then
        raise exception 'Not authorized (staff.edit)';
    end if;
    if p_style is null or p_style = '' then
        delete from public.notification_prefs where tenant_id = public.current_tenant_id() and person = p_person and kind = p_kind;
    else
        insert into public.notification_prefs (tenant_id, person, kind, style) values (public.current_tenant_id(), p_person, p_kind, p_style)
        on conflict (tenant_id, person, kind) do update set style = excluded.style;
    end if;
end;
$$;

create function public.set_quiet_hours(p_person text, p_from time, p_to time) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not (public.has_perm('staff.edit') or p_person = public.my_person()) then
        raise exception 'Not authorized (staff.edit)';
    end if;
    insert into public.person_settings (tenant_id, person, quiet_from, quiet_to) values (public.current_tenant_id(), p_person, p_from, p_to)
    on conflict (tenant_id, person) do update set quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to;
end;
$$;

-- What the signed-in person gets for each event (their choice, else the default; quiet hours turn
-- everything except alarms into "normal")
create function public.my_notification_prefs() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_person text := public.my_person();
    v_tenant uuid := public.current_tenant_id();
    v_q public.person_settings;
    v_now time := (now() at time zone public.cafe_timezone(public.current_tenant_id()))::time;
    v_quiet boolean := false;
begin
    perform public.require_admin();
    select * into v_q from public.person_settings where tenant_id = v_tenant and person = v_person;
    if v_q.quiet_from is not null and v_q.quiet_to is not null then
        v_quiet := case when v_q.quiet_from < v_q.quiet_to then v_now >= v_q.quiet_from and v_now < v_q.quiet_to
                        else v_now >= v_q.quiet_from or v_now < v_q.quiet_to end;
    end if;
    return jsonb_build_object('person', v_person, 'quietNow', v_quiet,
        'styles', (select jsonb_object_agg(k ->> 'kind', coalesce(p.style, k ->> 'default'))
                     from jsonb_array_elements(public.notification_kinds()) k
                     left join public.notification_prefs p on p.tenant_id = v_tenant and p.person = v_person and p.kind = k ->> 'kind'));
end;
$$;

create function public.save_push_subscription(p_endpoint text, p_keys jsonb, p_platform text default 'web') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    insert into public.push_subscriptions (tenant_id, person, endpoint, keys, platform)
    values (public.current_tenant_id(), public.my_person(), p_endpoint, coalesce(p_keys, '{}'), coalesce(p_platform, 'web'))
    on conflict (endpoint) do update set person = excluded.person, tenant_id = excluded.tenant_id, keys = excluded.keys;
end;
$$;

-- Who should get a push for an event, and in which style (used by the push edge function)
create function public.push_targets(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', ps.keys, 'platform', ps.platform,
                                                 'style', coalesce(np.style, k ->> 'default', n.priority))), '[]'::jsonb)
      from public.notification_events n
      join public.push_subscriptions ps on ps.tenant_id = n.tenant_id
      left join lateral (select x as k from jsonb_array_elements(public.notification_kinds()) x where x ->> 'kind' = n.kind) kk on true
      left join public.notification_prefs np on np.tenant_id = n.tenant_id and np.person = ps.person and np.kind = n.kind
     where n.id = p_event
       and coalesce(np.style, k ->> 'default', n.priority) not in ('off', 'digest')
       and (case when ps.person like 'user:%' then true
                 else exists (select 1 from public.staff_users s where s.id = substr(ps.person, 7)::uuid and s.is_active
                                and public.staff_has_perm(s.id, n.perm)) end);
$$;
revoke execute on function public.push_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_targets(uuid) to service_role;

-- New counter/QR orders also ring as an event (style per person from the matrix)
create function public.orders_notify_new() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.channel in ('qr') then
        perform public.notify(new.tenant_id, 'new_order', 'New order ' || coalesce(nullif('· Table ' || new.table_number, '· Table '), '')
                              || ' ' || new.order_number, public.inr(new.total), '/admin/orders', 'orders.view', 'alarm',
                              jsonb_build_object('orderId', new.id));
    end if;
    return null;
end;
$$;
create trigger orders_notify_new after insert on public.orders for each row execute function public.orders_notify_new();

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
alter table public.location_pings enable row level security;
alter table public.attendance_breaks enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.person_settings enable row level security;
alter table public.push_subscriptions enable row level security;
create policy "staff view" on public.location_pings for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));
create policy "staff view" on public.attendance_breaks for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));
create policy "staff view" on public.notification_prefs for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.view')));
create policy "staff view" on public.person_settings for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.view')));

revoke execute on function public.distance_m(double precision, double precision, double precision, double precision) from anon;

commit;
