-- Cafe ERP · Phase 0 upgrade for an existing database (paste into Supabase -> SQL Editor -> Run, once).
-- Adds: cafes (tenants), plans, superadmin, roles & permissions, staff PIN logins, audit log,
-- brands, tax groups, pack units, restricted items, global search. Existing data moves into the 'default' cafe.
begin;

-- ===== 20261004000001_tenancy.sql =====
-- Phase 0 · 1/5: multi-tenancy, plans, superadmin.
-- Existing data moves into a tenant with slug 'default' (the cafe this project already serves).

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Plans and tenants
-- ---------------------------------------------------------------------------
create table public.plans (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    max_staff integer not null default 5 check (max_staff >= 0),
    max_kiosks integer not null default 0 check (max_kiosks >= 0),
    max_devices integer not null default 5 check (max_devices >= 0),
    monthly_price numeric(10, 2) not null default 0,
    features jsonb not null default '{}',
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

insert into public.plans (name, max_staff, max_kiosks, max_devices, monthly_price) values
    ('Starter', 5, 0, 5, 5000),
    ('Pro', 10, 1, 10, 0),
    ('Business', 20, 3, 20, 0),
    ('Custom', 50, 5, 50, 0);

create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
    plan_id uuid references public.plans (id),
    paid_until date,
    grace_days integer not null default 3 check (grace_days >= 0),
    locked boolean not null default false,
    billing_amount numeric(10, 2) not null default 0,
    billing_note text not null default '',
    owner_name text not null default '',
    owner_phone text not null default '',
    owner_email text not null default '',
    created_at timestamptz not null default now()
);

create table public.tenant_payments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    amount numeric(10, 2) not null default 0,
    months integer not null default 1,
    paid_on date not null default current_date,
    note text not null default '',
    recorded_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);

-- The platform owner (N.A.I.R. Solutions). Added only from the SQL editor via make_superadmin().
create table public.platform_admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

insert into public.tenants (name, slug, plan_id, paid_until)
select coalesce((select value #>> '{}' from public.settings where key = 'restaurant_name'), 'Cafe'),
       'default',
       (select id from public.plans where name = 'Custom'),
       current_date + 30;

-- ---------------------------------------------------------------------------
-- Profiles: every session belongs to one tenant (platform admins to none)
-- ---------------------------------------------------------------------------
alter table public.profiles add column tenant_id uuid references public.tenants (id) on delete cascade;
update public.profiles set tenant_id = (select id from public.tenants where slug = 'default');
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
    check (role in ('customer', 'admin', 'staff', 'platform'));

-- ---------------------------------------------------------------------------
-- Tenant helpers
-- ---------------------------------------------------------------------------
create function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select tenant_id from public.profiles where id = auth.uid();
$$;

-- The cafe a browser is looking at, from the x-tenant-slug header the app sends.
-- No header at all (older app versions, other tools) means the 'default' cafe.
create function public.header_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select id from public.tenants
     where slug = coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-slug', 'default');
$$;

-- Public pages (menu) use the header; signed-in sessions fall back to their own tenant
create function public.view_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(public.header_tenant_id(), public.current_tenant_id());
$$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- active | grace | locked
create function public.tenant_status(p_tenant uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when t.locked then 'locked'
        when t.paid_until is null or current_date <= t.paid_until then 'active'
        when current_date <= t.paid_until + t.grace_days then 'grace'
        else 'locked'
    end
    from public.tenants t where t.id = p_tenant;
$$;

create function public.tenant_active(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(public.tenant_status(p_tenant) <> 'locked', false);
$$;

-- ---------------------------------------------------------------------------
-- tenant_id on every tenant-owned table; existing rows go to 'default'
-- ---------------------------------------------------------------------------
do $$
declare
    t text;
    v_default uuid := (select id from public.tenants where slug = 'default');
begin
    foreach t in array array['settings', 'customers', 'categories', 'menu_items', 'collections', 'coupons',
                             'loyalty_settings', 'loyalty_offers', 'dining_tables', 'orders', 'inventory',
                             'employees', 'holidays', 'attendance', 'otp_requests'] loop
        execute format('alter table public.%I add column tenant_id uuid references public.tenants (id) on delete cascade', t);
        execute format('update public.%I set tenant_id = %L', t, v_default);
        execute format('alter table public.%I alter column tenant_id set not null', t);
        execute format('alter table public.%I alter column tenant_id set default public.current_tenant_id()', t);
        execute format('create index %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    end loop;
end $$;

-- Uniqueness is now per cafe
alter table public.settings drop constraint settings_pkey;
alter table public.settings add primary key (tenant_id, key);

alter table public.loyalty_settings drop constraint loyalty_settings_pkey;
alter table public.loyalty_settings drop constraint if exists loyalty_settings_id_check;
alter table public.loyalty_settings drop column id;
alter table public.loyalty_settings add primary key (tenant_id);

alter table public.categories drop constraint categories_name_key;
alter table public.categories add constraint categories_tenant_name_key unique (tenant_id, name);
alter table public.coupons drop constraint coupons_code_key;
alter table public.coupons add constraint coupons_tenant_code_key unique (tenant_id, code);
alter table public.dining_tables drop constraint dining_tables_table_number_key;
alter table public.dining_tables add constraint dining_tables_tenant_number_key unique (tenant_id, table_number);
alter table public.customers drop constraint customers_phone_key;
alter table public.customers add constraint customers_tenant_phone_key unique (tenant_id, phone);
alter table public.holidays drop constraint holidays_date_key;
alter table public.holidays add constraint holidays_tenant_date_key unique (tenant_id, date);
alter table public.collections drop constraint collections_slug_key;
alter table public.collections add constraint collections_tenant_slug_key unique (tenant_id, slug);
alter table public.otp_requests drop constraint otp_requests_pkey;
alter table public.otp_requests add primary key (tenant_id, phone);

-- ---------------------------------------------------------------------------
-- Superadmin setup (SQL editor only): select public.make_superadmin('you@email.com');
-- ---------------------------------------------------------------------------
create function public.make_superadmin(p_email text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_user uuid;
begin
    select id into v_user from auth.users where lower(email) = lower(trim(p_email));
    if v_user is null then
        raise exception 'No user with email %', p_email;
    end if;
    insert into public.platform_admins (user_id) values (v_user) on conflict do nothing;
    insert into public.profiles (id, role, tenant_id) values (v_user, 'platform', null)
    on conflict (id) do update set role = 'platform', tenant_id = null, customer_id = null;
    return 'ok';
end;
$$;
revoke execute on function public.make_superadmin(text) from public, anon, authenticated;

-- ===== 20261004000002_access.sql =====
-- Phase 0 · 2/5: roles, permissions, staff PIN logins, terms acceptance, audit log.

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- Permission keys: '<module>.<view|create|edit|delete>' and 'sensitive.<switch>'.
-- Modules: orders, menu, inventory, employees, customers, coupons, rewards, tables,
--          collections, reports, settings, staff, audit
-- ---------------------------------------------------------------------------
create table public.roles (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    description text not null default '',
    is_owner boolean not null default false,
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

create table public.role_permissions (
    role_id uuid not null references public.roles (id) on delete cascade,
    perm text not null check (perm ~ '^[a-z_]+\.[a-z_]+$'),
    primary key (role_id, perm)
);

create table public.staff_users (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    phone text not null check (phone ~ '^[0-9]{10}$'),
    role_id uuid not null references public.roles (id),
    pin_hash text,
    is_active boolean not null default true,
    failed_attempts integer not null default 0,
    locked_until timestamptz,
    last_login_at timestamptz,
    employee_id uuid references public.employees (id) on delete set null,
    created_at timestamptz not null default now(),
    unique (tenant_id, phone)
);
create index staff_users_tenant_idx on public.staff_users (tenant_id);

-- Per-person exceptions on top of the role
create table public.staff_overrides (
    staff_id uuid not null references public.staff_users (id) on delete cascade,
    perm text not null check (perm ~ '^[a-z_]+\.[a-z_]+$'),
    allow boolean not null,
    primary key (staff_id, perm)
);

alter table public.profiles add column staff_id uuid references public.staff_users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Permission checks
-- ---------------------------------------------------------------------------
create function public.has_perm(p_perm text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_profile public.profiles;
    v_override boolean;
begin
    select * into v_profile from public.profiles where id = auth.uid();
    if v_profile.id is null or v_profile.tenant_id is null then
        return false;
    end if;
    if not public.tenant_active(v_profile.tenant_id) then
        return false;
    end if;
    if v_profile.role = 'admin' then
        return true;
    end if;
    if v_profile.role <> 'staff' or v_profile.staff_id is null then
        return false;
    end if;
    if not exists (select 1 from public.staff_users where id = v_profile.staff_id and is_active) then
        return false;
    end if;
    select allow into v_override from public.staff_overrides where staff_id = v_profile.staff_id and perm = p_perm;
    if v_override is not null then
        return v_override;
    end if;
    return exists (
        select 1 from public.staff_users s
          join public.roles r on r.id = s.role_id
         where s.id = v_profile.staff_id
           and (r.is_owner or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.perm = p_perm)));
end;
$$;

create or replace function public.require_perm(p_perm text) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
    if not public.has_perm(p_perm) then
        raise exception 'Not authorized (%)', p_perm;
    end if;
end;
$$;

-- Staff session of a cafe that isn't locked (owner email login or PIN login)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.role in ('admin', 'staff')
           and public.tenant_active(p.tenant_id)
           and (p.role = 'admin' or exists (select 1 from public.staff_users s where s.id = p.staff_id and s.is_active)));
$$;

create or replace function public.require_admin() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
    if not public.is_admin() then
        raise exception 'Not authorized as admin';
    end if;
end;
$$;

-- All permissions the current user holds ('*' = everything)
create function public.my_permissions() returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_profile public.profiles;
begin
    select * into v_profile from public.profiles where id = auth.uid();
    if v_profile.id is null or not public.tenant_active(v_profile.tenant_id) then
        return '{}';
    end if;
    if v_profile.role = 'admin'
       or exists (select 1 from public.staff_users s join public.roles r on r.id = s.role_id
                   where s.id = v_profile.staff_id and r.is_owner and s.is_active) then
        return array['*'];
    end if;
    if v_profile.role <> 'staff' then
        return '{}';
    end if;
    return coalesce((
        select array_agg(distinct perm order by perm) from (
            select rp.perm from public.staff_users s join public.role_permissions rp on rp.role_id = s.role_id
             where s.id = v_profile.staff_id and s.is_active
               and not exists (select 1 from public.staff_overrides o where o.staff_id = s.id and o.perm = rp.perm and not o.allow)
            union
            select o.perm from public.staff_overrides o where o.staff_id = v_profile.staff_id and o.allow) x), '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- Default roles for a new cafe
-- ---------------------------------------------------------------------------
create function public.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_role uuid;
    v_mods text[] := array['orders', 'menu', 'inventory', 'employees', 'customers', 'coupons', 'rewards',
                           'tables', 'collections', 'reports', 'settings'];
    m text;
    a text;
begin
    insert into public.roles (tenant_id, name, description, is_owner)
    values (p_tenant, 'Owner', 'Everything, always', true)
    on conflict (tenant_id, name) do nothing;

    insert into public.roles (tenant_id, name, description) values (p_tenant, 'Manager', 'Runs the floor, menu, stock and staff schedules')
    on conflict (tenant_id, name) do nothing returning id into v_role;
    if v_role is not null then
        foreach m in array v_mods loop
            foreach a in array array['view', 'create', 'edit', 'delete'] loop
                insert into public.role_permissions values (v_role, m || '.' || a);
            end loop;
        end loop;
        insert into public.role_permissions values (v_role, 'staff.view'), (v_role, 'audit.view'),
            (v_role, 'sensitive.see_cost'), (v_role, 'sensitive.see_profit'),
            (v_role, 'sensitive.see_customer_phone'), (v_role, 'sensitive.give_discount'), (v_role, 'sensitive.void_bill');
    end if;

    v_role := null;
    insert into public.roles (tenant_id, name, description) values (p_tenant, 'Cashier', 'Billing counter: orders, tables, payments')
    on conflict (tenant_id, name) do nothing returning id into v_role;
    if v_role is not null then
        insert into public.role_permissions values (v_role, 'orders.view'), (v_role, 'orders.create'), (v_role, 'orders.edit'),
            (v_role, 'menu.view'), (v_role, 'tables.view'), (v_role, 'tables.edit'), (v_role, 'customers.view'),
            (v_role, 'coupons.view'), (v_role, 'rewards.view'), (v_role, 'sensitive.give_discount');
    end if;

    v_role := null;
    insert into public.roles (tenant_id, name, description) values (p_tenant, 'Kiosk operator', 'Quick kiosk sales')
    on conflict (tenant_id, name) do nothing returning id into v_role;
    if v_role is not null then
        insert into public.role_permissions values (v_role, 'orders.view'), (v_role, 'orders.create'), (v_role, 'orders.edit'),
            (v_role, 'menu.view'), (v_role, 'customers.view');
    end if;

    v_role := null;
    insert into public.roles (tenant_id, name, description) values (p_tenant, 'Chef', 'Kitchen: orders and stock')
    on conflict (tenant_id, name) do nothing returning id into v_role;
    if v_role is not null then
        insert into public.role_permissions values (v_role, 'orders.view'), (v_role, 'orders.edit'),
            (v_role, 'menu.view'), (v_role, 'inventory.view');
    end if;

    v_role := null;
    insert into public.roles (tenant_id, name, description) values (p_tenant, 'Waiter', 'Tables and orders')
    on conflict (tenant_id, name) do nothing returning id into v_role;
    if v_role is not null then
        insert into public.role_permissions values (v_role, 'orders.view'), (v_role, 'orders.create'), (v_role, 'orders.edit'),
            (v_role, 'menu.view'), (v_role, 'tables.view'), (v_role, 'tables.edit');
    end if;

    v_role := null;
    insert into public.roles (tenant_id, name, description) values (p_tenant, 'Accountant', 'Reports, costs and payroll (read only)')
    on conflict (tenant_id, name) do nothing returning id into v_role;
    if v_role is not null then
        insert into public.role_permissions values (v_role, 'reports.view'), (v_role, 'orders.view'), (v_role, 'inventory.view'),
            (v_role, 'employees.view'), (v_role, 'audit.view'), (v_role, 'sensitive.see_cost'),
            (v_role, 'sensitive.see_profit'), (v_role, 'sensitive.see_salary');
    end if;
end;
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;

do $$ begin perform public.seed_tenant_roles(id) from public.tenants; end $$;

-- ---------------------------------------------------------------------------
-- Plan limit: staff users per cafe
-- ---------------------------------------------------------------------------
create function public.staff_plan_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_max integer;
    v_count integer;
begin
    if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
        select p.max_staff into v_max from public.tenants t join public.plans p on p.id = t.plan_id where t.id = new.tenant_id;
        select count(*) into v_count from public.staff_users where tenant_id = new.tenant_id and is_active and id <> new.id;
        if v_max is not null and v_count >= v_max then
            raise exception 'Your plan allows % staff users. Upgrade the plan to add more.', v_max;
        end if;
    end if;
    return new;
end;
$$;
create trigger staff_plan_limit before insert or update of is_active on public.staff_users
    for each row execute function public.staff_plan_limit();

-- A staff member's role must belong to the same cafe
create function public.staff_role_same_tenant() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not exists (select 1 from public.roles where id = new.role_id and tenant_id = new.tenant_id) then
        raise exception 'Role not found';
    end if;
    return new;
end;
$$;
create trigger staff_role_same_tenant before insert or update of role_id on public.staff_users
    for each row execute function public.staff_role_same_tenant();

-- ---------------------------------------------------------------------------
-- Staff PIN login: the device signs in anonymously, then proves the PIN.
-- Returns {ok, message}; never raises, so failed attempts are counted.
-- ---------------------------------------------------------------------------
create function public.staff_pin_login(p_phone text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
    v_tenant uuid := public.header_tenant_id();
    v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
    v_staff public.staff_users;
begin
    if auth.uid() is null then
        return jsonb_build_object('ok', false, 'message', 'Not signed in');
    end if;
    if v_tenant is null then
        return jsonb_build_object('ok', false, 'message', 'Unknown cafe');
    end if;
    select * into v_staff from public.staff_users where tenant_id = v_tenant and phone = v_phone;
    if v_staff.id is null or not v_staff.is_active or v_staff.pin_hash is null then
        return jsonb_build_object('ok', false, 'message', 'Invalid phone or PIN');
    end if;
    if v_staff.locked_until is not null and v_staff.locked_until > now() then
        return jsonb_build_object('ok', false, 'message',
            format('Too many wrong PINs. Try again in %s min or ask the admin to reset it.',
                   ceil(extract(epoch from v_staff.locked_until - now()) / 60)));
    end if;
    if crypt(coalesce(p_pin, ''), v_staff.pin_hash) <> v_staff.pin_hash then
        update public.staff_users
           set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
               locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
         where id = v_staff.id;
        return jsonb_build_object('ok', false, 'message', 'Invalid phone or PIN');
    end if;
    if not public.tenant_active(v_tenant) then
        return jsonb_build_object('ok', false, 'message', 'This account is locked. Please contact N.A.I.R. Solutions.');
    end if;
    update public.staff_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = v_staff.id;
    insert into public.profiles (id, role, tenant_id, staff_id, customer_id)
    values (auth.uid(), 'staff', v_tenant, v_staff.id, null)
    on conflict (id) do update set role = 'staff', tenant_id = excluded.tenant_id, staff_id = excluded.staff_id, customer_id = null;
    return jsonb_build_object('ok', true);
end;
$$;

-- Admin sets or resets a PIN; signs that person out everywhere
create function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
    perform public.require_perm('staff.edit');
    if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
        raise exception 'PIN must be 4 to 6 digits';
    end if;
    update public.staff_users
       set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null
     where id = p_staff_id and tenant_id = public.current_tenant_id();
    if not found then
        raise exception 'Staff member not found';
    end if;
    delete from public.profiles where staff_id = p_staff_id;
end;
$$;

-- Signs a staff member out of every device when deactivated or their role changes
create function public.staff_sessions_reset() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if (not new.is_active and old.is_active) or new.role_id <> old.role_id then
        delete from public.profiles where staff_id = new.id;
    end if;
    return new;
end;
$$;
create trigger staff_sessions_reset after update of is_active, role_id on public.staff_users
    for each row execute function public.staff_sessions_reset();

-- ---------------------------------------------------------------------------
-- Terms and acceptances
-- ---------------------------------------------------------------------------
create table public.terms_versions (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('owner', 'staff')),
    version integer not null,
    title text not null,
    body text not null,
    created_at timestamptz not null default now(),
    unique (kind, version)
);

insert into public.terms_versions (kind, version, title, body) values
('owner', 1, 'Platform terms for cafe owners',
 E'1. N.A.I.R. Solutions provides this software as a monthly subscription.\n'
 '2. Fees are due on the date shown in the app. If unpaid after the grace period, the account is locked until payment; your data is kept and can be exported.\n'
 '3. The number of staff users, kiosks and devices is limited by your plan.\n'
 '4. You are responsible for the accuracy of prices, taxes and the data your staff enter, and for collecting your staff''s consent where required.\n'
 '5. Customer and staff data belongs to the cafe; N.A.I.R. Solutions processes it only to run the service and keeps it confidential.\n'
 '6. Support access by N.A.I.R. Solutions is logged and visible to you.'),
('staff', 1, 'Staff terms and consent',
 E'1. This app records your logins, attendance and the actions you take (orders, payments, stock and changes) under your name.\n'
 '2. Keep your PIN secret. Actions done with your PIN are treated as yours.\n'
 '3. When attendance tracking is switched on for you by the cafe, the app records your location at check-in, check-out and periodically during your shift only, to confirm you are on the premises. Location history is deleted after 30 days.\n'
 '4. The cafe owner and managers can see your attendance, location alerts and work records.\n'
 '5. You can ask the cafe owner to switch location tracking off; you will then check in at the counter instead.\n'
 '6. By tapping "I agree" you give this consent. A copy is stored with the date and time.');

create table public.acceptances (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants (id) on delete cascade,
    user_id uuid,
    staff_id uuid references public.staff_users (id) on delete set null,
    kind text not null,
    version integer not null,
    accepted_name text not null default '',
    accepted_phone text not null default '',
    user_agent text not null default '',
    accepted_at timestamptz not null default now()
);
create index acceptances_tenant_idx on public.acceptances (tenant_id, accepted_at desc);

-- Terms the signed-in staff or owner still has to accept (null = none)
create function public.pending_terms() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_profile public.profiles;
    v_kind text;
    v_terms public.terms_versions;
begin
    select * into v_profile from public.profiles where id = auth.uid();
    if v_profile.role = 'admin' then v_kind := 'owner';
    elsif v_profile.role = 'staff' then v_kind := 'staff';
    else return null;
    end if;
    select * into v_terms from public.terms_versions where kind = v_kind order by version desc limit 1;
    if v_terms.id is null then
        return null;
    end if;
    if exists (select 1 from public.acceptances a
                where a.kind = v_kind and a.version = v_terms.version
                  and ((v_kind = 'staff' and a.staff_id = v_profile.staff_id)
                       or (v_kind = 'owner' and a.user_id = v_profile.id))) then
        return null;
    end if;
    return jsonb_build_object('kind', v_terms.kind, 'version', v_terms.version, 'title', v_terms.title, 'body', v_terms.body);
end;
$$;

create function public.accept_terms(p_kind text, p_version integer, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_profile public.profiles;
    v_staff public.staff_users;
begin
    select * into v_profile from public.profiles where id = auth.uid();
    if v_profile.id is null or v_profile.role not in ('admin', 'staff') then
        raise exception 'Not signed in';
    end if;
    select * into v_staff from public.staff_users where id = v_profile.staff_id;
    insert into public.acceptances (tenant_id, user_id, staff_id, kind, version, accepted_name, accepted_phone, user_agent)
    values (v_profile.tenant_id, v_profile.id, v_profile.staff_id, p_kind, p_version,
            coalesce(v_staff.name, (select email from auth.users where id = v_profile.id), ''),
            coalesce(v_staff.phone, ''), left(coalesce(p_user_agent, ''), 300));
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log: who changed what, before and after. Nobody can edit it.
-- ---------------------------------------------------------------------------
create table public.audit_log (
    id bigint generated always as identity primary key,
    tenant_id uuid references public.tenants (id) on delete cascade,
    at timestamptz not null default now(),
    actor_user uuid,
    actor_staff uuid,
    actor_name text not null default '',
    action text not null,
    entity text not null,
    entity_id text not null default '',
    summary text not null default '',
    old_data jsonb,
    new_data jsonb
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, at desc);

create function public.actor_name() returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select s.name from public.profiles p join public.staff_users s on s.id = p.staff_id where p.id = auth.uid()),
        (select c.name from public.profiles p join public.customers c on c.id = p.customer_id where p.id = auth.uid()),
        (select u.email from auth.users u where u.id = auth.uid()),
        'System');
$$;

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'pin_hash' - 'salary' end;
    v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'pin_hash' - 'salary' end;
    v_row jsonb := coalesce(v_new, v_old);
    v_summary text;
begin
    if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'failed_attempts' - 'last_login_at' - 'locked_until')
                          = (v_new - 'updated_at' - 'failed_attempts' - 'last_login_at' - 'locked_until') then
        if tg_table_name <> 'staff_users' then
            return null;
        end if;
        -- (nested: a record field can only be read on the table that has it)
        if old.pin_hash is distinct from new.pin_hash then
            v_summary := 'PIN reset';
        else
            return null;
        end if;
    end if;
    if tg_table_name = 'orders' and tg_op = 'INSERT' then
        return null;
    end if;
    if tg_table_name = 'orders' and tg_op = 'UPDATE' then
        if new.status = old.status and new.amount_paid = old.amount_paid and new.payment_method = old.payment_method then
            return null;
        end if;
    end if;
    insert into public.audit_log (tenant_id, actor_user, actor_staff, actor_name, action, entity, entity_id, summary, old_data, new_data)
    values (
        (v_row ->> 'tenant_id')::uuid,
        auth.uid(),
        (select staff_id from public.profiles where id = auth.uid()),
        public.actor_name(),
        lower(tg_op), tg_table_name,
        coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'role_id', v_row ->> 'staff_id', ''),
        coalesce(v_summary, v_row ->> 'name', v_row ->> 'order_number', v_row ->> 'code', v_row ->> 'key', v_row ->> 'perm', ''),
        v_old, v_new);
    return null;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['menu_items', 'categories', 'settings', 'coupons', 'loyalty_settings', 'loyalty_offers',
                             'roles', 'staff_users', 'orders', 'employees'] loop
        execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    end loop;
end $$;

-- role_permissions / staff_overrides have no tenant column: log against the role's / person's cafe
create function public.audit_perm_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_row jsonb := to_jsonb(coalesce(new, old));
    v_tenant uuid;
    v_entity text;
begin
    if tg_table_name = 'role_permissions' then
        select tenant_id, name into v_tenant, v_entity from public.roles where id = (v_row ->> 'role_id')::uuid;
    else
        select tenant_id, name into v_tenant, v_entity from public.staff_users where id = (v_row ->> 'staff_id')::uuid;
    end if;
    if v_tenant is null then
        return null;
    end if;
    insert into public.audit_log (tenant_id, actor_user, actor_staff, actor_name, action, entity, entity_id, summary, old_data, new_data)
    values (v_tenant, auth.uid(), (select staff_id from public.profiles where id = auth.uid()), public.actor_name(),
            lower(tg_op), tg_table_name, coalesce(v_row ->> 'role_id', v_row ->> 'staff_id'),
            v_entity || ': ' || (v_row ->> 'perm') ||
                case when tg_table_name = 'staff_overrides' then ' = ' || coalesce(v_row ->> 'allow', '') else '' end,
            case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
    return null;
end;
$$;
create trigger audit_role_permissions after insert or delete on public.role_permissions
    for each row execute function public.audit_perm_row();
create trigger audit_staff_overrides after insert or update or delete on public.staff_overrides
    for each row execute function public.audit_perm_row();

-- ===== 20261004000003_catalogue.sql =====
-- Phase 0 · 3/5: catalogue v2 — sub-categories, brands, item types, units and packs,
-- per-item tax groups, MRP / tax-inclusive pricing, restricted items.

alter table public.categories add column parent_id uuid references public.categories (id) on delete set null;
alter table public.categories add constraint categories_not_own_parent check (parent_id is null or parent_id <> id);

create table public.brands (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

-- A tax group = one or more components, e.g. [{"name":"CGST","rate":2.5},{"name":"SGST","rate":2.5}]
create table public.tax_groups (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    components jsonb not null default '[]' check (jsonb_typeof(components) = 'array'),
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

alter table public.menu_items
    add column brand_id uuid references public.brands (id) on delete set null,
    add column item_type text not null default 'dish' check (item_type in ('dish', 'resale', 'combo')),
    add column unit text not null default 'pc',
    add column mrp numeric(10, 2),
    add column price_includes_tax boolean not null default false,
    add column tax_group_id uuid references public.tax_groups (id) on delete set null,
    add column is_restricted boolean not null default false,
    add column sku text not null default '';

alter table public.menu_items add constraint menu_items_price_within_mrp check (mrp is null or price <= mrp);

-- Pack units: 1 Pack = 10 pieces, 1 Crate = 24 bottles
create table public.item_units (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    name text not null,
    factor numeric(12, 3) not null check (factor > 0),
    sale_price numeric(10, 2),
    created_at timestamptz not null default now(),
    unique (menu_item_id, name)
);

-- Order lines remember how they were taxed and whether they were restricted
alter table public.order_items
    add column is_restricted boolean not null default false,
    add column price_includes_tax boolean not null default false,
    add column tax_rate numeric(6, 3) not null default 0,
    add column discount numeric(10, 2) not null default 0,
    add column net_amount numeric(10, 2) not null default 0,
    add column tax_amount numeric(10, 2) not null default 0,
    add column unit_cost numeric(10, 2) not null default 0;

-- Older orders: the line total is the best available net amount
update public.order_items set net_amount = total;

create index menu_items_name_trgm on public.menu_items using gin (name extensions.gin_trgm_ops);
create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);

-- ===== 20261004000004_logic_v2.sql =====
-- Phase 0 · 4/5: business logic, now per cafe (tenant) and per permission.
-- Replaces the functions from 20261002000002/3 with tenant-aware versions.

-- ---------------------------------------------------------------------------
-- Settings and time, per cafe
-- ---------------------------------------------------------------------------
drop function public.get_setting(text, jsonb);
create function public.get_setting(p_key text, p_default jsonb default null, p_tenant uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select value from public.settings where key = p_key and tenant_id = coalesce(p_tenant, public.view_tenant_id())),
        p_default);
$$;

drop function public.cafe_timezone();
create function public.cafe_timezone(p_tenant uuid default null) returns text
language sql stable set search_path = public, pg_temp as $$
    select coalesce(public.get_setting('timezone', null, p_tenant) #>> '{}', 'Asia/Kolkata');
$$;

-- Default settings, loyalty row and roles for a new cafe
create function public.seed_tenant(p_tenant uuid, p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into public.settings (tenant_id, key, value, description) values
        (p_tenant, 'gst_rate', '5', 'Default GST rate (%)'),
        (p_tenant, 'tax_config', '[{"name":"CGST","rate":2.5},{"name":"SGST","rate":2.5}]', 'Default taxes for items without a tax group'),
        (p_tenant, 'restaurant_name', to_jsonb(p_name), 'Name printed on bills'),
        (p_tenant, 'restaurant_address', '""', 'Address printed on bills'),
        (p_tenant, 'restaurant_phone', '""', 'Phone printed on bills'),
        (p_tenant, 'gst_number', '""', 'GSTIN printed on bills'),
        (p_tenant, 'fssai_number', '""', 'FSSAI licence number printed on bills'),
        (p_tenant, 'profit_margin', '30', 'Estimated profit margin (%) for analytics'),
        (p_tenant, 'timezone', '"Asia/Kolkata"', 'Timezone used for daily reports'),
        (p_tenant, 'otp_login_enabled', 'false', 'Require SMS OTP for customer login')
    on conflict (tenant_id, key) do nothing;
    insert into public.loyalty_settings (tenant_id) values (p_tenant) on conflict do nothing;
    perform public.seed_tenant_roles(p_tenant);
end;
$$;
revoke execute on function public.seed_tenant(uuid, text) from public, anon, authenticated;

insert into public.settings (tenant_id, key, value, description)
select id, 'fssai_number', '""', 'FSSAI licence number printed on bills' from public.tenants
on conflict (tenant_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Triggers that must stay inside one cafe
-- ---------------------------------------------------------------------------
create or replace function public.menu_items_single_upsell() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if new.is_upsell then
        update public.menu_items set is_upsell = false
         where id <> new.id and is_upsell and tenant_id = new.tenant_id;
    end if;
    return new;
end;
$$;

create or replace function public.attendance_holiday() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.holidays where date = new.date and tenant_id = new.tenant_id) then
        new.status := 'holiday';
    end if;
    return new;
end;
$$;

create or replace function public.holidays_mark_attendance() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    update public.attendance set status = 'holiday' where date = new.date and tenant_id = new.tenant_id;
    return new;
end;
$$;

-- Points on payment are earned only on non-restricted items, after their discount
create or replace function public.orders_status_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_settings public.loyalty_settings;
    v_base numeric;
    v_points integer := 0;
begin
    if new.status = old.status then
        return new;
    end if;

    if new.status = 'paid' and new.points_awarded = 0 and new.customer_id is not null then
        select * into v_settings from public.loyalty_settings where tenant_id = new.tenant_id;
        select coalesce(sum(oi.total - oi.discount), 0) into v_base
          from public.order_items oi where oi.order_id = new.id and not oi.is_restricted;
        if v_settings.is_active and v_base > 0 and v_base >= v_settings.min_order_for_points then
            v_points := floor(v_base * v_settings.points_per_rupee);
            select v_points + coalesce(sum(mi.bonus_loyalty_points * oi.quantity), 0)
              into v_points
              from public.order_items oi
              join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = new.id and not oi.is_restricted;
            if v_points > 0 then
                update public.customers
                   set loyalty_points = loyalty_points + v_points,
                       total_points_earned = total_points_earned + v_points
                 where id = new.customer_id;
                new.points_awarded := v_points;
            end if;
        end if;
    end if;

    if new.status = 'cancelled' and old.status <> 'cancelled'
       and new.points_redeemed > 0 and new.customer_id is not null then
        update public.customers
           set loyalty_points = loyalty_points + new.points_redeemed
         where id = new.customer_id;
    end if;

    if new.status in ('paid', 'cancelled') and new.table_id is not null then
        perform public.free_table_if_idle(new.table_id, new.id);
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers: name + mobile login for the cafe in the x-tenant-slug header
-- ---------------------------------------------------------------------------
drop function public.link_customer(uuid, text, text, text, boolean);
create function public.link_customer(p_user uuid, p_tenant uuid, p_name text, p_phone text, p_email text, p_verified boolean)
returns public.customers
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    v_name text := trim(coalesce(p_name, ''));
    v_customer public.customers;
begin
    if p_user is null then
        raise exception 'Not signed in';
    end if;
    if p_tenant is null then
        raise exception 'Unknown cafe';
    end if;
    if length(v_phone) = 12 and left(v_phone, 2) = '91' then
        v_phone := right(v_phone, 10);
    end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
        raise exception 'Enter a valid 10-digit mobile number';
    end if;
    if exists (select 1 from public.profiles where id = p_user and role in ('admin', 'staff', 'platform')) then
        raise exception 'Admin accounts cannot place customer orders';
    end if;

    insert into public.customers (tenant_id, phone, name, email, phone_verified)
    values (p_tenant, v_phone, v_name, coalesce(trim(p_email), ''), p_verified)
    on conflict (tenant_id, phone) do update
        set name = case when excluded.name <> '' then excluded.name else public.customers.name end,
            email = case when excluded.email <> '' then excluded.email else public.customers.email end,
            phone_verified = public.customers.phone_verified or excluded.phone_verified
    returning * into v_customer;

    if v_customer.name = '' then
        raise exception 'Name is required';
    end if;

    insert into public.profiles (id, role, tenant_id, customer_id)
    values (p_user, 'customer', p_tenant, v_customer.id)
    on conflict (id) do update set customer_id = excluded.customer_id, tenant_id = excluded.tenant_id;

    return v_customer;
end;
$$;
revoke execute on function public.link_customer(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.link_customer(uuid, uuid, text, text, text, boolean) to service_role;

create or replace function public.customer_sign_in(p_name text, p_phone text, p_email text default '')
returns public.customers
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.header_tenant_id();
begin
    if coalesce((public.get_setting('otp_login_enabled', null, v_tenant) #>> '{}')::boolean, false) then
        raise exception 'OTP verification required';
    end if;
    return public.link_customer(auth.uid(), v_tenant, p_name, p_phone, p_email, false);
end;
$$;

-- The signed-in person: customer, staff, owner or platform admin
create or replace function public.me() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_profile public.profiles;
    v_customer public.customers;
    v_staff public.staff_users;
    v_role public.roles;
    v_tenant public.tenants;
    v_email text;
begin
    select * into v_profile from public.profiles where id = auth.uid();
    if v_profile.id is null then
        return null;
    end if;
    select email into v_email from auth.users where id = v_profile.id;
    if v_profile.role = 'platform' then
        return jsonb_build_object('_id', v_profile.id, 'id', v_profile.id, 'role', 'platform',
            'name', 'Platform admin', 'email', coalesce(v_email, ''), 'permissions', '[]'::jsonb);
    end if;
    select * into v_tenant from public.tenants where id = v_profile.tenant_id;
    if v_profile.role = 'customer' then
        select * into v_customer from public.customers where id = v_profile.customer_id;
        if v_customer.id is null then
            return null;
        end if;
        return jsonb_build_object(
            '_id', v_customer.id, 'id', v_customer.id, 'role', 'customer',
            'name', v_customer.name, 'phone', v_customer.phone, 'email', v_customer.email,
            'loyaltyPoints', v_customer.loyalty_points, 'totalPointsEarned', v_customer.total_points_earned,
            'phoneVerified', v_customer.phone_verified,
            'tenant', jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'slug', v_tenant.slug));
    end if;
    if v_profile.role = 'staff' then
        select * into v_staff from public.staff_users where id = v_profile.staff_id and is_active;
        if v_staff.id is null then
            return null;
        end if;
        select * into v_role from public.roles where id = v_staff.role_id;
    end if;
    return jsonb_build_object(
        '_id', v_profile.id, 'id', v_profile.id,
        'role', 'admin',
        'kind', v_profile.role,
        'staffId', v_staff.id,
        'name', coalesce(v_staff.name, 'Owner'),
        'phone', coalesce(v_staff.phone, ''),
        'email', coalesce(v_email, ''),
        'roleName', case when v_profile.role = 'admin' then 'Owner' else v_role.name end,
        'isOwner', v_profile.role = 'admin' or coalesce(v_role.is_owner, false),
        'permissions', to_jsonb(public.my_permissions()),
        'pendingTerms', public.pending_terms(),
        'tenant', jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'slug', v_tenant.slug,
                                     'status', public.tenant_status(v_tenant.id), 'paidUntil', v_tenant.paid_until,
                                     'graceDays', v_tenant.grace_days));
end;
$$;

-- Public info about the cafe a page is showing (works signed out)
create function public.get_tenant_public() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'status', public.tenant_status(t.id))
      from public.tenants t where t.id = public.header_tenant_id();
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create function public.can_see_phone(p_customer uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select p_customer = public.current_customer_id() or public.has_perm('sensitive.see_customer_phone');
$$;

create function public.mask_phone(p_phone text) returns text
language sql immutable as $$
    select case when coalesce(p_phone, '') = '' then '' else '******' || right(p_phone, 4) end;
$$;

create or replace function public.order_json(o public.orders) returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select jsonb_build_object(
        '_id', o.id, 'id', o.id,
        'orderNumber', o.order_number,
        'user', case when c.id is null then null else
            jsonb_build_object('_id', c.id, 'name', c.name,
                'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end,
                'email', c.email) end,
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                '_id', oi.id,
                'menuItem', case when mi.id is null then null else
                    jsonb_build_object('_id', mi.id, 'name', mi.name, 'image', mi.image, 'price', mi.price) end,
                'name', oi.name, 'price', oi.price, 'quantity', oi.quantity, 'total', oi.total,
                'discount', oi.discount, 'taxRate', oi.tax_rate, 'isRestricted', oi.is_restricted)
                order by oi.name)
              from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = o.id), '[]'::jsonb),
        'subtotal', o.subtotal, 'discount', o.discount, 'couponCode', o.coupon_code,
        'tax', o.tax, 'gstRate', o.gst_rate, 'taxDetails', o.tax_details,
        'restaurantInfo', o.restaurant_info, 'total', o.total, 'status', o.status,
        'paymentMethod', o.payment_method, 'amountPaid', o.amount_paid,
        'tableNumber', o.table_number, 'table', o.table_id,
        'specialInstructions', o.special_instructions,
        'loyaltyOffer', o.loyalty_offer_id, 'pointsRedeemed', o.points_redeemed,
        'pointsAwarded', o.points_awarded,
        'createdAt', o.created_at, 'updatedAt', o.updated_at)
      from (select 1) x
      left join public.customers c on c.id = o.customer_id;
$$;

create or replace function public.admin_orders(p_scope text default 'all', p_status text default null, p_date date default null)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.view');
    return (
        select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
          from public.orders o
         where o.tenant_id = public.current_tenant_id()
           and (p_scope <> 'active' or o.status not in ('paid', 'cancelled'))
           and (p_status is null or p_status = '' or o.status = p_status)
           and (p_date is null or (o.created_at at time zone public.cafe_timezone())::date = p_date));
end;
$$;

-- Prices an order from the database: discounts are spread over the lines they apply to,
-- each line is taxed by its own tax group (or the cafe default), MRP items include tax.
-- Restricted items never get coupons or loyalty rewards.
create function public.price_order(p_tenant uuid, p_customer uuid, p_items jsonb, p_coupon_code text, p_loyalty_offer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_item jsonb;
    v_menu public.menu_items;
    v_qty integer;
    v_lines jsonb := '[]'::jsonb;
    v_subtotal numeric := 0;
    v_eligible numeric := 0;
    v_coupon_base numeric := 0;
    v_code text := upper(trim(coalesce(p_coupon_code, '')));
    v_coupon public.coupons;
    v_coupon_disc numeric := 0;
    v_offer public.loyalty_offers;
    v_offer_disc numeric := 0;
    v_points integer;
    v_default jsonb;
    v_comps jsonb;
    v_coupon_ok boolean;
    v_calc jsonb;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'No items in order';
    end if;
    if jsonb_array_length(p_items) > 50 then
        raise exception 'Too many items in one order';
    end if;

    if v_code <> '' then
        select * into v_coupon from public.coupons
         where tenant_id = p_tenant and code = v_code and is_active
           and valid_from <= now() and valid_until >= now();
        if v_coupon.id is null then
            raise exception 'Invalid coupon code';
        end if;
    end if;

    v_default := public.get_setting('tax_config', null, p_tenant);
    if v_default is null or jsonb_typeof(v_default) <> 'array' then
        v_default := jsonb_build_array(jsonb_build_object('name', 'GST',
            'rate', coalesce((public.get_setting('gst_rate', '5', p_tenant) #>> '{}')::numeric, 5)));
    end if;

    for v_item in select * from jsonb_array_elements(p_items) loop
        v_qty := (v_item ->> 'quantity')::integer;
        if v_qty is null or v_qty < 1 or v_qty > 99 then
            raise exception 'Invalid quantity';
        end if;
        select * into v_menu from public.menu_items
         where id = (v_item ->> 'menuItem')::uuid and tenant_id = p_tenant;
        if v_menu.id is null then
            raise exception 'Menu item not found';
        end if;
        if not v_menu.is_available then
            raise exception '% is not available', v_menu.name;
        end if;
        select components into v_comps from public.tax_groups where id = v_menu.tax_group_id;
        v_comps := coalesce(v_comps, v_default);
        v_coupon_ok := v_coupon.id is not null and not v_menu.is_restricted and (
            (cardinality(v_coupon.applicable_items) = 0 and cardinality(v_coupon.applicable_categories) = 0)
            or v_menu.id = any (v_coupon.applicable_items)
            or v_menu.category_id = any (v_coupon.applicable_categories));
        v_subtotal := v_subtotal + v_menu.price * v_qty;
        if not v_menu.is_restricted then
            v_eligible := v_eligible + v_menu.price * v_qty;
        end if;
        if v_coupon_ok then
            v_coupon_base := v_coupon_base + v_menu.price * v_qty;
        end if;
        v_lines := v_lines || jsonb_build_object(
            'menu_item_id', v_menu.id, 'name', v_menu.name, 'price', v_menu.price, 'quantity', v_qty,
            'total', v_menu.price * v_qty, 'is_restricted', v_menu.is_restricted,
            'price_includes_tax', v_menu.price_includes_tax, 'unit_cost', v_menu.cost_price,
            'coupon_ok', v_coupon_ok, 'comps', v_comps,
            'tax_rate', (select coalesce(sum((c ->> 'rate')::numeric), 0) from jsonb_array_elements(v_comps) c));
    end loop;

    if v_coupon.id is not null then
        if v_coupon_base = 0 then
            raise exception 'This coupon does not apply to the items in your cart';
        end if;
        v_coupon_disc := public.coupon_discount(v_coupon, v_eligible, v_coupon_base);
    end if;

    if p_loyalty_offer_id is not null then
        select * into v_offer from public.loyalty_offers
         where id = p_loyalty_offer_id and tenant_id = p_tenant and is_active;
        if v_offer.id is null then
            raise exception 'This reward is no longer available';
        end if;
        if not coalesce((select is_active from public.loyalty_settings where tenant_id = p_tenant), false) then
            raise exception 'Loyalty program is currently disabled';
        end if;
        select loyalty_points into v_points from public.customers where id = p_customer;
        if coalesce(v_points, 0) < v_offer.points_required then
            raise exception 'Not enough loyalty points for this reward';
        end if;
        if v_eligible < v_offer.min_order_value then
            raise exception 'Minimum order for this reward is ₹%', v_offer.min_order_value;
        end if;
        v_offer_disc := round(least(v_offer.discount_value, v_eligible - v_coupon_disc), 2);
    end if;

    with l as (
        select ord, x,
               (x ->> 'total')::numeric as t,
               (x ->> 'coupon_ok')::boolean as cok,
               not (x ->> 'is_restricted')::boolean as eok,
               (x ->> 'price_includes_tax')::boolean as incl,
               (x ->> 'tax_rate')::numeric as rate
          from jsonb_array_elements(v_lines) with ordinality as e(x, ord)),
    w as (
        select *, sum(case when cok then t else 0 end) over (order by ord) as ccum,
                  sum(case when eok then t else 0 end) over (order by ord) as ecum
          from l),
    d as (
        select *,
               (case when cok and v_coupon_base > 0
                     then round(v_coupon_disc * ccum / v_coupon_base, 2) - round(v_coupon_disc * (ccum - t) / v_coupon_base, 2)
                     else 0 end)
             + (case when eok and v_eligible > 0
                     then round(v_offer_disc * ecum / v_eligible, 2) - round(v_offer_disc * (ecum - t) / v_eligible, 2)
                     else 0 end) as disc
          from w),
    n as (
        select *, t - disc as gross,
               case when incl then round((t - disc) / (1 + rate / 100), 2) else t - disc end as net
          from d),
    comp as (
        select n.incl, n.gross, n.net, n.rate as line_rate, c
          from n, jsonb_array_elements(n.x -> 'comps') c),
    buckets as (
        select c ->> 'name' as name, (c ->> 'rate')::numeric as rate,
               sum(case when incl then case when line_rate > 0 then (gross - net) * (c ->> 'rate')::numeric / line_rate else 0 end
                        else net * (c ->> 'rate')::numeric / 100 end) as amt,
               sum(case when incl then 0 else net * (c ->> 'rate')::numeric / 100 end) as excl_amt
          from comp group by 1, 2)
    select jsonb_build_object(
        'lines', (select jsonb_agg((x - 'comps' - 'coupon_ok') || jsonb_build_object(
                         'discount', disc, 'net_amount', net,
                         'tax_amount', case when incl then gross - net else round(net * rate / 100, 2) end) order by ord) from n),
        'gross', (select sum(case when incl then gross else net end) from n),
        'tax_details', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'rate', rate, 'amount', round(amt, 2))
                                                  order by name, rate), '[]'::jsonb) from buckets where amt <> 0),
        'tax', (select coalesce(sum(round(amt, 2)), 0) from buckets),
        'excl_tax', (select coalesce(sum(round(excl_amt, 2)), 0) from buckets))
      into v_calc;

    return jsonb_build_object(
        'lines', v_calc -> 'lines',
        'subtotal', v_subtotal,
        'eligibleSubtotal', v_eligible,
        'couponDiscount', v_coupon_disc,
        'offerDiscount', v_offer_disc,
        'discount', v_coupon_disc + v_offer_disc,
        'couponId', v_coupon.id,
        'couponCode', coalesce(v_coupon.code, ''),
        'offerId', v_offer.id,
        'pointsUsed', coalesce(v_offer.points_required, 0),
        'tax', (v_calc ->> 'tax')::numeric,
        'taxDetails', v_calc -> 'tax_details',
        'total', (v_calc ->> 'gross')::numeric + (v_calc ->> 'excl_tax')::numeric);
end;
$$;
revoke execute on function public.price_order(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Exact bill preview for the cart (same maths as placing the order)
create function public.quote_order(p_items jsonb, p_coupon_code text default '', p_loyalty_offer_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_customer uuid := public.current_customer_id();
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = v_customer), public.header_tenant_id());
    v_quote jsonb;
begin
    v_quote := public.price_order(v_tenant, v_customer, p_items, p_coupon_code, p_loyalty_offer_id);
    return v_quote - 'lines' - 'couponId' - 'offerId';
end;
$$;

create or replace function public.validate_coupon(p_code text, p_order_total numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_coupon public.coupons;
    v_discount numeric;
begin
    select * into v_coupon from public.coupons
     where tenant_id = public.view_tenant_id() and code = upper(trim(p_code)) and is_active
       and valid_from <= now() and valid_until >= now();
    if v_coupon.id is null then
        raise exception 'Invalid coupon code';
    end if;
    v_discount := public.coupon_discount(v_coupon, p_order_total, p_order_total);
    return jsonb_build_object(
        'valid', true,
        'coupon', jsonb_build_object(
            'code', v_coupon.code, 'description', v_coupon.description,
            'discountType', v_coupon.discount_type, 'discountValue', v_coupon.discount_value),
        'discount', v_discount);
end;
$$;

create or replace function public.place_order(
    p_items jsonb,
    p_coupon_code text default '',
    p_table_id uuid default null,
    p_special_instructions text default '',
    p_loyalty_offer_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_customer_id uuid := public.current_customer_id();
    v_customer public.customers;
    v_tenant uuid;
    v_table public.dining_tables;
    v_calc jsonb;
    v_order_id uuid;
    v_tz text;
begin
    if v_customer_id is null then
        raise exception 'Please sign in first';
    end if;
    select * into v_customer from public.customers where id = v_customer_id for update;
    v_tenant := v_customer.tenant_id;
    if not public.tenant_active(v_tenant) then
        raise exception 'Ordering is paused at the moment. Please ask the staff.';
    end if;
    v_tz := public.cafe_timezone(v_tenant);

    if p_table_id is not null then
        select * into v_table from public.dining_tables
         where id = p_table_id and tenant_id = v_tenant and is_active for update;
        if v_table.id is null then
            raise exception 'Invalid table selected';
        end if;
        if v_table.status <> 'available' and not (
            v_table.status = 'occupied' and exists (
                select 1 from public.orders
                 where table_id = v_table.id and customer_id = v_customer_id
                   and status not in ('paid', 'cancelled'))) then
            raise exception 'This table is currently occupied';
        end if;
    end if;

    -- Lock the coupon so its usage limit holds under concurrent orders
    if trim(coalesce(p_coupon_code, '')) <> '' then
        perform 1 from public.coupons
         where tenant_id = v_tenant and code = upper(trim(p_coupon_code)) for update;
    end if;

    v_calc := public.price_order(v_tenant, v_customer_id, p_items, p_coupon_code, p_loyalty_offer_id);

    if v_calc ->> 'couponId' is not null then
        update public.coupons set used_count = used_count + 1 where id = (v_calc ->> 'couponId')::uuid;
    end if;
    if (v_calc ->> 'pointsUsed')::integer > 0 then
        update public.customers set loyalty_points = loyalty_points - (v_calc ->> 'pointsUsed')::integer
         where id = v_customer_id;
    end if;

    insert into public.orders (
        tenant_id, order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate,
        tax_details, restaurant_info, total, table_id, table_number,
        special_instructions, loyalty_offer_id, points_redeemed)
    values (
        v_tenant,
        'ORD-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-'
            || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
        v_customer_id,
        (v_calc ->> 'subtotal')::numeric,
        (v_calc ->> 'discount')::numeric,
        v_calc ->> 'couponCode',
        (v_calc ->> 'tax')::numeric,
        coalesce((public.get_setting('gst_rate', '5', v_tenant) #>> '{}')::numeric, 5),
        v_calc -> 'taxDetails',
        jsonb_build_object(
            'name', public.get_setting('restaurant_name', '""', v_tenant) #>> '{}',
            'address', public.get_setting('restaurant_address', '""', v_tenant) #>> '{}',
            'phone', public.get_setting('restaurant_phone', '""', v_tenant) #>> '{}',
            'gstNumber', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
            'fssaiNumber', public.get_setting('fssai_number', '""', v_tenant) #>> '{}'),
        (v_calc ->> 'total')::numeric,
        v_table.id, coalesce(v_table.table_number, ''),
        left(coalesce(p_special_instructions, ''), 500),
        (v_calc ->> 'offerId')::uuid,
        (v_calc ->> 'pointsUsed')::integer)
    returning id into v_order_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost)
    select v_order_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0)
      from jsonb_array_elements(v_calc -> 'lines') l;

    if v_table.id is not null then
        update public.dining_tables
           set status = 'occupied', is_occupied = true, current_order_id = v_order_id
         where id = v_table.id;
    end if;

    return v_order_id;
end;
$$;

create or replace function public.request_bill(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_order public.orders;
begin
    select * into v_order from public.orders where id = p_order_id;
    if v_order.id is null then
        raise exception 'Order not found';
    end if;
    if v_order.customer_id is distinct from public.current_customer_id()
       and not (v_order.tenant_id = public.current_tenant_id() and public.has_perm('orders.edit')) then
        raise exception 'Not authorized';
    end if;

    update public.orders
       set status = 'bill_requested'
     where tenant_id = v_order.tenant_id
       and status not in ('paid', 'cancelled', 'bill_requested')
       and (id = v_order.id
            or (v_order.table_id is not null and table_id = v_order.table_id)
            or (v_order.table_id is null and customer_id = v_order.customer_id));

    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

create or replace function public.update_order_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.edit');
    if p_status = 'cancelled' then
        perform public.require_perm('sensitive.void_bill');
    end if;
    update public.orders set status = p_status
     where id = p_order_id and tenant_id = public.current_tenant_id();
    if not found then
        raise exception 'Order not found';
    end if;
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

create or replace function public.record_payment(p_order_id uuid, p_method text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_order public.orders;
begin
    perform public.require_perm('orders.edit');
    select * into v_order from public.orders
     where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_order.id is null then
        raise exception 'Order not found';
    end if;
    update public.orders
       set payment_method = coalesce(nullif(p_method, ''), payment_method),
           amount_paid = coalesce(p_amount, amount_paid),
           status = case when coalesce(p_amount, amount_paid) >= total then 'paid' else status end
     where id = p_order_id;
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Loyalty
-- ---------------------------------------------------------------------------
create or replace function public.my_loyalty_points() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'currentPoints', c.loyalty_points,
        'totalEarned', c.total_points_earned,
        'pointsValue', c.loyalty_points / s.points_to_rupee_ratio,
        'canRedeem', c.loyalty_points >= s.min_points_to_redeem,
        'minPointsToRedeem', s.min_points_to_redeem,
        'pointsToRupeeRatio', s.points_to_rupee_ratio)
      from public.customers c
      join public.loyalty_settings s on s.tenant_id = c.tenant_id
     where c.id = public.current_customer_id();
$$;

create or replace function public.calculate_redemption(p_order_total numeric, p_points_to_use integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_settings public.loyalty_settings;
    v_points integer;
    v_tenant uuid;
    v_max numeric;
    v_discount numeric;
    v_used integer;
begin
    select loyalty_points, tenant_id into v_points, v_tenant from public.customers where id = public.current_customer_id();
    select * into v_settings from public.loyalty_settings where tenant_id = v_tenant;
    if not coalesce(v_settings.is_active, false) then
        return jsonb_build_object('discount', 0, 'pointsUsed', 0, 'message', 'Loyalty program is currently disabled');
    end if;
    if coalesce(v_points, 0) < v_settings.min_points_to_redeem then
        return jsonb_build_object('discount', 0, 'pointsUsed', 0,
            'message', format('Need at least %s points to redeem', v_settings.min_points_to_redeem));
    end if;
    v_max := p_order_total * v_settings.max_redemption_percent / 100;
    v_discount := least(least(coalesce(p_points_to_use, v_points), v_points) / v_settings.points_to_rupee_ratio, v_max);
    v_used := ceil(v_discount * v_settings.points_to_rupee_ratio);
    return jsonb_build_object('discount', v_discount, 'pointsUsed', v_used,
        'remainingPoints', v_points - v_used, 'maxDiscount', v_max);
end;
$$;

create or replace function public.adjust_points(p_customer_id uuid, p_points integer, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_balance integer;
begin
    perform public.require_perm('rewards.edit');
    update public.customers
       set loyalty_points = greatest(loyalty_points + p_points, 0),
           total_points_earned = total_points_earned + greatest(p_points, 0)
     where id = p_customer_id and tenant_id = public.current_tenant_id()
    returning loyalty_points into v_balance;
    if not found then
        raise exception 'User not found';
    end if;
    return jsonb_build_object('message', format('Points adjusted by %s', p_points), 'newBalance', v_balance);
end;
$$;

-- Customer list for the loyalty screen, phone masked unless allowed
create function public.loyalty_customers() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('rewards.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', c.id, 'id', c.id, 'name', c.name,
                   'phone', case when public.has_perm('sensitive.see_customer_phone') then c.phone else public.mask_phone(c.phone) end,
                   'loyaltyPoints', c.loyalty_points, 'totalPointsEarned', c.total_points_earned,
                   'createdAt', c.created_at) order by c.loyalty_points desc), '[]'::jsonb)
          from public.customers c where c.tenant_id = public.current_tenant_id());
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables, inventory, admin setup
-- ---------------------------------------------------------------------------
create or replace function public.create_tables_bulk(p_start integer, p_end integer, p_capacity integer default 4) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_created jsonb;
    v_tenant uuid := public.current_tenant_id();
begin
    perform public.require_perm('tables.create');
    if p_end < p_start or p_end - p_start > 200 then
        raise exception 'Invalid table range';
    end if;
    with ins as (
        insert into public.dining_tables (tenant_id, table_number, capacity)
        select v_tenant, n::text, coalesce(p_capacity, 4) from generate_series(p_start, p_end) n
        on conflict (tenant_id, table_number) do nothing
        returning *)
    select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_created from ins;
    return jsonb_build_object('message', format('Created %s tables', jsonb_array_length(v_created)), 'tables', v_created);
end;
$$;

create or replace function public.restock_inventory(p_id uuid, p_quantity numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('inventory.edit');
    update public.inventory
       set current_stock = current_stock + p_quantity, last_restocked = now()
     where id = p_id and tenant_id = public.current_tenant_id();
    if not found then
        raise exception 'Item not found';
    end if;
end;
$$;

-- Employees with salary hidden unless allowed
create function public.list_employees() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_salary boolean := public.has_perm('sensitive.see_salary');
begin
    perform public.require_perm('employees.view');
    return (
        select coalesce(jsonb_agg(to_jsonb(e) - case when v_salary then '' else 'salary' end order by e.name), '[]'::jsonb)
          from public.employees e where e.tenant_id = public.current_tenant_id());
end;
$$;

-- Owner email login for a cafe (SQL editor): select public.make_admin('owner@cafe.com', 'default');
drop function public.make_admin(text);
create function public.make_admin(p_email text, p_slug text default 'default') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_user uuid;
    v_tenant uuid;
begin
    select id into v_user from auth.users where lower(email) = lower(trim(p_email));
    if v_user is null then
        raise exception 'No user with email %', p_email;
    end if;
    select id into v_tenant from public.tenants where slug = p_slug;
    if v_tenant is null then
        raise exception 'No cafe with slug %', p_slug;
    end if;
    insert into public.profiles (id, role, tenant_id) values (v_user, 'admin', v_tenant)
    on conflict (id) do update set role = 'admin', tenant_id = v_tenant, customer_id = null, staff_id = null;
    return 'ok';
end;
$$;
revoke execute on function public.make_admin(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff management
-- ---------------------------------------------------------------------------
create function public.create_staff(p_name text, p_phone text, p_role_id uuid, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
    v_id uuid;
    v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
    perform public.require_perm('staff.create');
    if trim(coalesce(p_name, '')) = '' then
        raise exception 'Name is required';
    end if;
    if v_phone !~ '^[0-9]{10}$' then
        raise exception 'Enter a valid 10-digit mobile number';
    end if;
    if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
        raise exception 'PIN must be 4 to 6 digits';
    end if;
    -- Only an owner can create another owner
    if exists (select 1 from public.roles where id = p_role_id and is_owner)
       and not ('*' = any (public.my_permissions())) then
        raise exception 'Only an owner can add another owner';
    end if;
    insert into public.staff_users (tenant_id, name, phone, role_id, pin_hash)
    values (public.current_tenant_id(), trim(p_name), v_phone, p_role_id, crypt(p_pin, gen_salt('bf')))
    returning id into v_id;
    return v_id;
exception when unique_violation then
    raise exception 'A staff member with this phone already exists';
end;
$$;

-- Staff list with role names, for the Staff screen
create function public.list_staff() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('staff.view');
    return jsonb_build_object(
        'staff', (select coalesce(jsonb_agg(jsonb_build_object(
                     '_id', s.id, 'id', s.id, 'name', s.name, 'phone', s.phone, 'roleId', s.role_id, 'roleName', r.name,
                     'isActive', s.is_active, 'hasPin', s.pin_hash is not null, 'lastLoginAt', s.last_login_at,
                     'lockedUntil', s.locked_until, 'createdAt', s.created_at,
                     'overrides', (select coalesce(jsonb_object_agg(o.perm, o.allow), '{}'::jsonb)
                                     from public.staff_overrides o where o.staff_id = s.id),
                     'acceptedTerms', (select jsonb_build_object('version', a.version, 'at', a.accepted_at)
                                         from public.acceptances a where a.staff_id = s.id and a.kind = 'staff'
                                        order by a.accepted_at desc limit 1))
                     order by s.is_active desc, s.name), '[]'::jsonb)
                    from public.staff_users s join public.roles r on r.id = s.role_id
                   where s.tenant_id = public.current_tenant_id()),
        'usage', (select jsonb_build_object('active', count(*) filter (where s.is_active), 'max', p.max_staff, 'plan', p.name)
                    from public.tenants t
                    join public.plans p on p.id = t.plan_id
                    left join public.staff_users s on s.tenant_id = t.id
                   where t.id = public.current_tenant_id()
                   group by p.max_staff, p.name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Global search: items, categories, brands, customers, orders, staff the user may see
-- ---------------------------------------------------------------------------
create function public.global_search(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_q text := lower(trim(coalesce(p_query, '')));
    v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
    v_out jsonb := '{}'::jsonb;
begin
    perform public.require_admin();
    if length(v_q) < 2 then
        return v_out;
    end if;

    if public.has_perm('menu.view') then
        v_out := v_out || jsonb_build_object('items', (
            select coalesce(jsonb_agg(r order by score desc), '[]'::jsonb) from (select r, score from (
                select jsonb_build_object('id', m.id, 'title', m.name,
                         'subtitle', concat_ws(' · ', c.name, b.name, '₹' || m.price), 'available', m.is_available) as r,
                       greatest(word_similarity(v_q, lower(m.name)), similarity(lower(m.name), v_q),
                                case when lower(m.name) like '%' || v_q || '%' then 0.9 else 0 end,
                                case when lower(coalesce(b.name, '')) like '%' || v_q || '%' then 0.6 else 0 end) as score
                  from public.menu_items m
                  left join public.categories c on c.id = m.category_id
                  left join public.brands b on b.id = m.brand_id
                 where m.tenant_id = v_tenant) s
             where score > 0.3 order by score desc limit 8) t));
        v_out := v_out || jsonb_build_object('categories', (
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', name) order by name), '[]'::jsonb) from (
                select id, name from public.categories
                 where tenant_id = v_tenant
                   and (lower(name) like '%' || v_q || '%' or similarity(lower(name), v_q) > 0.35)
                 limit 5) s));
        v_out := v_out || jsonb_build_object('brands', (
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', name) order by name), '[]'::jsonb) from (
                select id, name from public.brands
                 where tenant_id = v_tenant
                   and (lower(name) like '%' || v_q || '%' or similarity(lower(name), v_q) > 0.35)
                 limit 5) s));
    end if;

    if public.has_perm('customers.view') then
        v_out := v_out || jsonb_build_object('customers', (
            select coalesce(jsonb_agg(r order by score desc), '[]'::jsonb) from (select r, score from (
                select jsonb_build_object('id', c.id, 'title', c.name,
                         'subtitle', case when v_phone then c.phone else public.mask_phone(c.phone) end
                                     || ' · ' || c.loyalty_points || ' pts') as r,
                       greatest(word_similarity(v_q, lower(c.name)),
                                case when lower(c.name) like '%' || v_q || '%' then 0.9 else 0 end,
                                case when v_phone and length(v_digits) >= 3 and c.phone like '%' || v_digits || '%' then 0.95
                                     when length(v_digits) >= 4 and right(c.phone, length(v_digits)) = v_digits then 0.9
                                     else 0 end) as score
                  from public.customers c where c.tenant_id = v_tenant) s
             where score > 0.3 order by score desc limit 8) t));
    end if;

    if public.has_perm('orders.view') then
        v_out := v_out || jsonb_build_object('orders', (
            select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.order_number,
                       'subtitle', concat_ws(' · ', nullif('Table ' || o.table_number, 'Table '), o.status, '₹' || o.total,
                                             to_char(o.created_at at time zone public.cafe_timezone(), 'DD Mon HH24:MI')))
                       order by o.created_at desc), '[]'::jsonb)
              from (select * from public.orders o
                     where o.tenant_id = v_tenant
                       and (lower(o.order_number) like '%' || v_q || '%'
                            or (length(v_digits) between 1 and 3 and o.table_number = v_digits))
                     order by o.created_at desc limit 8) o));
    end if;

    if public.has_perm('staff.view') then
        v_out := v_out || jsonb_build_object('staff', (
            select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.name, 'subtitle', r.name) order by s.name), '[]'::jsonb)
              from public.staff_users s join public.roles r on r.id = s.role_id
             where s.tenant_id = v_tenant
               and (lower(s.name) like '%' || v_q || '%' or similarity(lower(s.name), v_q) > 0.35)));
    end if;

    return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Superadmin (platform) functions
-- ---------------------------------------------------------------------------
create function public.require_platform() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
    if not public.is_platform_admin() then
        raise exception 'Not authorized';
    end if;
end;
$$;

create function public.sa_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_platform();
    return jsonb_build_object(
        'tenants', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'slug', t.slug, 'planId', t.plan_id, 'planName', p.name,
                'maxStaff', p.max_staff, 'paidUntil', t.paid_until, 'graceDays', t.grace_days, 'locked', t.locked,
                'status', public.tenant_status(t.id), 'billingAmount', t.billing_amount, 'billingNote', t.billing_note,
                'ownerName', t.owner_name, 'ownerPhone', t.owner_phone, 'ownerEmail', t.owner_email,
                'createdAt', t.created_at,
                'staffActive', (select count(*) from public.staff_users s where s.tenant_id = t.id and s.is_active),
                'orders30d', (select count(*) from public.orders o where o.tenant_id = t.id and o.created_at > now() - interval '30 days'),
                'sales30d', (select coalesce(sum(total), 0) from public.orders o
                              where o.tenant_id = t.id and o.status = 'paid' and o.created_at > now() - interval '30 days'),
                'payments', (select coalesce(jsonb_agg(jsonb_build_object('amount', tp.amount, 'months', tp.months,
                                 'paidOn', tp.paid_on, 'note', tp.note) order by tp.paid_on desc), '[]'::jsonb)
                               from public.tenant_payments tp where tp.tenant_id = t.id))
                order by t.created_at), '[]'::jsonb)
              from public.tenants t left join public.plans p on p.id = t.plan_id),
        'plans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.monthly_price, p.name), '[]'::jsonb) from public.plans p));
end;
$$;

create function public.sa_create_tenant(
    p_name text, p_slug text, p_plan_id uuid, p_paid_until date,
    p_owner_name text, p_owner_phone text, p_owner_pin text, p_owner_email text default ''
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
    v_tenant uuid;
    v_phone text := right(regexp_replace(coalesce(p_owner_phone, ''), '\D', '', 'g'), 10);
begin
    perform public.require_platform();
    if coalesce(p_owner_pin, '') !~ '^[0-9]{4,6}$' then
        raise exception 'PIN must be 4 to 6 digits';
    end if;
    if v_phone !~ '^[0-9]{10}$' then
        raise exception 'Enter a valid 10-digit owner mobile number';
    end if;
    insert into public.tenants (name, slug, plan_id, paid_until, owner_name, owner_phone, owner_email)
    values (trim(p_name), lower(trim(p_slug)), p_plan_id, p_paid_until, trim(p_owner_name), v_phone, coalesce(p_owner_email, ''))
    returning id into v_tenant;
    perform public.seed_tenant(v_tenant, trim(p_name));
    insert into public.staff_users (tenant_id, name, phone, role_id, pin_hash)
    values (v_tenant, coalesce(nullif(trim(p_owner_name), ''), 'Owner'), v_phone,
            (select id from public.roles where tenant_id = v_tenant and is_owner limit 1),
            crypt(p_owner_pin, gen_salt('bf')));
    return v_tenant;
exception when unique_violation then
    raise exception 'That slug is already taken';
end;
$$;

create function public.sa_update_tenant(p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_platform();
    update public.tenants set
        name = coalesce(p_patch ->> 'name', name),
        plan_id = coalesce((p_patch ->> 'planId')::uuid, plan_id),
        paid_until = case when p_patch ? 'paidUntil' then (p_patch ->> 'paidUntil')::date else paid_until end,
        grace_days = coalesce((p_patch ->> 'graceDays')::integer, grace_days),
        locked = coalesce((p_patch ->> 'locked')::boolean, locked),
        billing_amount = coalesce((p_patch ->> 'billingAmount')::numeric, billing_amount),
        billing_note = coalesce(p_patch ->> 'billingNote', billing_note),
        owner_name = coalesce(p_patch ->> 'ownerName', owner_name),
        owner_phone = coalesce(p_patch ->> 'ownerPhone', owner_phone),
        owner_email = coalesce(p_patch ->> 'ownerEmail', owner_email)
     where id = p_id;
    if not found then
        raise exception 'Cafe not found';
    end if;
end;
$$;

-- Record a payment and extend paid_until by N months from the later of today or the current due date
create function public.sa_record_payment(p_id uuid, p_months integer, p_amount numeric, p_note text default '') returns date
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_until date;
begin
    perform public.require_platform();
    if coalesce(p_months, 0) < 1 then
        raise exception 'Months must be at least 1';
    end if;
    update public.tenants
       set paid_until = (greatest(coalesce(paid_until, current_date), current_date) + make_interval(months => p_months))::date,
           locked = false
     where id = p_id
    returning paid_until into v_until;
    if not found then
        raise exception 'Cafe not found';
    end if;
    insert into public.tenant_payments (tenant_id, amount, months, note, recorded_by)
    values (p_id, coalesce(p_amount, 0), p_months, coalesce(p_note, ''), auth.uid());
    return v_until;
end;
$$;

create function public.sa_reset_owner_pin(p_tenant uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
    v_staff uuid;
begin
    perform public.require_platform();
    if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
        raise exception 'PIN must be 4 to 6 digits';
    end if;
    select s.id into v_staff from public.staff_users s join public.roles r on r.id = s.role_id
     where s.tenant_id = p_tenant and r.is_owner order by s.created_at limit 1;
    if v_staff is null then
        raise exception 'This cafe has no owner PIN account';
    end if;
    update public.staff_users set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null, is_active = true
     where id = v_staff;
    delete from public.profiles where staff_id = v_staff;
end;
$$;

-- ===== 20261004000005_analytics_v2.sql =====
-- Phase 0 · 5/6: analytics per cafe and per permission (same JSON shapes as before).

create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone();
    v_today date := (now() at time zone v_tz)::date;
begin
    perform public.require_perm('reports.view');
    return jsonb_build_object(
        'today', (select jsonb_build_object('revenue', coalesce(sum(total), 0), 'orders', count(*))
                    from public.orders
                   where tenant_id = v_t and status = 'paid' and (created_at at time zone v_tz)::date = v_today),
        'month', (select jsonb_build_object('revenue', coalesce(sum(total), 0), 'orders', count(*))
                    from public.orders
                   where tenant_id = v_t and status = 'paid'
                     and (created_at at time zone v_tz)::date >= date_trunc('month', v_today)::date),
        'pendingOrders', (select count(*) from public.orders
                           where tenant_id = v_t and status in ('pending', 'confirmed', 'preparing', 'ready')));
end;
$$;

create or replace function public.revenue_series(p_period text default 'week') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone();
    v_margin numeric := coalesce((public.get_setting('profit_margin', '30') #>> '{}')::numeric, 30) / 100;
    v_profit boolean := public.has_perm('sensitive.see_profit');
begin
    perform public.require_perm('reports.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', day, 'revenue', revenue, 'orders', orders,
                   'profit', case when v_profit then round(revenue * v_margin, 2) end)
                   order by day), '[]'::jsonb)
          from (select to_char(created_at at time zone v_tz, 'YYYY-MM-DD') as day,
                       sum(total) as revenue, count(*) as orders
                  from public.orders
                 where tenant_id = v_t and status = 'paid' and created_at >= public.period_start(p_period)
                 group by 1) d);
end;
$$;

create or replace function public.category_sales(p_period text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('reports.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object('_id', name, 'total', total, 'count', qty)
                   order by total desc), '[]'::jsonb)
          from (select c.name, sum(oi.total) as total, sum(oi.quantity) as qty
                  from public.orders o
                  join public.order_items oi on oi.order_id = o.id
                  join public.menu_items mi on mi.id = oi.menu_item_id
                  join public.categories c on c.id = mi.category_id
                 where o.tenant_id = public.current_tenant_id()
                   and o.status = 'paid' and o.created_at >= public.period_start(p_period)
                 group by c.name) s);
end;
$$;

create or replace function public.top_items() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('reports.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', menu_item_id, 'name', name, 'totalQuantity', qty, 'totalRevenue', revenue)
                   order by qty desc), '[]'::jsonb)
          from (select oi.menu_item_id, min(oi.name) as name, sum(oi.quantity) as qty, sum(oi.total) as revenue
                  from public.orders o
                  join public.order_items oi on oi.order_id = o.id
                 where o.tenant_id = public.current_tenant_id() and o.status = 'paid'
                 group by oi.menu_item_id
                 order by qty desc
                 limit 10) t);
end;
$$;

create or replace function public.user_analytics(p_period text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone();
    v_start timestamptz := public.period_start(p_period);
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
begin
    perform public.require_perm('reports.view');
    return jsonb_build_object(
        'totalUsers', (select count(*) from public.customers where tenant_id = v_t),
        'newUsers', (select count(*) from public.customers where tenant_id = v_t and created_at >= v_start),
        'activeUsers', (select count(distinct customer_id) from public.orders
                         where tenant_id = v_t and status = 'paid' and created_at >= v_start),
        'returningCustomers', (select count(*) from (
                                  select customer_id from public.orders where tenant_id = v_t and status = 'paid'
                                   group by customer_id having count(*) > 1) r),
        'userGrowth', (select coalesce(jsonb_agg(jsonb_build_object('date', to_char(day, 'FMDD Mon'), 'users', n)
                                   order by day), '[]'::jsonb)
                         from (select (created_at at time zone v_tz)::date as day, count(*) as n
                                 from public.customers where tenant_id = v_t and created_at >= v_start group by 1) g),
        'topCustomers', (select coalesce(jsonb_agg(jsonb_build_object(
                                   '_id', c.id, 'name', c.name,
                                   'phone', case when v_phone then c.phone else public.mask_phone(c.phone) end,
                                   'orderCount', t.order_count, 'totalSpent', t.spent)
                                   order by t.spent desc), '[]'::jsonb)
                           from (select customer_id, count(*) as order_count, sum(total) as spent
                                   from public.orders where tenant_id = v_t and status <> 'cancelled' and customer_id is not null
                                  group by customer_id order by spent desc limit 5) t
                           join public.customers c on c.id = t.customer_id));
end;
$$;

create or replace function public.customer_analytics(
    p_search text default '', p_sort_by text default 'totalSpent', p_order text default 'desc',
    p_page integer default 1, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rows jsonb;
    v_total integer;
    v_search text := '%' || coalesce(trim(p_search), '') || '%';
    v_page integer := greatest(coalesce(p_page, 1), 1);
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
    v_t uuid := public.current_tenant_id();
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
begin
    perform public.require_perm('customers.view');

    with stats as (
        select c.*,
               count(o.id) as total_orders,
               count(o.id) filter (where o.status = 'paid') as paid_orders,
               coalesce(sum(o.total) filter (where o.status = 'paid'), 0) as total_spent,
               max(o.created_at) as last_order_date
          from public.customers c
          left join public.orders o on o.customer_id = c.id
         where c.tenant_id = v_t
           and (c.name ilike v_search or (v_phone and c.phone ilike v_search) or c.email ilike v_search)
         group by c.id),
    sorted as (
        select * from stats
         order by
            case when p_order = 'asc' then null else
                case p_sort_by
                    when 'totalOrders' then total_orders::numeric
                    when 'loyaltyPoints' then loyalty_points::numeric
                    when 'lastOrderDate' then extract(epoch from last_order_date)::numeric
                    when 'createdAt' then extract(epoch from created_at)::numeric
                    else total_spent end end desc nulls last,
            case when p_order = 'asc' then
                case p_sort_by
                    when 'totalOrders' then total_orders::numeric
                    when 'loyaltyPoints' then loyalty_points::numeric
                    when 'lastOrderDate' then extract(epoch from last_order_date)::numeric
                    when 'createdAt' then extract(epoch from created_at)::numeric
                    else total_spent end end asc nulls last,
            name
         offset (v_page - 1) * v_limit
         limit v_limit)
    select coalesce(jsonb_agg(jsonb_build_object(
               '_id', id, 'name', name, 'phone', case when v_phone then phone else public.mask_phone(phone) end, 'email', email,
               'loyaltyPoints', loyalty_points, 'totalPointsEarned', total_points_earned,
               'totalOrders', total_orders, 'paidOrders', paid_orders, 'totalSpent', total_spent,
               'lastOrderDate', last_order_date, 'createdAt', created_at)), '[]'::jsonb)
      into v_rows from sorted;

    select count(*) into v_total from public.customers c
     where c.tenant_id = v_t
       and (c.name ilike v_search or (v_phone and c.phone ilike v_search) or c.email ilike v_search);

    return jsonb_build_object('customers', v_rows,
        'pagination', jsonb_build_object('total', v_total, 'page', v_page, 'pages', ceil(v_total::numeric / v_limit)));
end;
$$;

create or replace function public.customer_detail(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_customer public.customers;
    v_tz text := public.cafe_timezone();
begin
    perform public.require_perm('customers.view');
    select * into v_customer from public.customers where id = p_customer_id and tenant_id = public.current_tenant_id();
    if not found then
        raise exception 'Customer not found';
    end if;
    return jsonb_build_object(
        'customer', jsonb_build_object(
            '_id', v_customer.id, 'name', v_customer.name,
            'phone', case when public.has_perm('sensitive.see_customer_phone') then v_customer.phone else public.mask_phone(v_customer.phone) end,
            'email', v_customer.email, 'loyaltyPoints', v_customer.loyalty_points,
            'totalPointsEarned', v_customer.total_points_earned, 'createdAt', v_customer.created_at),
        'stats', (select jsonb_build_object(
                      'totalOrders', count(*),
                      'paidOrders', count(*) filter (where status = 'paid'),
                      'totalSpent', coalesce(sum(total) filter (where status = 'paid'), 0),
                      'avgOrderValue', coalesce(avg(total) filter (where status = 'paid'), 0),
                      'lastOrderDate', max(created_at))
                    from public.orders where customer_id = p_customer_id),
        'favoriteItems', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', qty, 'total', total)
                                   order by qty desc), '[]'::jsonb)
                            from (select oi.name, sum(oi.quantity) as qty, sum(oi.total) as total
                                    from public.orders o join public.order_items oi on oi.order_id = o.id
                                   where o.customer_id = p_customer_id and o.status = 'paid'
                                   group by oi.name order by qty desc limit 5) f),
        'ordersByMonth', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon YYYY'),
                                   'orders', n, 'spent', spent) order by m), '[]'::jsonb)
                            from (select date_trunc('month', created_at at time zone v_tz) as m,
                                         count(*) as n, sum(total) as spent
                                    from public.orders where customer_id = p_customer_id and status = 'paid'
                                   group by 1) mo),
        'recentOrders', (select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
                           from (select * from public.orders where customer_id = p_customer_id
                                  order by created_at desc limit 10) o));
end;
$$;

create or replace function public.search_orders(
    p_search text default '', p_status text default '', p_start_date timestamptz default null,
    p_end_date timestamptz default null, p_min_amount numeric default null, p_max_amount numeric default null,
    p_page integer default 1, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_page integer := greatest(coalesce(p_page, 1), 1);
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 500);
    v_total integer;
    v_rows jsonb;
    v_search text := '%' || lower(coalesce(trim(p_search), '')) || '%';
begin
    perform public.require_perm('orders.view');

    with matched as (
        select o.*
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where o.tenant_id = public.current_tenant_id()
           and (p_status is null or p_status = '' or o.status = p_status)
           and (p_start_date is null or o.created_at >= p_start_date)
           and (p_end_date is null or o.created_at <= p_end_date)
           and (p_min_amount is null or o.total >= p_min_amount)
           and (p_max_amount is null or o.total <= p_max_amount)
           and (coalesce(trim(p_search), '') = ''
                or lower(coalesce(c.name, '')) like v_search
                or coalesce(c.phone, '') like v_search
                or lower(o.order_number) like v_search
                or o.id::text like v_search))
    select (select count(*) from matched),
           (select coalesce(jsonb_agg(public.order_json(p) order by p.created_at desc), '[]'::jsonb)
              from (select * from matched order by created_at desc
                     offset (v_page - 1) * v_limit limit v_limit) p)
      into v_total, v_rows;

    return jsonb_build_object('orders', v_rows,
        'pagination', jsonb_build_object('total', v_total, 'page', v_page, 'pages', ceil(v_total::numeric / v_limit)));
end;
$$;

-- ===== 20261004000006_security_v2.sql =====
-- Phase 0 · 6/6: row level security per cafe and per permission.
-- Public pages read the cafe in the x-tenant-slug header; staff read only their own cafe,
-- and only what their role allows.

-- Drop every existing policy on public tables
do $$
declare
    r record;
begin
    for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
        execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    end loop;
end $$;

alter table public.plans enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_payments enable row level security;
alter table public.platform_admins enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_users enable row level security;
alter table public.staff_overrides enable row level security;
alter table public.terms_versions enable row level security;
alter table public.acceptances enable row level security;
alter table public.audit_log enable row level security;
alter table public.brands enable row level security;
alter table public.tax_groups enable row level security;
alter table public.item_units enable row level security;

-- ---------------------------------------------------------------------------
-- Standard policies: staff of the cafe, by module permission
-- ---------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in select * from (values
        ('inventory', 'inventory'), ('employees', 'employees'), ('holidays', 'employees'),
        ('attendance', 'employees'), ('roles', 'staff')) v(tbl, module) loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.view');
        execute format($p$create policy "staff create" on public.%I for insert
            with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.create');
        execute format($p$create policy "staff edit" on public.%I for update
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))
            with check (tenant_id = (select public.current_tenant_id()))$p$, r.tbl, r.module || '.edit');
        execute format($p$create policy "staff delete" on public.%I for delete
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.delete');
    end loop;
end $$;

-- Attendance upsert (mark attendance) counts as an edit, so allow insert with edit too
create policy "staff mark" on public.attendance for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.edit')));

-- ---------------------------------------------------------------------------
-- Public catalogue: readable for the cafe being viewed; written by staff with permission
-- ---------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in select * from (values
        ('menu_items', 'menu', 'true'),
        ('brands', 'menu', 'true'),
        ('tax_groups', 'menu', 'true'),
        ('item_units', 'menu', 'true'),
        ('categories', 'menu', 'is_active'),
        ('collections', 'collections', 'true'),
        ('dining_tables', 'tables', 'true'),
        ('loyalty_settings', 'rewards', 'true'),
        ('loyalty_offers', 'rewards', 'is_active'),
        ('coupons', 'coupons', 'is_active and valid_from <= now() and valid_until >= now()')) v(tbl, module, public_filter) loop
        execute format($p$create policy "public read" on public.%I for select
            using (tenant_id = (select public.view_tenant_id())
                   and ((%s) or (select public.has_perm(%L))))$p$, r.tbl, r.public_filter, r.module || '.view');
        execute format($p$create policy "staff create" on public.%I for insert
            with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.create');
        execute format($p$create policy "staff edit" on public.%I for update
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))
            with check (tenant_id = (select public.current_tenant_id()))$p$, r.tbl, r.module || '.edit');
        execute format($p$create policy "staff delete" on public.%I for delete
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.delete');
    end loop;
end $$;

-- Settings: public read (bill details, GST); one permission for writing
create policy "public read" on public.settings for select
    using (tenant_id = (select public.view_tenant_id()));
create policy "staff write" on public.settings for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('settings.edit')));
create policy "staff edit" on public.settings for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('settings.edit')))
    with check (tenant_id = (select public.current_tenant_id()));

-- Collection items follow their collection
create policy "public read" on public.collection_items for select
    using (exists (select 1 from public.collections c where c.id = collection_id));
create policy "staff write" on public.collection_items for all
    using (exists (select 1 from public.collections c where c.id = collection_id
                    and c.tenant_id = (select public.current_tenant_id()))
           and (select public.has_perm('collections.edit')))
    with check (exists (select 1 from public.collections c where c.id = collection_id
                         and c.tenant_id = (select public.current_tenant_id()))
                and (select public.has_perm('collections.edit')));

-- ---------------------------------------------------------------------------
-- Customers and orders
-- ---------------------------------------------------------------------------
create policy "own or staff" on public.customers for select
    using (id = (select public.current_customer_id())
           or (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('customers.view'))));
create policy "staff edit" on public.customers for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('customers.edit')))
    with check (tenant_id = (select public.current_tenant_id()));

create policy "own" on public.profiles for select using (id = auth.uid());

create policy "own or staff" on public.orders for select
    using (customer_id = (select public.current_customer_id())
           or (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.view'))));
create policy "staff edit" on public.orders for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff delete" on public.orders for delete
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.delete')));

create policy "via order" on public.order_items for select
    using (exists (select 1 from public.orders o where o.id = order_id));

-- ---------------------------------------------------------------------------
-- Staff, roles, permissions
-- ---------------------------------------------------------------------------
create policy "staff view" on public.staff_users for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.view')));
create policy "staff edit" on public.staff_users for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
-- Creating staff goes through create_staff() (hashes the PIN)

create policy "staff view" on public.role_permissions for select
    using (exists (select 1 from public.roles r where r.id = role_id));
create policy "staff write" on public.role_permissions for all
    using (exists (select 1 from public.roles r where r.id = role_id
                    and r.tenant_id = (select public.current_tenant_id()) and not r.is_owner)
           and (select public.has_perm('staff.edit')))
    with check (exists (select 1 from public.roles r where r.id = role_id
                         and r.tenant_id = (select public.current_tenant_id()) and not r.is_owner)
                and (select public.has_perm('staff.edit')));

create policy "staff view" on public.staff_overrides for select
    using (exists (select 1 from public.staff_users s where s.id = staff_id));
create policy "staff write" on public.staff_overrides for all
    using (exists (select 1 from public.staff_users s where s.id = staff_id
                    and s.tenant_id = (select public.current_tenant_id()))
           and (select public.has_perm('staff.edit')))
    with check (exists (select 1 from public.staff_users s where s.id = staff_id
                         and s.tenant_id = (select public.current_tenant_id()))
                and (select public.has_perm('staff.edit')));

-- The Owner role can't be edited or deleted (it always has everything)
create or replace function public.protect_owner_role() returns trigger
language plpgsql as $$
begin
    -- Deleting a whole cafe cascades here after the cafe row is gone
    if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
        return old;
    end if;
    if old.is_owner then
        raise exception 'The Owner role cannot be changed or deleted';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger protect_owner_role before update or delete on public.roles
    for each row execute function public.protect_owner_role();

-- ---------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------
create policy "read" on public.plans for select using (true);
create policy "platform write" on public.plans for all
    using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "own cafe or platform" on public.tenants for select
    using (id = (select public.current_tenant_id()) or (select public.is_platform_admin()));

create policy "read" on public.terms_versions for select using (true);
create policy "platform write" on public.terms_versions for insert with check ((select public.is_platform_admin()));

create policy "own or staff" on public.acceptances for select
    using (user_id = auth.uid()
           or (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.view')))
           or (select public.is_platform_admin()));

create policy "audit view" on public.audit_log for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('audit.view')));

-- ---------------------------------------------------------------------------
-- Images bucket: staff who can edit the menu or homepage sections
-- ---------------------------------------------------------------------------
drop policy if exists "admin upload images" on storage.objects;
drop policy if exists "admin update images" on storage.objects;
drop policy if exists "admin delete images" on storage.objects;

create policy "staff upload images" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (public.has_perm('menu.create') or public.has_perm('menu.edit')
                                          or public.has_perm('collections.edit')));
create policy "staff update images" on storage.objects for update to authenticated
    using (bucket_id = 'images' and (public.has_perm('menu.edit') or public.has_perm('collections.edit')));
create policy "staff delete images" on storage.objects for delete to authenticated
    using (bucket_id = 'images' and public.has_perm('menu.delete'));


commit;
