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
