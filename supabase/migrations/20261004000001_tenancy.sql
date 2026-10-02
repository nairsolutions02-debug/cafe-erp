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
