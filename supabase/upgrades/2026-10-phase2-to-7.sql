-- Cafe ERP · Phases 2 to 7 in one paste (for a database that has Phase 1). Each phase is its own transaction.

-- Cafe ERP · Phase 2 (counter, kitchen, offline, money) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261006000001_counter_money.sql ====
-- Phase 2 · 1/2: counter, kitchen and money — tables.
-- Every rupee is one row in ledger_entries (append-only). Cash drawers have shifts with
-- opening/closing counts. Counter and kiosk orders carry a client id so offline sales sync once.

-- ---------------------------------------------------------------------------
-- Orders: channels, counter fields, bill extras, kitchen status per line
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_order_number_key;
alter table public.orders add constraint orders_tenant_number_key unique (tenant_id, order_number);
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
    check (payment_method in ('cash', 'online', 'upi', 'card', 'split', 'khata', 'pending'));
alter table public.orders
    add column channel text not null default 'qr' check (channel in ('qr', 'dine_in', 'takeaway', 'kiosk', 'aggregator')),
    add column token_number text not null default '',
    add column client_id text,
    add column device_code text not null default '',
    add column created_by_staff uuid references public.staff_users (id) on delete set null,
    add column staff_name text not null default '',
    add column manual_discount numeric(10, 2) not null default 0,
    add column discount_reason text not null default '',
    add column discount_approved_by text not null default '',
    add column base_total numeric(10, 2),
    add column service_charge numeric(10, 2) not null default 0,
    add column service_charge_tax numeric(10, 2) not null default 0,
    add column service_charge_removed boolean not null default false,
    add column round_off numeric(6, 2) not null default 0,
    add column payment_request text not null default '' check (payment_request in ('', 'counter', 'qr')),
    add column payment_requested_at timestamptz,
    add column cancel_reason text not null default '',
    add column cancelled_after_kitchen boolean not null default false,
    add column kitchen_started_at timestamptz,
    add column ready_at timestamptz,
    add column paid_at timestamptz;
create unique index orders_client_id_key on public.orders (tenant_id, client_id) where client_id is not null;
create index orders_tenant_created_idx on public.orders (tenant_id, created_at desc);

alter table public.order_items
    add column kitchen_status text not null default 'queued' check (kitchen_status in ('queued', 'preparing', 'ready', 'served')),
    add column unit_name text not null default '',
    add column unit_factor numeric(12, 3) not null default 1 check (unit_factor > 0),
    add column note text not null default '';

-- Older orders: lines of finished orders count as served
update public.order_items oi set kitchen_status = 'served'
  from public.orders o where o.id = oi.order_id and o.status in ('served', 'bill_requested', 'bill_generated', 'paid');

-- Discount limits per role (% of the bill a person may give without a manager's PIN)
alter table public.roles add column max_discount_pct numeric(5, 2) not null default 0 check (max_discount_pct between 0 and 100);

-- ---------------------------------------------------------------------------
-- Devices: counters, kiosks and kitchen screens get a short code (C1, K1, D1)
-- used in offline order numbers. Kiosks count against the plan.
-- ---------------------------------------------------------------------------
create table public.devices (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    code text not null,
    kind text not null check (kind in ('counter', 'kiosk', 'kitchen', 'phone')),
    name text not null default '',
    is_active boolean not null default true,
    last_seen_at timestamptz not null default now(),
    registered_by text not null default '',
    created_at timestamptz not null default now(),
    unique (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- Money accounts and the money ledger
-- ---------------------------------------------------------------------------
create table public.money_accounts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    code text not null,
    name text not null,
    kind text not null check (kind in ('cash', 'upi', 'card', 'bank', 'khata')),
    is_drawer boolean not null default false,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (tenant_id, code)
);

create table public.shifts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    account_id uuid not null references public.money_accounts (id),
    status text not null default 'open' check (status in ('open', 'closed')),
    opened_by text not null default '',
    opened_by_staff uuid references public.staff_users (id) on delete set null,
    opened_at timestamptz not null default now(),
    opening_cash numeric(12, 2) not null default 0,
    opening_denoms jsonb not null default '{}',
    last_close_cash numeric(12, 2),
    closed_by text not null default '',
    closed_at timestamptz,
    counted_cash numeric(12, 2),
    closing_denoms jsonb not null default '{}',
    expected_cash numeric(12, 2),
    upi_expected numeric(12, 2),
    upi_reported numeric(12, 2),
    card_expected numeric(12, 2),
    card_reported numeric(12, 2),
    difference numeric(12, 2),
    reason text not null default '',
    note text not null default ''
);
create unique index shifts_one_open on public.shifts (account_id) where status = 'open';
create index shifts_tenant_idx on public.shifts (tenant_id, opened_at desc);

create table public.expense_categories (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    sort_order integer not null default 0,
    is_active boolean not null default true,
    unique (tenant_id, name)
);

create table public.recurring_expenses (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    category_id uuid not null references public.expense_categories (id),
    amount numeric(12, 2) not null check (amount > 0),
    day_of_month integer not null default 1 check (day_of_month between 1 and 28),
    spread_months integer not null default 1 check (spread_months between 1 and 12),
    next_due date not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table public.expenses (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    expense_date date not null,
    category_id uuid not null references public.expense_categories (id),
    amount numeric(12, 2) not null check (amount > 0),
    status text not null default 'paid' check (status in ('paid', 'due')),
    account_id uuid references public.money_accounts (id),
    paid_at timestamptz,
    vendor_name text not null default '',
    note text not null default '',
    bill_photo_url text not null default '',
    spread_months integer not null default 1 check (spread_months between 1 and 12),
    recurring_id uuid references public.recurring_expenses (id) on delete set null,
    shift_id uuid references public.shifts (id) on delete set null,
    client_id text,
    is_void boolean not null default false,
    void_reason text not null default '',
    actor_name text not null default '',
    created_at timestamptz not null default now()
);
create unique index expenses_client_id_key on public.expenses (tenant_id, client_id) where client_id is not null;
create index expenses_tenant_date_idx on public.expenses (tenant_id, expense_date desc);

create table public.ledger_entries (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    entry_date date not null,
    account_id uuid not null references public.money_accounts (id),
    amount numeric(12, 2) not null check (amount <> 0),
    kind text not null check (kind in ('sale', 'refund', 'expense', 'purchase_payment', 'payout', 'pay_in', 'drop',
                                       'khata_sale', 'khata_settle', 'salary', 'advance', 'adjustment', 'reversal',
                                       'aggregator', 'transfer')),
    order_id uuid references public.orders (id) on delete set null,
    purchase_id uuid references public.purchases (id) on delete set null,
    expense_id uuid references public.expenses (id) on delete set null,
    shift_id uuid references public.shifts (id) on delete set null,
    customer_id uuid references public.customers (id) on delete set null,
    reverses_id uuid references public.ledger_entries (id),
    method text not null default '',
    note text not null default '',
    client_id text,
    staff_id uuid references public.staff_users (id) on delete set null,
    actor_name text not null default '',
    created_at timestamptz not null default now()
);
create unique index ledger_client_id_key on public.ledger_entries (tenant_id, client_id) where client_id is not null;
create index ledger_tenant_date_idx on public.ledger_entries (tenant_id, entry_date desc, created_at desc);
create index ledger_order_idx on public.ledger_entries (order_id) where order_id is not null;
create index ledger_shift_idx on public.ledger_entries (shift_id) where shift_id is not null;

create function public.ledger_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
        return old;
    end if;
    raise exception 'Money entries cannot be changed; record a reversing entry instead';
end;
$$;
create trigger ledger_immutable before update or delete on public.ledger_entries
    for each row execute function public.ledger_immutable();

-- ---------------------------------------------------------------------------
-- Notifications (shown in the admin bell now; pushed to phones in Phase 5)
-- ---------------------------------------------------------------------------
create table public.notification_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    kind text not null,
    title text not null,
    body text not null default '',
    link text not null default '',
    perm text not null default 'orders.view',
    priority text not null default 'normal' check (priority in ('alarm', 'loud', 'normal', 'digest')),
    payload jsonb not null default '{}',
    acknowledged_by text not null default '',
    acknowledged_at timestamptz,
    created_at timestamptz not null default now()
);
create index notification_events_tenant_idx on public.notification_events (tenant_id, created_at desc);

alter publication supabase_realtime add table public.notification_events;

-- ---------------------------------------------------------------------------
-- Per-cafe defaults added by each phase (called for new cafes by seed_tenant)
-- ---------------------------------------------------------------------------
create function public.seed_tenant_extras(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into public.money_accounts (tenant_id, code, name, kind, is_drawer, sort_order) values
        (p_tenant, 'cash_counter', 'Cash – Counter', 'cash', true, 1),
        (p_tenant, 'cash_kiosk', 'Cash – Kiosk', 'cash', true, 2),
        (p_tenant, 'cash_office', 'Cash – Office / safe', 'cash', false, 3),
        (p_tenant, 'upi', 'UPI', 'upi', false, 4),
        (p_tenant, 'card', 'Card', 'card', false, 5),
        (p_tenant, 'bank', 'Bank', 'bank', false, 6),
        (p_tenant, 'khata', 'Khata (credit)', 'khata', false, 7)
    on conflict (tenant_id, code) do nothing;

    insert into public.expense_categories (tenant_id, name, sort_order)
    select p_tenant, n, i from unnest(array['Rent', 'Electricity', 'Gas', 'Water', 'Internet', 'Consumables', 'Packaging',
        'Repairs', 'Breakage', 'Marketing', 'Salaries', 'Aggregator commission', 'Bank charges', 'Licences',
        'Miscellaneous']) with ordinality as t(n, i)
    on conflict (tenant_id, name) do nothing;

    insert into public.settings (tenant_id, key, value, description) values
        (p_tenant, 'service_charge_pct', '0', 'Optional service charge % (0 = off); customers may ask to remove it'),
        (p_tenant, 'round_off', 'false', 'Round bill totals to the nearest rupee'),
        (p_tenant, 'bill_footer', '"Thank you! Visit again."', 'Text printed at the bottom of bills'),
        (p_tenant, 'shift_tolerance', '50', 'Cash difference (₹) allowed at shift close without a reason')
    on conflict (tenant_id, key) do nothing;

    update public.roles set max_discount_pct = case name
            when 'Manager' then 100 when 'Cashier' then 10 when 'Kiosk operator' then 5 else max_discount_pct end
     where tenant_id = p_tenant and name in ('Manager', 'Cashier', 'Kiosk operator') and max_discount_pct = 0;

    insert into public.role_permissions (role_id, perm)
    select r.id, p from public.roles r,
           unnest(case r.name
               when 'Manager' then array['finance.view', 'finance.create', 'finance.edit']
               when 'Accountant' then array['finance.view']
               else array[]::text[] end) p
     where r.tenant_id = p_tenant
    on conflict do nothing;
end;
$$;
revoke execute on function public.seed_tenant_extras(uuid) from public, anon, authenticated;

create or replace function public.seed_tenant(p_tenant uuid, p_name text) returns void
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
    perform public.seed_tenant_extras(p_tenant);
end;
$$;

do $$ begin perform public.seed_tenant_extras(id) from public.tenants; end $$;

-- ==== 20261006000002_counter_money_logic.sql ====
-- Phase 2 · 2/2: counter, kitchen and money — logic and row security.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.cafe_today(p_tenant uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
    select (now() at time zone public.cafe_timezone(p_tenant))::date;
$$;

create function public.account_id(p_tenant uuid, p_code text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select id from public.money_accounts where tenant_id = p_tenant and code = p_code;
$$;

create function public.open_shift_id(p_account uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select id from public.shifts where account_id = p_account and status = 'open';
$$;

create function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select staff_id from public.profiles where id = auth.uid();
$$;

-- ₹ amounts in messages: 125 not 125.00, 12.5 → 12.50
create function public.inr(p numeric) returns text
language sql immutable as $$
    select '₹' || case when p = trunc(p) then trunc(p)::text else to_char(round(p, 2), 'FM999999999990.00') end;
$$;

-- One money movement. amount > 0 = money in, < 0 = money out.
create function public.post_ledger(
    p_tenant uuid, p_account uuid, p_amount numeric, p_kind text, p_method text default '',
    p_order uuid default null, p_purchase uuid default null, p_expense uuid default null, p_shift uuid default null,
    p_customer uuid default null, p_note text default '', p_client_id text default null, p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    if p_account is null then
        raise exception 'Money account not found';
    end if;
    if round(coalesce(p_amount, 0), 2) = 0 then
        return null;
    end if;
    insert into public.ledger_entries (tenant_id, entry_date, account_id, amount, kind, method, order_id, purchase_id,
                                       expense_id, shift_id, customer_id, note, client_id, reverses_id, staff_id, actor_name)
    values (p_tenant, public.cafe_today(p_tenant), p_account, round(p_amount, 2), p_kind, coalesce(p_method, ''), p_order,
            p_purchase, p_expense, p_shift, p_customer, coalesce(p_note, ''), p_client_id, p_reverses,
            public.my_staff_id(), public.actor_name())
    returning id into v_id;
    return v_id;
end;
$$;

create function public.notify(p_tenant uuid, p_kind text, p_title text, p_body text default '', p_link text default '',
                              p_perm text default 'orders.view', p_priority text default 'normal', p_payload jsonb default '{}')
returns uuid
language sql security definer set search_path = public, pg_temp as $$
    insert into public.notification_events (tenant_id, kind, title, body, link, perm, priority, payload)
    values (p_tenant, p_kind, p_title, coalesce(p_body, ''), coalesce(p_link, ''), p_perm, p_priority, coalesce(p_payload, '{}'))
    returning id;
$$;

-- Does a given staff member hold a permission (for manager-PIN approvals)?
create function public.staff_has_perm(p_staff uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_override boolean;
begin
    select allow into v_override from public.staff_overrides where staff_id = p_staff and perm = p_perm;
    if v_override is not null then
        return v_override;
    end if;
    return exists (select 1 from public.staff_users s join public.roles r on r.id = s.role_id
                    where s.id = p_staff and s.is_active
                      and (r.is_owner or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.perm = p_perm)));
end;
$$;

-- Discount limit of the signed-in person (owner email login and owner role = 100%)
create function public.my_discount_limit() returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select case when p.role = 'admin' then 100
                when r.is_owner then 100
                when public.has_perm('sensitive.give_discount') then coalesce(r.max_discount_pct, 0)
                else 0 end
      from public.profiles p
      left join public.staff_users s on s.id = p.staff_id
      left join public.roles r on r.id = s.role_id
     where p.id = auth.uid();
$$;

-- A manager standing next to the cashier types their mobile + PIN to approve
create function public.verify_approver(p_tenant uuid, p_phone text, p_pin text, p_perm text, p_discount_pct numeric default null)
returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
    v_staff public.staff_users;
    v_role public.roles;
begin
    select * into v_staff from public.staff_users
     where tenant_id = p_tenant and phone = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) and is_active;
    if v_staff.id is null or v_staff.pin_hash is null or crypt(coalesce(p_pin, ''), v_staff.pin_hash) <> v_staff.pin_hash
       or (v_staff.locked_until is not null and v_staff.locked_until > now()) then
        raise exception 'Manager PIN not accepted';
    end if;
    if not public.staff_has_perm(v_staff.id, p_perm) then
        raise exception '% is not allowed to approve this', v_staff.name;
    end if;
    select * into v_role from public.roles where id = v_staff.role_id;
    if p_discount_pct is not null and not v_role.is_owner and p_discount_pct > v_role.max_discount_pct then
        raise exception '% can approve up to % percent', v_staff.name, v_role.max_discount_pct;
    end if;
    return v_staff.name;
end;
$$;
revoke execute on function public.verify_approver(uuid, text, text, text, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pricing: + manual (counter) discount and pack units (1 Pack = 10 pc at the pack price)
-- ---------------------------------------------------------------------------
drop function public.price_order(uuid, uuid, jsonb, text, uuid);
create function public.price_order(p_tenant uuid, p_customer uuid, p_items jsonb, p_coupon_code text, p_loyalty_offer_id uuid,
                                   p_manual_discount numeric default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_item jsonb;
    v_menu public.menu_items;
    v_unit public.item_units;
    v_unit_price numeric;
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
    v_manual numeric := 0;
    v_elig_disc numeric := 0;
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
        v_unit := null;
        v_unit_price := v_menu.price;
        if nullif(v_item ->> 'unitId', '') is not null then
            select * into v_unit from public.item_units where id = (v_item ->> 'unitId')::uuid and menu_item_id = v_menu.id;
            if v_unit.id is null then
                raise exception 'Pack unit not found for %', v_menu.name;
            end if;
            v_unit_price := coalesce(v_unit.sale_price, round(v_menu.price * v_unit.factor, 2));
        end if;
        select components into v_comps from public.tax_groups where id = v_menu.tax_group_id;
        v_comps := coalesce(v_comps, v_default);
        v_coupon_ok := v_coupon.id is not null and not v_menu.is_restricted and (
            (cardinality(v_coupon.applicable_items) = 0 and cardinality(v_coupon.applicable_categories) = 0)
            or v_menu.id = any (v_coupon.applicable_items)
            or v_menu.category_id = any (v_coupon.applicable_categories));
        v_subtotal := v_subtotal + v_unit_price * v_qty;
        if not v_menu.is_restricted then
            v_eligible := v_eligible + v_unit_price * v_qty;
        end if;
        if v_coupon_ok then
            v_coupon_base := v_coupon_base + v_unit_price * v_qty;
        end if;
        v_lines := v_lines || jsonb_build_object(
            'menu_item_id', v_menu.id,
            'name', v_menu.name || coalesce(' (' || v_unit.name || ')', ''),
            'price', v_unit_price, 'quantity', v_qty,
            'total', v_unit_price * v_qty, 'is_restricted', v_menu.is_restricted,
            'price_includes_tax', v_menu.price_includes_tax,
            'unit_cost', v_menu.cost_price * coalesce(v_unit.factor, 1),
            'unit_name', coalesce(v_unit.name, ''), 'unit_factor', coalesce(v_unit.factor, 1),
            'note', left(coalesce(v_item ->> 'note', ''), 200),
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

    -- Counter discount: on items that may be discounted (restricted items never are)
    v_manual := round(least(greatest(coalesce(p_manual_discount, 0), 0), greatest(v_eligible - v_coupon_disc - v_offer_disc, 0)), 2);
    v_elig_disc := v_offer_disc + v_manual;

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
                     then round(v_elig_disc * ecum / v_eligible, 2) - round(v_elig_disc * (ecum - t) / v_eligible, 2)
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
        'manualDiscount', v_manual,
        'discount', v_coupon_disc + v_offer_disc + v_manual,
        'couponId', v_coupon.id,
        'couponCode', coalesce(v_coupon.code, ''),
        'offerId', v_offer.id,
        'pointsUsed', coalesce(v_offer.points_required, 0),
        'tax', (v_calc ->> 'tax')::numeric,
        'taxDetails', v_calc -> 'tax_details',
        'total', (v_calc ->> 'gross')::numeric + (v_calc ->> 'excl_tax')::numeric);
end;
$$;
revoke execute on function public.price_order(uuid, uuid, jsonb, text, uuid, numeric) from public, anon, authenticated;

-- Packs: cost and stock use pieces × pack size
create or replace function public.order_items_cost() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_cost numeric;
begin
    if new.menu_item_id is not null then
        v_cost := public.recipe_cost(new.menu_item_id);
        if v_cost is not null then
            new.unit_cost := round(v_cost * coalesce(new.unit_factor, 1), 2);
        end if;
    end if;
    return new;
end;
$$;

create or replace function public.deduct_order_line(p_line public.order_items) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid;
    v_loc uuid;
    v_mult numeric := p_line.quantity * coalesce(p_line.unit_factor, 1);
begin
    if p_line.menu_item_id is null then
        return;
    end if;
    select tenant_id into v_tenant from public.orders where id = p_line.order_id;
    v_loc := public.sale_location(p_line.menu_item_id);
    if v_loc is null then
        return;
    end if;
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
    select v_tenant, r.item_id, v_loc, -round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3), i.cost_per_unit,
           'sale', p_line.order_id, p_line.menu_item_id, p_line.name || ' × ' || p_line.quantity, 'Sale'
      from public.recipe_lines r join public.inventory i on i.id = r.item_id
     where r.menu_item_id = p_line.menu_item_id and i.track_stock
       and round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3) <> 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bill extras: optional service charge (with its GST) and round-off, on every new order
-- ---------------------------------------------------------------------------
create function public.apply_bill_extras(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_pct numeric;
    v_rate numeric;
    v_net numeric;
    v_base numeric;
    v_sc numeric := 0;
    v_sc_tax numeric := 0;
    v_sum numeric;
    v_ro numeric := 0;
begin
    select * into v_o from public.orders where id = p_order for update;
    if v_o.id is null then
        return;
    end if;
    v_base := coalesce(v_o.base_total, v_o.total);
    v_pct := coalesce((public.get_setting('service_charge_pct', '0', v_o.tenant_id) #>> '{}')::numeric, 0);
    if v_pct > 0 and not v_o.service_charge_removed and v_o.channel in ('qr', 'dine_in') then
        select coalesce(sum(net_amount), 0) into v_net from public.order_items where order_id = p_order;
        select coalesce(sum((c ->> 'rate')::numeric), 0) into v_rate
          from jsonb_array_elements(coalesce(public.get_setting('tax_config', '[]', v_o.tenant_id), '[]'::jsonb)) c;
        v_sc := round(v_net * v_pct / 100, 2);
        v_sc_tax := round(v_sc * v_rate / 100, 2);
    end if;
    v_sum := v_base + v_sc + v_sc_tax;
    if coalesce((public.get_setting('round_off', 'false', v_o.tenant_id) #>> '{}')::boolean, false) then
        v_ro := round(v_sum) - v_sum;
    end if;
    -- Nothing to add and nothing added before: leave the order untouched (no extra live update)
    if v_sc = 0 and v_sc_tax = 0 and v_ro = 0 and v_o.service_charge = 0 and v_o.service_charge_tax = 0 and v_o.round_off = 0 then
        return;
    end if;
    update public.orders
       set base_total = v_base, service_charge = v_sc, service_charge_tax = v_sc_tax, round_off = v_ro, total = v_sum + v_ro
     where id = p_order;
end;
$$;
revoke execute on function public.apply_bill_extras(uuid) from public, anon, authenticated;

create function public.order_items_bill_extras() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    for v_id in select distinct order_id from new_rows loop
        perform public.apply_bill_extras(v_id);
    end loop;
    return null;
end;
$$;
create trigger order_items_bill_extras after insert on public.order_items
    referencing new table as new_rows for each statement execute function public.order_items_bill_extras();

create function public.remove_service_charge(p_order_id uuid, p_remove boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.edit');
    update public.orders set service_charge_removed = p_remove
     where id = p_order_id and tenant_id = public.current_tenant_id() and status not in ('paid', 'cancelled');
    if not found then
        raise exception 'Order not found or already closed';
    end if;
    perform public.apply_bill_extras(p_order_id);
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Order JSON: + channel, token, staff, bill extras, kitchen status, payments
-- ---------------------------------------------------------------------------
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
                'discount', oi.discount, 'taxRate', oi.tax_rate, 'isRestricted', oi.is_restricted,
                'kitchenStatus', oi.kitchen_status, 'unitName', oi.unit_name, 'note', oi.note)
                order by oi.name)
              from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = o.id), '[]'::jsonb),
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by method)
              from (select le.method, sum(le.amount) as amt from public.ledger_entries le
                     where le.order_id = o.id and le.kind in ('sale', 'refund', 'khata_sale')
                     group by le.method having sum(le.amount) <> 0) p), '[]'::jsonb),
        'subtotal', o.subtotal, 'discount', o.discount, 'couponCode', o.coupon_code,
        'manualDiscount', o.manual_discount, 'discountReason', o.discount_reason,
        'tax', o.tax, 'gstRate', o.gst_rate, 'taxDetails', o.tax_details,
        'serviceCharge', o.service_charge, 'serviceChargeTax', o.service_charge_tax,
        'serviceChargeRemoved', o.service_charge_removed, 'roundOff', o.round_off,
        'restaurantInfo', o.restaurant_info, 'total', o.total, 'status', o.status,
        'paymentMethod', o.payment_method, 'amountPaid', o.amount_paid,
        'paymentRequest', o.payment_request, 'paymentRequestedAt', o.payment_requested_at,
        'tableNumber', o.table_number, 'table', o.table_id,
        'channel', o.channel, 'tokenNumber', o.token_number, 'staffName', o.staff_name, 'deviceCode', o.device_code,
        'cancelReason', o.cancel_reason, 'cancelledAfterKitchen', o.cancelled_after_kitchen,
        'specialInstructions', o.special_instructions,
        'loyaltyOffer', o.loyalty_offer_id, 'pointsRedeemed', o.points_redeemed,
        'pointsAwarded', o.points_awarded,
        'paidAt', o.paid_at, 'readyAt', o.ready_at,
        'createdAt', o.created_at, 'updatedAt', o.updated_at)
      from (select 1) x
      left join public.customers c on c.id = o.customer_id;
$$;

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
create function public.register_device(p_kind text, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_prefix text := case p_kind when 'counter' then 'C' when 'kiosk' then 'K' when 'kitchen' then 'D' else 'P' end;
    v_max integer;
    v_n integer;
    v_code text;
begin
    perform public.require_perm('orders.view');
    if p_kind not in ('counter', 'kiosk', 'kitchen', 'phone') then
        raise exception 'Unknown device type';
    end if;
    if p_kind = 'kiosk' then
        select p.max_kiosks into v_max from public.tenants t join public.plans p on p.id = t.plan_id where t.id = v_tenant;
        if v_max is not null and (select count(*) from public.devices where tenant_id = v_tenant and kind = 'kiosk' and is_active) >= v_max then
            raise exception 'Your plan allows % kiosk%. Upgrade the plan to add more.', v_max, case when v_max = 1 then '' else 's' end;
        end if;
    end if;
    perform pg_advisory_xact_lock(hashtext('devices:' || v_tenant::text));
    select coalesce(max(substr(code, 2)::integer), 0) + 1 into v_n
      from public.devices where tenant_id = v_tenant and code ~ ('^' || v_prefix || '[0-9]+$');
    v_code := v_prefix || v_n;
    insert into public.devices (tenant_id, code, kind, name, registered_by)
    values (v_tenant, v_code, p_kind, coalesce(nullif(trim(p_name), ''), initcap(p_kind) || ' ' || v_n), public.actor_name());
    return jsonb_build_object('code', v_code, 'kind', p_kind);
end;
$$;

create function public.touch_device(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_d public.devices;
begin
    update public.devices set last_seen_at = now()
     where tenant_id = public.current_tenant_id() and code = p_code
    returning * into v_d;
    if v_d.id is null or not v_d.is_active then
        return jsonb_build_object('ok', false);
    end if;
    return jsonb_build_object('ok', true, 'code', v_d.code, 'kind', v_d.kind, 'name', v_d.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers picked at the counter (by id, or by mobile; a new mobile creates the customer)
-- ---------------------------------------------------------------------------
create function public.counter_customer(p_tenant uuid, p_customer uuid, p_phone text, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
    v_id uuid;
begin
    if p_customer is not null then
        select id into v_id from public.customers where id = p_customer and tenant_id = p_tenant;
        if v_id is null then
            raise exception 'Customer not found';
        end if;
        return v_id;
    end if;
    if v_phone = '' then
        return null;
    end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
        raise exception 'Enter a valid 10-digit mobile number';
    end if;
    insert into public.customers (tenant_id, phone, name)
    values (p_tenant, v_phone, coalesce(nullif(trim(p_name), ''), 'Guest'))
    on conflict (tenant_id, phone) do update
       set name = case when public.customers.name in ('', 'Guest') and trim(coalesce(p_name, '')) <> '' then trim(p_name)
                       else public.customers.name end
    returning id into v_id;
    return v_id;
end;
$$;
revoke execute on function public.counter_customer(uuid, uuid, text, text) from public, anon, authenticated;

create function public.find_customers(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_q text := lower(trim(coalesce(p_query, '')));
    v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
begin
    if not (public.has_perm('orders.create') or public.has_perm('customers.view')) then
        raise exception 'Not authorized (orders.create)';
    end if;
    if length(v_q) < 2 then
        return '[]'::jsonb;
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', c.id, 'name', c.name,
                   'phone', case when v_phone then c.phone else public.mask_phone(c.phone) end,
                   'points', c.loyalty_points) order by c.name), '[]'::jsonb)
          from (select * from public.customers c
                 where c.tenant_id = public.current_tenant_id()
                   and ((length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
                        or (length(v_digits) = 0 and lower(c.name) like '%' || v_q || '%'))
                 order by c.name limit 8) c);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments: cash into the drawer of the open shift, UPI/card to their accounts
-- p_payments: [{method: cash|upi|card, amount}]
-- ---------------------------------------------------------------------------
create function public.settle_order(p_order_id uuid, p_payments jsonb, p_drawer text default 'cash_counter',
                                    p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_drawer uuid;
    v_shift uuid;
    v_p jsonb;
    v_due numeric;
    v_given numeric := 0;
    v_cash numeric := 0;
    v_change numeric := 0;
    v_change_left numeric := 0;
    v_take numeric;
    v_amount numeric;
    v_method text;
    v_methods text[] := '{}';
    v_n integer := 0;
    v_applied numeric := 0;
begin
    perform public.require_perm('orders.edit');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    if p_client_id is not null and exists (select 1 from public.ledger_entries
                                           where tenant_id = v_o.tenant_id and client_id like p_client_id || ':%') then
        return public.order_json(v_o);
    end if;
    if v_o.status = 'cancelled' then
        raise exception 'This order was cancelled';
    end if;
    v_due := v_o.total - v_o.amount_paid;
    if v_due <= 0 then
        raise exception 'This order is already paid';
    end if;
    if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) = 0 then
        raise exception 'Enter a payment';
    end if;
    for v_p in select * from jsonb_array_elements(p_payments) loop
        v_method := v_p ->> 'method';
        v_amount := round(coalesce(nullif(v_p ->> 'amount', '')::numeric, 0), 2);
        if v_method not in ('cash', 'upi', 'card', 'khata') or v_amount <= 0 then
            raise exception 'Check the payment method and amount';
        end if;
        v_given := v_given + v_amount;
        if v_method = 'cash' then
            v_cash := v_cash + v_amount;
        end if;
    end loop;
    if v_given > v_due then
        v_change := v_given - v_due;
        if v_change > v_cash then
            raise exception 'Only cash can be more than the bill (change). Due ₹%', v_due;
        end if;
    end if;

    v_change_left := v_change;
    v_drawer := public.account_id(v_o.tenant_id, coalesce(nullif(p_drawer, ''), 'cash_counter'));
    if v_drawer is null or not exists (select 1 from public.money_accounts where id = v_drawer and is_drawer) then
        raise exception 'Unknown cash drawer';
    end if;
    v_shift := public.open_shift_id(v_drawer);

    for v_p in select * from jsonb_array_elements(p_payments) loop
        v_method := v_p ->> 'method';
        v_amount := round((v_p ->> 'amount')::numeric, 2);
        if v_method = 'cash' and v_change_left > 0 then
            v_take := least(v_change_left, v_amount);
            v_amount := v_amount - v_take;
            v_change_left := v_change_left - v_take;
        end if;
        v_n := v_n + 1;
        if v_amount > 0 then
            if v_method = 'khata' then
                perform public.khata_charge(v_o, v_amount, v_shift,
                                            case when p_client_id is null then null else p_client_id || ':' || v_n end);
            else
                perform public.post_ledger(v_o.tenant_id,
                    case v_method when 'cash' then v_drawer else public.account_id(v_o.tenant_id, v_method) end,
                    v_amount, 'sale', v_method, v_o.id, null, null, v_shift, v_o.customer_id,
                    'Order ' || v_o.order_number, case when p_client_id is null then null else p_client_id || ':' || v_n end);
            end if;
            v_applied := v_applied + v_amount;
            v_methods := array_append(v_methods, v_method);
        end if;
    end loop;

    v_methods := array(select distinct m from unnest(v_methods || coalesce(
        (select array_agg(distinct method) from public.ledger_entries where order_id = v_o.id and kind in ('sale', 'khata_sale') and method <> ''),
        '{}')) m);
    update public.orders
       set amount_paid = amount_paid + v_applied,
           payment_method = case when cardinality(v_methods) > 1 then 'split' else coalesce(v_methods[1], payment_method) end,
           status = case when amount_paid + v_applied >= total then 'paid' else status end,
           paid_at = case when amount_paid + v_applied >= total then now() else paid_at end,
           payment_request = case when amount_paid + v_applied >= total then '' else payment_request end
     where id = v_o.id
    returning * into v_o;
    return public.order_json(v_o) || jsonb_build_object('change', v_change);
end;
$$;

-- Khata is added with the kiosk (Phase 3); until then it is refused
create function public.khata_charge(p_order public.orders, p_amount numeric, p_shift uuid, p_client_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    raise exception 'Khata (credit) is not set up yet';
end;
$$;
revoke execute on function public.khata_charge(public.orders, numeric, uuid, text) from public, anon, authenticated;

-- The old "Cash Paid / Online Paid" buttons: pay what is due by one method
create or replace function public.record_payment(p_order_id uuid, p_method text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_due numeric;
begin
    perform public.require_perm('orders.edit');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id();
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    v_due := v_o.total - v_o.amount_paid;
    if v_due <= 0 then
        return public.order_json(v_o);
    end if;
    return public.settle_order(p_order_id,
        jsonb_build_array(jsonb_build_object('method', case when p_method in ('online', 'upi') then 'upi' when p_method = 'card' then 'card' else 'cash' end,
                                             'amount', least(coalesce(nullif(p_amount, 0), v_due), v_due))));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancel / void with a reason; paid money is refunded to where it came from
-- ---------------------------------------------------------------------------
create function public.cancel_order(p_order_id uuid, p_reason text, p_approver_phone text default null, p_approver_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_by text := '';
    v_after boolean;
    v_e record;
begin
    perform public.require_perm('orders.edit');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    if v_o.status = 'cancelled' then
        raise exception 'This order is already cancelled';
    end if;
    if trim(coalesce(p_reason, '')) = '' then
        raise exception 'Give a reason for cancelling';
    end if;
    if not public.has_perm('sensitive.void_bill') then
        if nullif(p_approver_phone, '') is null then
            raise exception 'A manager must approve: enter their mobile and PIN';
        end if;
        v_by := public.verify_approver(v_o.tenant_id, p_approver_phone, p_approver_pin, 'sensitive.void_bill');
    end if;
    v_after := v_o.kitchen_started_at is not null
               or v_o.status in ('preparing', 'ready', 'served', 'bill_requested', 'bill_generated', 'paid');

    -- Refund each payment account (khata balances are reversed by its own entries)
    for v_e in select account_id, method, sum(amount) as amt from public.ledger_entries
                where order_id = v_o.id and kind in ('sale', 'refund', 'khata_sale')
                group by account_id, method having sum(amount) <> 0 loop
        perform public.post_ledger(v_o.tenant_id, v_e.account_id, -v_e.amt, 'refund', v_e.method, v_o.id, null, null,
                                   public.open_shift_id(v_e.account_id), v_o.customer_id, 'Refund: ' || trim(p_reason));
    end loop;

    update public.orders
       set status = 'cancelled', cancel_reason = trim(p_reason) || case when v_by <> '' then ' (approved by ' || v_by || ')' else '' end,
           cancelled_after_kitchen = v_after, payment_request = ''
     where id = v_o.id
    returning * into v_o;
    if v_after then
        perform public.notify(v_o.tenant_id, 'void', 'Order ' || v_o.order_number || ' cancelled after the kitchen started',
            public.inr(v_o.total) || ' · ' || trim(p_reason) || ' · by ' || public.actor_name(), '/admin/history?q=' || v_o.order_number,
            'reports.view', 'loud');
    end if;
    return public.order_json(v_o);
end;
$$;

create or replace function public.update_order_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.edit');
    if p_status = 'cancelled' then
        return public.cancel_order(p_order_id, 'Cancelled from the orders board');
    end if;
    if p_status = 'paid' then
        raise exception 'Record the payment to mark an order paid';
    end if;
    update public.orders set status = p_status
     where id = p_order_id and tenant_id = public.current_tenant_id() and status not in ('paid', 'cancelled');
    if not found then
        raise exception 'Order not found or already closed';
    end if;
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

-- Order status ↔ kitchen line status
create function public.orders_kitchen_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.status is distinct from old.status then
        if new.status = 'preparing' and new.kitchen_started_at is null then
            new.kitchen_started_at := now();
        end if;
        if new.status = 'ready' then
            new.ready_at := coalesce(new.ready_at, now());
            new.kitchen_started_at := coalesce(new.kitchen_started_at, now());
        end if;
    end if;
    return new;
end;
$$;
create trigger orders_kitchen_sync before update on public.orders
    for each row execute function public.orders_kitchen_sync();

create function public.orders_kitchen_lines() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.status is distinct from old.status then
        if new.status = 'preparing' then
            update public.order_items set kitchen_status = 'preparing' where order_id = new.id and kitchen_status = 'queued';
        elsif new.status = 'ready' then
            update public.order_items set kitchen_status = 'ready' where order_id = new.id and kitchen_status in ('queued', 'preparing');
        elsif new.status in ('served', 'bill_requested', 'bill_generated') then
            update public.order_items set kitchen_status = 'served' where order_id = new.id and kitchen_status <> 'served';
        end if;
    end if;
    return null;
end;
$$;
create trigger orders_kitchen_lines after update on public.orders
    for each row execute function public.orders_kitchen_lines();

-- ---------------------------------------------------------------------------
-- Counter / takeaway / kiosk orders, online or synced from an offline device
-- p: {clientId, orderNumber, deviceCode, channel, tableId, tokenNumber, customerId, customerPhone, customerName,
--     items: [{menuItem, quantity, unitId, note}], couponCode, manualDiscount, discountReason,
--     approverPhone, approverPin, specialInstructions, payments: [{method, amount}] or payFullBy: method, drawer}
-- ---------------------------------------------------------------------------
create function public.create_staff_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_client text := nullif(trim(coalesce(p ->> 'clientId', '')), '');
    v_existing public.orders;
    v_channel text := coalesce(nullif(p ->> 'channel', ''), 'dine_in');
    v_customer uuid;
    v_table public.dining_tables;
    v_calc jsonb;
    v_manual numeric := round(coalesce(nullif(p ->> 'manualDiscount', '')::numeric, 0), 2);
    v_pct numeric;
    v_by text := '';
    v_number text := nullif(trim(coalesce(p ->> 'orderNumber', '')), '');
    v_id uuid;
    v_tz text := public.cafe_timezone(v_tenant);
    v_res jsonb;
    v_o public.orders;
begin
    perform public.require_perm('orders.create');
    if not public.tenant_active(v_tenant) then
        raise exception 'This cafe''s account is locked';
    end if;
    if v_client is not null then
        select * into v_existing from public.orders where tenant_id = v_tenant and client_id = v_client;
        if v_existing.id is not null then
            return public.order_json(v_existing) || jsonb_build_object('duplicate', true);
        end if;
    end if;
    if v_channel not in ('dine_in', 'takeaway', 'kiosk') then
        raise exception 'Unknown order type';
    end if;
    if v_number is not null and v_number !~ '^[A-Z0-9]{1,8}-[0-9]{6}-[0-9]{1,6}$' then
        raise exception 'Invalid order number';
    end if;

    v_customer := public.counter_customer(v_tenant, nullif(p ->> 'customerId', '')::uuid, p ->> 'customerPhone', p ->> 'customerName');

    if nullif(p ->> 'tableId', '') is not null then
        select * into v_table from public.dining_tables where id = (p ->> 'tableId')::uuid and tenant_id = v_tenant for update;
        if v_table.id is null then
            raise exception 'Table not found';
        end if;
    end if;

    if v_manual > 0 then
        if trim(coalesce(p ->> 'discountReason', '')) = '' then
            raise exception 'Give a reason for the discount';
        end if;
    end if;
    v_calc := public.price_order(v_tenant, v_customer, p -> 'items', p ->> 'couponCode', null, v_manual);
    if v_manual > 0 then
        v_pct := round((v_calc ->> 'manualDiscount')::numeric * 100 / nullif((v_calc ->> 'subtotal')::numeric, 0), 2);
        if v_pct > public.my_discount_limit() then
            if nullif(p ->> 'approverPhone', '') is null then
                raise exception 'Discount of % percent is above your limit of % percent. A manager must approve.', v_pct, public.my_discount_limit();
            end if;
            v_by := public.verify_approver(v_tenant, p ->> 'approverPhone', p ->> 'approverPin', 'sensitive.give_discount', v_pct);
        end if;
    end if;

    if v_calc ->> 'couponId' is not null then
        update public.coupons set used_count = used_count + 1 where id = (v_calc ->> 'couponId')::uuid;
    end if;

    insert into public.orders (
        tenant_id, order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate, tax_details, restaurant_info,
        total, table_id, table_number, special_instructions, status, channel, token_number, client_id, device_code,
        created_by_staff, staff_name, manual_discount, discount_reason, discount_approved_by)
    values (
        v_tenant,
        coalesce(v_number, 'ORD-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-'
                           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
        v_customer, (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'discount')::numeric, v_calc ->> 'couponCode',
        (v_calc ->> 'tax')::numeric, coalesce((public.get_setting('gst_rate', '5', v_tenant) #>> '{}')::numeric, 5),
        v_calc -> 'taxDetails',
        jsonb_build_object(
            'name', public.get_setting('restaurant_name', '""', v_tenant) #>> '{}',
            'address', public.get_setting('restaurant_address', '""', v_tenant) #>> '{}',
            'phone', public.get_setting('restaurant_phone', '""', v_tenant) #>> '{}',
            'gstNumber', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
            'fssaiNumber', public.get_setting('fssai_number', '""', v_tenant) #>> '{}',
            'footer', public.get_setting('bill_footer', '""', v_tenant) #>> '{}'),
        (v_calc ->> 'total')::numeric, v_table.id, coalesce(v_table.table_number, ''),
        left(coalesce(p ->> 'specialInstructions', ''), 500), 'confirmed', v_channel,
        left(coalesce(p ->> 'tokenNumber', ''), 12), v_client, left(coalesce(p ->> 'deviceCode', ''), 8),
        public.my_staff_id(), public.actor_name(), (v_calc ->> 'manualDiscount')::numeric,
        trim(coalesce(p ->> 'discountReason', '')), v_by)
    returning id into v_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost,
                                    unit_name, unit_factor, note)
    select v_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0),
           l ->> 'unit_name', (l ->> 'unit_factor')::numeric, coalesce(l ->> 'note', '')
      from jsonb_array_elements(v_calc -> 'lines') l;

    if v_table.id is not null then
        update public.dining_tables set status = 'occupied', is_occupied = true, current_order_id = v_id where id = v_table.id;
    end if;
    -- Kiosk sales are handed over at once; they never go to the kitchen
    if v_channel = 'kiosk' then
        update public.order_items set kitchen_status = 'served' where order_id = v_id;
    end if;

    -- payFullBy: pay exactly what the bill comes to (used by offline devices, which can't price the bill)
    if nullif(p ->> 'payFullBy', '') is not null then
        select * into v_o from public.orders where id = v_id;
        return public.settle_order(v_id, jsonb_build_array(jsonb_build_object('method', p ->> 'payFullBy', 'amount', v_o.total)),
                                   coalesce(nullif(p ->> 'drawer', ''), 'cash_counter'), coalesce(v_client, v_id::text) || ':pay');
    end if;
    if jsonb_typeof(p -> 'payments') = 'array' and jsonb_array_length(p -> 'payments') > 0 then
        return public.settle_order(v_id, p -> 'payments', coalesce(nullif(p ->> 'drawer', ''), 'cash_counter'),
                                   coalesce(v_client, v_id::text) || ':pay');
    end if;
    select * into v_o from public.orders where id = v_id;
    return public.order_json(v_o);
end;
$$;

-- Price preview for the counter (same maths as create_staff_order)
create function public.quote_staff_order(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_q jsonb;
begin
    perform public.require_perm('orders.create');
    v_q := public.price_order(public.current_tenant_id(), nullif(p ->> 'customerId', '')::uuid, p -> 'items', p ->> 'couponCode', null,
                              round(coalesce(nullif(p ->> 'manualDiscount', '')::numeric, 0), 2));
    return (v_q - 'couponId' - 'offerId') || jsonb_build_object('discountLimit', public.my_discount_limit());
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer asks to pay: at the counter, or by UPI QR at the table
-- ---------------------------------------------------------------------------
create function public.request_payment(p_order_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_due numeric;
    v_where text;
begin
    if p_mode not in ('counter', 'qr') then
        raise exception 'Choose how to pay';
    end if;
    select * into v_o from public.orders where id = p_order_id;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    if v_o.customer_id is distinct from public.current_customer_id()
       and not (v_o.tenant_id = public.current_tenant_id() and public.has_perm('orders.edit')) then
        raise exception 'Not authorized';
    end if;
    if v_o.status in ('paid', 'cancelled') then
        raise exception 'This order is closed';
    end if;
    update public.orders
       set payment_request = p_mode, payment_requested_at = now(),
           status = case when status in ('bill_generated') then status else 'bill_requested' end
     where id = v_o.id
    returning * into v_o;
    v_due := v_o.total - v_o.amount_paid;
    v_where := coalesce(nullif('Table ' || v_o.table_number, 'Table '), 'Order ' || v_o.order_number);
    perform public.notify(v_o.tenant_id, 'payment_request',
        case p_mode when 'qr' then v_where || ' wants to pay ' || public.inr(v_due) || ' by UPI' else v_where || ' is coming to the counter to pay ' || public.inr(v_due) end,
        case p_mode when 'qr' then 'Take the cafe''s UPI QR to the table' else '' end,
        '/admin/orders', 'orders.edit', 'alarm', jsonb_build_object('orderId', v_o.id));
    return public.order_json(v_o);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kitchen screen
-- ---------------------------------------------------------------------------
create function public.kitchen_orders() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', o.id, 'orderNumber', o.order_number, 'status', o.status, 'channel', o.channel,
                   'tableNumber', o.table_number, 'tokenNumber', o.token_number,
                   'customer', c.name, 'note', o.special_instructions, 'createdAt', o.created_at,
                   'kitchenStartedAt', o.kitchen_started_at,
                   'items', (select jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
                                                                 'status', oi.kitchen_status, 'note', oi.note) order by oi.name)
                               from public.order_items oi where oi.order_id = o.id))
                   order by o.created_at), '[]'::jsonb)
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where o.tenant_id = public.current_tenant_id()
           and o.status <> 'cancelled' and o.channel <> 'kiosk'
           and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.kitchen_status <> 'served')
           and o.created_at > now() - interval '24 hours');
end;
$$;

-- p_item null = the whole order
create function public.set_kitchen_status(p_order_id uuid, p_item_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_open integer;
    v_started integer;
begin
    perform public.require_perm('orders.edit');
    if p_status not in ('queued', 'preparing', 'ready', 'served') then
        raise exception 'Unknown kitchen status';
    end if;
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_o.id is null or v_o.status = 'cancelled' then
        raise exception 'Order not found or cancelled';
    end if;
    update public.order_items set kitchen_status = p_status
     where order_id = p_order_id and (p_item_id is null or id = p_item_id);
    select count(*) filter (where kitchen_status in ('queued', 'preparing')),
           count(*) filter (where kitchen_status <> 'queued')
      into v_open, v_started
      from public.order_items where order_id = p_order_id;
    update public.orders
       set status = case
               when v_open = 0 and p_status = 'served' and status in ('pending', 'confirmed', 'preparing', 'ready') then 'served'
               when v_open = 0 and status in ('pending', 'confirmed', 'preparing') then 'ready'
               when v_started > 0 and status in ('pending', 'confirmed') then 'preparing'
               else status end,
           kitchen_started_at = case when v_started > 0 then coalesce(kitchen_started_at, now()) else kitchen_started_at end,
           updated_at = now()
     where id = p_order_id;
    return public.kitchen_orders();
end;
$$;

-- ---------------------------------------------------------------------------
-- Shifts and cash drawers
-- ---------------------------------------------------------------------------
create function public.denoms_total(p jsonb) returns numeric
language sql immutable as $$
    select coalesce(sum(key::numeric * value::numeric), 0) from jsonb_each_text(coalesce(p, '{}')) where key ~ '^[0-9.]+$' and value ~ '^[0-9]+$';
$$;

create function public.shift_json(s public.shifts) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'id', s.id, 'status', s.status, 'drawer', a.code, 'drawerName', a.name,
        'openedBy', s.opened_by, 'openedAt', s.opened_at, 'openingCash', s.opening_cash, 'openingDenoms', s.opening_denoms,
        'lastCloseCash', s.last_close_cash,
        'closedBy', s.closed_by, 'closedAt', s.closed_at, 'countedCash', s.counted_cash, 'closingDenoms', s.closing_denoms,
        'reason', s.reason, 'note', s.note,
        'cashSales', coalesce(sum(le.amount) filter (where le.account_id = s.account_id and le.kind in ('sale', 'refund')), 0),
        'payouts', coalesce(-sum(le.amount) filter (where le.account_id = s.account_id and le.kind in ('payout', 'expense', 'purchase_payment')), 0),
        'drops', coalesce(-sum(le.amount) filter (where le.account_id = s.account_id and le.kind = 'drop'), 0),
        'payIns', coalesce(sum(le.amount) filter (where le.account_id = s.account_id and le.kind = 'pay_in'), 0),
        'khataSettled', coalesce(sum(le.amount) filter (where le.account_id = s.account_id and le.kind = 'khata_settle'), 0),
        'expectedCash', coalesce(s.expected_cash, s.opening_cash + coalesce(sum(le.amount) filter (where le.account_id = s.account_id), 0)),
        'upiExpected', coalesce(s.upi_expected, sum(le.amount) filter (where ma.kind = 'upi'), 0),
        'cardExpected', coalesce(s.card_expected, sum(le.amount) filter (where ma.kind = 'card'), 0),
        'upiReported', s.upi_reported, 'cardReported', s.card_reported,
        'difference', s.difference,
        'orders', (select count(distinct order_id) from public.ledger_entries x where x.shift_id = s.id and x.kind = 'sale'))
      from public.money_accounts a
      left join public.ledger_entries le on le.shift_id = s.id
      left join public.money_accounts ma on ma.id = le.account_id
     where a.id = s.account_id
     group by a.code, a.name;
$$;

create function public.current_shifts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.has_perm('orders.edit') or public.has_perm('finance.view')) then
        raise exception 'Not authorized (orders.edit)';
    end if;
    return (
        select jsonb_build_object(
            'drawers', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name,
                                                                     'lastCloseCash', (select counted_cash from public.shifts x
                                                                                        where x.account_id = a.id and x.status = 'closed'
                                                                                        order by closed_at desc limit 1))
                                                  order by a.sort_order), '[]'::jsonb)
                          from public.money_accounts a where a.tenant_id = public.current_tenant_id() and a.is_drawer and a.is_active),
            'open', (select coalesce(jsonb_agg(public.shift_json(s) order by s.opened_at), '[]'::jsonb)
                       from public.shifts s where s.tenant_id = public.current_tenant_id() and s.status = 'open'),
            'tolerance', coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50)));
end;
$$;

create function public.open_shift(p_drawer text, p_denoms jsonb, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_acc public.money_accounts;
    v_last numeric;
    v_cash numeric := public.denoms_total(p_denoms);
    v_s public.shifts;
    v_tol numeric := coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50);
begin
    perform public.require_perm('orders.edit');
    select * into v_acc from public.money_accounts where tenant_id = v_tenant and code = p_drawer and is_drawer;
    if v_acc.id is null then
        raise exception 'Unknown cash drawer';
    end if;
    if public.open_shift_id(v_acc.id) is not null then
        raise exception '% already has an open shift', v_acc.name;
    end if;
    select counted_cash into v_last from public.shifts where account_id = v_acc.id and status = 'closed' order by closed_at desc limit 1;
    insert into public.shifts (tenant_id, account_id, opened_by, opened_by_staff, opening_cash, opening_denoms, last_close_cash, note)
    values (v_tenant, v_acc.id, public.actor_name(), public.my_staff_id(), v_cash, coalesce(p_denoms, '{}'), v_last, coalesce(p_note, ''))
    returning * into v_s;
    if v_last is not null and abs(v_cash - v_last) > v_tol then
        perform public.notify(v_tenant, 'shift_open_mismatch', v_acc.name || ' opened with ' || public.inr(v_cash) || ', last close counted ' || public.inr(v_last),
            'Opened by ' || public.actor_name(), '/admin/shifts', 'finance.view', 'loud');
    end if;
    return public.shift_json(v_s);
end;
$$;

-- payout: cash taken out for a small purchase (optionally recorded as an expense)
-- pay_in: cash put into the drawer from the safe · drop: cash moved from the drawer to the safe
create function public.cash_movement(p_drawer text, p_kind text, p_amount numeric, p_note text default '',
                                     p_category_id uuid default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_acc uuid := public.account_id(public.current_tenant_id(), p_drawer);
    v_office uuid := public.account_id(public.current_tenant_id(), 'cash_office');
    v_shift uuid;
    v_amount numeric := round(coalesce(p_amount, 0), 2);
    v_exp uuid;
    v_s public.shifts;
begin
    perform public.require_perm('orders.edit');
    if p_client_id is not null and exists (select 1 from public.ledger_entries where tenant_id = v_tenant and client_id = p_client_id) then
        select * into v_s from public.shifts where id = (select shift_id from public.ledger_entries where tenant_id = v_tenant and client_id = p_client_id);
        return public.shift_json(v_s);
    end if;
    if p_kind not in ('payout', 'pay_in', 'drop') or v_amount <= 0 then
        raise exception 'Check the type and amount';
    end if;
    v_shift := public.open_shift_id(v_acc);
    if v_shift is null then
        raise exception 'Open a shift on this drawer first';
    end if;
    if trim(coalesce(p_note, '')) = '' and p_category_id is null then
        raise exception 'Write what the cash was for';
    end if;
    if p_kind = 'payout' then
        if p_category_id is not null then
            if not exists (select 1 from public.expense_categories where id = p_category_id and tenant_id = v_tenant) then
                raise exception 'Expense category not found';
            end if;
            insert into public.expenses (tenant_id, expense_date, category_id, amount, status, account_id, paid_at, note, shift_id, actor_name)
            values (v_tenant, public.cafe_today(v_tenant), p_category_id, v_amount, 'paid', v_acc, now(), coalesce(p_note, ''), v_shift, public.actor_name())
            returning id into v_exp;
        end if;
        perform public.post_ledger(v_tenant, v_acc, -v_amount, case when v_exp is null then 'payout' else 'expense' end, 'cash',
                                   null, null, v_exp, v_shift, null, p_note, p_client_id);
    elsif p_kind = 'drop' then
        perform public.post_ledger(v_tenant, v_acc, -v_amount, 'drop', 'cash', null, null, null, v_shift, null, coalesce(nullif(p_note, ''), 'To safe'), p_client_id);
        perform public.post_ledger(v_tenant, v_office, v_amount, 'drop', 'cash', null, null, null, null, null, coalesce(nullif(p_note, ''), 'From drawer'));
    else
        perform public.post_ledger(v_tenant, v_acc, v_amount, 'pay_in', 'cash', null, null, null, v_shift, null, coalesce(nullif(p_note, ''), 'From safe'), p_client_id);
        perform public.post_ledger(v_tenant, v_office, -v_amount, 'pay_in', 'cash', null, null, null, null, null, coalesce(nullif(p_note, ''), 'To drawer'));
    end if;
    select * into v_s from public.shifts where id = v_shift;
    return public.shift_json(v_s);
end;
$$;

create function public.close_shift(p_shift_id uuid, p_denoms jsonb, p_upi_reported numeric default null,
                                   p_card_reported numeric default null, p_reason text default '', p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_s public.shifts;
    v_j jsonb;
    v_counted numeric := public.denoms_total(p_denoms);
    v_diff numeric;
    v_tol numeric := coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50);
    v_name text;
begin
    perform public.require_perm('orders.edit');
    select * into v_s from public.shifts where id = p_shift_id and tenant_id = public.current_tenant_id() for update;
    if v_s.id is null or v_s.status <> 'open' then
        raise exception 'This shift is not open';
    end if;
    v_j := public.shift_json(v_s);
    v_diff := v_counted - (v_j ->> 'expectedCash')::numeric;
    if abs(v_diff) > v_tol and trim(coalesce(p_reason, '')) = '' then
        raise exception 'Cash is off by %. Write the reason to close the shift.', public.inr(v_diff);
    end if;
    update public.shifts
       set status = 'closed', closed_by = public.actor_name(), closed_at = now(), counted_cash = v_counted,
           closing_denoms = coalesce(p_denoms, '{}'), expected_cash = (v_j ->> 'expectedCash')::numeric,
           upi_expected = (v_j ->> 'upiExpected')::numeric, card_expected = (v_j ->> 'cardExpected')::numeric,
           upi_reported = p_upi_reported, card_reported = p_card_reported, difference = v_diff,
           reason = trim(coalesce(p_reason, '')), note = trim(coalesce(v_s.note || ' ' || coalesce(p_note, ''), ''))
     where id = v_s.id
    returning * into v_s;
    select name into v_name from public.money_accounts where id = v_s.account_id;
    if abs(v_diff) > v_tol or (p_upi_reported is not null and abs(p_upi_reported - (v_j ->> 'upiExpected')::numeric) > v_tol) then
        perform public.notify(v_s.tenant_id, 'shift_mismatch',
            v_name || ' closed ' || case when v_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_diff)),
            'Closed by ' || public.actor_name() || coalesce(' · ' || nullif(trim(p_reason), ''), '')
                || case when p_upi_reported is not null then ' · UPI app ' || public.inr(p_upi_reported) || ' vs ' || public.inr((v_j ->> 'upiExpected')::numeric) else '' end,
            '/admin/shifts', 'finance.view', 'loud');
    end if;
    return public.shift_json(v_s);
end;
$$;

create function public.list_shifts(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (
        select coalesce(jsonb_agg(public.shift_json(s) order by s.opened_at desc), '[]'::jsonb)
          from (select * from public.shifts
                 where tenant_id = public.current_tenant_id()
                   and (p_from is null or opened_at >= p_from::timestamp at time zone public.cafe_timezone())
                   and (p_to is null or opened_at < (p_to + 1)::timestamp at time zone public.cafe_timezone())
                 order by opened_at desc limit 200) s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
-- Recurring expenses (rent, internet) become "due" entries on their date
create function public.ensure_recurring_expenses(p_tenant uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_r public.recurring_expenses;
    v_n integer := 0;
    v_today date := public.cafe_today(p_tenant);
begin
    for v_r in select * from public.recurring_expenses where tenant_id = p_tenant and is_active and next_due <= v_today for update loop
        while v_r.next_due <= v_today loop
            insert into public.expenses (tenant_id, expense_date, category_id, amount, status, note, spread_months, recurring_id, actor_name)
            values (p_tenant, v_r.next_due, v_r.category_id, v_r.amount, 'due', v_r.name, v_r.spread_months, v_r.id, 'Recurring');
            v_r.next_due := (v_r.next_due + interval '1 month')::date;
            v_n := v_n + 1;
        end loop;
        update public.recurring_expenses set next_due = v_r.next_due where id = v_r.id;
    end loop;
    return v_n;
end;
$$;
revoke execute on function public.ensure_recurring_expenses(uuid) from public, anon, authenticated;

-- p: {clientId, date, categoryId, amount, status: paid|due, accountCode, vendorName, note, billPhotoUrl, spreadMonths}
create function public.record_expense(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_client text := nullif(p ->> 'clientId', '');
    v_id uuid;
    v_status text := coalesce(nullif(p ->> 'status', ''), 'paid');
    v_acc uuid;
    v_amount numeric := round(coalesce(nullif(p ->> 'amount', '')::numeric, 0), 2);
    v_shift uuid;
begin
    perform public.require_perm('finance.create');
    if v_client is not null then
        select id into v_id from public.expenses where tenant_id = v_tenant and client_id = v_client;
        if v_id is not null then
            return v_id;
        end if;
    end if;
    if v_amount <= 0 then
        raise exception 'Enter the amount';
    end if;
    if not exists (select 1 from public.expense_categories where id = nullif(p ->> 'categoryId', '')::uuid and tenant_id = v_tenant) then
        raise exception 'Pick a category';
    end if;
    if v_status = 'paid' then
        v_acc := public.account_id(v_tenant, coalesce(nullif(p ->> 'accountCode', ''), 'cash_office'));
        if v_acc is null then
            raise exception 'Pick where it was paid from';
        end if;
        v_shift := public.open_shift_id(v_acc);
    end if;
    insert into public.expenses (tenant_id, expense_date, category_id, amount, status, account_id, paid_at, vendor_name, note,
                                 bill_photo_url, spread_months, shift_id, client_id, actor_name)
    values (v_tenant, coalesce(nullif(p ->> 'date', '')::date, public.cafe_today(v_tenant)), (p ->> 'categoryId')::uuid, v_amount,
            v_status, v_acc, case when v_status = 'paid' then now() end, trim(coalesce(p ->> 'vendorName', '')),
            trim(coalesce(p ->> 'note', '')), coalesce(p ->> 'billPhotoUrl', ''),
            greatest(1, least(12, coalesce(nullif(p ->> 'spreadMonths', '')::integer, 1))), v_shift, v_client, public.actor_name())
    returning id into v_id;
    if v_status = 'paid' then
        perform public.post_ledger(v_tenant, v_acc, -v_amount, 'expense', '', null, null, v_id, v_shift, null,
                                   trim(coalesce(p ->> 'note', '')), v_client);
    end if;
    return v_id;
end;
$$;

create function public.pay_expense(p_id uuid, p_account_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.expenses;
    v_acc uuid := public.account_id(public.current_tenant_id(), p_account_code);
begin
    perform public.require_perm('finance.edit');
    select * into v_e from public.expenses where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_e.id is null or v_e.is_void or v_e.status <> 'due' then
        raise exception 'This expense is not due';
    end if;
    if v_acc is null then
        raise exception 'Pick where it was paid from';
    end if;
    update public.expenses set status = 'paid', account_id = v_acc, paid_at = now(), shift_id = public.open_shift_id(v_acc) where id = p_id;
    perform public.post_ledger(v_e.tenant_id, v_acc, -v_e.amount, 'expense', '', null, null, p_id, public.open_shift_id(v_acc), null, v_e.note);
end;
$$;

create function public.void_expense(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_e public.expenses;
    v_l record;
begin
    perform public.require_perm('finance.delete');
    if trim(coalesce(p_reason, '')) = '' then
        raise exception 'Give a reason';
    end if;
    select * into v_e from public.expenses where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_e.id is null or v_e.is_void then
        raise exception 'Expense not found';
    end if;
    for v_l in select * from public.ledger_entries where expense_id = p_id and reverses_id is null loop
        perform public.post_ledger(v_e.tenant_id, v_l.account_id, -v_l.amount, 'reversal', '', null, null, p_id, null, null,
                                   'Expense cancelled: ' || trim(p_reason), null, v_l.id);
    end loop;
    update public.expenses set is_void = true, void_reason = trim(p_reason) where id = p_id;
end;
$$;

create function public.list_expenses(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    perform public.ensure_recurring_expenses(public.current_tenant_id());
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', e.id, 'date', e.expense_date, 'category', c.name, 'categoryId', e.category_id, 'amount', e.amount,
                   'status', e.status, 'account', a.name, 'vendorName', e.vendor_name, 'note', e.note,
                   'billPhotoUrl', e.bill_photo_url, 'spreadMonths', e.spread_months, 'recurring', e.recurring_id is not null,
                   'isVoid', e.is_void, 'voidReason', e.void_reason, 'by', e.actor_name, 'createdAt', e.created_at)
                   order by e.expense_date desc, e.created_at desc), '[]'::jsonb)
          from public.expenses e
          join public.expense_categories c on c.id = e.category_id
          left join public.money_accounts a on a.id = e.account_id
         where e.tenant_id = public.current_tenant_id()
           and (p_from is null or e.expense_date >= p_from or e.status = 'due')
           and (p_to is null or e.expense_date <= p_to));
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchases pay through the ledger
-- ---------------------------------------------------------------------------
alter table public.purchases drop constraint if exists purchases_payment_mode_check;
alter table public.purchases add constraint purchases_payment_mode_check
    check (payment_mode in ('cash', 'upi', 'bank', 'card', 'credit', 'drawer'));

create function public.purchase_account(p_tenant uuid, p_mode text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select public.account_id(p_tenant, case p_mode when 'upi' then 'upi' when 'bank' then 'bank' when 'card' then 'card'
                                                   when 'drawer' then 'cash_counter' else 'cash_office' end);
$$;

create function public.purchases_ledger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_delta numeric := new.paid_amount - case when tg_op = 'INSERT' then 0 else old.paid_amount end;
    v_acc uuid;
begin
    if v_delta <> 0 then
        v_acc := public.purchase_account(new.tenant_id, new.payment_mode);
        perform public.post_ledger(new.tenant_id, v_acc, -v_delta, 'purchase_payment', new.payment_mode, null, new.id, null,
                                   public.open_shift_id(v_acc), null,
                                   concat_ws(' · ', nullif(new.vendor_name, ''), nullif('Bill ' || new.bill_number, 'Bill ')));
    end if;
    return null;
end;
$$;
create trigger purchases_ledger after insert or update of paid_amount on public.purchases
    for each row execute function public.purchases_ledger();

create or replace function public.pay_purchase(p_id uuid, p_amount numeric, p_mode text default 'cash') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p public.purchases;
begin
    perform public.require_perm('inventory.edit');
    if coalesce(p_amount, 0) <= 0 then
        raise exception 'Enter an amount';
    end if;
    select * into v_p from public.purchases where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_p.id is null or v_p.is_void then
        raise exception 'Purchase not found';
    end if;
    if p_amount > v_p.total - v_p.paid_amount then
        raise exception 'Only ₹% is due on this bill', v_p.total - v_p.paid_amount;
    end if;
    update public.purchases
       set payment_mode = case when p_mode in ('cash', 'upi', 'bank', 'card', 'drawer') then p_mode else 'cash' end
     where id = p_id;
    update public.purchases
       set paid_amount = paid_amount + p_amount,
           due_date = case when paid_amount + p_amount >= total then null else due_date end
     where id = p_id
    returning * into v_p;
    return jsonb_build_object('paid', v_p.paid_amount, 'due', v_p.total - v_p.paid_amount);
end;
$$;

-- What the cafe owes: unpaid vendor bills (aged) and due expenses
create function public.payables() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
begin
    perform public.require_perm('finance.view');
    perform public.ensure_recurring_expenses(v_tenant);
    return jsonb_build_object(
        'bills', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', p.id, 'vendor', p.vendor_name, 'vendorId', p.vendor_id, 'phone', v.phone, 'billNumber', p.bill_number,
                         'billDate', p.bill_date, 'dueDate', p.due_date, 'total', p.total, 'due', p.total - p.paid_amount,
                         'age', v_today - p.bill_date, 'overdue', p.due_date is not null and p.due_date < v_today)
                         order by p.bill_date), '[]'::jsonb)
                    from public.purchases p left join public.vendors v on v.id = p.vendor_id
                   where p.tenant_id = v_tenant and not p.is_void and p.paid_amount < p.total),
        'aging', (select jsonb_build_object(
                         'd0_7', coalesce(sum(p.total - p.paid_amount) filter (where v_today - p.bill_date <= 7), 0),
                         'd8_15', coalesce(sum(p.total - p.paid_amount) filter (where v_today - p.bill_date between 8 and 15), 0),
                         'd16_30', coalesce(sum(p.total - p.paid_amount) filter (where v_today - p.bill_date between 16 and 30), 0),
                         'd30', coalesce(sum(p.total - p.paid_amount) filter (where v_today - p.bill_date > 30), 0))
                    from public.purchases p where p.tenant_id = v_tenant and not p.is_void and p.paid_amount < p.total),
        'expenses', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', e.id, 'date', e.expense_date, 'category', c.name, 'amount', e.amount, 'note', e.note,
                            'overdue', e.expense_date < v_today) order by e.expense_date), '[]'::jsonb)
                       from public.expenses e join public.expense_categories c on c.id = e.category_id
                      where e.tenant_id = v_tenant and e.status = 'due' and not e.is_void));
end;
$$;

-- ---------------------------------------------------------------------------
-- Money views
-- ---------------------------------------------------------------------------
create function public.account_balances() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind, 'isDrawer', a.is_drawer,
                                                     'balance', coalesce((select sum(amount) from public.ledger_entries le where le.account_id = a.id), 0))
                                  order by a.sort_order), '[]'::jsonb)
          from public.money_accounts a where a.tenant_id = public.current_tenant_id() and a.is_active);
end;
$$;

-- p: {from, to, accountCode, kind, limit}
create function public.list_ledger(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', le.id, 'date', le.entry_date, 'createdAt', le.created_at, 'account', a.name, 'accountCode', a.code,
                   'amount', le.amount, 'kind', le.kind, 'method', le.method, 'note', le.note, 'by', le.actor_name,
                   'orderNumber', o.order_number, 'orderId', le.order_id, 'expenseId', le.expense_id, 'purchaseId', le.purchase_id,
                   'customer', c.name, 'reverses', le.reverses_id)
                   order by le.created_at desc), '[]'::jsonb)
          from (select * from public.ledger_entries
                 where tenant_id = public.current_tenant_id()
                   and (nullif(p ->> 'from', '') is null or entry_date >= (p ->> 'from')::date)
                   and (nullif(p ->> 'to', '') is null or entry_date <= (p ->> 'to')::date)
                   and (nullif(p ->> 'kind', '') is null or kind = p ->> 'kind')
                   and (nullif(p ->> 'accountCode', '') is null
                        or account_id = public.account_id(public.current_tenant_id(), p ->> 'accountCode'))
                 order by created_at desc limit least(coalesce(nullif(p ->> 'limit', '')::integer, 300), 2000)) le
          join public.money_accounts a on a.id = le.account_id
          left join public.orders o on o.id = le.order_id
          left join public.customers c on c.id = le.customer_id);
end;
$$;

-- Day close: everything that happened on one day
create function public.day_summary(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_day date := coalesce(p_date, public.cafe_today(public.current_tenant_id()));
begin
    if not (public.has_perm('finance.view') or public.has_perm('reports.view')) then
        raise exception 'Not authorized (finance.view)';
    end if;
    return jsonb_build_object(
        'date', v_day,
        'sales', (select jsonb_build_object(
                    'orders', count(*) filter (where status <> 'cancelled'),
                    'gross', coalesce(sum(total) filter (where status <> 'cancelled'), 0),
                    'tax', coalesce(sum(tax + service_charge_tax) filter (where status <> 'cancelled'), 0),
                    'discounts', coalesce(sum(discount) filter (where status <> 'cancelled'), 0),
                    'serviceCharge', coalesce(sum(service_charge) filter (where status <> 'cancelled'), 0),
                    'unpaid', coalesce(sum(total - amount_paid) filter (where status not in ('cancelled', 'paid')), 0),
                    'cancelled', count(*) filter (where status = 'cancelled'),
                    'cancelledValue', coalesce(sum(total) filter (where status = 'cancelled'), 0),
                    'voidsAfterKitchen', count(*) filter (where cancelled_after_kitchen),
                    'avgBill', round(coalesce(avg(total) filter (where status <> 'cancelled'), 0), 2))
                    from public.orders where tenant_id = v_tenant and (created_at at time zone v_tz)::date = v_day),
        'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'total', t) order by t desc), '[]'::jsonb)
                       from (select channel, count(*) n, sum(total) t from public.orders
                              where tenant_id = v_tenant and status <> 'cancelled' and (created_at at time zone v_tz)::date = v_day
                              group by channel) s),
        'money', (select coalesce(jsonb_agg(jsonb_build_object('account', a.name, 'code', a.code, 'in', i, 'out', o) order by a.sort_order), '[]'::jsonb)
                    from (select account_id, coalesce(sum(amount) filter (where amount > 0), 0) i, coalesce(-sum(amount) filter (where amount < 0), 0) o
                            from public.ledger_entries where tenant_id = v_tenant and entry_date = v_day group by account_id) s
                    join public.money_accounts a on a.id = s.account_id),
        'expenses', (select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'amount', t) order by t desc), '[]'::jsonb)
                       from (select category_id, sum(amount) t from public.expenses
                              where tenant_id = v_tenant and not is_void and expense_date = v_day group by category_id) s
                       join public.expense_categories c on c.id = s.category_id),
        'purchases', (select coalesce(sum(total), 0) from public.purchases where tenant_id = v_tenant and not is_void and bill_date = v_day),
        'shifts', (select coalesce(jsonb_agg(public.shift_json(s) order by s.opened_at), '[]'::jsonb)
                     from public.shifts s where s.tenant_id = v_tenant and (s.opened_at at time zone v_tz)::date = v_day),
        'voids', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', order_number, 'total', total, 'reason', cancel_reason,
                                                               'afterKitchen', cancelled_after_kitchen, 'by', staff_name) order by created_at), '[]'::jsonb)
                    from public.orders where tenant_id = v_tenant and status = 'cancelled' and (created_at at time zone v_tz)::date = v_day),
        'discounts', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', order_number, 'amount', manual_discount,
                                                                   'reason', discount_reason, 'by', staff_name, 'approvedBy', discount_approved_by)
                                                order by created_at), '[]'::jsonb)
                        from public.orders where tenant_id = v_tenant and manual_discount > 0 and (created_at at time zone v_tz)::date = v_day));
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications for the signed-in person
-- ---------------------------------------------------------------------------
create function public.my_notifications(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link, 'priority', n.priority,
                   'payload', n.payload, 'acknowledgedBy', n.acknowledged_by, 'acknowledgedAt', n.acknowledged_at, 'createdAt', n.created_at)
                   order by n.created_at desc), '[]'::jsonb)
          from (select * from public.notification_events n
                 where n.tenant_id = public.current_tenant_id() and public.has_perm(n.perm)
                 order by n.created_at desc limit least(coalesce(p_limit, 30), 200)) n);
end;
$$;

create function public.ack_notification(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    update public.notification_events set acknowledged_by = public.actor_name(), acknowledged_at = now()
     where id = p_id and tenant_id = public.current_tenant_id() and acknowledged_at is null and public.has_perm(perm);
end;
$$;

-- Internal helpers are not callable from the browser
revoke execute on function public.post_ledger(uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.notify(uuid, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.staff_has_perm(uuid, text) from public, anon, authenticated;
revoke execute on function public.account_id(uuid, text) from public, anon, authenticated;
revoke execute on function public.open_shift_id(uuid) from public, anon, authenticated;
revoke execute on function public.purchase_account(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.money_accounts enable row level security;
alter table public.shifts enable row level security;
alter table public.expense_categories enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.notification_events enable row level security;

create policy "staff view" on public.devices for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.view')));
create policy "staff edit" on public.devices for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('settings.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff view" on public.money_accounts for select
    using (tenant_id = (select public.current_tenant_id())
           and ((select public.has_perm('finance.view')) or (select public.has_perm('orders.edit'))));
create policy "staff edit" on public.money_accounts for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff view" on public.shifts for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.view')));
create policy "staff view" on public.expense_categories for select
    using (tenant_id = (select public.current_tenant_id())
           and ((select public.has_perm('finance.view')) or (select public.has_perm('orders.edit'))));
create policy "staff create" on public.expense_categories for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.edit')));
create policy "staff edit" on public.expense_categories for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff view" on public.recurring_expenses for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.view')));
create policy "staff create" on public.recurring_expenses for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.edit')));
create policy "staff edit" on public.recurring_expenses for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff delete" on public.recurring_expenses for delete
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.delete')));
create policy "staff view" on public.expenses for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.view')));
create policy "staff view" on public.ledger_entries for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.view')));
create policy "staff view" on public.notification_events for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(perm)));

do $$
begin
    perform public.seed_tenant_extras(id) from public.tenants;
end $$;

commit;

-- Cafe ERP · Phase 3 (kiosk and khata) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261007000001_kiosk_khata.sql ====
-- Phase 3: quick kiosk and khata (credit tab).
-- Khata balances are the khata account of the money ledger per customer: a credit sale adds,
-- a settlement subtracts. Kiosk sales take stock from the kiosk location and cash into the kiosk drawer.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.customers add column credit_limit numeric(10, 2) not null default 0 check (credit_limit >= 0);

alter table public.stock_locations add column default_for_kiosk boolean not null default false;
create unique index stock_locations_one_kiosk on public.stock_locations (tenant_id) where default_for_kiosk;
update public.stock_locations l set default_for_kiosk = true
 where l.name = 'Kiosk' and not exists (select 1 from public.stock_locations x where x.tenant_id = l.tenant_id and x.default_for_kiosk);

-- Per-location low-stock level (e.g. kiosk: under 2 packs of Gold Flake)
alter table public.stock_levels add column min_quantity numeric(14, 3) not null default 0 check (min_quantity >= 0);

create or replace function public.seed_stock_locations(p_tenant uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.stock_locations (tenant_id, name, sort_order, receives_purchases, default_for_sales, default_for_kiosk)
    select p_tenant, v.name, v.sort_order, v.purchases, v.sales, v.kiosk from (values
        ('Main store', 1, true, false, false),
        ('Kitchen', 2, false, true, false),
        ('Kiosk', 3, false, false, true)) v(name, sort_order, purchases, sales, kiosk)
    where not exists (select 1 from public.stock_locations where tenant_id = p_tenant);
$$;

-- Manager approves khata over a customer's limit
insert into public.role_permissions (role_id, perm)
select id, 'sensitive.approve_credit' from public.roles where name = 'Manager'
on conflict do nothing;

create or replace function public.seed_tenant_extras(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into public.money_accounts (tenant_id, code, name, kind, is_drawer, sort_order) values
        (p_tenant, 'cash_counter', 'Cash – Counter', 'cash', true, 1),
        (p_tenant, 'cash_kiosk', 'Cash – Kiosk', 'cash', true, 2),
        (p_tenant, 'cash_office', 'Cash – Office / safe', 'cash', false, 3),
        (p_tenant, 'upi', 'UPI', 'upi', false, 4),
        (p_tenant, 'card', 'Card', 'card', false, 5),
        (p_tenant, 'bank', 'Bank', 'bank', false, 6),
        (p_tenant, 'khata', 'Khata (credit)', 'khata', false, 7)
    on conflict (tenant_id, code) do nothing;

    insert into public.expense_categories (tenant_id, name, sort_order)
    select p_tenant, n, i from unnest(array['Rent', 'Electricity', 'Gas', 'Water', 'Internet', 'Consumables', 'Packaging',
        'Repairs', 'Breakage', 'Marketing', 'Salaries', 'Aggregator commission', 'Bank charges', 'Licences',
        'Miscellaneous']) with ordinality as t(n, i)
    on conflict (tenant_id, name) do nothing;

    insert into public.settings (tenant_id, key, value, description) values
        (p_tenant, 'service_charge_pct', '0', 'Optional service charge % (0 = off); customers may ask to remove it'),
        (p_tenant, 'round_off', 'false', 'Round bill totals to the nearest rupee'),
        (p_tenant, 'bill_footer', '"Thank you! Visit again."', 'Text printed at the bottom of bills'),
        (p_tenant, 'shift_tolerance', '50', 'Cash difference (₹) allowed at shift close without a reason'),
        (p_tenant, 'restricted_id_reminder', 'true', 'Remind kiosk staff to check ID for restricted items'),
        (p_tenant, 'khata_reminder_days', '7', 'Remind about khata balances older than this many days')
    on conflict (tenant_id, key) do nothing;

    update public.roles set max_discount_pct = case name
            when 'Manager' then 100 when 'Cashier' then 10 when 'Kiosk operator' then 5 else max_discount_pct end
     where tenant_id = p_tenant and name in ('Manager', 'Cashier', 'Kiosk operator') and max_discount_pct = 0;

    insert into public.role_permissions (role_id, perm)
    select r.id, p from public.roles r,
           unnest(case r.name
               when 'Manager' then array['finance.view', 'finance.create', 'finance.edit', 'sensitive.approve_credit']
               when 'Accountant' then array['finance.view']
               when 'Kiosk operator' then array['orders.edit']
               else array[]::text[] end) p
     where r.tenant_id = p_tenant
    on conflict do nothing;
end;
$$;

do $$ begin perform public.seed_tenant_extras(id) from public.tenants; end $$;

-- ---------------------------------------------------------------------------
-- Kiosk sales take stock from the kiosk location
-- ---------------------------------------------------------------------------
create or replace function public.deduct_order_line(p_line public.order_items) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_loc uuid;
    v_mult numeric := p_line.quantity * coalesce(p_line.unit_factor, 1);
begin
    if p_line.menu_item_id is null then
        return;
    end if;
    select * into v_o from public.orders where id = p_line.order_id;
    if v_o.channel = 'kiosk' then
        v_loc := (select id from public.stock_locations where tenant_id = v_o.tenant_id and default_for_kiosk and is_active);
    end if;
    v_loc := coalesce(v_loc, public.sale_location(p_line.menu_item_id));
    if v_loc is null then
        return;
    end if;
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
    select v_o.tenant_id, r.item_id, v_loc, -round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3), i.cost_per_unit,
           'sale', p_line.order_id, p_line.menu_item_id, p_line.name || ' × ' || p_line.quantity, 'Sale'
      from public.recipe_lines r join public.inventory i on i.id = r.item_id
     where r.menu_item_id = p_line.menu_item_id and i.track_stock
       and round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3) <> 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Khata
-- ---------------------------------------------------------------------------
create function public.khata_balance(p_customer uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(sum(le.amount), 0)
      from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
     where le.customer_id = p_customer and a.kind = 'khata';
$$;

-- A credit sale: the customer owes more. Over the limit needs a manager's PIN.
drop function public.khata_charge(public.orders, numeric, uuid, text);
create function public.khata_charge(p_order public.orders, p_amount numeric, p_shift uuid, p_client_id text,
                                    p_approver_phone text default null, p_approver_pin text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_c public.customers;
    v_balance numeric;
    v_by text;
begin
    if p_order.customer_id is null then
        raise exception 'Pick the customer to put this on khata';
    end if;
    select * into v_c from public.customers where id = p_order.customer_id for update;
    v_balance := public.khata_balance(v_c.id);
    if v_balance + p_amount > v_c.credit_limit then
        if nullif(p_approver_phone, '') is null and not public.has_perm('sensitive.approve_credit') then
            raise exception 'Khata limit reached for % (limit %, due %). A manager must approve.',
                v_c.name, public.inr(v_c.credit_limit), public.inr(v_balance);
        end if;
        if nullif(p_approver_phone, '') is not null then
            v_by := public.verify_approver(p_order.tenant_id, p_approver_phone, p_approver_pin, 'sensitive.approve_credit');
        end if;
    end if;
    perform public.post_ledger(p_order.tenant_id, public.account_id(p_order.tenant_id, 'khata'), p_amount, 'khata_sale', 'khata',
                               p_order.id, null, null, p_shift, v_c.id,
                               'Order ' || p_order.order_number || coalesce(' · over limit, approved by ' || v_by, ''), p_client_id);
end;
$$;
revoke execute on function public.khata_charge(public.orders, numeric, uuid, text, text, text) from public, anon, authenticated;


-- Payments now carry an optional manager approval (khata over the limit)
drop function public.settle_order(uuid, jsonb, text, text);
create function public.settle_order(p_order_id uuid, p_payments jsonb, p_drawer text default 'cash_counter',
                                    p_client_id text default null, p_approver_phone text default null,
                                    p_approver_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_drawer uuid;
    v_shift uuid;
    v_p jsonb;
    v_due numeric;
    v_given numeric := 0;
    v_cash numeric := 0;
    v_change numeric := 0;
    v_change_left numeric := 0;
    v_take numeric;
    v_amount numeric;
    v_method text;
    v_methods text[] := '{}';
    v_n integer := 0;
    v_applied numeric := 0;
begin
    perform public.require_perm('orders.edit');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    if p_client_id is not null and exists (select 1 from public.ledger_entries
                                           where tenant_id = v_o.tenant_id and client_id like p_client_id || ':%') then
        return public.order_json(v_o);
    end if;
    if v_o.status = 'cancelled' then
        raise exception 'This order was cancelled';
    end if;
    v_due := v_o.total - v_o.amount_paid;
    if v_due <= 0 then
        raise exception 'This order is already paid';
    end if;
    if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) = 0 then
        raise exception 'Enter a payment';
    end if;
    for v_p in select * from jsonb_array_elements(p_payments) loop
        v_method := v_p ->> 'method';
        v_amount := round(coalesce(nullif(v_p ->> 'amount', '')::numeric, 0), 2);
        if v_method not in ('cash', 'upi', 'card', 'khata') or v_amount <= 0 then
            raise exception 'Check the payment method and amount';
        end if;
        v_given := v_given + v_amount;
        if v_method = 'cash' then
            v_cash := v_cash + v_amount;
        end if;
    end loop;
    if v_given > v_due then
        v_change := v_given - v_due;
        if v_change > v_cash then
            raise exception 'Only cash can be more than the bill (change). Due ₹%', v_due;
        end if;
    end if;

    v_change_left := v_change;
    v_drawer := public.account_id(v_o.tenant_id, coalesce(nullif(p_drawer, ''), 'cash_counter'));
    if v_drawer is null or not exists (select 1 from public.money_accounts where id = v_drawer and is_drawer) then
        raise exception 'Unknown cash drawer';
    end if;
    v_shift := public.open_shift_id(v_drawer);

    for v_p in select * from jsonb_array_elements(p_payments) loop
        v_method := v_p ->> 'method';
        v_amount := round((v_p ->> 'amount')::numeric, 2);
        if v_method = 'cash' and v_change_left > 0 then
            v_take := least(v_change_left, v_amount);
            v_amount := v_amount - v_take;
            v_change_left := v_change_left - v_take;
        end if;
        v_n := v_n + 1;
        if v_amount > 0 then
            if v_method = 'khata' then
                perform public.khata_charge(v_o, v_amount, v_shift,
                                            case when p_client_id is null then null else p_client_id || ':' || v_n end,
                                            p_approver_phone, p_approver_pin);
            else
                perform public.post_ledger(v_o.tenant_id,
                    case v_method when 'cash' then v_drawer else public.account_id(v_o.tenant_id, v_method) end,
                    v_amount, 'sale', v_method, v_o.id, null, null, v_shift, v_o.customer_id,
                    'Order ' || v_o.order_number, case when p_client_id is null then null else p_client_id || ':' || v_n end);
            end if;
            v_applied := v_applied + v_amount;
            v_methods := array_append(v_methods, v_method);
        end if;
    end loop;

    v_methods := array(select distinct m from unnest(v_methods || coalesce(
        (select array_agg(distinct method) from public.ledger_entries where order_id = v_o.id and kind in ('sale', 'khata_sale') and method <> ''),
        '{}')) m);
    update public.orders
       set amount_paid = amount_paid + v_applied,
           payment_method = case when cardinality(v_methods) > 1 then 'split' else coalesce(v_methods[1], payment_method) end,
           status = case when amount_paid + v_applied >= total then 'paid' else status end,
           paid_at = case when amount_paid + v_applied >= total then now() else paid_at end,
           payment_request = case when amount_paid + v_applied >= total then '' else payment_request end
     where id = v_o.id
    returning * into v_o;
    return public.order_json(v_o) || jsonb_build_object('change', v_change);
end;
$$;

create or replace function public.create_staff_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_client text := nullif(trim(coalesce(p ->> 'clientId', '')), '');
    v_existing public.orders;
    v_channel text := coalesce(nullif(p ->> 'channel', ''), 'dine_in');
    v_customer uuid;
    v_table public.dining_tables;
    v_calc jsonb;
    v_manual numeric := round(coalesce(nullif(p ->> 'manualDiscount', '')::numeric, 0), 2);
    v_pct numeric;
    v_by text := '';
    v_number text := nullif(trim(coalesce(p ->> 'orderNumber', '')), '');
    v_id uuid;
    v_tz text := public.cafe_timezone(v_tenant);
    v_res jsonb;
    v_o public.orders;
begin
    perform public.require_perm('orders.create');
    if not public.tenant_active(v_tenant) then
        raise exception 'This cafe''s account is locked';
    end if;
    if v_client is not null then
        select * into v_existing from public.orders where tenant_id = v_tenant and client_id = v_client;
        if v_existing.id is not null then
            return public.order_json(v_existing) || jsonb_build_object('duplicate', true);
        end if;
    end if;
    if v_channel not in ('dine_in', 'takeaway', 'kiosk') then
        raise exception 'Unknown order type';
    end if;
    if v_number is not null and v_number !~ '^[A-Z0-9]{1,8}-[0-9]{6}-[0-9]{1,6}$' then
        raise exception 'Invalid order number';
    end if;

    v_customer := public.counter_customer(v_tenant, nullif(p ->> 'customerId', '')::uuid, p ->> 'customerPhone', p ->> 'customerName');

    if nullif(p ->> 'tableId', '') is not null then
        select * into v_table from public.dining_tables where id = (p ->> 'tableId')::uuid and tenant_id = v_tenant for update;
        if v_table.id is null then
            raise exception 'Table not found';
        end if;
    end if;

    if v_manual > 0 then
        if trim(coalesce(p ->> 'discountReason', '')) = '' then
            raise exception 'Give a reason for the discount';
        end if;
    end if;
    v_calc := public.price_order(v_tenant, v_customer, p -> 'items', p ->> 'couponCode', null, v_manual);
    if v_manual > 0 then
        v_pct := round((v_calc ->> 'manualDiscount')::numeric * 100 / nullif((v_calc ->> 'subtotal')::numeric, 0), 2);
        if v_pct > public.my_discount_limit() then
            if nullif(p ->> 'approverPhone', '') is null then
                raise exception 'Discount of % percent is above your limit of % percent. A manager must approve.', v_pct, public.my_discount_limit();
            end if;
            v_by := public.verify_approver(v_tenant, p ->> 'approverPhone', p ->> 'approverPin', 'sensitive.give_discount', v_pct);
        end if;
    end if;

    if v_calc ->> 'couponId' is not null then
        update public.coupons set used_count = used_count + 1 where id = (v_calc ->> 'couponId')::uuid;
    end if;

    insert into public.orders (
        tenant_id, order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate, tax_details, restaurant_info,
        total, table_id, table_number, special_instructions, status, channel, token_number, client_id, device_code,
        created_by_staff, staff_name, manual_discount, discount_reason, discount_approved_by)
    values (
        v_tenant,
        coalesce(v_number, 'ORD-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-'
                           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
        v_customer, (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'discount')::numeric, v_calc ->> 'couponCode',
        (v_calc ->> 'tax')::numeric, coalesce((public.get_setting('gst_rate', '5', v_tenant) #>> '{}')::numeric, 5),
        v_calc -> 'taxDetails',
        jsonb_build_object(
            'name', public.get_setting('restaurant_name', '""', v_tenant) #>> '{}',
            'address', public.get_setting('restaurant_address', '""', v_tenant) #>> '{}',
            'phone', public.get_setting('restaurant_phone', '""', v_tenant) #>> '{}',
            'gstNumber', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
            'fssaiNumber', public.get_setting('fssai_number', '""', v_tenant) #>> '{}',
            'footer', public.get_setting('bill_footer', '""', v_tenant) #>> '{}'),
        (v_calc ->> 'total')::numeric, v_table.id, coalesce(v_table.table_number, ''),
        left(coalesce(p ->> 'specialInstructions', ''), 500), 'confirmed', v_channel,
        left(coalesce(p ->> 'tokenNumber', ''), 12), v_client, left(coalesce(p ->> 'deviceCode', ''), 8),
        public.my_staff_id(), public.actor_name(), (v_calc ->> 'manualDiscount')::numeric,
        trim(coalesce(p ->> 'discountReason', '')), v_by)
    returning id into v_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost,
                                    unit_name, unit_factor, note)
    select v_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0),
           l ->> 'unit_name', (l ->> 'unit_factor')::numeric, coalesce(l ->> 'note', '')
      from jsonb_array_elements(v_calc -> 'lines') l;

    if v_table.id is not null then
        update public.dining_tables set status = 'occupied', is_occupied = true, current_order_id = v_id where id = v_table.id;
    end if;
    -- Kiosk sales are handed over at once; they never go to the kitchen
    if v_channel = 'kiosk' then
        update public.order_items set kitchen_status = 'served' where order_id = v_id;
    end if;

    -- payFullBy: pay exactly what the bill comes to (used by offline devices, which can't price the bill)
    if nullif(p ->> 'payFullBy', '') is not null then
        select * into v_o from public.orders where id = v_id;
        return public.settle_order(v_id, jsonb_build_array(jsonb_build_object('method', p ->> 'payFullBy', 'amount', v_o.total)),
                                   coalesce(nullif(p ->> 'drawer', ''), 'cash_counter'), coalesce(v_client, v_id::text) || ':pay',
                                   p ->> 'approverPhone', p ->> 'approverPin');
    end if;
    if jsonb_typeof(p -> 'payments') = 'array' and jsonb_array_length(p -> 'payments') > 0 then
        return public.settle_order(v_id, p -> 'payments', coalesce(nullif(p ->> 'drawer', ''), 'cash_counter'),
                                   coalesce(v_client, v_id::text) || ':pay',
                                   p ->> 'approverPhone', p ->> 'approverPin');
    end if;
    select * into v_o from public.orders where id = v_id;
    return public.order_json(v_o);
end;
$$;


-- The customer pays off their khata (all or part) by cash, UPI or card
create function public.settle_khata(p_customer uuid, p_amount numeric, p_method text default 'cash',
                                    p_drawer text default 'cash_counter', p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_c public.customers;
    v_balance numeric;
    v_amount numeric := round(coalesce(p_amount, 0), 2);
    v_to uuid;
begin
    perform public.require_perm('orders.edit');
    if p_client_id is not null and exists (select 1 from public.ledger_entries where tenant_id = v_tenant and client_id = p_client_id) then
        return jsonb_build_object('balance', public.khata_balance(p_customer), 'duplicate', true);
    end if;
    select * into v_c from public.customers where id = p_customer and tenant_id = v_tenant for update;
    if v_c.id is null then
        raise exception 'Customer not found';
    end if;
    v_balance := public.khata_balance(v_c.id);
    if v_amount <= 0 then
        raise exception 'Enter the amount';
    end if;
    if v_amount > v_balance then
        raise exception 'Only % is due on this khata', public.inr(v_balance);
    end if;
    if p_method not in ('cash', 'upi', 'card') then
        raise exception 'Pick cash, UPI or card';
    end if;
    v_to := case p_method when 'cash' then public.account_id(v_tenant, coalesce(nullif(p_drawer, ''), 'cash_counter'))
                          else public.account_id(v_tenant, p_method) end;
    if v_to is null then
        raise exception 'Unknown cash drawer';
    end if;
    perform public.post_ledger(v_tenant, public.account_id(v_tenant, 'khata'), -v_amount, 'khata_settle', p_method,
                               null, null, null, null, v_c.id, 'Khata paid by ' || v_c.name);
    perform public.post_ledger(v_tenant, v_to, v_amount, 'khata_settle', p_method, null, null, null,
                               public.open_shift_id(v_to), v_c.id, 'Khata paid by ' || v_c.name, p_client_id);
    return jsonb_build_object('balance', v_balance - v_amount);
end;
$$;

create function public.set_credit_limit(p_customer uuid, p_limit numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.edit');
    update public.customers set credit_limit = greatest(coalesce(p_limit, 0), 0)
     where id = p_customer and tenant_id = public.current_tenant_id();
    if not found then
        raise exception 'Customer not found';
    end if;
end;
$$;

-- Everyone with a limit or a balance, with the age of the oldest unpaid credit (first in, first out)
create function public.khata_accounts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
    v_today date := public.cafe_today(public.current_tenant_id());
begin
    if not (public.has_perm('customers.view') or public.has_perm('orders.edit')) then
        raise exception 'Not authorized (customers.view)';
    end if;
    return (
        with k as (
            select le.customer_id, le.amount, le.entry_date, le.kind, le.created_at
              from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
             where le.tenant_id = v_tenant and a.kind = 'khata'),
        bal as (select customer_id, sum(amount) as balance, max(created_at) filter (where kind = 'khata_settle') as last_paid
                  from k group by customer_id),
        sales as (
            select k.customer_id, k.entry_date, k.amount,
                   sum(k.amount) over (partition by k.customer_id order by k.created_at desc) as cum
              from k where k.kind = 'khata_sale'),
        oldest as (
            select s.customer_id, min(s.entry_date) as oldest_unpaid
              from sales s join bal b on b.customer_id = s.customer_id
             where b.balance > 0 and s.cum - s.amount < b.balance
             group by s.customer_id)
        select coalesce(jsonb_agg(jsonb_build_object(
                   'customerId', c.id, 'name', c.name,
                   'phone', case when v_phone then c.phone else public.mask_phone(c.phone) end,
                   'rawPhone', case when v_phone then c.phone end,
                   'limit', c.credit_limit, 'balance', coalesce(b.balance, 0),
                   'oldestDays', case when o.oldest_unpaid is not null then v_today - o.oldest_unpaid end,
                   'lastPaid', b.last_paid)
                   order by coalesce(b.balance, 0) desc, c.name), '[]'::jsonb)
          from public.customers c
          left join bal b on b.customer_id = c.id
          left join oldest o on o.customer_id = c.id
         where c.tenant_id = v_tenant and (c.credit_limit > 0 or coalesce(b.balance, 0) <> 0));
end;
$$;

create function public.khata_history(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.has_perm('customers.view') or public.has_perm('orders.edit')) then
        raise exception 'Not authorized (customers.view)';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object('date', le.created_at, 'kind', le.kind, 'amount', le.amount, 'method', le.method,
                                                     'note', le.note, 'orderNumber', o.order_number, 'by', le.actor_name)
                                  order by le.created_at desc), '[]'::jsonb)
          from public.ledger_entries le
          join public.money_accounts a on a.id = le.account_id and a.kind = 'khata'
          left join public.orders o on o.id = le.order_id
         where le.customer_id = p_customer and le.tenant_id = public.current_tenant_id());
end;
$$;

-- ---------------------------------------------------------------------------
-- Kiosk
-- ---------------------------------------------------------------------------
-- Items for the kiosk grid: most sold at the kiosk first, with pieces left at the kiosk location
create function public.kiosk_items() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_loc uuid := (select id from public.stock_locations where tenant_id = public.current_tenant_id() and default_for_kiosk);
begin
    perform public.require_perm('orders.create');
    return (
        select coalesce(jsonb_agg(x order by (x ->> 'sold')::numeric desc, x ->> 'name'), '[]'::jsonb) from (
            select jsonb_build_object(
                'id', m.id, 'name', m.name, 'price', m.price, 'isRestricted', m.is_restricted, 'isVeg', m.is_veg,
                'categoryId', m.category_id, 'brandId', m.brand_id, 'brand', b.name, 'category', c.name,
                'taxGroupId', m.tax_group_id, 'priceIncludesTax', m.price_includes_tax,
                'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'factor', u.factor,
                                                                       'price', coalesce(u.sale_price, round(m.price * u.factor, 2))) order by u.factor)
                                     from public.item_units u where u.menu_item_id = m.id), '[]'::jsonb),
                'sold', coalesce((select sum(oi.quantity * oi.unit_factor) from public.order_items oi join public.orders o on o.id = oi.order_id
                                   where oi.menu_item_id = m.id and o.channel = 'kiosk' and o.status <> 'cancelled'
                                     and o.created_at > now() - interval '30 days'), 0),
                'left', (select floor(min(coalesce(sl.quantity, 0) / r.quantity)) from public.recipe_lines r
                           join public.inventory i on i.id = r.item_id and i.track_stock
                           left join public.stock_levels sl on sl.item_id = r.item_id and sl.location_id = v_loc
                          where r.menu_item_id = m.id),
                'low', exists (select 1 from public.recipe_lines r join public.stock_levels sl on sl.item_id = r.item_id and sl.location_id = v_loc
                                where r.menu_item_id = m.id and sl.min_quantity > 0 and sl.quantity <= sl.min_quantity)) x
              from public.menu_items m
              left join public.brands b on b.id = m.brand_id
              left join public.categories c on c.id = m.category_id
             where m.tenant_id = v_tenant and m.is_available) s);
end;
$$;

-- Regulars at the kiosk (last 30 days) as one-tap chips, with their khata due
create function public.kiosk_regulars() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.create');
    return (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', public.mask_phone(c.phone),
                                                     'balance', public.khata_balance(c.id), 'limit', c.credit_limit)
                                  order by s.n desc), '[]'::jsonb)
          from (select customer_id, count(*) n from public.orders
                 where tenant_id = public.current_tenant_id() and channel = 'kiosk' and customer_id is not null
                   and created_at > now() - interval '30 days' and status <> 'cancelled'
                 group by customer_id order by n desc limit 12) s
          join public.customers c on c.id = s.customer_id);
end;
$$;

-- Customer search at the kiosk/counter also shows khata due
create or replace function public.find_customers(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_q text := lower(trim(coalesce(p_query, '')));
    v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
begin
    if not (public.has_perm('orders.create') or public.has_perm('customers.view')) then
        raise exception 'Not authorized (orders.create)';
    end if;
    if length(v_q) < 2 then
        return '[]'::jsonb;
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', c.id, 'name', c.name,
                   'phone', case when v_phone then c.phone else public.mask_phone(c.phone) end,
                   'points', c.loyalty_points, 'balance', public.khata_balance(c.id), 'limit', c.credit_limit) order by c.name), '[]'::jsonb)
          from (select * from public.customers c
                 where c.tenant_id = public.current_tenant_id()
                   and ((length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
                        or (length(v_digits) = 0 and lower(c.name) like '%' || v_q || '%'))
                 order by c.name limit 8) c);
end;
$$;

create function public.set_location_min(p_item uuid, p_location uuid, p_min numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('inventory.edit');
    perform public.require_stock_item(p_item);
    perform public.require_location(p_location);
    insert into public.stock_levels (tenant_id, item_id, location_id, quantity, min_quantity)
    values (public.current_tenant_id(), p_item, p_location, 0, greatest(coalesce(p_min, 0), 0))
    on conflict (item_id, location_id) do update set min_quantity = excluded.min_quantity;
end;
$$;

-- Khata reminders and kiosk low stock show up in the bell once a day
create function public.daily_reminders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_days integer := coalesce((public.get_setting('khata_reminder_days', '7', public.current_tenant_id()) #>> '{}')::integer, 7);
    v_n integer := 0;
    v_count integer;
    v_sum numeric;
begin
    perform public.require_admin();
    if exists (select 1 from public.notification_events where tenant_id = v_tenant and kind = 'khata_due'
                                                         and created_at > now() - interval '20 hours') then
        return 0;
    end if;
    select count(*), coalesce(sum((x ->> 'balance')::numeric), 0) into v_count, v_sum
      from jsonb_array_elements(public.khata_accounts()) x
     where (x ->> 'balance')::numeric > 0 and coalesce((x ->> 'oldestDays')::integer, 0) > v_days;
    if v_count > 0 then
        perform public.notify(v_tenant, 'khata_due', v_count || ' khata ' || case when v_count = 1 then 'account' else 'accounts' end
                              || ' due over ' || v_days || ' days', public.inr(v_sum) || ' to collect', '/admin/khata', 'customers.view', 'normal');
        v_n := v_n + 1;
    end if;
    return v_n;
end;
$$;

revoke execute on function public.khata_balance(uuid) from public, anon;


-- Locations tab: which location the kiosk sells from
create or replace function public.set_location_default(p_location uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
begin
    perform public.require_perm('inventory.edit');
    perform public.require_location(p_location);
    if p_kind = 'purchases' then
        update public.stock_locations set receives_purchases = false where tenant_id = v_tenant and receives_purchases;
        update public.stock_locations set receives_purchases = true, is_active = true where id = p_location;
    elsif p_kind = 'sales' then
        update public.stock_locations set default_for_sales = false where tenant_id = v_tenant and default_for_sales;
        update public.stock_locations set default_for_sales = true, is_active = true where id = p_location;
    elsif p_kind = 'kiosk' then
        update public.stock_locations set default_for_kiosk = false where tenant_id = v_tenant and default_for_kiosk;
        update public.stock_locations set default_for_kiosk = true, is_active = true where id = p_location;
    else
        raise exception 'Unknown default';
    end if;
end;
$$;

-- (also in Phase 2) Bill extras: don't touch the order when there is nothing to add
create or replace function public.apply_bill_extras(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_pct numeric;
    v_rate numeric;
    v_net numeric;
    v_base numeric;
    v_sc numeric := 0;
    v_sc_tax numeric := 0;
    v_sum numeric;
    v_ro numeric := 0;
begin
    select * into v_o from public.orders where id = p_order for update;
    if v_o.id is null then
        return;
    end if;
    v_base := coalesce(v_o.base_total, v_o.total);
    v_pct := coalesce((public.get_setting('service_charge_pct', '0', v_o.tenant_id) #>> '{}')::numeric, 0);
    if v_pct > 0 and not v_o.service_charge_removed and v_o.channel in ('qr', 'dine_in') then
        select coalesce(sum(net_amount), 0) into v_net from public.order_items where order_id = p_order;
        select coalesce(sum((c ->> 'rate')::numeric), 0) into v_rate
          from jsonb_array_elements(coalesce(public.get_setting('tax_config', '[]', v_o.tenant_id), '[]'::jsonb)) c;
        v_sc := round(v_net * v_pct / 100, 2);
        v_sc_tax := round(v_sc * v_rate / 100, 2);
    end if;
    v_sum := v_base + v_sc + v_sc_tax;
    if coalesce((public.get_setting('round_off', 'false', v_o.tenant_id) #>> '{}')::boolean, false) then
        v_ro := round(v_sum) - v_sum;
    end if;
    -- Nothing to add and nothing added before: leave the order untouched (no extra live update)
    if v_sc = 0 and v_sc_tax = 0 and v_ro = 0 and v_o.service_charge = 0 and v_o.service_charge_tax = 0 and v_o.round_off = 0 then
        return;
    end if;
    update public.orders
       set base_total = v_base, service_charge = v_sc, service_charge_tax = v_sc_tax, round_off = v_ro, total = v_sum + v_ro
     where id = p_order;
end;
$$;

commit;

-- Cafe ERP · Phase 4 (reports and payroll) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261008000001_reports_payroll.sql ====
-- Phase 4: finance reports (P&L, cash flow, profit target, GST pack, item economics)
-- and payroll (pay types, leave, advances, penalties, overtime, payslips paid through the ledger).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.menu_items add column hsn_code text not null default '';

alter table public.employees
    add column pay_type text not null default 'monthly' check (pay_type in ('monthly', 'daily', 'hourly')),
    add column daily_rate numeric(10, 2) not null default 0,
    add column hourly_rate numeric(10, 2) not null default 0,
    add column ot_rate numeric(10, 2) not null default 0,
    add column shift_hours numeric(4, 2) not null default 9 check (shift_hours > 0 and shift_hours <= 16),
    add column weekly_off integer check (weekly_off between 0 and 6),
    add column staff_id uuid references public.staff_users (id) on delete set null;

alter table public.attendance
    add column check_in_at timestamptz,
    add column check_out_at timestamptz,
    add column leave_type_id uuid;

create table public.leave_types (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    is_paid boolean not null default true,
    yearly_quota numeric(5, 1) not null default 0 check (yearly_quota >= 0),
    is_active boolean not null default true,
    unique (tenant_id, name)
);
alter table public.attendance add constraint attendance_leave_type_fk foreign key (leave_type_id) references public.leave_types (id) on delete set null;

create table public.leave_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    leave_type_id uuid not null references public.leave_types (id),
    from_date date not null,
    to_date date not null check (to_date >= from_date),
    half_day boolean not null default false,
    reason text not null default '',
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    decided_by text not null default '',
    decided_at timestamptz,
    requested_by text not null default '',
    created_at timestamptz not null default now()
);

create table public.advances (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    given_on date not null default current_date,
    amount numeric(10, 2) not null check (amount > 0),
    instalment numeric(10, 2) not null check (instalment > 0),
    note text not null default '',
    actor_name text not null default '',
    created_at timestamptz not null default now()
);

create table public.penalties (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    penalty_date date not null default current_date,
    reason text not null check (trim(reason) <> ''),
    amount numeric(10, 2) not null check (amount > 0),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    requested_by text not null default '',
    decided_by text not null default '',
    created_at timestamptz not null default now()
);

create table public.payroll_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    month date not null check (extract(day from month) = 1),
    status text not null default 'draft' check (status in ('draft', 'final')),
    finalized_by text not null default '',
    finalized_at timestamptz,
    created_at timestamptz not null default now(),
    unique (tenant_id, month)
);

create table public.payslips (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    run_id uuid not null references public.payroll_runs (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    pay_type text not null,
    rate numeric(10, 2) not null default 0,
    days_in_month integer not null,
    present_days numeric(5, 1) not null default 0,
    half_days integer not null default 0,
    paid_leave_days numeric(5, 1) not null default 0,
    unpaid_leave_days numeric(5, 1) not null default 0,
    holidays integer not null default 0,
    weekly_offs integer not null default 0,
    absent_days numeric(5, 1) not null default 0,
    payable_days numeric(5, 1) not null default 0,
    hours_worked numeric(7, 2) not null default 0,
    ot_hours numeric(7, 2) not null default 0,
    base_pay numeric(10, 2) not null default 0,
    ot_pay numeric(10, 2) not null default 0,
    incentives numeric(10, 2) not null default 0,
    advance_recovery numeric(10, 2) not null default 0,
    penalties numeric(10, 2) not null default 0,
    gross numeric(10, 2) not null default 0,
    deductions numeric(10, 2) not null default 0,
    net numeric(10, 2) not null default 0,
    paid_at timestamptz,
    paid_from uuid references public.money_accounts (id),
    unique (run_id, employee_id)
);

-- Per-cafe defaults for this phase
create or replace function public.seed_phase4(p_tenant uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.leave_types (tenant_id, name, is_paid, yearly_quota) values
        (p_tenant, 'Casual', true, 8), (p_tenant, 'Sick', true, 6), (p_tenant, 'Earned', true, 12), (p_tenant, 'Unpaid', false, 0)
    on conflict (tenant_id, name) do nothing;
    insert into public.settings (tenant_id, key, value, description) values
        (p_tenant, 'profit_target_weekly', '0', 'Weekly net profit target (₹, 0 = none)'),
        (p_tenant, 'profit_target_monthly', '0', 'Monthly net profit target (₹, 0 = none)'),
        (p_tenant, 'gst_filing', '"monthly"', 'GST filing: monthly, quarterly, composition or none'),
        (p_tenant, 'sac_code', '"996331"', 'SAC code for restaurant service (GST pack)')
    on conflict (tenant_id, key) do nothing;
$$;
revoke execute on function public.seed_phase4(uuid) from public, anon, authenticated;
do $$ begin perform public.seed_phase4(id) from public.tenants; end $$;

create or replace function public.seed_tenant_extras_p4() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.seed_phase4(new.id);
    return null;
end;
$$;
create trigger tenants_seed_phase4 after insert on public.tenants for each row execute function public.seed_tenant_extras_p4();

-- Bills entered late in the evening: "today" is the cafe's date, not the server's (UTC)
create function public.purchases_cafe_date() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.bill_date = current_date and public.cafe_today(new.tenant_id) <> current_date then
        new.bill_date := public.cafe_today(new.tenant_id);
    end if;
    return new;
end;
$$;
create trigger purchases_cafe_date before insert on public.purchases for each row execute function public.purchases_cafe_date();

-- ---------------------------------------------------------------------------
-- P&L
-- ---------------------------------------------------------------------------
-- Expenses allocated to a period: a one-month expense counts on its date; an expense spread over
-- N months is shared out evenly per day from its date for N months
create function public.expense_allocation(p_tenant uuid, p_from date, p_to date) returns table (category text, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
    select c.name, round(sum(x.part), 2)
      from (select e.category_id,
                   case when e.spread_months <= 1
                        then case when e.expense_date between p_from and p_to then e.amount else 0 end
                        else e.amount * greatest(0, least(p_to + 1, (e.expense_date + make_interval(months => e.spread_months))::date)
                                                    - greatest(p_from, e.expense_date))
                             / ((e.expense_date + make_interval(months => e.spread_months))::date - e.expense_date) end as part
              from public.expenses e
             where e.tenant_id = p_tenant and not e.is_void and e.expense_date <= p_to
               and (e.expense_date + make_interval(months => greatest(e.spread_months, 1)))::date > p_from) x
      join public.expense_categories c on c.id = x.category_id
     group by c.name
    having round(sum(x.part), 2) <> 0;
$$;
revoke execute on function public.expense_allocation(uuid, date, date) from public, anon, authenticated;

-- Staff cost of a period: finalized payslips spread over their month; months without a payroll
-- run use each active employee's monthly salary (marked as an estimate)
create function public.staff_cost(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_month date;
    v_end date;
    v_days integer;
    v_overlap integer;
    v_total numeric := 0;
    v_est boolean := false;
    v_run uuid;
begin
    v_month := date_trunc('month', p_from)::date;
    while v_month <= p_to loop
        v_end := (v_month + interval '1 month')::date - 1;
        v_days := v_end - v_month + 1;
        v_overlap := least(v_end, p_to) - greatest(v_month, p_from) + 1;
        select id into v_run from public.payroll_runs where tenant_id = p_tenant and month = v_month and status = 'final';
        if v_run is not null then
            v_total := v_total + (select coalesce(sum(gross), 0) from public.payslips where run_id = v_run) * v_overlap / v_days;
        else
            v_total := v_total + (select coalesce(sum(case pay_type when 'monthly' then salary when 'daily' then daily_rate * 26
                                                          else hourly_rate * shift_hours * 26 end), 0)
                                    from public.employees where tenant_id = p_tenant and is_active) * v_overlap / v_days;
            v_est := v_est or exists (select 1 from public.employees where tenant_id = p_tenant and is_active);
        end if;
        v_month := (v_month + interval '1 month')::date;
    end loop;
    return jsonb_build_object('amount', round(v_total, 2), 'estimate', v_est);
end;
$$;
revoke execute on function public.staff_cost(uuid, date, date) from public, anon, authenticated;

create function public.pnl_core(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone(p_tenant);
    v_sales jsonb;
    v_net numeric;
    v_cogs numeric;
    v_unknown integer;
    v_loss numeric;
    v_exp jsonb;
    v_exp_total numeric;
    v_staff jsonb;
    v_gross numeric;
begin
    select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'gross', g, 'tax', t, 'net', net) order by g desc), '[]'::jsonb),
           coalesce(sum(net), 0)
      into v_sales, v_net
      from (select o.channel, count(*) n, sum(o.total) g, sum(o.tax + o.service_charge_tax) t,
                   sum(o.total - o.tax - o.service_charge_tax - o.round_off) net
              from public.orders o
             where o.tenant_id = p_tenant and o.status <> 'cancelled'
               and (o.created_at at time zone v_tz)::date between p_from and p_to
             group by o.channel) s;
    select coalesce(sum(oi.unit_cost * oi.quantity), 0), count(*) filter (where oi.unit_cost = 0)
      into v_cogs, v_unknown
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.tenant_id = p_tenant and o.status <> 'cancelled' and (o.created_at at time zone v_tz)::date between p_from and p_to;
    select coalesce(-sum(m.quantity * m.unit_cost), 0) into v_loss
      from public.stock_moves m
     where m.tenant_id = p_tenant and m.kind in ('wastage', 'count', 'staff_meal', 'complimentary')
       and (m.created_at at time zone v_tz)::date between p_from and p_to;
    select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb),
           coalesce(sum(amount), 0)
      into v_exp, v_exp_total
      from public.expense_allocation(p_tenant, p_from, p_to) where category <> 'Salaries';
    v_staff := public.staff_cost(p_tenant, p_from, p_to);
    v_gross := v_net - v_cogs;
    return jsonb_build_object(
        'from', p_from, 'to', p_to, 'channels', v_sales,
        'grossSales', (select coalesce(sum((x ->> 'gross')::numeric), 0) from jsonb_array_elements(v_sales) x),
        'taxes', (select coalesce(sum((x ->> 'tax')::numeric), 0) from jsonb_array_elements(v_sales) x),
        'netSales', round(v_net, 2), 'cogs', round(v_cogs, 2), 'linesWithoutCost', v_unknown,
        'grossProfit', round(v_gross, 2), 'grossMarginPct', case when v_net > 0 then round(v_gross / v_net * 100, 1) end,
        'stockLosses', round(v_loss, 2), 'expenses', v_exp, 'expensesTotal', round(v_exp_total, 2),
        'staffCost', (v_staff ->> 'amount')::numeric, 'staffCostEstimated', (v_staff ->> 'estimate')::boolean,
        'netProfit', round(v_gross - v_loss - v_exp_total - (v_staff ->> 'amount')::numeric, 2));
end;
$$;
revoke execute on function public.pnl_core(uuid, date, date) from public, anon, authenticated;

-- P&L for a period, with the previous period of the same length to compare
create function public.pnl(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_len integer := p_to - p_from + 1;
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    if p_to < p_from or v_len > 400 then
        raise exception 'Pick a period of up to 400 days';
    end if;
    return jsonb_build_object('current', public.pnl_core(v_tenant, p_from, p_to),
                              'previous', public.pnl_core(v_tenant, p_from - v_len, p_from - 1));
end;
$$;

-- Cash flow by account: opening + in − out = closing
create function public.cash_flow(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'code', a.code, 'name', a.name,
                   'opening', coalesce((select sum(amount) from public.ledger_entries where account_id = a.id and entry_date < p_from), 0),
                   'in', coalesce((select sum(amount) from public.ledger_entries where account_id = a.id and amount > 0 and entry_date between p_from and p_to), 0),
                   'out', coalesce((select -sum(amount) from public.ledger_entries where account_id = a.id and amount < 0 and entry_date between p_from and p_to), 0),
                   'closing', coalesce((select sum(amount) from public.ledger_entries where account_id = a.id and entry_date <= p_to), 0))
                   order by a.sort_order), '[]'::jsonb)
          from public.money_accounts a where a.tenant_id = public.current_tenant_id() and a.is_active);
end;
$$;

-- Weekly and monthly profit target: progress so far and a straight-line forecast to the period end
create function public.profit_targets() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
    v_wk date := v_today - ((extract(isodow from v_today)::integer) - 1);
    v_mo date := date_trunc('month', v_today)::date;
    v_mo_end date := (date_trunc('month', v_today) + interval '1 month')::date - 1;
    v_w jsonb;
    v_m jsonb;
    v_tw numeric := coalesce((public.get_setting('profit_target_weekly', '0', public.current_tenant_id()) #>> '{}')::numeric, 0);
    v_tm numeric := coalesce((public.get_setting('profit_target_monthly', '0', public.current_tenant_id()) #>> '{}')::numeric, 0);
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    v_w := public.pnl_core(v_tenant, v_wk, v_today);
    v_m := public.pnl_core(v_tenant, v_mo, v_today);
    return jsonb_build_object(
        'week', jsonb_build_object('from', v_wk, 'to', v_wk + 6, 'target', v_tw, 'profit', v_w -> 'netProfit',
                                   'daysGone', v_today - v_wk + 1, 'days', 7,
                                   'forecast', round((v_w ->> 'netProfit')::numeric * 7 / (v_today - v_wk + 1), 2)),
        'month', jsonb_build_object('from', v_mo, 'to', v_mo_end, 'target', v_tm, 'profit', v_m -> 'netProfit',
                                    'daysGone', v_today - v_mo + 1, 'days', v_mo_end - v_mo + 1,
                                    'forecast', round((v_m ->> 'netProfit')::numeric * (v_mo_end - v_mo + 1) / (v_today - v_mo + 1), 2)));
end;
$$;

-- Every item sold: units, net revenue, cost, contribution, share of total contribution, trend
create function public.item_economics(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_len integer := p_to - p_from + 1;
begin
    perform public.require_perm('reports.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    return (
        with cur as (
            select oi.menu_item_id, max(oi.name) as name, sum(oi.quantity) as units, sum(oi.net_amount) as revenue,
                   sum(oi.unit_cost * oi.quantity) as cost, count(*) filter (where oi.unit_cost = 0) as unknown
              from public.order_items oi join public.orders o on o.id = oi.order_id
             where o.tenant_id = v_tenant and o.status <> 'cancelled' and (o.created_at at time zone v_tz)::date between p_from and p_to
             group by oi.menu_item_id),
        prev as (
            select oi.menu_item_id, sum(oi.quantity) as units
              from public.order_items oi join public.orders o on o.id = oi.order_id
             where o.tenant_id = v_tenant and o.status <> 'cancelled'
               and (o.created_at at time zone v_tz)::date between p_from - v_len and p_from - 1
             group by oi.menu_item_id),
        tot as (select nullif(sum(revenue - cost), 0) as contribution from cur)
        select coalesce(jsonb_agg(jsonb_build_object(
                   'menuItemId', c.menu_item_id, 'name', coalesce(m.name, c.name), 'units', c.units,
                   'revenue', round(c.revenue, 2), 'cost', round(c.cost, 2), 'costKnown', c.unknown = 0,
                   'contribution', round(c.revenue - c.cost, 2),
                   'contributionPct', case when c.revenue > 0 then round((c.revenue - c.cost) / c.revenue * 100, 1) end,
                   'perUnit', round((c.revenue - c.cost) / nullif(c.units, 0), 2),
                   'sharePct', round((c.revenue - c.cost) / (select contribution from tot) * 100, 1),
                   'prevUnits', coalesce(p.units, 0),
                   'trendPct', case when coalesce(p.units, 0) > 0 then round((c.units - p.units) * 100.0 / p.units, 1) end)
                   order by c.revenue - c.cost desc), '[]'::jsonb)
          from cur c left join prev p on p.menu_item_id is not distinct from c.menu_item_id
          left join public.menu_items m on m.id = c.menu_item_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- GST pack for the CA
-- ---------------------------------------------------------------------------
create function public.gst_pack(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_sac text := coalesce(public.get_setting('sac_code', '"996331"', public.current_tenant_id()) #>> '{}', '996331');
    v_default numeric;
begin
    perform public.require_perm('finance.view');
    select coalesce(sum((c ->> 'rate')::numeric), 0) into v_default
      from jsonb_array_elements(coalesce(public.get_setting('tax_config', '[]', v_tenant), '[]'::jsonb)) c;
    return jsonb_build_object(
        'from', p_from, 'to', p_to,
        'gstin', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
        'filing', public.get_setting('gst_filing', '"monthly"', v_tenant) #>> '{}',
        -- Sales by GST rate (CGST = SGST = half for intra-state sales); service charge taxed at the default rate
        'byRate', (select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'taxable', round(taxable, 2), 'tax', round(tax, 2),
                                                               'cgst', round(tax / 2, 2), 'sgst', round(tax / 2, 2), 'lines', n)
                                            order by rate), '[]'::jsonb)
                     from (select rate, sum(taxable) taxable, sum(tax) tax, sum(n) n from (
                              select oi.tax_rate as rate, oi.net_amount as taxable, oi.tax_amount as tax, 1 as n
                                from public.order_items oi join public.orders o on o.id = oi.order_id
                               where o.tenant_id = v_tenant and o.status <> 'cancelled'
                                 and (o.created_at at time zone v_tz)::date between p_from and p_to
                              union all
                              select v_default, o.service_charge, o.service_charge_tax, 0
                                from public.orders o
                               where o.tenant_id = v_tenant and o.status <> 'cancelled' and o.service_charge > 0
                                 and (o.created_at at time zone v_tz)::date between p_from and p_to) x
                            group by rate) s),
        'hsn', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'rate', rate, 'qty', qty, 'taxable', round(taxable, 2), 'tax', round(tax, 2))
                                         order by code, rate), '[]'::jsonb)
                  from (select coalesce(nullif(m.hsn_code, ''), v_sac) as code, oi.tax_rate as rate, sum(oi.quantity) qty,
                               sum(oi.net_amount) taxable, sum(oi.tax_amount) tax
                          from public.order_items oi join public.orders o on o.id = oi.order_id
                          left join public.menu_items m on m.id = oi.menu_item_id
                         where o.tenant_id = v_tenant and o.status <> 'cancelled'
                           and (o.created_at at time zone v_tz)::date between p_from and p_to
                         group by 1, 2) s),
        'purchases', (select coalesce(jsonb_agg(jsonb_build_object('date', p.bill_date, 'vendor', p.vendor_name, 'gstin', v.gstin,
                                                                   'billNumber', p.bill_number, 'taxable', p.subtotal, 'tax', p.tax, 'total', p.total)
                                                order by p.bill_date), '[]'::jsonb)
                        from public.purchases p left join public.vendors v on v.id = p.vendor_id
                       where p.tenant_id = v_tenant and not p.is_void and p.bill_date between p_from and p_to),
        'orders', (select jsonb_build_object('count', count(*), 'first', min(order_number), 'last', max(order_number),
                                             'cancelled', count(*) filter (where status = 'cancelled'))
                     from public.orders where tenant_id = v_tenant and (created_at at time zone v_tz)::date between p_from and p_to));
end;
$$;

-- Upcoming GST due dates for the cafe's filing type (the CA files on the GST portal)
create function public.gst_due_dates() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_today date := public.cafe_today(public.current_tenant_id());
    v_filing text := coalesce(public.get_setting('gst_filing', '"monthly"', public.current_tenant_id()) #>> '{}', 'monthly');
    v_m date := date_trunc('month', v_today)::date;
    v_out jsonb := '[]'::jsonb;
    v_q date;
    i integer;
begin
    perform public.require_admin();
    for i in 0..3 loop
        v_q := (v_m + make_interval(months => i))::date;
        if v_filing = 'monthly' then
            v_out := v_out || jsonb_build_array(
                jsonb_build_object('form', 'GSTR-1', 'for', to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 10),
                jsonb_build_object('form', 'GSTR-3B', 'for', to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 19));
        elsif v_filing = 'quarterly' then
            if extract(month from v_q)::integer in (1, 4, 7, 10) then
                v_out := v_out || jsonb_build_array(
                    jsonb_build_object('form', 'GSTR-1 (QRMP)', 'for', 'quarter to ' || to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 12),
                    jsonb_build_object('form', 'GSTR-3B (QRMP)', 'for', 'quarter to ' || to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 21));
            else
                v_out := v_out || jsonb_build_array(
                    jsonb_build_object('form', 'PMT-06 tax payment', 'for', to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 24));
            end if;
        elsif v_filing = 'composition' then
            if extract(month from v_q)::integer in (1, 4, 7, 10) then
                v_out := v_out || jsonb_build_array(
                    jsonb_build_object('form', 'CMP-08', 'for', 'quarter to ' || to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 17));
            end if;
            if extract(month from v_q)::integer = 4 then
                v_out := v_out || jsonb_build_array(jsonb_build_object('form', 'GSTR-4 (annual)', 'for', 'FY ending March', 'due', v_q + 29));
            end if;
        end if;
    end loop;
    return (select coalesce(jsonb_agg(x || jsonb_build_object('daysLeft', (x ->> 'due')::date - v_today) order by (x ->> 'due')::date), '[]'::jsonb)
              from jsonb_array_elements(v_out) x
             where (x ->> 'due')::date >= v_today and (x ->> 'due')::date <= v_today + 45);
end;
$$;

-- Bell reminders: khata (Phase 3) + GST forms due within 3 days, once a day
create or replace function public.daily_reminders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_days integer := coalesce((public.get_setting('khata_reminder_days', '7', public.current_tenant_id()) #>> '{}')::integer, 7);
    v_n integer := 0;
    v_count integer;
    v_sum numeric;
    v_g jsonb;
begin
    perform public.require_admin();
    if exists (select 1 from public.notification_events where tenant_id = v_tenant and kind = 'daily_check'
                                                         and created_at > now() - interval '20 hours') then
        return 0;
    end if;
    insert into public.notification_events (tenant_id, kind, title, perm, priority, acknowledged_at, acknowledged_by)
    values (v_tenant, 'daily_check', 'Daily reminders checked', 'settings.edit', 'digest', now(), 'System');
    select count(*), coalesce(sum((x ->> 'balance')::numeric), 0) into v_count, v_sum
      from jsonb_array_elements(public.khata_accounts()) x
     where (x ->> 'balance')::numeric > 0 and coalesce((x ->> 'oldestDays')::integer, 0) > v_days;
    if v_count > 0 then
        perform public.notify(v_tenant, 'khata_due', v_count || ' khata ' || case when v_count = 1 then 'account' else 'accounts' end
                              || ' due over ' || v_days || ' days', public.inr(v_sum) || ' to collect', '/admin/khata', 'customers.view', 'normal');
        v_n := v_n + 1;
    end if;
    if public.has_perm('finance.view') then
        for v_g in select * from jsonb_array_elements(public.gst_due_dates()) x where (x ->> 'daysLeft')::integer <= 3 loop
            perform public.notify(v_tenant, 'gst_due', v_g ->> 'form' || ' for ' || (v_g ->> 'for') || ' due in ' || (v_g ->> 'daysLeft') || ' days',
                                  'Due ' || to_char((v_g ->> 'due')::date, 'DD Mon') || '. Send the GST pack to your CA.', '/admin/reports?tab=gst',
                                  'finance.view', case when (v_g ->> 'daysLeft')::integer = 0 then 'loud' else 'normal' end);
            v_n := v_n + 1;
        end loop;
    end if;
    return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
-- Hours worked on a day: from check-in/out times (timestamps from the app, or HH:MM typed by hand)
create function public.attendance_hours(a public.attendance) returns numeric
language sql immutable as $$
    select case
        when a.check_in_at is not null and a.check_out_at is not null
            then round(extract(epoch from a.check_out_at - a.check_in_at) / 3600, 2)
        when a.check_in ~ '^\d{1,2}:\d{2}' and a.check_out ~ '^\d{1,2}:\d{2}'
            then round(extract(epoch from (substr(a.check_out, 1, 5)::time - substr(a.check_in, 1, 5)::time)) / 3600, 2)
        else 0 end;
$$;

-- Advance still to recover = amount − recoveries on finalized payslips
create function public.advance_remaining(p_employee uuid, p_exclude_run uuid default null) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select greatest(coalesce((select sum(amount) from public.advances where employee_id = p_employee), 0)
                    - coalesce((select sum(ps.advance_recovery) from public.payslips ps join public.payroll_runs r on r.id = ps.run_id
                                 where ps.employee_id = p_employee and r.status = 'final' and r.id is distinct from p_exclude_run), 0), 0);
$$;

-- Build (or rebuild) the month's draft payslips from attendance, leave, advances and penalties.
--   monthly: salary × payable days ÷ days in month
--     payable days = present + ½ × half-days + paid leave + holidays + weekly offs (not marked absent)
--   daily:   daily rate × (present + ½ × half-days + paid leave + holidays)
--   hourly:  hourly rate × hours worked
--   overtime = hours beyond the shift each day × OT rate
--   net = base + overtime + incentives − advance instalment − approved penalties
create function public.run_payroll(p_month date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_month date := date_trunc('month', p_month)::date;
    v_end date := (date_trunc('month', p_month) + interval '1 month')::date - 1;
    v_days integer;
    v_run public.payroll_runs;
    v_e public.employees;
    v_present numeric; v_half integer; v_paid_leave numeric; v_unpaid_leave numeric; v_hol integer; v_off integer; v_absent numeric;
    v_hours numeric; v_ot numeric; v_payable numeric; v_base numeric; v_rate numeric; v_adv numeric; v_pen numeric; v_gross numeric;
begin
    perform public.require_perm('employees.edit');
    perform public.require_perm('sensitive.see_salary');
    v_days := v_end - v_month + 1;
    insert into public.payroll_runs (tenant_id, month) values (v_tenant, v_month)
    on conflict (tenant_id, month) do nothing;
    select * into v_run from public.payroll_runs where tenant_id = v_tenant and month = v_month for update;
    if v_run.status = 'final' then
        raise exception 'Payroll for % is final', to_char(v_month, 'Mon YYYY');
    end if;
    delete from public.payslips where run_id = v_run.id;
    for v_e in select * from public.employees
                where tenant_id = v_tenant and (is_active or exists (select 1 from public.attendance a where a.employee_id = employees.id
                                                                     and a.date between v_month and v_end))
                  and joining_date <= v_end loop
        select coalesce(count(*) filter (where status = 'present'), 0),
               coalesce(count(*) filter (where status = 'half-day'), 0),
               coalesce(count(*) filter (where status = 'leave' and coalesce((select is_paid from public.leave_types lt where lt.id = a.leave_type_id), true)), 0),
               coalesce(count(*) filter (where status = 'leave' and not coalesce((select is_paid from public.leave_types lt where lt.id = a.leave_type_id), true)), 0),
               coalesce(count(*) filter (where status = 'holiday'), 0),
               coalesce(count(*) filter (where status = 'absent'), 0),
               coalesce(sum(public.attendance_hours(a)), 0),
               coalesce(sum(greatest(public.attendance_hours(a) - v_e.shift_hours, 0)) filter (where status = 'present'), 0)
          into v_present, v_half, v_paid_leave, v_unpaid_leave, v_hol, v_absent, v_hours, v_ot
          from public.attendance a where a.employee_id = v_e.id and a.date between v_month and v_end;
        -- Weekly offs in the month (from joining) that aren't marked otherwise
        v_off := case when v_e.weekly_off is null then 0 else (
                    select count(*) from generate_series(greatest(v_month, v_e.joining_date), v_end, interval '1 day') d
                     where extract(dow from d)::integer = v_e.weekly_off
                       and not exists (select 1 from public.attendance a where a.employee_id = v_e.id and a.date = d::date)) end;
        v_payable := v_present + 0.5 * v_half + v_paid_leave + v_hol + v_off;
        v_rate := case v_e.pay_type when 'monthly' then v_e.salary when 'daily' then v_e.daily_rate else v_e.hourly_rate end;
        v_base := round(case v_e.pay_type
                    when 'monthly' then v_e.salary * least(v_payable, v_days) / v_days
                    when 'daily' then v_e.daily_rate * (v_present + 0.5 * v_half + v_paid_leave + v_hol)
                    else v_e.hourly_rate * v_hours end, 2);
        v_adv := least(public.advance_remaining(v_e.id, v_run.id),
                       coalesce((select max(instalment) from public.advances where employee_id = v_e.id), 0));
        select coalesce(sum(amount), 0) into v_pen from public.penalties
         where employee_id = v_e.id and status = 'approved' and penalty_date between v_month and v_end;
        v_gross := v_base + round(v_ot * v_e.ot_rate, 2);
        v_adv := least(v_adv, v_gross);
        insert into public.payslips (tenant_id, run_id, employee_id, pay_type, rate, days_in_month, present_days, half_days,
                                     paid_leave_days, unpaid_leave_days, holidays, weekly_offs, absent_days, payable_days,
                                     hours_worked, ot_hours, base_pay, ot_pay, advance_recovery, penalties, gross, deductions, net)
        values (v_tenant, v_run.id, v_e.id, v_e.pay_type, v_rate, v_days, v_present, v_half, v_paid_leave, v_unpaid_leave, v_hol,
                v_off, v_absent, v_payable, v_hours, v_ot, v_base, round(v_ot * v_e.ot_rate, 2), v_adv, v_pen, v_gross,
                v_adv + v_pen, greatest(v_gross - v_adv - v_pen, 0));
    end loop;
    return v_run.id;
end;
$$;

create function public.get_payroll(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_run public.payroll_runs;
begin
    perform public.require_perm('employees.view');
    perform public.require_perm('sensitive.see_salary');
    select * into v_run from public.payroll_runs where tenant_id = public.current_tenant_id() and month = date_trunc('month', p_month)::date;
    if v_run.id is null then
        return jsonb_build_object('month', date_trunc('month', p_month)::date, 'status', 'none', 'slips', '[]'::jsonb);
    end if;
    return jsonb_build_object(
        'id', v_run.id, 'month', v_run.month, 'status', v_run.status, 'finalizedBy', v_run.finalized_by, 'finalizedAt', v_run.finalized_at,
        'slips', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', ps.id, 'employeeId', e.id, 'name', e.name, 'role', e.role, 'payType', ps.pay_type, 'rate', ps.rate,
                         'daysInMonth', ps.days_in_month, 'present', ps.present_days, 'halfDays', ps.half_days,
                         'paidLeave', ps.paid_leave_days, 'unpaidLeave', ps.unpaid_leave_days, 'holidays', ps.holidays,
                         'weeklyOffs', ps.weekly_offs, 'absent', ps.absent_days, 'payableDays', ps.payable_days,
                         'hours', ps.hours_worked, 'otHours', ps.ot_hours, 'basePay', ps.base_pay, 'otPay', ps.ot_pay,
                         'incentives', ps.incentives, 'advanceRecovery', ps.advance_recovery, 'penalties', ps.penalties,
                         'gross', ps.gross, 'deductions', ps.deductions, 'net', ps.net, 'paidAt', ps.paid_at,
                         'paidFrom', (select name from public.money_accounts where id = ps.paid_from),
                         'advanceLeft', public.advance_remaining(e.id))
                         order by e.name), '[]'::jsonb)
                    from public.payslips ps join public.employees e on e.id = ps.employee_id where ps.run_id = v_run.id),
        'totals', (select jsonb_build_object('gross', coalesce(sum(gross), 0), 'net', coalesce(sum(net), 0),
                                             'paid', coalesce(sum(net) filter (where paid_at is not null), 0))
                     from public.payslips where run_id = v_run.id));
end;
$$;

create function public.finalize_payroll(p_month date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.edit');
    perform public.require_perm('sensitive.see_salary');
    update public.payroll_runs set status = 'final', finalized_by = public.actor_name(), finalized_at = now()
     where tenant_id = public.current_tenant_id() and month = date_trunc('month', p_month)::date and status = 'draft';
    if not found then
        raise exception 'Run the payroll first';
    end if;
end;
$$;

-- Pay one payslip (or all unpaid ones) from an account: money ledger "salary" entries
create function public.pay_payslips(p_month date, p_account_code text, p_payslip uuid default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_acc uuid := public.account_id(public.current_tenant_id(), p_account_code);
    v_ps record;
    v_n integer := 0;
begin
    perform public.require_perm('finance.create');
    perform public.require_perm('sensitive.see_salary');
    if v_acc is null then
        raise exception 'Pick where the salary is paid from';
    end if;
    for v_ps in select ps.*, e.name from public.payslips ps join public.payroll_runs r on r.id = ps.run_id
                  join public.employees e on e.id = ps.employee_id
                 where r.tenant_id = v_tenant and r.month = date_trunc('month', p_month)::date and r.status = 'final'
                   and ps.paid_at is null and ps.net > 0 and (p_payslip is null or ps.id = p_payslip) loop
        perform public.post_ledger(v_tenant, v_acc, -v_ps.net, 'salary', '', null, null, null, public.open_shift_id(v_acc), null,
                                   'Salary ' || to_char(p_month, 'Mon YYYY') || ': ' || v_ps.name);
        update public.payslips set paid_at = now(), paid_from = v_acc where id = v_ps.id;
        v_n := v_n + 1;
    end loop;
    if v_n = 0 then
        raise exception 'Nothing to pay (finalize the payroll first)';
    end if;
    return v_n;
end;
$$;

create function public.give_advance(p_employee uuid, p_amount numeric, p_instalment numeric, p_account_code text, p_note text default '') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_id uuid;
    v_acc uuid := public.account_id(public.current_tenant_id(), p_account_code);
    v_name text;
begin
    perform public.require_perm('employees.edit');
    select name into v_name from public.employees where id = p_employee and tenant_id = v_tenant;
    if v_name is null then
        raise exception 'Employee not found';
    end if;
    if v_acc is null then
        raise exception 'Pick where the cash came from';
    end if;
    insert into public.advances (tenant_id, employee_id, given_on, amount, instalment, note, actor_name)
    values (v_tenant, p_employee, public.cafe_today(v_tenant), p_amount, coalesce(nullif(p_instalment, 0), p_amount), coalesce(p_note, ''), public.actor_name())
    returning id into v_id;
    perform public.post_ledger(v_tenant, v_acc, -p_amount, 'advance', '', null, null, null, public.open_shift_id(v_acc), null,
                               'Advance to ' || v_name || coalesce(' · ' || nullif(p_note, ''), ''));
    return v_id;
end;
$$;

create function public.add_penalty(p_employee uuid, p_date date, p_reason text, p_amount numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    perform public.require_perm('employees.edit');
    if not exists (select 1 from public.employees where id = p_employee and tenant_id = public.current_tenant_id()) then
        raise exception 'Employee not found';
    end if;
    insert into public.penalties (tenant_id, employee_id, penalty_date, reason, amount, requested_by)
    values (public.current_tenant_id(), p_employee, coalesce(p_date, public.cafe_today(public.current_tenant_id())), p_reason, p_amount, public.actor_name())
    returning id into v_id;
    perform public.notify(public.current_tenant_id(), 'approval', 'Penalty to approve: ' || public.inr(p_amount) || ' · ' || p_reason,
                          'Requested by ' || public.actor_name(), '/admin/payroll?tab=penalties', 'sensitive.see_salary', 'loud');
    return v_id;
end;
$$;

-- Penalties need a second person (owner/manager with salary access) to approve
create function public.decide_penalty(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p public.penalties;
begin
    perform public.require_perm('employees.edit');
    perform public.require_perm('sensitive.see_salary');
    select * into v_p from public.penalties where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_p.id is null or v_p.status <> 'pending' then
        raise exception 'This penalty is already decided';
    end if;
    if v_p.requested_by = public.actor_name() and not public.has_perm('sensitive.void_bill') then
        raise exception 'Someone else must approve a penalty you added';
    end if;
    update public.penalties set status = case when p_approve then 'approved' else 'rejected' end, decided_by = public.actor_name()
     where id = p_id;
end;
$$;

-- Leave: request → manager approves → attendance rows marked leave (balances = yearly quota − approved days)
create function public.request_leave(p_employee uuid, p_type uuid, p_from date, p_to date, p_half boolean default false, p_reason text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
    v_tenant uuid := public.current_tenant_id();
begin
    if not (public.has_perm('employees.edit') or exists (select 1 from public.employees e where e.id = p_employee and e.staff_id = public.my_staff_id())) then
        raise exception 'Not authorized (employees.edit)';
    end if;
    if not exists (select 1 from public.employees where id = p_employee and tenant_id = v_tenant)
       or not exists (select 1 from public.leave_types where id = p_type and tenant_id = v_tenant) then
        raise exception 'Employee or leave type not found';
    end if;
    insert into public.leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, half_day, reason, requested_by)
    values (v_tenant, p_employee, p_type, p_from, p_to, coalesce(p_half, false) and p_from = p_to, coalesce(p_reason, ''), public.actor_name())
    returning id into v_id;
    perform public.notify(v_tenant, 'approval', 'Leave request: ' || (select name from public.employees where id = p_employee)
                          || ' ' || to_char(p_from, 'DD Mon') || case when p_to > p_from then ' – ' || to_char(p_to, 'DD Mon') else '' end,
                          coalesce(nullif(p_reason, ''), ''), '/admin/payroll?tab=leave', 'employees.edit', 'loud');
    return v_id;
end;
$$;

create function public.decide_leave(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_l public.leave_requests;
    d date;
begin
    perform public.require_perm('employees.edit');
    select * into v_l from public.leave_requests where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_l.id is null or v_l.status <> 'pending' then
        raise exception 'This request is already decided';
    end if;
    update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
                                     decided_by = public.actor_name(), decided_at = now()
     where id = p_id;
    if p_approve then
        for d in select generate_series(v_l.from_date, v_l.to_date, interval '1 day')::date loop
            insert into public.attendance (tenant_id, employee_id, date, status, leave_type_id, notes)
            values (v_l.tenant_id, v_l.employee_id, d, case when v_l.half_day then 'half-day' else 'leave' end, v_l.leave_type_id, 'Leave approved')
            on conflict (employee_id, date) do update set status = excluded.status, leave_type_id = excluded.leave_type_id, notes = excluded.notes;
        end loop;
    end if;
end;
$$;

create function public.leave_overview(p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_year integer := coalesce(p_year, extract(year from public.cafe_today(public.current_tenant_id()))::integer);
begin
    perform public.require_perm('employees.view');
    return jsonb_build_object(
        'types', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'isPaid', is_paid, 'quota', yearly_quota) order by name), '[]'::jsonb)
                    from public.leave_types where tenant_id = v_tenant and is_active),
        'balances', (select coalesce(jsonb_agg(jsonb_build_object('employeeId', e.id, 'name', e.name,
                            'leave', (select coalesce(jsonb_agg(jsonb_build_object('typeId', lt.id, 'type', lt.name, 'quota', lt.yearly_quota,
                                                     'used', (select count(*) from public.attendance a where a.employee_id = e.id and a.leave_type_id = lt.id
                                                                and a.status = 'leave' and extract(year from a.date) = v_year)
                                                           + 0.5 * (select count(*) from public.attendance a where a.employee_id = e.id and a.leave_type_id = lt.id
                                                                and a.status = 'half-day' and extract(year from a.date) = v_year))
                                                     order by lt.name), '[]'::jsonb)
                                        from public.leave_types lt where lt.tenant_id = v_tenant and lt.is_active)) order by e.name), '[]'::jsonb)
                       from public.employees e where e.tenant_id = v_tenant and e.is_active),
        'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'employee', e.name, 'type', lt.name, 'from', r.from_date, 'to', r.to_date,
                                                                  'halfDay', r.half_day, 'reason', r.reason, 'status', r.status,
                                                                  'decidedBy', r.decided_by, 'createdAt', r.created_at) order by r.created_at desc), '[]'::jsonb)
                       from public.leave_requests r join public.employees e on e.id = r.employee_id
                       join public.leave_types lt on lt.id = r.leave_type_id
                      where r.tenant_id = v_tenant and (r.status = 'pending' or r.created_at > now() - interval '90 days')));
end;
$$;

create function public.list_penalties_advances() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.view');
    perform public.require_perm('sensitive.see_salary');
    return jsonb_build_object(
        'penalties', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employee', e.name, 'date', p.penalty_date, 'reason', p.reason,
                                                                   'amount', p.amount, 'status', p.status, 'requestedBy', p.requested_by,
                                                                   'decidedBy', p.decided_by) order by p.created_at desc), '[]'::jsonb)
                        from public.penalties p join public.employees e on e.id = p.employee_id
                       where p.tenant_id = public.current_tenant_id()),
        'advances', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'employeeId', e.id, 'employee', e.name, 'date', a.given_on,
                                                                  'amount', a.amount, 'instalment', a.instalment, 'note', a.note,
                                                                  'remaining', public.advance_remaining(e.id)) order by a.created_at desc), '[]'::jsonb)
                       from public.advances a join public.employees e on e.id = a.employee_id
                      where a.tenant_id = public.current_tenant_id()));
end;
$$;

revoke execute on function public.advance_remaining(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.advances enable row level security;
alter table public.penalties enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

create policy "staff view" on public.leave_types for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));
create policy "staff create" on public.leave_types for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.edit')));
create policy "staff edit" on public.leave_types for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff view" on public.leave_requests for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));
do $$
declare
    t text;
begin
    foreach t in array array['advances', 'penalties', 'payroll_runs', 'payslips'] loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view'))
                   and (select public.has_perm('sensitive.see_salary')))$p$, t);
    end loop;
end $$;

-- Pay rates are as private as salaries
create or replace function public.list_employees() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_salary boolean := public.has_perm('sensitive.see_salary');
begin
    perform public.require_perm('employees.view');
    return (
        select coalesce(jsonb_agg(case when v_salary then to_jsonb(e) else to_jsonb(e) - 'salary' - 'daily_rate' - 'hourly_rate' - 'ot_rate' end
                                  order by e.name), '[]'::jsonb)
          from public.employees e where e.tenant_id = public.current_tenant_id());
end;
$$;

commit;

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

-- Cafe ERP · Phase 6 (rewards, customer portal, feedback, incentives) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261010000001_customers_rewards.sql ====
-- Phase 6: customer portal, reward rule builder, WhatsApp to-do, Instagram verification,
-- dish feedback, Google review link, automatic customer groups, editable slogans, staff incentives.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.customers
    add column birthday date,
    add column anniversary date,
    add column group_code text not null default 'new'
        check (group_code in ('new', 'occasional', 'regular', 'vip', 'slipping', 'lost')),
    add column group_changed_at timestamptz,
    add column points_multiplier numeric(4, 2) not null default 1 check (points_multiplier >= 1),
    add column multiplier_until timestamptz,
    add column instagram_handle text not null default '';

-- Coupons made by a reward belong to one customer
alter table public.coupons
    add column customer_id uuid references public.customers (id) on delete cascade;

-- When + If + Give + Limits + Tell
create table public.reward_rules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    name text not null,
    is_active boolean not null default true,
    -- When
    trigger_kind text not null check (trigger_kind in ('nth_order', 'spend_crosses', 'first_order', 'streak', 'birthday',
                                                        'anniversary', 'inactive', 'group', 'instagram', 'manual')),
    trigger_value numeric(12, 2) not null default 0,      -- N orders, ₹ spend, streak days, inactive days
    trigger_period text not null default 'lifetime' check (trigger_period in ('lifetime', 'month')),
    trigger_group text not null default '',               -- for 'group'
    -- If: {minBill, itemIds[], categoryIds[], days[0-6], fromTime, toTime, groups[], channels[], igKind}
    conditions jsonb not null default '{}',
    -- Give
    reward_type text not null check (reward_type in ('points', 'flat_coupon', 'pct_coupon', 'free_item', 'multiplier', 'text')),
    reward_value numeric(10, 2) not null default 0,       -- points, ₹, %, multiplier (e.g. 2)
    reward_cap numeric(10, 2),                            -- max ₹ for % coupons
    reward_item_id uuid references public.menu_items (id) on delete set null,
    reward_days integer not null default 7,               -- multiplier lasts this many days
    reward_text text not null default '',
    -- Limits
    per_customer_limit integer not null default 1,        -- 0 = no limit
    per_customer_period text not null default 'ever' check (per_customer_period in ('ever', 'year', 'month', 'week')),
    monthly_limit integer not null default 0,             -- 0 = no limit
    monthly_budget numeric(10, 2) not null default 0,     -- 0 = no budget
    expiry_days integer not null default 30,
    min_gap_days integer not null default 0,
    pause_when_behind boolean not null default false,
    -- Tell
    show_customer boolean not null default true,
    whatsapp_template text not null default '',
    assigned_staff uuid[] not null default '{}',
    paused_reason text not null default '',
    created_at timestamptz not null default now()
);
create index reward_rules_tenant on public.reward_rules (tenant_id, trigger_kind) where is_active;

create table public.reward_grants (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    rule_id uuid references public.reward_rules (id) on delete set null,
    customer_id uuid not null references public.customers (id) on delete cascade,
    order_id uuid references public.orders (id) on delete set null,
    source text not null default 'rule' check (source in ('rule', 'manual', 'multiplier', 'instagram')),
    title text not null,                                  -- "Hit 25 orders"
    reward_label text not null,                           -- "₹500 coupon"
    reward_type text not null,
    points integer not null default 0,
    coupon_id uuid references public.coupons (id) on delete set null,
    coupon_code text not null default '',
    cost numeric(10, 2) not null default 0,               -- estimated ₹ cost to the cafe
    expires_at timestamptz,
    show_customer boolean not null default true,
    message text not null default '',                     -- WhatsApp text (template filled in)
    send_status text not null default 'none' check (send_status in ('none', 'pending', 'sent', 'skipped')),
    sent_by text not null default '',
    sent_at timestamptz,
    used_order_id uuid references public.orders (id) on delete set null,
    used_at timestamptz,
    created_by text not null default '',
    created_at timestamptz not null default now()
);
create index reward_grants_customer on public.reward_grants (customer_id, created_at desc);
create index reward_grants_rule on public.reward_grants (rule_id, created_at);
create index reward_grants_todo on public.reward_grants (tenant_id, send_status) where send_status = 'pending';

create table public.dish_feedback (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    order_id uuid not null references public.orders (id) on delete cascade,
    customer_id uuid references public.customers (id) on delete set null,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    rating integer not null check (rating between 1 and 5),
    comment text not null default '',
    is_hidden boolean not null default false,
    reply text not null default '',
    replied_by text not null default '',
    created_at timestamptz not null default now(),
    unique (order_id, menu_item_id)
);
create index dish_feedback_item on public.dish_feedback (tenant_id, menu_item_id, created_at);

create table public.instagram_claims (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    customer_id uuid not null references public.customers (id) on delete cascade,
    kind text not null default 'tag' check (kind in ('tag', 'follow')),
    handle text not null,
    selfie_path text not null default '',
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reason text not null default '',
    decided_by text not null default '',
    decided_at timestamptz,
    selfie_purged boolean not null default false,
    created_at timestamptz not null default now()
);
create index instagram_claims_queue on public.instagram_claims (tenant_id, status, created_at);

create table public.incentive_rules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    name text not null,
    kind text not null check (kind in ('per_item', 'upsell', 'target', 'pool', 'rating')),
    item_ids uuid[] not null default '{}',
    category_ids uuid[] not null default '{}',
    staff_ids uuid[] not null default '{}',               -- empty = everyone
    amount numeric(10, 2) not null default 0,             -- ₹ per unit / bonus
    threshold numeric(12, 2) not null default 0,          -- ₹ sales (target) or rating (rating)
    percent numeric(5, 2) not null default 0,             -- pool: % of profit above the weekly target
    only_if_target_met boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.reward_rules enable row level security;
alter table public.reward_grants enable row level security;
alter table public.dish_feedback enable row level security;
alter table public.instagram_claims enable row level security;
alter table public.incentive_rules enable row level security;
create policy "staff read reward rules" on public.reward_rules for select to authenticated
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('rewards.view')));
create policy "staff read incentive rules" on public.incentive_rules for select to authenticated
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));

-- Customer selfies for Instagram verification: private, deleted after 30 days
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-private', 'customer-private', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "customer upload own selfie" on storage.objects for insert to authenticated
    with check (bucket_id = 'customer-private'
                and (storage.foldername(name))[1] = (select c.tenant_id::text from public.customers c where c.id = public.current_customer_id())
                and (storage.foldername(name))[2] = coalesce(public.current_customer_id()::text, '-'));
create policy "customer or staff read selfie" on storage.objects for select to authenticated
    using (bucket_id = 'customer-private'
           and ((storage.foldername(name))[2] = coalesce(public.current_customer_id()::text, '-')
                or ((storage.foldername(name))[1] = public.current_tenant_id()::text and public.has_perm('customers.view'))));
create policy "staff delete old selfies" on storage.objects for delete to authenticated
    using (bucket_id = 'customer-private' and (storage.foldername(name))[1] = public.current_tenant_id()::text
           and public.has_perm('customers.edit'));

-- Portal texts and switches (defaults; the admin edits them in Rewards → Customer portal)
create function public.portal_defaults() returns jsonb
language sql immutable as $$
    select jsonb_build_object(
        'texts', jsonb_build_object(
            'heading', 'Your rewards',
            'pointsLabel', 'Chai-ching! You have {points} points',
            'progress', 'You''re {left} away from {reward}!',
            'noRewards', 'No rewards yet — your first one is brewing ☕',
            'pointsAdded', 'Chai-ching! {points} points added',
            'instagram', 'Tag us on Instagram, earn a treat',
            'underReview', 'Under review — up to 2 days',
            'feedbackAsk', 'How was it? Rate each dish',
            'feedbackThanks', 'Thank you! The kitchen reads every rating.',
            'review', 'Loved it? Tell others on Google'),
        'show', jsonb_build_object('points', true, 'progress', true, 'upcoming', true, 'offers', true, 'instagram', true,
                                   'feedback', true, 'review', true));
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.order_local_date(o public.orders) returns date
language sql stable set search_path = public, pg_temp as $$
    select (o.created_at at time zone public.cafe_timezone(o.tenant_id))::date;
$$;

create function public.reward_label(r public.reward_rules) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select case r.reward_type
        when 'points' then r.reward_value::integer || ' points'
        when 'flat_coupon' then public.inr(r.reward_value) || ' off coupon'
        when 'pct_coupon' then trim(to_char(r.reward_value, 'FM990.##')) || '% off'
                               || coalesce(' (max ' || public.inr(r.reward_cap) || ')', '')
        when 'free_item' then 'Free ' || coalesce((select name from public.menu_items where id = r.reward_item_id), 'item')
        when 'multiplier' then trim(to_char(r.reward_value, 'FM990.##')) || '× points for ' || r.reward_days || ' days'
        else coalesce(nullif(r.reward_text, ''), 'A surprise') end;
$$;

-- Estimated ₹ cost of one grant
create function public.reward_unit_cost(r public.reward_rules) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_ratio numeric := coalesce((select points_to_rupee_ratio from public.loyalty_settings where tenant_id = r.tenant_id), 10);
    v_avg numeric;
    v_ppr numeric := coalesce((select points_per_rupee from public.loyalty_settings where tenant_id = r.tenant_id), 1);
begin
    select coalesce(avg(total), 300) into v_avg from public.orders
     where tenant_id = r.tenant_id and status = 'paid' and created_at > now() - interval '30 days';
    return round(case r.reward_type
        when 'points' then r.reward_value / v_ratio
        when 'flat_coupon' then r.reward_value
        when 'pct_coupon' then least(v_avg * r.reward_value / 100, coalesce(r.reward_cap, v_avg))
        when 'free_item' then coalesce(public.recipe_cost(r.reward_item_id),
                                       nullif((select cost_price from public.menu_items where id = r.reward_item_id), 0),
                                       (select price * 0.35 from public.menu_items where id = r.reward_item_id), 0)
        -- extra points on about two visits during the boost
        when 'multiplier' then (r.reward_value - 1) * v_avg * v_ppr * 2 / v_ratio
        else 0 end, 2);
end;
$$;

-- Fill a WhatsApp template: {name} {reward} {code} {expiry} {cafe} {points}
create function public.fill_template(p_template text, p_name text, p_reward text, p_code text, p_expiry timestamptz,
                                     p_tenant uuid, p_points integer) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select replace(replace(replace(replace(replace(replace(coalesce(p_template, ''),
        '{name}', coalesce(nullif(split_part(p_name, ' ', 1), ''), 'there')),
        '{reward}', coalesce(p_reward, '')),
        '{code}', coalesce(p_code, '')),
        '{expiry}', coalesce(to_char(p_expiry at time zone public.cafe_timezone(p_tenant), 'DD Mon'), 'no expiry')),
        '{cafe}', coalesce(public.get_setting('restaurant_name', '""', p_tenant) #>> '{}', '')),
        '{points}', coalesce(p_points::text, ''));
$$;

-- ---------------------------------------------------------------------------
-- Customer groups (automatic)
-- New (≤1 order) · Regular (3+ orders in 30 days) · VIP (top 10% by spend, 2+ orders)
-- Slipping (no visit in 2× their usual gap) · Lost (60+ days) · Occasional (everyone else)
-- ---------------------------------------------------------------------------
create function public.customer_group_calc(p_customer uuid, p_vip_spend numeric) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_n integer; v_first timestamptz; v_last timestamptz; v_spend numeric; v_recent integer; v_gap numeric; v_since numeric;
begin
    select count(*), min(created_at), max(created_at), coalesce(sum(total), 0),
           count(*) filter (where created_at > now() - interval '30 days')
      into v_n, v_first, v_last, v_spend, v_recent
      from public.orders where customer_id = p_customer and status = 'paid';
    if v_n <= 1 then
        return case when v_n = 1 and v_last < now() - interval '60 days' then 'lost' else 'new' end;
    end if;
    v_since := extract(epoch from now() - v_last) / 86400;
    if v_since >= 60 then return 'lost'; end if;
    v_gap := extract(epoch from v_last - v_first) / 86400 / (v_n - 1);
    if v_since > greatest(2 * v_gap, 7) then return 'slipping'; end if;
    if p_vip_spend is not null and v_spend >= p_vip_spend then return 'vip'; end if;
    if v_recent >= 3 then return 'regular'; end if;
    return 'occasional';
end;
$$;

create function public.vip_spend_threshold(p_tenant uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select percentile_cont(0.9) within group (order by spend)
      from (select sum(total) spend from public.orders
             where tenant_id = p_tenant and status = 'paid' and customer_id is not null
             group by customer_id having count(*) >= 2) s;
$$;

-- ---------------------------------------------------------------------------
-- Granting a reward
-- ---------------------------------------------------------------------------
create function public.grant_reward(p_rule uuid, p_customer uuid, p_order uuid, p_source text, p_title text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r public.reward_rules;
    c public.customers;
    v_label text;
    v_cost numeric;
    v_code text := '';
    v_coupon uuid;
    v_expires timestamptz;
    v_points integer := 0;
    v_price numeric;
    v_id uuid;
    v_msg text := '';
    v_actor text := coalesce(nullif(public.actor_name(), ''), 'System');
begin
    select * into r from public.reward_rules where id = p_rule;
    select * into c from public.customers where id = p_customer;
    v_label := public.reward_label(r);
    v_cost := public.reward_unit_cost(r);
    v_expires := case when r.expiry_days > 0 then now() + make_interval(days => r.expiry_days) end;

    if r.reward_type = 'points' then
        v_points := r.reward_value::integer;
        update public.customers set loyalty_points = loyalty_points + v_points, total_points_earned = total_points_earned + v_points
         where id = p_customer;
        v_expires := null;
    elsif r.reward_type in ('flat_coupon', 'pct_coupon', 'free_item') then
        v_code := 'R' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        if r.reward_type = 'free_item' then
            select price into v_price from public.menu_items where id = r.reward_item_id;
        end if;
        insert into public.coupons (tenant_id, code, description, discount_type, discount_value, min_order_amount, max_discount,
                                    applicable_items, usage_limit, valid_from, valid_until, is_active, customer_id)
        values (r.tenant_id, v_code, r.name || ' · ' || coalesce(nullif(c.name, ''), c.phone),
                case when r.reward_type = 'flat_coupon' then 'fixed' else 'percentage' end,
                case r.reward_type when 'free_item' then 100 else r.reward_value end,
                0,
                case r.reward_type when 'pct_coupon' then r.reward_cap when 'free_item' then v_price end,
                case when r.reward_type = 'free_item' and r.reward_item_id is not null then array[r.reward_item_id] else '{}' end,
                1, now(), coalesce(v_expires, now() + interval '10 years'), true, p_customer)
        returning id into v_coupon;
    elsif r.reward_type = 'multiplier' then
        update public.customers set points_multiplier = greatest(r.reward_value, 1),
                                    multiplier_until = now() + make_interval(days => greatest(r.reward_days, 1))
         where id = p_customer;
        v_expires := now() + make_interval(days => greatest(r.reward_days, 1));
    end if;

    if r.whatsapp_template <> '' then
        v_msg := public.fill_template(r.whatsapp_template, c.name, v_label, v_code, v_expires, r.tenant_id, v_points);
    end if;

    insert into public.reward_grants (tenant_id, rule_id, customer_id, order_id, source, title, reward_label, reward_type, points,
                                      coupon_id, coupon_code, cost, expires_at, show_customer, message, send_status, created_by)
    values (r.tenant_id, r.id, p_customer, p_order, p_source, coalesce(p_title, r.name), v_label, r.reward_type, v_points,
            v_coupon, v_code, v_cost, v_expires, r.show_customer, v_msg,
            case when v_msg <> '' then 'pending' else 'none' end, v_actor)
    returning id into v_id;

    perform public.notify(r.tenant_id, 'reward',
        coalesce(nullif(c.name, ''), 'Customer ' || right(c.phone, 4)) || ': ' || coalesce(p_title, r.name) || ' → ' || v_label,
        case when v_msg <> '' then 'Send it on WhatsApp' else '' end, '/admin/rewards?tab=todo', 'customers.view', 'loud',
        jsonb_build_object('grantId', v_id, 'assigned', to_jsonb(r.assigned_staff)));
    return v_id;
end;
$$;
revoke execute on function public.grant_reward(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- Can this rule give this customer a reward now? Returns null when yes, else the reason.
create function public.reward_blocked(r public.reward_rules, p_customer uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone(r.tenant_id);
    v_today date := public.cafe_today(r.tenant_id);
    v_month_start timestamptz := (date_trunc('month', v_today)::timestamp at time zone v_tz);
    v_since timestamptz;
    v_count integer;
    v_spent numeric;
    v_tw numeric;
    v_wk date;
    v_profit numeric;
begin
    if not r.is_active then return 'Rule is off'; end if;
    if r.paused_reason <> '' then return r.paused_reason; end if;
    if r.per_customer_limit > 0 then
        v_since := case r.per_customer_period
            when 'ever' then '-infinity'::timestamptz
            when 'year' then (date_trunc('year', v_today)::timestamp at time zone v_tz)
            when 'month' then v_month_start
            else ((v_today - (extract(isodow from v_today)::integer - 1))::timestamp at time zone v_tz) end;
        select count(*) into v_count from public.reward_grants
         where rule_id = r.id and customer_id = p_customer and created_at >= v_since;
        if v_count >= r.per_customer_limit then return 'Customer limit reached'; end if;
    end if;
    if r.min_gap_days > 0 and exists (select 1 from public.reward_grants where rule_id = r.id and customer_id = p_customer
                                         and created_at > now() - make_interval(days => r.min_gap_days)) then
        return 'Too soon after the last reward';
    end if;
    if r.monthly_limit > 0 and (select count(*) from public.reward_grants where rule_id = r.id and created_at >= v_month_start) >= r.monthly_limit then
        return 'Monthly limit reached';
    end if;
    if r.monthly_budget > 0 then
        select coalesce(sum(cost), 0) into v_spent from public.reward_grants where rule_id = r.id and created_at >= v_month_start;
        if v_spent + public.reward_unit_cost(r) > r.monthly_budget then
            update public.reward_rules set paused_reason = 'Monthly budget used up' where id = r.id;
            perform public.notify(r.tenant_id, 'reward', 'Reward "' || r.name || '" paused: monthly budget of ' || public.inr(r.monthly_budget) || ' used',
                                  'It restarts on the 1st, or raise the budget in Rewards → Rules.', '/admin/rewards', 'rewards.view', 'normal');
            return 'Monthly budget used up';
        end if;
    end if;
    if r.pause_when_behind then
        v_tw := coalesce((public.get_setting('profit_target_weekly', '0', r.tenant_id) #>> '{}')::numeric, 0);
        if v_tw > 0 then
            v_wk := v_today - (extract(isodow from v_today)::integer - 1);
            v_profit := (public.pnl_core(r.tenant_id, v_wk, v_today) ->> 'netProfit')::numeric;
            if v_profit * 7 / (v_today - v_wk + 1) < v_tw then
                return 'On hold: this week is behind the profit target';
            end if;
        end if;
    end if;
    return null;
end;
$$;

-- Does the order meet the rule's "If" conditions?
create function public.reward_conditions_ok(r public.reward_rules, o public.orders) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c jsonb := r.conditions;
    v_local timestamp := o.created_at at time zone public.cafe_timezone(o.tenant_id);
    v_group text;
begin
    if coalesce(nullif(c ->> 'minBill', '')::numeric, 0) > o.total then return false; end if;
    if jsonb_array_length(coalesce(c -> 'channels', '[]')) > 0 and not (c -> 'channels') ? o.channel then return false; end if;
    if jsonb_array_length(coalesce(c -> 'days', '[]')) > 0 and not (c -> 'days') @> to_jsonb(extract(dow from v_local)::integer) then
        return false;
    end if;
    if nullif(c ->> 'fromTime', '') is not null and v_local::time < (c ->> 'fromTime')::time then return false; end if;
    if nullif(c ->> 'toTime', '') is not null and v_local::time > (c ->> 'toTime')::time then return false; end if;
    if jsonb_array_length(coalesce(c -> 'groups', '[]')) > 0 then
        select group_code into v_group from public.customers where id = o.customer_id;
        if not (c -> 'groups') ? v_group then return false; end if;
    end if;
    -- Specific items / categories: at least one such line; restricted items never count
    if jsonb_array_length(coalesce(c -> 'itemIds', '[]')) + jsonb_array_length(coalesce(c -> 'categoryIds', '[]')) > 0 then
        return exists (select 1 from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id
                        where oi.order_id = o.id and not oi.is_restricted
                          and ((c -> 'itemIds') ? mi.id::text or (c -> 'categoryIds') ? mi.category_id::text));
    end if;
    return true;
end;
$$;

-- Order-based triggers, run when an order with a customer is paid
create function public.evaluate_order_rewards(p_order uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    o public.orders;
    r public.reward_rules;
    v_n integer;
    v_before numeric;
    v_after numeric;
    v_from timestamptz;
    v_streak integer;
    v_hit boolean;
    v_title text;
    v_granted integer := 0;
    v_tz text;
begin
    select * into o from public.orders where id = p_order;
    if o.customer_id is null or o.status <> 'paid' then return 0; end if;
    v_tz := public.cafe_timezone(o.tenant_id);
    for r in select * from public.reward_rules
              where tenant_id = o.tenant_id and is_active
                and trigger_kind in ('nth_order', 'spend_crosses', 'first_order', 'streak') order by created_at loop
        if not public.reward_conditions_ok(r, o) then continue; end if;
        v_from := case when r.trigger_period = 'month'
                       then (date_trunc('month', public.order_local_date(o))::timestamp at time zone v_tz) else '-infinity' end;
        v_hit := false;
        if r.trigger_kind in ('nth_order', 'first_order') then
            select count(*) into v_n from public.orders
             where customer_id = o.customer_id and status = 'paid' and created_at >= v_from and created_at <= o.created_at;
            if r.trigger_kind = 'first_order' then
                v_hit := v_n = 1; v_title := 'First order';
            elsif r.trigger_value >= 1 and v_n % r.trigger_value::integer = 0 then
                v_hit := true; v_title := 'Hit ' || v_n || ' orders';
            end if;
        elsif r.trigger_kind = 'spend_crosses' then
            select coalesce(sum(total), 0) into v_after from public.orders
             where customer_id = o.customer_id and status = 'paid' and created_at >= v_from and created_at <= o.created_at;
            v_before := v_after - o.total;
            v_hit := r.trigger_value > 0 and v_before < r.trigger_value and v_after >= r.trigger_value;
            v_title := 'Spent over ' || public.inr(r.trigger_value) || case when r.trigger_period = 'month' then ' this month' else '' end;
        elsif r.trigger_kind = 'streak' then
            -- the first paid order today completes a run of N consecutive days
            if (select count(*) from public.orders where customer_id = o.customer_id and status = 'paid'
                   and public.order_local_date(orders) = public.order_local_date(o)) = 1 then
                v_streak := 1;
                while v_streak < 400 and exists (select 1 from public.orders x where x.customer_id = o.customer_id and x.status = 'paid'
                                                   and public.order_local_date(x) = public.order_local_date(o) - v_streak) loop
                    v_streak := v_streak + 1;
                end loop;
                v_hit := r.trigger_value >= 2 and v_streak = r.trigger_value::integer;
                v_title := v_streak || '-day visit streak';
            end if;
        end if;
        if v_hit and public.reward_blocked(r, o.customer_id) is null then
            perform public.grant_reward(r.id, o.customer_id, o.id, 'rule', v_title);
            v_granted := v_granted + 1;
        end if;
    end loop;
    return v_granted;
end;
$$;
revoke execute on function public.evaluate_order_rewards(uuid) from public, anon, authenticated;

-- After an order is paid: points boost, group refresh, reward rules; mark reward coupons used
create function public.orders_rewards_paid() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_extra integer;
    v_group text;
begin
    if new.status <> 'paid' or old.status = 'paid' or new.customer_id is null then
        return null;
    end if;
    select * into c from public.customers where id = new.customer_id;
    if c.points_multiplier > 1 and c.multiplier_until > now() and new.points_awarded > 0 then
        v_extra := floor(new.points_awarded * (c.points_multiplier - 1));
        if v_extra > 0 then
            update public.customers set loyalty_points = loyalty_points + v_extra, total_points_earned = total_points_earned + v_extra
             where id = c.id;
            insert into public.reward_grants (tenant_id, customer_id, order_id, source, title, reward_label, reward_type, points, cost, created_by)
            values (new.tenant_id, c.id, new.id, 'multiplier', 'Points boost ' || trim(to_char(c.points_multiplier, 'FM990.##')) || '×',
                    v_extra || ' extra points', 'points', v_extra,
                    round(v_extra / coalesce((select points_to_rupee_ratio from public.loyalty_settings where tenant_id = new.tenant_id), 10), 2),
                    'System');
        end if;
    end if;
    v_group := public.customer_group_calc(c.id, public.vip_spend_threshold(new.tenant_id));
    if v_group is distinct from c.group_code then
        update public.customers set group_code = v_group, group_changed_at = now() where id = c.id;
    end if;
    perform public.evaluate_order_rewards(new.id);
    return null;
end;
$$;
create trigger orders_rewards_paid after update of status on public.orders
    for each row execute function public.orders_rewards_paid();

-- Reward coupons work only for their customer; using one marks the reward used
create function public.orders_reward_coupon() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_owner uuid;
begin
    if coalesce(new.coupon_code, '') = '' then
        return new;
    end if;
    select customer_id into v_owner from public.coupons where tenant_id = new.tenant_id and code = new.coupon_code;
    if v_owner is not null and v_owner is distinct from new.customer_id then
        raise exception 'This reward coupon belongs to another customer';
    end if;
    return new;
end;
$$;
create trigger orders_reward_coupon before insert on public.orders
    for each row execute function public.orders_reward_coupon();

create function public.orders_reward_coupon_used() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if coalesce(new.coupon_code, '') <> '' then
        update public.reward_grants set used_order_id = new.id, used_at = now()
         where tenant_id = new.tenant_id and coupon_code = new.coupon_code and used_at is null;
    end if;
    return null;
end;
$$;
create trigger orders_reward_coupon_used after insert on public.orders
    for each row execute function public.orders_reward_coupon_used();

-- ---------------------------------------------------------------------------
-- Daily: birthdays, anniversaries, inactive customers, group changes; selfies to delete
-- (run from the owner's / manager's screen once a day, like the other reminders)
-- ---------------------------------------------------------------------------
create function public.run_reward_checks() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
    v_vip numeric;
    r public.reward_rules;
    c record;
    v_n integer := 0;
    v_groups integer := 0;
begin
    perform public.require_admin();
    if (public.get_setting('reward_check_date', '""', v_tenant) #>> '{}') = v_today::text then
        return jsonb_build_object('skipped', true);
    end if;
    insert into public.settings (tenant_id, key, value, description)
    values (v_tenant, 'reward_check_date', to_jsonb(v_today::text), 'Last daily reward check')
    on conflict (tenant_id, key) do update set value = excluded.value;

    -- Budgets restart each month
    update public.reward_rules set paused_reason = ''
     where tenant_id = v_tenant and paused_reason = 'Monthly budget used up' and extract(day from v_today) = 1;

    -- Groups
    v_vip := public.vip_spend_threshold(v_tenant);
    for c in select id, group_code, public.customer_group_calc(id, v_vip) g from public.customers
              where tenant_id = v_tenant and exists (select 1 from public.orders o where o.customer_id = customers.id and o.status = 'paid') loop
        if c.g is distinct from c.group_code then
            update public.customers set group_code = c.g, group_changed_at = now() where id = c.id;
            v_groups := v_groups + 1;
            for r in select * from public.reward_rules where tenant_id = v_tenant and is_active and trigger_kind = 'group' and trigger_group = c.g loop
                if public.reward_blocked(r, c.id) is null then
                    perform public.grant_reward(r.id, c.id, null, 'rule', 'Now ' || initcap(c.g));
                    v_n := v_n + 1;
                end if;
            end loop;
        end if;
    end loop;

    -- Birthdays / anniversaries / inactive
    for r in select * from public.reward_rules where tenant_id = v_tenant and is_active
                                                and trigger_kind in ('birthday', 'anniversary', 'inactive') loop
        for c in select cu.id from public.customers cu
                  where cu.tenant_id = v_tenant
                    and case r.trigger_kind
                        when 'birthday' then to_char(cu.birthday, 'MMDD') = to_char(v_today, 'MMDD')
                        when 'anniversary' then to_char(cu.anniversary, 'MMDD') = to_char(v_today, 'MMDD')
                        else (select max(public.order_local_date(o)) from public.orders o where o.customer_id = cu.id and o.status = 'paid')
                                 <= v_today - greatest(r.trigger_value, 1)::integer
                             and not exists (select 1 from public.reward_grants g where g.rule_id = r.id and g.customer_id = cu.id
                                               and g.created_at > (select max(o.created_at) from public.orders o
                                                                    where o.customer_id = cu.id and o.status = 'paid')) end loop
            if public.reward_blocked(r, c.id) is null then
                perform public.grant_reward(r.id, c.id, null, 'rule',
                    case r.trigger_kind when 'birthday' then 'Happy birthday' when 'anniversary' then 'Happy anniversary'
                         else 'Missed you: ' || r.trigger_value::integer || '+ days' end);
                v_n := v_n + 1;
            end if;
        end loop;
    end loop;

    -- Unsent WhatsApp rewards from earlier days
    if exists (select 1 from public.reward_grants where tenant_id = v_tenant and send_status = 'pending'
                  and created_at < (v_today::timestamp at time zone public.cafe_timezone(v_tenant))) then
        perform public.notify(v_tenant, 'reward',
            (select count(*) from public.reward_grants where tenant_id = v_tenant and send_status = 'pending') || ' reward messages not sent yet',
            'Open the WhatsApp to-do list', '/admin/rewards?tab=todo', 'customers.view', 'normal');
    end if;
    return jsonb_build_object('granted', v_n, 'groupChanges', v_groups);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: rules
-- ---------------------------------------------------------------------------
create function public.reward_rule_json(r public.reward_rules) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_month timestamptz := (date_trunc('month', public.cafe_today(r.tenant_id))::timestamp at time zone public.cafe_timezone(r.tenant_id));
    v_unit numeric := public.reward_unit_cost(r);
    v_fires numeric;
begin
    -- Expected grants per month, from the last 30 days of orders and customers
    v_fires := case r.trigger_kind
        when 'nth_order' then (select count(*) from public.orders where tenant_id = r.tenant_id and status = 'paid' and customer_id is not null
                                   and created_at > now() - interval '30 days') / greatest(r.trigger_value, 1)
        when 'first_order' then (select count(*) from public.customers c where c.tenant_id = r.tenant_id
                                    and (select min(created_at) from public.orders o where o.customer_id = c.id and o.status = 'paid') > now() - interval '30 days')
        when 'spend_crosses' then (select count(*) from (select customer_id from public.orders where tenant_id = r.tenant_id and status = 'paid'
                                         and customer_id is not null and created_at > now() - interval '30 days'
                                       group by customer_id having sum(total) >= r.trigger_value) s)
        when 'birthday' then (select count(*) from public.customers where tenant_id = r.tenant_id and birthday is not null) / 12.0
        when 'anniversary' then (select count(*) from public.customers where tenant_id = r.tenant_id and anniversary is not null) / 12.0
        when 'group' then (select count(*) from public.customers where tenant_id = r.tenant_id and group_code = r.trigger_group
                              and group_changed_at > now() - interval '30 days')
        else (select count(*) from public.reward_grants where rule_id = r.id and created_at > now() - interval '30 days') end;
    if r.monthly_limit > 0 then v_fires := least(v_fires, r.monthly_limit); end if;
    return jsonb_build_object(
        'id', r.id, 'name', r.name, 'isActive', r.is_active, 'triggerKind', r.trigger_kind, 'triggerValue', r.trigger_value,
        'triggerPeriod', r.trigger_period, 'triggerGroup', r.trigger_group, 'conditions', r.conditions,
        'rewardType', r.reward_type, 'rewardValue', r.reward_value, 'rewardCap', r.reward_cap, 'rewardItemId', r.reward_item_id,
        'rewardDays', r.reward_days, 'rewardText', r.reward_text, 'rewardLabel', public.reward_label(r),
        'perCustomerLimit', r.per_customer_limit, 'perCustomerPeriod', r.per_customer_period, 'monthlyLimit', r.monthly_limit,
        'monthlyBudget', r.monthly_budget, 'expiryDays', r.expiry_days, 'minGapDays', r.min_gap_days,
        'pauseWhenBehind', r.pause_when_behind, 'showCustomer', r.show_customer, 'whatsappTemplate', r.whatsapp_template,
        'assignedStaff', to_jsonb(r.assigned_staff), 'pausedReason', r.paused_reason,
        'unitCost', v_unit, 'estMonthlyCost', round(coalesce(v_fires, 0) * v_unit, 0), 'estMonthlyCount', round(coalesce(v_fires, 0), 1),
        'thisMonth', (select jsonb_build_object('count', count(*), 'cost', coalesce(sum(cost), 0))
                        from public.reward_grants where rule_id = r.id and created_at >= v_month));
end;
$$;

create function public.list_reward_rules() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('rewards.view');
    return (select coalesce(jsonb_agg(public.reward_rule_json(r) order by r.is_active desc, r.created_at), '[]'::jsonb)
              from public.reward_rules r where r.tenant_id = public.current_tenant_id());
end;
$$;

create function public.save_reward_rule(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_id uuid := nullif(p ->> 'id', '')::uuid;
    v_type text := p ->> 'rewardType';
    v_value numeric := coalesce(nullif(p ->> 'rewardValue', '')::numeric, 0);
begin
    perform public.require_perm('rewards.edit');
    if trim(coalesce(p ->> 'name', '')) = '' then raise exception 'Give the rule a name'; end if;
    if v_type in ('points', 'flat_coupon', 'pct_coupon') and v_value <= 0 then raise exception 'Enter the reward amount'; end if;
    if v_type = 'pct_coupon' and v_value > 100 then raise exception 'Percent can''t be above 100'; end if;
    if v_type = 'multiplier' and v_value <= 1 then raise exception 'Multiplier must be more than 1 (e.g. 2 for double points)'; end if;
    if v_type = 'free_item' and not exists (select 1 from public.menu_items where id = nullif(p ->> 'rewardItemId', '')::uuid
                                               and tenant_id = v_tenant and not is_restricted) then
        raise exception 'Pick the free item (restricted items can''t be rewards)';
    end if;
    if p ->> 'triggerKind' in ('nth_order', 'spend_crosses', 'inactive', 'streak')
       and coalesce(nullif(p ->> 'triggerValue', '')::numeric, 0) <= 0 then
        raise exception 'Enter the number for the trigger';
    end if;
    if v_id is null then
        insert into public.reward_rules (tenant_id, name, trigger_kind, reward_type) values (v_tenant, 'x', p ->> 'triggerKind', v_type)
        returning id into v_id;
    elsif not exists (select 1 from public.reward_rules where id = v_id and tenant_id = v_tenant) then
        raise exception 'Rule not found';
    end if;
    update public.reward_rules set
        name = trim(p ->> 'name'),
        is_active = coalesce((p ->> 'isActive')::boolean, true),
        trigger_kind = p ->> 'triggerKind',
        trigger_value = coalesce(nullif(p ->> 'triggerValue', '')::numeric, 0),
        trigger_period = coalesce(nullif(p ->> 'triggerPeriod', ''), 'lifetime'),
        trigger_group = coalesce(p ->> 'triggerGroup', ''),
        conditions = coalesce(p -> 'conditions', '{}'),
        reward_type = v_type,
        reward_value = v_value,
        reward_cap = nullif(p ->> 'rewardCap', '')::numeric,
        reward_item_id = nullif(p ->> 'rewardItemId', '')::uuid,
        reward_days = coalesce(nullif(p ->> 'rewardDays', '')::integer, 7),
        reward_text = coalesce(p ->> 'rewardText', ''),
        per_customer_limit = coalesce(nullif(p ->> 'perCustomerLimit', '')::integer, 1),
        per_customer_period = coalesce(nullif(p ->> 'perCustomerPeriod', ''), 'ever'),
        monthly_limit = coalesce(nullif(p ->> 'monthlyLimit', '')::integer, 0),
        monthly_budget = coalesce(nullif(p ->> 'monthlyBudget', '')::numeric, 0),
        expiry_days = coalesce(nullif(p ->> 'expiryDays', '')::integer, 30),
        min_gap_days = coalesce(nullif(p ->> 'minGapDays', '')::integer, 0),
        pause_when_behind = coalesce((p ->> 'pauseWhenBehind')::boolean, false),
        show_customer = coalesce((p ->> 'showCustomer')::boolean, true),
        whatsapp_template = coalesce(p ->> 'whatsappTemplate', ''),
        assigned_staff = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'assignedStaff') x), '{}'),
        paused_reason = ''
     where id = v_id;
    return v_id;
end;
$$;

create function public.delete_reward_rule(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('rewards.delete');
    delete from public.reward_rules where id = p_id and tenant_id = public.current_tenant_id();
end;
$$;

-- Staff gives a rule's reward by hand (e.g. "manual by staff" rules)
create function public.give_reward(p_rule uuid, p_customer uuid, p_note text default '') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r public.reward_rules;
    v_block text;
begin
    perform public.require_perm('rewards.edit');
    select * into r from public.reward_rules where id = p_rule and tenant_id = public.current_tenant_id();
    if r.id is null then raise exception 'Rule not found'; end if;
    if not exists (select 1 from public.customers where id = p_customer and tenant_id = r.tenant_id) then
        raise exception 'Customer not found';
    end if;
    v_block := public.reward_blocked(r, p_customer);
    if v_block is not null then raise exception '%', v_block; end if;
    return public.grant_reward(r.id, p_customer, null, 'manual', coalesce(nullif(trim(p_note), ''), r.name));
end;
$$;

-- WhatsApp to-do: rewards whose message hasn't been sent
create function public.reward_todo(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_me uuid := public.my_staff_id();
begin
    perform public.require_perm('customers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object(
                'id', g.id, 'title', g.title, 'reward', g.reward_label, 'code', g.coupon_code, 'message', g.message,
                'status', g.send_status, 'sentBy', g.sent_by, 'sentAt', g.sent_at, 'createdAt', g.created_at,
                'expiresAt', g.expires_at, 'used', g.used_at is not null,
                'customer', jsonb_build_object('id', c.id, 'name', c.name, 'group', c.group_code,
                    'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end),
                -- the WhatsApp button shows only to assigned people (or everyone when nobody is assigned)
                'canSend', public.can_see_phone(c.id) and (r.id is null or cardinality(r.assigned_staff) = 0 or v_me is null
                                                          or v_me = any (r.assigned_staff)))
                order by g.created_at desc), '[]'::jsonb)
              from public.reward_grants g
              join public.customers c on c.id = g.customer_id
              left join public.reward_rules r on r.id = g.rule_id
             where g.tenant_id = public.current_tenant_id()
               and (case when p_status = 'all' then g.send_status <> 'none' else g.send_status = p_status end)
               and g.created_at > now() - interval '90 days');
end;
$$;

create function public.mark_reward_sent(p_grant uuid, p_status text default 'sent') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.view');
    if p_status not in ('sent', 'skipped', 'pending') then raise exception 'Bad status'; end if;
    update public.reward_grants set send_status = p_status,
           sent_by = case when p_status = 'pending' then '' else public.actor_name() end,
           sent_at = case when p_status = 'pending' then null else now() end
     where id = p_grant and tenant_id = public.current_tenant_id();
end;
$$;

-- Recent rewards for a customer (Customers page / kiosk)
create function public.customer_rewards(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'reward', g.reward_label, 'code', g.coupon_code,
                                                         'createdAt', g.created_at, 'expiresAt', g.expires_at, 'used', g.used_at is not null,
                                                         'status', g.send_status) order by g.created_at desc), '[]'::jsonb)
              from public.reward_grants g where g.customer_id = p_customer and g.tenant_id = public.current_tenant_id());
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer portal
-- ---------------------------------------------------------------------------
create function public.portal_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = public.current_customer_id()), public.current_tenant_id());
    v_d jsonb := public.portal_defaults();
begin
    return jsonb_build_object(
        'texts', (v_d -> 'texts') || coalesce(public.get_setting('portal_texts', '{}', v_tenant), '{}'),
        'show', (v_d -> 'show') || coalesce(public.get_setting('portal_show', '{}', v_tenant), '{}'),
        'googleReviewUrl', coalesce(public.get_setting('google_review_url', '""', v_tenant) #>> '{}', ''),
        'instagramHandle', coalesce(public.get_setting('instagram_handle', '""', v_tenant) #>> '{}', ''));
end;
$$;

create function public.my_rewards() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    s public.loyalty_settings;
    v_show jsonb;
    v_progress jsonb := '[]';
    r public.reward_rules;
    v_n integer;
    v_spend numeric;
    v_left numeric;
begin
    select * into c from public.customers where id = public.current_customer_id();
    if c.id is null then raise exception 'Please sign in'; end if;
    select * into s from public.loyalty_settings where tenant_id = c.tenant_id;
    v_show := (public.portal_defaults() -> 'show') || coalesce(public.get_setting('portal_show', '{}', c.tenant_id), '{}');

    -- Progress towards each visible order/spend milestone
    for r in select * from public.reward_rules where tenant_id = c.tenant_id and is_active and show_customer and paused_reason = ''
                                                 and trigger_kind in ('nth_order', 'spend_crosses', 'first_order') loop
        if r.trigger_kind = 'nth_order' and r.trigger_value >= 1 then
            select count(*) into v_n from public.orders where customer_id = c.id and status = 'paid'
               and (r.trigger_period = 'lifetime' or created_at >= (date_trunc('month', public.cafe_today(c.tenant_id))::timestamp
                                                                    at time zone public.cafe_timezone(c.tenant_id)));
            v_left := r.trigger_value::integer - (v_n % r.trigger_value::integer);
            v_progress := v_progress || jsonb_build_object('rule', r.name, 'reward', public.reward_label(r), 'unit', 'orders',
                'done', r.trigger_value::integer - v_left, 'target', r.trigger_value::integer, 'left', v_left,
                'leftLabel', v_left || case when v_left = 1 then ' more order' else ' more orders' end);
        elsif r.trigger_kind = 'spend_crosses' and public.reward_blocked(r, c.id) is null then
            select coalesce(sum(total), 0) into v_spend from public.orders where customer_id = c.id and status = 'paid'
               and (r.trigger_period = 'lifetime' or created_at >= (date_trunc('month', public.cafe_today(c.tenant_id))::timestamp
                                                                    at time zone public.cafe_timezone(c.tenant_id)));
            if v_spend < r.trigger_value then
                v_progress := v_progress || jsonb_build_object('rule', r.name, 'reward', public.reward_label(r), 'unit', 'rupees',
                    'done', v_spend, 'target', r.trigger_value, 'left', r.trigger_value - v_spend,
                    'leftLabel', public.inr(r.trigger_value - v_spend) || ' more');
            end if;
        end if;
    end loop;

    return jsonb_build_object(
        'name', c.name, 'group', c.group_code, 'birthday', c.birthday, 'anniversary', c.anniversary,
        'points', case when (v_show ->> 'points')::boolean then c.loyalty_points end,
        'pointsValue', case when (v_show ->> 'points')::boolean then round(c.loyalty_points / coalesce(s.points_to_rupee_ratio, 10), 2) end,
        'multiplier', case when c.multiplier_until > now() then jsonb_build_object('x', c.points_multiplier, 'until', c.multiplier_until) end,
        'progress', case when (v_show ->> 'progress')::boolean then v_progress else '[]' end,
        'coupons', (select coalesce(jsonb_agg(jsonb_build_object('code', g.coupon_code, 'reward', g.reward_label, 'title', g.title,
                                                                 'expiresAt', g.expires_at) order by g.expires_at nulls last), '[]'::jsonb)
                      from public.reward_grants g join public.coupons cp on cp.id = g.coupon_id
                     where g.customer_id = c.id and g.show_customer and g.used_at is null and cp.is_active
                       and cp.used_count < greatest(cp.usage_limit, 1) and (g.expires_at is null or g.expires_at > now())),
        'history', (select coalesce(jsonb_agg(h order by (h ->> 'at') desc), '[]'::jsonb) from (
                       select jsonb_build_object('at', g.created_at, 'title', g.title, 'reward', g.reward_label, 'used', g.used_at is not null) h
                         from public.reward_grants g where g.customer_id = c.id and g.show_customer
                       union all
                       select jsonb_build_object('at', o.created_at, 'title', 'Order ' || o.order_number, 'reward', o.points_awarded || ' points')
                         from public.orders o where o.customer_id = c.id and o.points_awarded > 0
                       order by 1 desc limit 30) x),
        'upcoming', case when (v_show ->> 'upcoming')::boolean then (
                        select coalesce(jsonb_agg(jsonb_build_object('name', r2.name, 'reward', public.reward_label(r2), 'when', r2.trigger_kind,
                                                                     'value', r2.trigger_value)), '[]'::jsonb)
                          from public.reward_rules r2 where r2.tenant_id = c.tenant_id and r2.is_active and r2.show_customer
                           and r2.paused_reason = '' and r2.trigger_kind in ('birthday', 'anniversary', 'instagram', 'streak'))
                    else '[]' end,
        'offers', case when (v_show ->> 'offers')::boolean then (
                        select coalesce(jsonb_agg(jsonb_build_object('name', lo.name, 'description', lo.description,
                                                                     'pointsRequired', lo.points_required, 'discount', lo.discount_value,
                                                                     'eligible', c.loyalty_points >= lo.points_required)
                                                  order by lo.points_required), '[]'::jsonb)
                          from public.loyalty_offers lo where lo.tenant_id = c.tenant_id and lo.is_active)
                    else '[]' end,
        'instagram', (select coalesce(jsonb_agg(jsonb_build_object('handle', handle, 'kind', kind, 'status', status, 'reason', reason,
                                                                   'createdAt', created_at) order by created_at desc), '[]'::jsonb)
                        from (select * from public.instagram_claims where customer_id = c.id order by created_at desc limit 5) ic),
        'unratedOrders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'orderNumber', o.order_number, 'createdAt', o.created_at)
                                                    order by o.created_at desc), '[]'::jsonb)
                            from (select * from public.orders o where o.customer_id = c.id and o.status = 'paid'
                                     and o.created_at > now() - interval '14 days'
                                     and not exists (select 1 from public.dish_feedback f where f.order_id = o.id)
                                   order by created_at desc limit 3) o));
end;
$$;

create function public.set_my_dates(p_birthday date, p_anniversary date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
begin
    select * into c from public.customers where id = public.current_customer_id();
    if c.id is null then raise exception 'Please sign in'; end if;
    -- a birthday can be set once (stops changing it to get another birthday reward)
    if c.birthday is not null and p_birthday is distinct from c.birthday then
        raise exception 'Birthday is already saved. Ask the cafe to change it.';
    end if;
    if c.anniversary is not null and p_anniversary is distinct from c.anniversary then
        raise exception 'Anniversary is already saved. Ask the cafe to change it.';
    end if;
    update public.customers set birthday = p_birthday, anniversary = p_anniversary where id = c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Instagram verification
-- ---------------------------------------------------------------------------
create function public.submit_instagram_claim(p_handle text, p_kind text, p_selfie_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_handle text := lower(regexp_replace(trim(coalesce(p_handle, '')), '^@', ''));
    v_id uuid;
begin
    select * into c from public.customers where id = public.current_customer_id();
    if c.id is null then raise exception 'Please sign in'; end if;
    if v_handle !~ '^[a-z0-9._]{1,30}$' then raise exception 'Enter your Instagram username (letters, numbers, . and _)'; end if;
    if coalesce(p_selfie_path, '') = '' or split_part(p_selfie_path, '/', 2) <> c.id::text then
        raise exception 'Add a selfie taken at the cafe';
    end if;
    if exists (select 1 from public.instagram_claims where customer_id = c.id and status = 'pending') then
        raise exception 'Your last one is still under review';
    end if;
    insert into public.instagram_claims (tenant_id, customer_id, kind, handle, selfie_path)
    values (c.tenant_id, c.id, case when p_kind = 'follow' then 'follow' else 'tag' end, v_handle, p_selfie_path)
    returning id into v_id;
    update public.customers set instagram_handle = v_handle where id = c.id;
    perform public.notify(c.tenant_id, 'instagram', 'Instagram ' || case when p_kind = 'follow' then 'follow' else 'tag' end
                          || ' to verify: @' || v_handle, coalesce(nullif(c.name, ''), 'Customer'), '/admin/rewards?tab=instagram',
                          'customers.view', 'normal');
    return v_id;
end;
$$;

create function public.instagram_queue(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'handle', i.handle, 'kind', i.kind, 'status', i.status, 'reason', i.reason,
                'selfiePath', case when i.selfie_purged then '' else i.selfie_path end, 'decidedBy', i.decided_by, 'decidedAt', i.decided_at,
                'createdAt', i.created_at, 'customer', jsonb_build_object('id', c.id, 'name', c.name),
                'earlier', (select count(*) from public.instagram_claims x where x.customer_id = c.id and x.status = 'approved'))
                order by i.created_at), '[]'::jsonb)
              from public.instagram_claims i join public.customers c on c.id = i.customer_id
             where i.tenant_id = public.current_tenant_id() and (p_status = 'all' or i.status = p_status)
               and i.created_at > now() - interval '60 days');
end;
$$;

create function public.decide_instagram(p_claim uuid, p_approve boolean, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    i public.instagram_claims;
    r public.reward_rules;
    v_granted integer := 0;
    v_blocked text;
    v_why text := '';
begin
    perform public.require_perm('customers.edit');
    select * into i from public.instagram_claims where id = p_claim and tenant_id = public.current_tenant_id() for update;
    if i.id is null then raise exception 'Not found'; end if;
    if i.status <> 'pending' then raise exception 'Already %', i.status; end if;
    if not p_approve and trim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason (the customer sees it)'; end if;
    update public.instagram_claims set status = case when p_approve then 'approved' else 'rejected' end,
           reason = trim(coalesce(p_reason, '')), decided_by = public.actor_name(), decided_at = now()
     where id = i.id;
    if p_approve then
        for r in select * from public.reward_rules where tenant_id = i.tenant_id and is_active and trigger_kind = 'instagram'
                    and coalesce(conditions ->> 'igKind', '') in ('', i.kind) loop
            v_blocked := public.reward_blocked(r, i.customer_id);
            if v_blocked is null then
                perform public.grant_reward(r.id, i.customer_id, null, 'instagram', 'Instagram ' || i.kind || ' @' || i.handle);
                v_granted := v_granted + 1;
            else
                v_why := v_blocked;
            end if;
        end loop;
    end if;
    return jsonb_build_object('granted', v_granted, 'note', v_why);
end;
$$;

-- Selfies older than 30 days: the admin screen deletes the files, then marks them gone
create function public.expired_instagram_selfies() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.edit');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'path', selfie_path)), '[]'::jsonb)
              from public.instagram_claims where tenant_id = public.current_tenant_id() and not selfie_purged
               and selfie_path <> '' and created_at < now() - interval '30 days');
end;
$$;

create function public.mark_selfies_purged(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.edit');
    update public.instagram_claims set selfie_purged = true, selfie_path = ''
     where tenant_id = public.current_tenant_id() and id = any (p_ids) and created_at < now() - interval '30 days';
end;
$$;

-- ---------------------------------------------------------------------------
-- Dish feedback
-- ---------------------------------------------------------------------------
create function public.order_feedback_form(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    o public.orders;
begin
    select * into o from public.orders where id = p_order;
    if o.id is null or o.customer_id is distinct from public.current_customer_id() then raise exception 'Order not found'; end if;
    return jsonb_build_object('canRate', o.status = 'paid', 'items', (
        select coalesce(jsonb_agg(jsonb_build_object('menuItemId', x.menu_item_id, 'name', x.name,
                                                     'rating', f.rating, 'comment', f.comment, 'reply', f.reply)), '[]'::jsonb)
          from (select distinct on (oi.menu_item_id) oi.menu_item_id, mi.name
                  from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id
                 where oi.order_id = o.id and not oi.is_restricted) x
          left join public.dish_feedback f on f.order_id = o.id and f.menu_item_id = x.menu_item_id));
end;
$$;

-- p_ratings: [{menuItemId, rating, comment}]
create function public.submit_dish_feedback(p_order uuid, p_ratings jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    o public.orders;
    v jsonb;
    v_low text := '';
begin
    select * into o from public.orders where id = p_order;
    if o.id is null or o.customer_id is distinct from public.current_customer_id() then raise exception 'Order not found'; end if;
    if o.status <> 'paid' then raise exception 'You can rate after paying'; end if;
    for v in select * from jsonb_array_elements(coalesce(p_ratings, '[]')) loop
        if nullif(v ->> 'rating', '') is null then continue; end if;
        if not exists (select 1 from public.order_items where order_id = o.id and menu_item_id = (v ->> 'menuItemId')::uuid) then
            continue;
        end if;
        insert into public.dish_feedback (tenant_id, order_id, customer_id, menu_item_id, rating, comment)
        values (o.tenant_id, o.id, o.customer_id, (v ->> 'menuItemId')::uuid, least(greatest((v ->> 'rating')::integer, 1), 5),
                left(trim(coalesce(v ->> 'comment', '')), 500))
        on conflict (order_id, menu_item_id) do update set rating = excluded.rating, comment = excluded.comment;
        if (v ->> 'rating')::integer <= 2 then
            v_low := v_low || (select name from public.menu_items where id = (v ->> 'menuItemId')::uuid) || ' ' || (v ->> 'rating') || '★ ';
        end if;
    end loop;
    if v_low <> '' then
        perform public.notify(o.tenant_id, 'feedback', 'Low rating on ' || o.order_number || ': ' || trim(v_low),
                              left(coalesce((select string_agg(nullif(x ->> 'comment', ''), ' · ') from jsonb_array_elements(p_ratings) x), ''), 200),
                              '/admin/rewards?tab=feedback', 'reports.view', 'normal');
    end if;
end;
$$;

create function public.feedback_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
begin
    perform public.require_perm('customers.view');
    return jsonb_build_object(
        'dishes', (select coalesce(jsonb_agg(jsonb_build_object('menuItemId', mi.id, 'name', mi.name, 'ratings', n, 'avg', a, 'low', low)
                                             order by a, n desc), '[]'::jsonb)
                     from (select menu_item_id, count(*) n, round(avg(rating), 2) a, count(*) filter (where rating <= 2) low
                             from public.dish_feedback where tenant_id = v_tenant
                              and (created_at at time zone v_tz)::date between p_from and p_to group by menu_item_id) f
                     join public.menu_items mi on mi.id = f.menu_item_id),
        'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'dish', mi.name, 'rating', f.rating, 'comment', f.comment,
                                                                  'hidden', f.is_hidden, 'reply', f.reply, 'repliedBy', f.replied_by,
                                                                  'customer', coalesce(nullif(c.name, ''), 'Guest'), 'orderNumber', o.order_number,
                                                                  'createdAt', f.created_at) order by f.created_at desc), '[]'::jsonb)
                       from public.dish_feedback f join public.menu_items mi on mi.id = f.menu_item_id
                       join public.orders o on o.id = f.order_id left join public.customers c on c.id = f.customer_id
                      where f.tenant_id = v_tenant and (f.comment <> '' or f.rating <= 2)
                        and (f.created_at at time zone v_tz)::date between p_from and p_to));
end;
$$;

create function public.moderate_feedback(p_id uuid, p_reply text, p_hidden boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.edit');
    update public.dish_feedback set reply = coalesce(trim(p_reply), reply), is_hidden = coalesce(p_hidden, is_hidden),
           replied_by = case when coalesce(trim(p_reply), '') <> '' and trim(p_reply) <> reply then public.actor_name() else replied_by end
     where id = p_id and tenant_id = public.current_tenant_id();
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer groups overview (drives the WhatsApp list and group rules)
-- ---------------------------------------------------------------------------
create function public.customer_groups(p_group text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
begin
    perform public.require_perm('customers.view');
    return jsonb_build_object(
        'counts', (select coalesce(jsonb_object_agg(group_code, n), '{}'::jsonb)
                     from (select group_code, count(*) n from public.customers c where c.tenant_id = v_tenant
                              and exists (select 1 from public.orders o where o.customer_id = c.id and o.status = 'paid')
                            group by group_code) g),
        'customers', case when p_group is null then '[]'::jsonb else (
            select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
                        'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end,
                        'canWhatsapp', public.can_see_phone(c.id), 'orders', s.n, 'spend', s.spend, 'lastAt', s.last_at,
                        'points', c.loyalty_points) order by s.spend desc), '[]'::jsonb)
              from public.customers c
              join lateral (select count(*) n, coalesce(sum(total), 0) spend, max(created_at) last_at
                              from public.orders o where o.customer_id = c.id and o.status = 'paid') s on s.n > 0
             where c.tenant_id = v_tenant and c.group_code = p_group) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff incentives
-- ---------------------------------------------------------------------------
create function public.save_incentive_rule(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
    perform public.require_perm('employees.edit');
    if trim(coalesce(p ->> 'name', '')) = '' then raise exception 'Give the incentive a name'; end if;
    if p ->> 'kind' in ('per_item', 'upsell')
       and jsonb_array_length(coalesce(p -> 'itemIds', '[]')) + jsonb_array_length(coalesce(p -> 'categoryIds', '[]')) = 0 then
        raise exception 'Pick the items or categories it pays for';
    end if;
    if p ->> 'kind' = 'pool' and coalesce(nullif(p ->> 'percent', '')::numeric, 0) <= 0 then raise exception 'Enter the pool percent'; end if;
    if p ->> 'kind' <> 'pool' and coalesce(nullif(p ->> 'amount', '')::numeric, 0) <= 0 then raise exception 'Enter the amount'; end if;
    if v_id is null then
        insert into public.incentive_rules (tenant_id, name, kind) values (v_tenant, 'x', p ->> 'kind') returning id into v_id;
    elsif not exists (select 1 from public.incentive_rules where id = v_id and tenant_id = v_tenant) then
        raise exception 'Not found';
    end if;
    update public.incentive_rules set
        name = trim(p ->> 'name'), kind = p ->> 'kind',
        item_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'itemIds') x), '{}'),
        category_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'categoryIds') x), '{}'),
        staff_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'staffIds') x), '{}'),
        amount = coalesce(nullif(p ->> 'amount', '')::numeric, 0),
        threshold = coalesce(nullif(p ->> 'threshold', '')::numeric, 0),
        percent = coalesce(nullif(p ->> 'percent', '')::numeric, 0),
        only_if_target_met = coalesce((p ->> 'onlyIfTargetMet')::boolean, false),
        is_active = coalesce((p ->> 'isActive')::boolean, true)
     where id = v_id;
    return v_id;
end;
$$;

create function public.delete_incentive_rule(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.edit');
    delete from public.incentive_rules where id = p_id and tenant_id = public.current_tenant_id();
end;
$$;

-- Incentives earned per staff login in a period, worked out week by week.
-- Returns [{staffId, name, total, lines: [{ruleId, rule, detail, amount}]}], capped at incentive_cap_pct of gross profit.
create function public.incentive_calc(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone(p_tenant);
    v_today date := public.cafe_today(p_tenant);
    v_tw numeric := coalesce((public.get_setting('profit_target_weekly', '0', p_tenant) #>> '{}')::numeric, 0);
    v_tm numeric := coalesce((public.get_setting('profit_target_monthly', '0', p_tenant) #>> '{}')::numeric, 0);
    v_cap_pct numeric := coalesce((public.get_setting('incentive_cap_pct', '0', p_tenant) #>> '{}')::numeric, 0);
    r public.incentive_rules;
    v_wk date;
    v_s date;
    v_e date;
    v_profit numeric;
    v_ok boolean;
    v_pool numeric;
    v_hours numeric;
    x record;
    v_lines jsonb := '[]';
    v_total numeric;
    v_cap numeric;
    v_scale numeric := 1;
begin
    for r in select * from public.incentive_rules where tenant_id = p_tenant and is_active order by created_at loop
        if r.kind in ('per_item', 'upsell', 'pool') then
            v_wk := p_from - (extract(isodow from p_from)::integer - 1);
            while v_wk <= p_to loop
                v_s := greatest(v_wk, p_from); v_e := least(v_wk + 6, p_to, v_today);
                if v_s <= v_e then
                    v_ok := true;
                    if r.only_if_target_met or r.kind = 'pool' then
                        v_profit := (public.pnl_core(p_tenant, v_wk, least(v_wk + 6, v_today)) ->> 'netProfit')::numeric;
                        v_ok := v_profit >= v_tw;
                    end if;
                    if r.kind = 'pool' and v_ok then
                        v_pool := round(greatest(v_profit - v_tw, 0) * r.percent / 100
                                        * (v_e - v_s + 1) / (least(v_wk + 6, v_today) - v_wk + 1), 2);
                        select coalesce(sum(public.attendance_hours(a)), 0) into v_hours
                          from public.attendance a join public.employees e on e.id = a.employee_id
                         where a.tenant_id = p_tenant and a.date between v_s and v_e and e.staff_id is not null
                           and (cardinality(r.staff_ids) = 0 or e.staff_id = any (r.staff_ids));
                        if v_pool > 0 and v_hours > 0 then
                            for x in select e.staff_id, sum(public.attendance_hours(a)) h
                                       from public.attendance a join public.employees e on e.id = a.employee_id
                                      where a.tenant_id = p_tenant and a.date between v_s and v_e and e.staff_id is not null
                                        and (cardinality(r.staff_ids) = 0 or e.staff_id = any (r.staff_ids))
                                      group by e.staff_id having sum(public.attendance_hours(a)) > 0 loop
                                v_lines := v_lines || jsonb_build_object('staffId', x.staff_id, 'ruleId', r.id, 'rule', r.name,
                                    'detail', 'Week of ' || to_char(v_wk, 'DD Mon') || ': ' || round(x.h, 1) || ' h of ' || round(v_hours, 1)
                                              || ' h × pool ' || public.inr(v_pool),
                                    'amount', round(v_pool * x.h / v_hours, 2));
                            end loop;
                        end if;
                    elsif r.kind in ('per_item', 'upsell') and v_ok then
                        for x in select o.created_by_staff staff_id, sum(oi.quantity) q
                                   from public.order_items oi join public.orders o on o.id = oi.order_id
                                   join public.menu_items mi on mi.id = oi.menu_item_id
                                  where o.tenant_id = p_tenant and o.status = 'paid' and o.created_by_staff is not null
                                    and (o.created_at at time zone v_tz)::date between v_s and v_e
                                    and not oi.is_restricted
                                    and (mi.id = any (r.item_ids) or mi.category_id = any (r.category_ids))
                                    and (cardinality(r.staff_ids) = 0 or o.created_by_staff = any (r.staff_ids))
                                    and (r.kind = 'per_item' or exists (
                                          select 1 from public.order_items o2 join public.menu_items m2 on m2.id = o2.menu_item_id
                                           where o2.order_id = o.id and not (m2.id = any (r.item_ids) or m2.category_id = any (r.category_ids))))
                                  group by o.created_by_staff loop
                            v_lines := v_lines || jsonb_build_object('staffId', x.staff_id, 'ruleId', r.id, 'rule', r.name,
                                'detail', 'Week of ' || to_char(v_wk, 'DD Mon') || ': ' || x.q || ' × ' || public.inr(r.amount),
                                'amount', x.q * r.amount);
                        end loop;
                    end if;
                end if;
                v_wk := v_wk + 7;
            end loop;
        else
            v_ok := true;
            if r.only_if_target_met and v_tm > 0 then
                v_profit := (public.pnl_core(p_tenant, p_from, least(p_to, v_today)) ->> 'netProfit')::numeric;
                v_ok := v_profit >= v_tm * (least(p_to, v_today) - p_from + 1) / 30.0;
            end if;
            if v_ok and r.kind = 'target' then
                for x in select o.created_by_staff staff_id, sum(o.total) - coalesce(sum((select sum(oi.total) from public.order_items oi
                                                                                       where oi.order_id = o.id and oi.is_restricted)), 0) s
                           from public.orders o
                          where o.tenant_id = p_tenant and o.status = 'paid' and o.created_by_staff is not null
                            and (o.created_at at time zone v_tz)::date between p_from and p_to
                            and (cardinality(r.staff_ids) = 0 or o.created_by_staff = any (r.staff_ids))
                          group by o.created_by_staff loop
                    if x.s >= r.threshold then
                        v_lines := v_lines || jsonb_build_object('staffId', x.staff_id, 'ruleId', r.id, 'rule', r.name,
                            'detail', 'Sales ' || public.inr(x.s) || ' ≥ ' || public.inr(r.threshold), 'amount', r.amount);
                    end if;
                end loop;
            elsif v_ok and r.kind = 'rating' then
                for x in select o.created_by_staff staff_id, avg(f.rating) a, count(*) n
                           from public.dish_feedback f join public.orders o on o.id = f.order_id
                          where o.tenant_id = p_tenant and o.created_by_staff is not null
                            and (o.created_at at time zone v_tz)::date between p_from and p_to
                            and (cardinality(r.staff_ids) = 0 or o.created_by_staff = any (r.staff_ids))
                          group by o.created_by_staff having count(*) >= 5 loop
                    if x.a >= r.threshold then
                        v_lines := v_lines || jsonb_build_object('staffId', x.staff_id, 'ruleId', r.id, 'rule', r.name,
                            'detail', 'Average ' || round(x.a, 2) || '★ from ' || x.n || ' ratings', 'amount', r.amount);
                    end if;
                end loop;
            end if;
        end if;
    end loop;

    select coalesce(sum((l ->> 'amount')::numeric), 0) into v_total from jsonb_array_elements(v_lines) l;
    if v_cap_pct > 0 and v_total > 0 then
        v_cap := greatest((public.pnl_core(p_tenant, p_from, least(p_to, v_today)) ->> 'grossProfit')::numeric, 0) * v_cap_pct / 100;
        if v_total > v_cap then v_scale := v_cap / v_total; end if;
    end if;

    return (select coalesce(jsonb_agg(jsonb_build_object('staffId', s.id, 'name', s.name, 'total', t.total, 'lines', t.lines,
                                                         'capped', v_scale < 1) order by t.total desc), '[]'::jsonb)
              from (select (l ->> 'staffId')::uuid sid, round(sum((l ->> 'amount')::numeric) * v_scale, 2) total,
                           jsonb_agg(l - 'staffId' || jsonb_build_object('amount', round((l ->> 'amount')::numeric * v_scale, 2))) lines
                      from jsonb_array_elements(v_lines) l group by 1) t
              join public.staff_users s on s.id = t.sid);
end;
$$;
revoke execute on function public.incentive_calc(uuid, date, date) from public, anon, authenticated;

create function public.incentive_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.view');
    return jsonb_build_object(
        'rules', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'itemIds', to_jsonb(item_ids),
                     'categoryIds', to_jsonb(category_ids), 'staffIds', to_jsonb(staff_ids), 'amount', amount, 'threshold', threshold,
                     'percent', percent, 'onlyIfTargetMet', only_if_target_met, 'isActive', is_active) order by created_at), '[]'::jsonb)
                    from public.incentive_rules where tenant_id = public.current_tenant_id()),
        'capPct', coalesce((public.get_setting('incentive_cap_pct', '0', public.current_tenant_id()) #>> '{}')::numeric, 0),
        'staff', public.incentive_calc(public.current_tenant_id(), p_from, p_to));
end;
$$;

-- A staff member's own incentives (My day): this week and this month, plus what's next
create function public.my_incentives() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_me uuid := public.my_staff_id();
    v_today date := public.cafe_today(public.current_tenant_id());
    v_wk date := v_today - (extract(isodow from v_today)::integer - 1);
    v_mo date := date_trunc('month', v_today)::date;
    v_week jsonb;
    v_month jsonb;
    v_hints jsonb := '[]';
    r public.incentive_rules;
    v_sales numeric;
begin
    if v_me is null then return null; end if;
    select x into v_week from jsonb_array_elements(public.incentive_calc(v_tenant, v_wk, v_today)) x where (x ->> 'staffId')::uuid = v_me;
    select x into v_month from jsonb_array_elements(public.incentive_calc(v_tenant, v_mo, v_today)) x where (x ->> 'staffId')::uuid = v_me;
    for r in select * from public.incentive_rules where tenant_id = v_tenant and is_active
                                                    and (cardinality(staff_ids) = 0 or v_me = any (staff_ids)) loop
        if r.kind = 'target' then
            select coalesce(sum(total), 0) into v_sales from public.orders
             where tenant_id = v_tenant and status = 'paid' and created_by_staff = v_me
               and (created_at at time zone public.cafe_timezone(v_tenant))::date between v_mo and v_today;
            if v_sales < r.threshold then
                v_hints := v_hints || to_jsonb(public.inr(r.threshold - v_sales) || ' more sales this month for a ' || public.inr(r.amount) || ' bonus');
            end if;
        elsif r.kind in ('per_item', 'upsell') then
            v_hints := v_hints || to_jsonb(public.inr(r.amount) || ' for every ' || r.name);
        end if;
    end loop;
    return jsonb_build_object('week', coalesce((v_week ->> 'total')::numeric, 0), 'month', coalesce((v_month ->> 'total')::numeric, 0),
                              'lines', coalesce(v_month -> 'lines', '[]'), 'hints', v_hints);
end;
$$;

-- Payslips include the month's incentives (for employees linked to a staff login)
create function public.payslips_incentives() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_staff uuid;
    v_month date;
    v_amount numeric;
begin
    select staff_id into v_staff from public.employees where id = new.employee_id;
    if v_staff is null or not exists (select 1 from public.incentive_rules where tenant_id = new.tenant_id and is_active) then
        return new;
    end if;
    select month into v_month from public.payroll_runs where id = new.run_id;
    select coalesce((x ->> 'total')::numeric, 0) into v_amount
      from jsonb_array_elements(public.incentive_calc(new.tenant_id, v_month, (v_month + interval '1 month')::date - 1)) x
     where (x ->> 'staffId')::uuid = v_staff;
    if coalesce(v_amount, 0) > 0 then
        new.incentives := v_amount;
        new.gross := new.gross + v_amount;
        new.net := greatest(new.gross - new.deductions, 0);
    end if;
    return new;
end;
$$;
create trigger payslips_incentives before insert on public.payslips
    for each row execute function public.payslips_incentives();

-- Alert kinds: add low dish ratings
create or replace function public.notification_kinds() returns jsonb
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
      {"kind": "feedback", "label": "Low dish rating", "default": "normal", "perm": "reports.view"},
      {"kind": "khata_due", "label": "Khata due", "default": "normal", "perm": "customers.view"},
      {"kind": "gst_due", "label": "GST / bills due", "default": "normal", "perm": "finance.view"},
      {"kind": "subscription", "label": "Subscription due", "default": "normal", "perm": "settings.edit"}
    ]'::jsonb;
$$;

-- Seed: one example rule per cafe, switched off, to show how a rule reads
create function public.seed_phase6(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.reward_rules where tenant_id = p_tenant) then return; end if;
    insert into public.reward_rules (tenant_id, name, is_active, trigger_kind, trigger_value, reward_type, reward_value, per_customer_limit,
                                     per_customer_period, expiry_days, whatsapp_template)
    values (p_tenant, 'Every 10th order: ₹100 off', false, 'nth_order', 10, 'flat_coupon', 100, 0, 'ever', 30,
            'Hi {name}! You just hit a milestone at {cafe} 🎉 Here''s {reward} — use code {code} before {expiry}.'),
           (p_tenant, 'Birthday treat', false, 'birthday', 0, 'flat_coupon', 150, 1, 'year', 7,
            'Happy birthday {name}! 🎂 {cafe} has a gift for you: {reward}, code {code}, valid till {expiry}.');
end;
$$;
select public.seed_phase6(id) from public.tenants;

create function public.tenants_seed_phase6() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.seed_phase6(new.id);
    return null;
end;
$$;
create trigger tenants_seed_phase6 after insert on public.tenants for each row execute function public.tenants_seed_phase6();

-- Groups for existing customers
update public.customers c set group_code = public.customer_group_calc(c.id, public.vip_spend_threshold(c.tenant_id))
 where exists (select 1 from public.orders o where o.customer_id = c.id and o.status = 'paid');

commit;

-- Cafe ERP · Phase 7 (profit advisor, menu matrix, Swiggy/Zomato import) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261011000001_profit_engine.sql ====
-- Phase 7: profit engine (≈18 checks on the cafe's own data, ranked suggestions with ₹ impact, the formula,
-- the inputs and an assumption; actions; outcomes after 4 weeks), menu matrix, Swiggy/Zomato CSV import.
-- Pure arithmetic: no outside AI, same result every time.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
create table public.profit_suggestions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    check_key text not null,
    subject text not null default '',            -- e.g. a menu item id; '' for cafe-wide checks
    area text not null,                          -- menu, inventory, costs, sales, customers, marketing, profit, cash, kiosk
    priority integer not null default 2,         -- 1 = do today
    title text not null,
    detail text not null default '',
    impact numeric(12, 2) not null default 0,    -- ₹ per month
    formula text not null default '',
    inputs jsonb not null default '[]',          -- [{label, value}]
    assumption text not null default '',
    actions jsonb not null default '[]',         -- [{label, link} | {label, kind: 'price', itemId, price}]
    status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'snoozed', 'gone')),
    reason text not null default '',
    snooze_until timestamptz,
    decided_by text not null default '',
    decided_at timestamptz,
    baseline jsonb,
    outcome text not null default '',
    outcome_at timestamptz,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    unique (tenant_id, check_key, subject)
);
create index profit_suggestions_open on public.profit_suggestions (tenant_id, status, priority, impact desc);

create table public.aggregator_item_map (
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    platform text not null,
    external_name text not null,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    primary key (tenant_id, platform, external_name)
);

create table public.aggregator_imports (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    platform text not null,
    file_name text not null default '',
    period_from date,
    period_to date,
    orders integer not null default 0,
    skipped integer not null default 0,
    gross numeric(12, 2) not null default 0,
    commission numeric(12, 2) not null default 0,
    payout numeric(12, 2) not null default 0,
    expense_id uuid references public.expenses (id) on delete set null,
    created_by text not null default '',
    created_at timestamptz not null default now()
);

alter table public.profit_suggestions enable row level security;
alter table public.aggregator_item_map enable row level security;
alter table public.aggregator_imports enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Item sales between two cafe dates (cost from the per-line snapshot)
create function public.item_stats(p_tenant uuid, p_from date, p_to date)
returns table (menu_item_id uuid, name text, units numeric, revenue numeric, cost numeric, unknown bigint)
language sql stable security definer set search_path = public, pg_temp as $$
    select oi.menu_item_id, coalesce(max(m.name), max(oi.name)), sum(oi.quantity)::numeric, sum(oi.net_amount), sum(oi.unit_cost * oi.quantity),
           count(*) filter (where oi.unit_cost = 0)
      from public.order_items oi join public.orders o on o.id = oi.order_id
      left join public.menu_items m on m.id = oi.menu_item_id
     where o.tenant_id = p_tenant and o.status <> 'cancelled' and oi.menu_item_id is not null and not oi.is_restricted
       and (o.created_at at time zone public.cafe_timezone(p_tenant))::date between p_from and p_to
     group by oi.menu_item_id;
$$;

create function public.add_suggestion(p_tenant uuid, p_check text, p_subject text, p_area text, p_priority integer, p_title text,
                                      p_detail text, p_impact numeric, p_formula text, p_inputs jsonb, p_assumption text, p_actions jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into public.profit_suggestions as s (tenant_id, check_key, subject, area, priority, title, detail, impact, formula, inputs,
                                                assumption, actions)
    values (p_tenant, p_check, coalesce(p_subject, ''), p_area, p_priority, p_title, coalesce(p_detail, ''), round(greatest(coalesce(p_impact, 0), 0), 0),
            coalesce(p_formula, ''), coalesce(p_inputs, '[]'), coalesce(p_assumption, ''), coalesce(p_actions, '[]'))
    on conflict (tenant_id, check_key, subject) do update set
        area = excluded.area, priority = excluded.priority, title = excluded.title, detail = excluded.detail, impact = excluded.impact,
        formula = excluded.formula, inputs = excluded.inputs, assumption = excluded.assumption, actions = excluded.actions,
        last_seen = now(),
        status = case when s.status = 'gone' then 'open'
                      when s.status = 'snoozed' and s.snooze_until <= now() then 'open'
                      else s.status end,
        first_seen = case when s.status = 'gone' then now() else s.first_seen end;
end;
$$;
revoke execute on function public.add_suggestion(uuid, text, text, text, integer, text, text, numeric, text, jsonb, text, jsonb)
    from public, anon, authenticated;

create function public.rs(p numeric) returns text
language sql immutable as $$
    select '₹' || to_char(round(coalesce(p, 0)), 'FM99,99,99,999');
$$;

-- ---------------------------------------------------------------------------
-- Menu matrix (Kasavana & Smith): popularity × contribution per unit vs the menu's averages
-- ---------------------------------------------------------------------------
create function public.menu_matrix_core(p_tenant uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with s as (select * from public.item_stats(p_tenant, p_from, p_to) where units > 0 and unknown = 0),
         t as (select count(*) n, sum(units) units, sum(revenue - cost) cm from s)
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'menuItemId', s.menu_item_id, 'name', s.name, 'units', s.units, 'revenue', round(s.revenue, 2),
                    'cmPerUnit', round((s.revenue - s.cost) / s.units, 2), 'contribution', round(s.revenue - s.cost, 2),
                    'mixPct', round(s.units * 100 / t.units, 1),
                    'class', case when s.units >= t.units / t.n * 0.7 then
                                       case when (s.revenue - s.cost) / s.units >= t.cm / t.units then 'star' else 'plowhorse' end
                                  else case when (s.revenue - s.cost) / s.units >= t.cm / t.units then 'puzzle' else 'dog' end end)
                    order by s.revenue - s.cost desc) from s, t), '[]'::jsonb),
        'popularityThreshold', (select round(units / nullif(n, 0) * 0.7, 1) from t),
        'avgCmPerUnit', (select round(cm / nullif(units, 0), 2) from t),
        'withoutCost', (select count(*) from public.item_stats(p_tenant, p_from, p_to) where unknown > 0));
$$;

create function public.menu_matrix(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('reports.view');
    if not public.has_perm('sensitive.see_profit') then raise exception 'Not authorized (sensitive.see_profit)'; end if;
    return public.menu_matrix_core(public.current_tenant_id(), p_from, p_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- The checks
-- ---------------------------------------------------------------------------
create function public.run_profit_checks() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_today date := public.cafe_today(public.current_tenant_id());
    v_from date := public.cafe_today(public.current_tenant_id()) - 29;
    v_pfrom date := public.cafe_today(public.current_tenant_id()) - 59;
    v_pto date := public.cafe_today(public.current_tenant_id()) - 30;
    v_run timestamptz := now();
    v_target_fc numeric := coalesce((public.get_setting('target_food_cost_pct', '32', public.current_tenant_id()) #>> '{}')::numeric, 32);
    v_gst numeric := coalesce((public.get_setting('gst_rate', '5', public.current_tenant_id()) #>> '{}')::numeric, 5);
    v_pnl jsonb;
    v_gm numeric;            -- gross margin share of net sales (0..1)
    v_avg_bill numeric;
    v_matrix jsonb;
    v_avg_cm numeric;
    x record;
    y record;
    v_n integer;
    v_val numeric;
    v_val2 numeric;
    v_text text;
    v_delta numeric;
    v_price numeric;
    v_count integer;
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then raise exception 'Not authorized (sensitive.see_profit)'; end if;

    v_pnl := public.pnl_core(v_t, v_from, v_today);
    v_gm := coalesce((v_pnl ->> 'grossProfit')::numeric / nullif((v_pnl ->> 'netSales')::numeric, 0), 0.6);
    select coalesce(avg(total), 0) into v_avg_bill from public.orders
     where tenant_id = v_t and status = 'paid' and (created_at at time zone v_tz)::date between v_from and v_today;

    -- 1. Menu matrix
    v_matrix := public.menu_matrix_core(v_t, v_from, v_today);
    v_avg_cm := (v_matrix ->> 'avgCmPerUnit')::numeric;
    for x in select (i ->> 'menuItemId')::uuid id, i ->> 'name' name, (i ->> 'units')::numeric units, (i ->> 'cmPerUnit')::numeric cm,
                    i ->> 'class' cls, m.price
               from jsonb_array_elements(v_matrix -> 'items') i join public.menu_items m on m.id = (i ->> 'menuItemId')::uuid
              where (i ->> 'units')::numeric >= 5 loop
        if x.cls = 'plowhorse' then
            v_delta := greatest(5, ceil(x.price * 0.05 / 5) * 5);
            v_val := x.units * 0.95 * (x.cm + v_delta / (1 + v_gst / 100)) - x.units * x.cm;
            perform public.add_suggestion(v_t, 'matrix', x.id::text, 'menu', 2,
                'Raise ' || x.name || ' from ' || public.rs(x.price) || ' to ' || public.rs(x.price + v_delta),
                'Popular (' || x.units || ' sold in 30 days) but earns ' || public.rs(x.cm) || ' per unit vs the menu average of '
                    || public.rs(v_avg_cm) || ' — a Plowhorse in the menu matrix. Or cut its recipe cost.',
                v_val, 'units × 95% × (profit per unit + rise without GST) − units × profit per unit',
                jsonb_build_array(jsonb_build_object('label', 'Sold (30 days)', 'value', x.units),
                                  jsonb_build_object('label', 'Profit per unit', 'value', public.rs(x.cm)),
                                  jsonb_build_object('label', 'Menu average per unit', 'value', public.rs(v_avg_cm)),
                                  jsonb_build_object('label', 'Price rise', 'value', public.rs(v_delta))),
                'Sales drop at most 5% after the rise.',
                jsonb_build_array(jsonb_build_object('label', 'Change price to ' || public.rs(x.price + v_delta), 'kind', 'price', 'itemId', x.id, 'price', x.price + v_delta),
                                  jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name)));
        elsif x.cls = 'puzzle' then
            perform public.add_suggestion(v_t, 'matrix', x.id::text, 'menu', 2,
                'Promote ' || x.name,
                'Earns ' || public.rs(x.cm) || ' per unit (above the ' || public.rs(v_avg_cm) || ' average) but sells only ' || x.units
                    || ' a month — a Puzzle. Put it on the homepage, suggest it at the counter, or add it to a combo.',
                x.units * 0.2 * x.cm, 'units × 20% more × profit per unit',
                jsonb_build_array(jsonb_build_object('label', 'Sold (30 days)', 'value', x.units),
                                  jsonb_build_object('label', 'Profit per unit', 'value', public.rs(x.cm))),
                'Promotion lifts its sales by 20%.',
                jsonb_build_array(jsonb_build_object('label', 'Homepage sections', 'link', '/admin/collections'),
                                  jsonb_build_object('label', 'Open in menu', 'link', '/admin/menu?q=' || x.name)));
        elsif x.cls = 'dog' then
            perform public.add_suggestion(v_t, 'matrix', x.id::text, 'menu', 3,
                'Rework or remove ' || x.name,
                'Sells little (' || x.units || ' a month) and earns little (' || public.rs(x.cm) || ' per unit) — a Dog. Fix the recipe and price, or drop it to simplify the kitchen.',
                x.units * greatest(v_avg_cm - x.cm, 0), 'units × (menu average profit per unit − its profit per unit)',
                jsonb_build_array(jsonb_build_object('label', 'Sold (30 days)', 'value', x.units),
                                  jsonb_build_object('label', 'Profit per unit', 'value', public.rs(x.cm)),
                                  jsonb_build_object('label', 'Menu average per unit', 'value', public.rs(v_avg_cm))),
                'Customers who bought it buy an average item instead.',
                jsonb_build_array(jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name),
                                  jsonb_build_object('label', 'Open in menu', 'link', '/admin/menu?q=' || x.name)));
        end if;
    end loop;

    -- 2. Food cost % above target
    for x in select s.menu_item_id id, s.name, s.units, s.revenue, s.cost from public.item_stats(v_t, v_from, v_today) s
              where s.unknown = 0 and s.units >= 5 and s.revenue > 0 and s.cost / s.revenue * 100 > v_target_fc + 2 loop
        perform public.add_suggestion(v_t, 'food_cost', x.id::text, 'menu', 2,
            x.name || ' food cost ' || round(x.cost / x.revenue * 100) || '% vs ' || round(v_target_fc) || '% target',
            'Ingredients take too big a share of its price. Check portion sizes and ingredient prices, or raise the price.',
            (x.cost / x.revenue - v_target_fc / 100) * x.revenue, '(food cost % − target %) × sales of the dish (30 days)',
            jsonb_build_array(jsonb_build_object('label', 'Sales (30 days, without GST)', 'value', public.rs(x.revenue)),
                              jsonb_build_object('label', 'Ingredient cost', 'value', public.rs(x.cost)),
                              jsonb_build_object('label', 'Target', 'value', round(v_target_fc) || '% (Settings key target_food_cost_pct)')),
            'Bringing it to the target keeps the same sales.',
            jsonb_build_array(jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name)));
    end loop;

    -- 3. Low rated and falling
    for x in select f.menu_item_id id, m.name, round(avg(f.rating), 1) a, count(*) n,
                    (select coalesce(sum(units), 0) from public.item_stats(v_t, v_from, v_today) s where s.menu_item_id = f.menu_item_id) u_now,
                    (select coalesce(sum(units), 0) from public.item_stats(v_t, v_pfrom, v_pto) s where s.menu_item_id = f.menu_item_id) u_prev,
                    (select coalesce(sum(revenue - cost), 0) from public.item_stats(v_t, v_from, v_today) s where s.menu_item_id = f.menu_item_id) cm
               from public.dish_feedback f join public.menu_items m on m.id = f.menu_item_id
              where f.tenant_id = v_t and (f.created_at at time zone v_tz)::date between v_from and v_today
              group by f.menu_item_id, m.name having count(*) >= 3 and avg(f.rating) < 3.5 loop
        perform public.add_suggestion(v_t, 'low_rated', x.id::text, 'menu', 2,
            x.name || ' rated ' || x.a || '★' || case when x.u_prev > 0 and x.u_now < x.u_prev
                then ', sales ' || round((x.u_now - x.u_prev) * 100.0 / x.u_prev) || '%' else '' end || ': fix the recipe',
            'Customers rate it low (' || x.n || ' ratings). Read the comments in Rewards → Feedback.',
            greatest(x.cm * 0.2, (x.u_prev - x.u_now) * x.cm / nullif(x.u_now, 0)),
            'profit from the dish (30 days) × 20% at risk, or the profit already lost to falling sales',
            jsonb_build_array(jsonb_build_object('label', 'Average rating', 'value', x.a),
                              jsonb_build_object('label', 'Sold (30 days / previous 30)', 'value', x.u_now || ' / ' || x.u_prev)),
            'Unhappy customers order it less over time.',
            jsonb_build_array(jsonb_build_object('label', 'Read feedback', 'link', '/admin/rewards?tab=feedback'),
                              jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name)));
    end loop;

    -- 4–6. Inventory (needs inventory access)
    if public.has_perm('inventory.view') then
        -- 4. Reorder today
        select count(*), string_agg((s ->> 'name') || ' ' || round((s ->> 'suggestedQty')::numeric, 1) || ' ' || (s ->> 'unit'), ', ')
          into v_count, v_text
          from (select s from jsonb_array_elements(public.stock_overview(null)) s where (s ->> 'reorder')::boolean
                 order by coalesce((s ->> 'daysLeft')::numeric, 0) limit 6) z;
        if v_count > 0 then
            perform public.add_suggestion(v_t, 'reorder', '', 'inventory', 1, 'Order ' || v_count || ' item' || case when v_count > 1 then 's' else '' end || ' today',
                v_text || '. Days of stock left are below the vendor''s lead time.', 0,
                'days left = stock ÷ daily use (last 14 days); reorder when days left ≤ lead time',
                '[]', 'Use stays like the last 2 weeks.',
                jsonb_build_array(jsonb_build_object('label', 'Reorder list', 'link', '/admin/inventory')));
        end if;
        -- 5. Dead / slow stock
        select count(*), coalesce(sum(i.current_stock * i.cost_per_unit), 0), string_agg(i.name, ', ')
          into v_count, v_val, v_text
          from public.inventory i
         where i.tenant_id = v_t and i.track_stock and i.current_stock > 0 and i.cost_per_unit > 0
           and i.created_at < now() - interval '21 days'
           and not exists (select 1 from public.stock_moves m where m.item_id = i.id and m.quantity < 0 and m.created_at > now() - interval '21 days');
        if v_count > 0 and v_val >= 500 then
            perform public.add_suggestion(v_t, 'dead_stock', '', 'inventory', 3,
                public.rs(v_val) || ' stuck in ' || v_count || ' slow item' || case when v_count > 1 then 's' else '' end,
                v_text || ' — nothing used in 21 days. Run a combo, use them up, or stop buying.', v_val * 0.2,
                'stock value × 20% a month', jsonb_build_array(jsonb_build_object('label', 'Value in stock', 'value', public.rs(v_val))),
                'About a fifth spoils, expires or ties up cash each month.',
                jsonb_build_array(jsonb_build_object('label', 'Stock', 'link', '/admin/inventory')));
        end if;
        -- 6. Leaks (counts short + wastage)
        for x in select (l ->> 'itemId') id, l ->> 'item' name, -(l ->> 'lostValue')::numeric lost
                   from jsonb_array_elements(public.stock_leaks(7)) l where (l ->> 'lostValue')::numeric < -200 limit 5 loop
            perform public.add_suggestion(v_t, 'leak', x.id, 'inventory', 2,
                x.name || ': ' || public.rs(x.lost) || ' lost this week',
                'Count shortfall plus wastage. Check portions against the recipe, storage and who handles it.',
                x.lost * 4.3, 'lost this week × 4.3 weeks',
                jsonb_build_array(jsonb_build_object('label', 'Lost in 7 days', 'value', public.rs(x.lost))),
                'The leak continues at this week''s rate.',
                jsonb_build_array(jsonb_build_object('label', 'Counts & leaks', 'link', '/admin/inventory?tab=counts')));
        end loop;
        -- 7. Vendor price creep
        for x in select pl.item_id id, i.name, i.unit,
                        avg(pl.base_cost) filter (where p.bill_date > v_today - 30) now_cost,
                        avg(pl.base_cost) filter (where p.bill_date between v_today - 90 and v_today - 31) old_cost,
                        sum(pl.base_quantity) filter (where p.bill_date > v_today - 30) qty
                   from public.purchase_lines pl join public.purchases p on p.id = pl.purchase_id join public.inventory i on i.id = pl.item_id
                  where p.tenant_id = v_t and not p.is_void and p.bill_date > v_today - 90
                  group by pl.item_id, i.name, i.unit loop
            if x.old_cost > 0 and x.now_cost > x.old_cost * 1.10 then
                perform public.add_suggestion(v_t, 'price_creep', x.id::text, 'inventory', 2,
                    x.name || ' up ' || round((x.now_cost / x.old_cost - 1) * 100) || '% in 60 days: compare vendors',
                    'You now pay ' || public.rs(x.now_cost * case when x.unit in ('g', 'ml') then 1000 else 1 end) || case when x.unit = 'g' then '/kg' when x.unit = 'ml' then '/L' else '/' || x.unit end
                        || ' vs ' || public.rs(x.old_cost * case when x.unit in ('g', 'ml') then 1000 else 1 end) || ' before.',
                    (x.now_cost - x.old_cost) * x.qty, '(price now − price 1–3 months ago) × quantity bought in the last 30 days',
                    jsonb_build_array(jsonb_build_object('label', 'Bought (30 days)', 'value', round(x.qty, 1) || ' ' || x.unit)),
                    'You keep buying the same quantity.',
                    jsonb_build_array(jsonb_build_object('label', 'Purchases', 'link', '/admin/inventory?tab=purchases'),
                                      jsonb_build_object('label', 'Vendors', 'link', '/admin/inventory?tab=vendors')));
            end if;
        end loop;
    end if;

    -- 8. Expense category above its 3-month average
    for x in select c.id, c.name,
                    coalesce(sum(e.amount) filter (where e.expense_date between v_from and v_today), 0) cur,
                    coalesce(sum(e.amount) filter (where e.expense_date between v_from - 90 and v_from - 1), 0) / 3 avg3
               from public.expense_categories c join public.expenses e on e.category_id = c.id and not e.is_void
              where c.tenant_id = v_t and c.name not in ('Salaries', 'Aggregator commission') and coalesce(e.spread_months, 1) <= 1
              group by c.id, c.name loop
        if x.avg3 > 0 and x.cur > x.avg3 * 1.25 and x.cur - x.avg3 >= 500 then
            perform public.add_suggestion(v_t, 'expense_up', x.id::text, 'costs', 2,
                x.name || ' +' || round((x.cur / x.avg3 - 1) * 100) || '% vs its average',
                public.rs(x.cur) || ' in the last 30 days vs ' || public.rs(x.avg3) || ' a month on average before. Check the bill and usage.',
                x.cur - x.avg3, 'last 30 days − average of the 3 months before',
                jsonb_build_array(jsonb_build_object('label', 'Last 30 days', 'value', public.rs(x.cur)),
                                  jsonb_build_object('label', '3-month average', 'value', public.rs(x.avg3))),
                'The extra is avoidable, not a new normal.',
                jsonb_build_array(jsonb_build_object('label', 'Expenses', 'link', '/admin/finance?tab=expenses')));
        end if;
    end loop;

    -- 9. Staff cost share of sales
    if (v_pnl ->> 'netSales')::numeric > 0 and (v_pnl ->> 'staffCost')::numeric / (v_pnl ->> 'netSales')::numeric > 0.35 then
        v_val := (v_pnl ->> 'staffCost')::numeric / (v_pnl ->> 'netSales')::numeric * 100;
        perform public.add_suggestion(v_t, 'staff_cost', '', 'costs', 2,
            'Staff cost is ' || round(v_val) || '% of sales',
            'Above the 35% cafes usually aim for. Look at shifts in slow hours (see the weak-hours suggestion) or push sales in them.',
            (v_val - 35) / 100 * (v_pnl ->> 'netSales')::numeric, '(staff cost % − 35%) × net sales (30 days)',
            jsonb_build_array(jsonb_build_object('label', 'Staff cost (30 days)', 'value', public.rs((v_pnl ->> 'staffCost')::numeric)),
                              jsonb_build_object('label', 'Net sales (30 days)', 'value', public.rs((v_pnl ->> 'netSales')::numeric))),
            '35% is a common ceiling for cafes.', jsonb_build_array(jsonb_build_object('label', 'Attendance', 'link', '/admin/attendance')));
    end if;

    -- 10. Weak hours: the 3-hour block with the smallest share of sales (over hours that have sales)
    select h, share, sales into y from (
        select hh.h, sum(b.sales) over w3 / nullif(sum(b.sales) over (), 0) * 100 share, sum(b.sales) over w3 sales, count(*) over w3 n
          from (select distinct extract(hour from created_at at time zone v_tz)::integer h from public.orders
                 where tenant_id = v_t and status = 'paid' and created_at > now() - interval '28 days') hh
          join lateral (select coalesce(sum(o.total), 0) sales from public.orders o where o.tenant_id = v_t and o.status = 'paid'
                          and o.created_at > now() - interval '28 days' and extract(hour from o.created_at at time zone v_tz)::integer = hh.h) b on true
        window w3 as (order by hh.h rows between current row and 2 following)) z
     where n = 3 order by share limit 1;
    if y.share is not null and y.share < 10 and (select count(*) from public.orders where tenant_id = v_t and status = 'paid' and created_at > now() - interval '28 days') >= 30 then
        perform public.add_suggestion(v_t, 'weak_hours', '', 'sales', 3,
            to_char(make_time(y.h, 0, 0), 'FMHH12 am') || '–' || to_char(make_time((y.h + 3) % 24, 0, 0), 'FMHH12 am') || ' is ' || round(y.share) || '% of sales: try a combo',
            'Your slowest 3 hours. A time-bound combo (e.g. tea + snack) or a happy-hour price can fill them; staff fewer people then.',
            y.sales / 28 * 30 * 0.2 * v_gm, 'sales in those hours (a month) × 20% lift × gross margin',
            jsonb_build_array(jsonb_build_object('label', 'Sales in the block (28 days)', 'value', public.rs(y.sales)),
                              jsonb_build_object('label', 'Gross margin', 'value', round(v_gm * 100) || '%')),
            'A combo lifts those hours by 20%.', jsonb_build_array(jsonb_build_object('label', 'Coupons', 'link', '/admin/coupons')));
    end if;

    -- 11. Average bill falling
    select avg(total) filter (where created_at > now() - interval '28 days'), avg(total) filter (where created_at <= now() - interval '28 days'),
           count(*) filter (where created_at > now() - interval '28 days')
      into v_val, v_val2, v_n
      from public.orders where tenant_id = v_t and status = 'paid' and created_at > now() - interval '56 days';
    if v_n >= 20 and v_val2 > 0 and v_val < v_val2 * 0.95 then
        perform public.add_suggestion(v_t, 'avg_bill', '', 'sales', 2,
            'Average bill ' || public.rs(v_val2) || ' → ' || public.rs(v_val) || ' in 4 weeks: push add-ons',
            'Suggest a dessert, a drink upgrade or a combo at the counter; show add-ons in the menu.',
            (v_val2 - v_val) * v_n / 28 * 30 * v_gm, '(previous average − current average) × orders a month × gross margin',
            jsonb_build_array(jsonb_build_object('label', 'Orders (28 days)', 'value', v_n)),
            'Half the drop can be won back with add-ons; the figure shows the full gap.', '[]');
    end if;

    -- 12. Slipping regulars
    select count(*) into v_n from public.customers c where c.tenant_id = v_t and c.group_code = 'slipping'
       and (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'paid') >= 3;
    if v_n >= 3 then
        perform public.add_suggestion(v_t, 'slipping', '', 'customers', 2,
            v_n || ' regulars haven''t visited lately: send a win-back',
            'They used to come often and are now late by twice their usual gap. Message them from Rewards → Groups → Slipping, or add a rule "moves into Slipping → 20% off".',
            v_n * 0.3 * v_avg_bill * v_gm * 2, 'regulars × 30% come back × average bill × gross margin × 2 visits',
            jsonb_build_array(jsonb_build_object('label', 'Average bill', 'value', public.rs(v_avg_bill))),
            '30% return after a message and visit twice in the month.',
            jsonb_build_array(jsonb_build_object('label', 'Slipping customers', 'link', '/admin/rewards?tab=groups')));
    end if;

    -- 13. New customers not returning
    select count(*), count(*) filter (where n >= 2) into v_n, v_count from (
        select c.id, (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'paid') n
          from public.customers c where c.tenant_id = v_t
           and (select min(created_at) from public.orders o where o.customer_id = c.id and o.status = 'paid')
               between now() - interval '60 days' and now() - interval '30 days') z;
    if v_n >= 5 and v_count::numeric / v_n < 0.3 then
        perform public.add_suggestion(v_t, 'new_return', '', 'customers', 2,
            'Only ' || round(v_count * 100.0 / v_n) || '% of new customers come back: add a first-return offer',
            'A reward rule "First order → ₹X off the next visit" (coupon valid 14 days) turns first-timers into regulars.',
            v_n * (0.3 - v_count::numeric / v_n) * v_avg_bill * v_gm, 'new customers a month × (30% − return rate) × average bill × gross margin',
            jsonb_build_array(jsonb_build_object('label', 'New customers (30–60 days ago)', 'value', v_n),
                              jsonb_build_object('label', 'Came back', 'value', v_count)),
            'An offer lifts the return rate to 30%.', jsonb_build_array(jsonb_build_object('label', 'Reward rules', 'link', '/admin/rewards')));
    end if;

    -- 14. Reward ROI (last 60 days)
    for x in select r.id, r.name, sum(g.cost) cost,
                    coalesce((select sum(o.total) from public.orders o
                               where o.status = 'paid' and exists (select 1 from public.reward_grants g2 where g2.rule_id = r.id
                                                                     and g2.customer_id = o.customer_id and o.created_at between g2.created_at and g2.created_at + interval '14 days')), 0) after_sales
               from public.reward_rules r join public.reward_grants g on g.rule_id = r.id
              where r.tenant_id = v_t and g.created_at > now() - interval '60 days'
              group by r.id, r.name having sum(g.cost) >= 300 loop
        if x.after_sales * v_gm < x.cost then
            perform public.add_suggestion(v_t, 'reward_roi', x.id::text, 'marketing', 2,
                'Reward "' || x.name || '" cost ' || public.rs(x.cost) || ' and brought ' || public.rs(x.after_sales * v_gm) || ' profit: lower it',
                'Rewarded customers'' orders in the 14 days after the reward didn''t cover its cost. Lower the reward, raise the trigger, or add a budget.',
                (x.cost - x.after_sales * v_gm) / 2, '(reward cost − gross profit of rewarded customers'' next-14-day orders) ÷ 2 months',
                jsonb_build_array(jsonb_build_object('label', 'Reward cost (60 days)', 'value', public.rs(x.cost)),
                                  jsonb_build_object('label', 'Their sales in the 14 days after', 'value', public.rs(x.after_sales))),
                'Those orders would partly have happened anyway, so this is generous to the reward.',
                jsonb_build_array(jsonb_build_object('label', 'Edit rule', 'link', '/admin/rewards')));
        end if;
    end loop;

    -- 15. Rewards over budget (% of gross profit this month)
    select coalesce(sum(cost), 0) into v_val from public.reward_grants
     where tenant_id = v_t and created_at >= (date_trunc('month', v_today)::timestamp at time zone v_tz);
    v_val2 := greatest((public.pnl_core(v_t, date_trunc('month', v_today)::date, v_today) ->> 'grossProfit')::numeric, 0)
              * coalesce((public.get_setting('reward_budget_pct', '5', v_t) #>> '{}')::numeric, 5) / 100;
    if v_val > 0 and v_val > v_val2 then
        perform public.add_suggestion(v_t, 'reward_budget', '', 'marketing', 2,
            'Rewards cost ' || public.rs(v_val) || ' this month, over the ' || public.rs(v_val2) || ' budget',
            'Rewards are capped at a share of gross profit (Settings key reward_budget_pct). Add monthly budgets to the biggest rules.',
            v_val - v_val2, 'reward cost this month − budget % × gross profit this month', '[]', '', jsonb_build_array(jsonb_build_object('label', 'Reward rules', 'link', '/admin/rewards')));
    end if;

    -- 16. Shift mismatches by person
    for x in select closed_by, count(*) n, sum(abs(difference)) filter (where difference < 0) short
               from public.shifts where tenant_id = v_t and status = 'closed' and closed_at > now() - interval '30 days'
                and abs(coalesce(difference, 0)) > coalesce((public.get_setting('shift_tolerance', '50', v_t) #>> '{}')::numeric, 50)
              group by closed_by having count(*) >= 3 loop
        perform public.add_suggestion(v_t, 'shift_mismatch', x.closed_by, 'cash', 1,
            x.n || ' cash mismatches at shift close by ' || x.closed_by || ' this month',
            'Count the drawer together at the next close and check payouts are recorded.',
            coalesce(x.short, 0), 'total shortages in 30 days', jsonb_build_array(jsonb_build_object('label', 'Mismatched closes', 'value', x.n)),
            'Shortages continue at this rate.', jsonb_build_array(jsonb_build_object('label', 'Cash & shifts', 'link', '/admin/shifts')));
    end loop;

    -- 17. Kiosk: pack vs loose margin
    for x in select m.id, m.name, m.price loose, u.factor, u.sale_price pack,
                    (select coalesce(sum(oi.quantity), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                      where oi.menu_item_id = m.id and oi.unit_name = u.name and o.status <> 'cancelled' and o.created_at > now() - interval '30 days') packs
               from public.item_units u join public.menu_items m on m.id = u.menu_item_id
              where m.tenant_id = v_t and u.sale_price is not null and u.factor > 1 and m.price > u.sale_price / u.factor * 1.02 loop
        if x.packs > 0 then
            perform public.add_suggestion(v_t, 'pack_loose', x.id::text, 'kiosk', 3,
                'Loose ' || x.name || ' earns ' || public.rs(x.loose - x.pack / x.factor) || '/piece more than packs: keep loose stock up',
                'A ' || x.factor::integer || '-pack sells for ' || public.rs(x.pack) || ' (' || to_char(x.pack / x.factor, 'FM990.00') || ' a piece) vs ' || public.rs(x.loose) || ' loose.',
                (x.loose - x.pack / x.factor) * x.factor * x.packs * 0.3, 'difference per piece × pieces in packs sold × 30% who would buy loose',
                jsonb_build_array(jsonb_build_object('label', 'Packs sold (30 days)', 'value', x.packs)),
                '30% of pack buyers would buy loose if it''s in stock.', jsonb_build_array(jsonb_build_object('label', 'Kiosk', 'link', '/admin/kiosk')));
        end if;
    end loop;

    -- Retire suggestions that no longer apply
    update public.profit_suggestions set status = 'gone'
     where tenant_id = v_t and status in ('open', 'snoozed') and last_seen < v_run and check_key <> 'forecast';

    -- 18. Forecast vs target, with the 3 biggest open actions
    v_val := coalesce((public.get_setting('profit_target_monthly', '0', v_t) #>> '{}')::numeric, 0);
    if v_val > 0 then
        v_pnl := public.pnl_core(v_t, date_trunc('month', v_today)::date, v_today);
        v_val2 := (v_pnl ->> 'netProfit')::numeric
                  * ((date_trunc('month', v_today) + interval '1 month')::date - date_trunc('month', v_today)::date)
                  / (v_today - date_trunc('month', v_today)::date + 1);
        if v_val2 < v_val then
            select string_agg(title || ' (+' || public.rs(impact) || ')', '; ' order by impact desc) into v_text
              from (select title, impact from public.profit_suggestions where tenant_id = v_t and status = 'open' and impact > 0
                     order by impact desc limit 3) z;
            perform public.add_suggestion(v_t, 'forecast', '', 'profit', 1,
                'On track for ' || public.rs(v_val2) || ' vs ' || public.rs(v_val) || ' target this month',
                coalesce('Biggest actions: ' || v_text || '.', 'Add more data (recipes, expenses) for specific actions.'),
                v_val - v_val2, 'target − (profit so far ÷ days gone × days in month)',
                jsonb_build_array(jsonb_build_object('label', 'Profit so far', 'value', public.rs((v_pnl ->> 'netProfit')::numeric)),
                                  jsonb_build_object('label', 'Monthly target', 'value', public.rs(v_val))),
                'The rest of the month goes like the days so far.', jsonb_build_array(jsonb_build_object('label', 'Profit & loss', 'link', '/admin/reports')));
        else
            update public.profit_suggestions set status = 'gone' where tenant_id = v_t and check_key = 'forecast' and status = 'open';
        end if;
    end if;

    perform public.evaluate_suggestion_outcomes(v_t);
    insert into public.settings (tenant_id, key, value, description) values (v_t, 'profit_check_at', to_jsonb(now()), 'Last profit engine run')
    on conflict (tenant_id, key) do update set value = excluded.value;
    return jsonb_build_object('open', (select count(*) from public.profit_suggestions where tenant_id = v_t and status = 'open'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Decisions and outcomes
-- ---------------------------------------------------------------------------
-- What we measure before and 4 weeks after: the dish's units and profit a day, or the cafe's net sales and gross profit a day
create function public.suggestion_metric(p_tenant uuid, p_subject text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_days numeric := p_to - p_from + 1;
    v_pnl jsonb;
    v_item uuid;
begin
    begin
        v_item := nullif(p_subject, '')::uuid;
    exception when others then
        v_item := null;
    end;
    if v_item is not null and exists (select 1 from public.menu_items where id = v_item) then
        return (select jsonb_build_object('kind', 'item', 'units', round(coalesce(sum(units), 0) / v_days, 2),
                                          'profit', round(coalesce(sum(revenue - cost), 0) / v_days, 2),
                                          'price', (select price from public.menu_items where id = v_item))
                  from public.item_stats(p_tenant, p_from, p_to) where menu_item_id = v_item);
    end if;
    v_pnl := public.pnl_core(p_tenant, p_from, p_to);
    return jsonb_build_object('kind', 'cafe', 'sales', round((v_pnl ->> 'netSales')::numeric / v_days, 2),
                              'profit', round((v_pnl ->> 'grossProfit')::numeric / v_days, 2));
end;
$$;

create function public.evaluate_suggestion_outcomes(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.profit_suggestions;
    v_d date;
    a jsonb;
    b jsonb;
    v_units text;
    v_profit numeric;
begin
    for s in select * from public.profit_suggestions where tenant_id = p_tenant and status in ('accepted', 'dismissed')
                and outcome = '' and decided_at < now() - interval '28 days' and baseline is not null loop
        v_d := (s.decided_at at time zone public.cafe_timezone(p_tenant))::date;
        a := s.baseline;
        b := public.suggestion_metric(p_tenant, s.subject, v_d + 1, v_d + 28);
        v_profit := ((b ->> 'profit')::numeric - (a ->> 'profit')::numeric) * 30;
        if b ->> 'kind' = 'item' then
            v_units := case when (a ->> 'units')::numeric > 0
                            then 'sales ' || to_char(((b ->> 'units')::numeric / (a ->> 'units')::numeric - 1) * 100, 'FMSG990') || '%' else 'sales n/a' end;
        else
            v_units := case when (a ->> 'sales')::numeric > 0
                            then 'cafe sales ' || to_char(((b ->> 'sales')::numeric / (a ->> 'sales')::numeric - 1) * 100, 'FMSG990') || '%' else 'sales n/a' end;
        end if;
        update public.profit_suggestions set
            outcome = case when s.status = 'accepted' then 'Done' else 'Dismissed' end || '; 4 weeks later: ' || v_units
                      || ', profit ' || case when v_profit >= 0 then '+' else '−' end || public.rs(abs(v_profit)) || '/month',
            outcome_at = now()
         where id = s.id;
    end loop;
end;
$$;
revoke execute on function public.evaluate_suggestion_outcomes(uuid) from public, anon, authenticated;

create function public.decide_suggestion(p_id uuid, p_decision text, p_reason text default '', p_days integer default 14) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.profit_suggestions;
    v_today date := public.cafe_today(public.current_tenant_id());
begin
    perform public.require_perm('finance.view');
    select * into s from public.profit_suggestions where id = p_id and tenant_id = public.current_tenant_id();
    if s.id is null then raise exception 'Not found'; end if;
    if p_decision not in ('accepted', 'dismissed', 'snoozed', 'open') then raise exception 'Bad decision'; end if;
    if p_decision = 'dismissed' and trim(coalesce(p_reason, '')) = '' then raise exception 'Say why (it helps judge the advice later)'; end if;
    update public.profit_suggestions set status = p_decision, reason = trim(coalesce(p_reason, '')),
           snooze_until = case when p_decision = 'snoozed' then now() + make_interval(days => greatest(coalesce(p_days, 14), 1)) end,
           decided_by = public.actor_name(), decided_at = now(),
           baseline = case when p_decision in ('accepted', 'dismissed') then public.suggestion_metric(s.tenant_id, s.subject, v_today - 27, v_today) else baseline end,
           outcome = '', outcome_at = null
     where id = s.id;
end;
$$;

-- "Change price" straight from a suggestion
create function public.apply_suggestion_price(p_id uuid, p_price numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.profit_suggestions;
    v_item uuid;
begin
    perform public.require_perm('menu.edit');
    select * into s from public.profit_suggestions where id = p_id and tenant_id = public.current_tenant_id();
    if s.id is null then raise exception 'Not found'; end if;
    select (a ->> 'itemId')::uuid into v_item from jsonb_array_elements(s.actions) a where a ->> 'kind' = 'price' limit 1;
    if v_item is null or p_price is null or p_price <= 0 then raise exception 'No price change in this suggestion'; end if;
    perform public.decide_suggestion(p_id, 'accepted', 'Price changed to ' || public.rs(p_price));
    update public.menu_items set price = round(p_price, 2) where id = v_item and tenant_id = s.tenant_id;
end;
$$;

create function public.profit_suggestions(p_status text default 'open') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then raise exception 'Not authorized (sensitive.see_profit)'; end if;
    update public.profit_suggestions set status = 'open' where tenant_id = v_t and status = 'snoozed' and snooze_until <= now();
    return jsonb_build_object(
        'lastRun', public.get_setting('profit_check_at', 'null', v_t),
        'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.profit_suggestions
                    where tenant_id = v_t group by status) z),
        'totalImpact', (select coalesce(sum(impact), 0) from public.profit_suggestions where tenant_id = v_t and status = 'open'),
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', id, 'check', check_key, 'area', area, 'priority', priority, 'title', title, 'detail', detail, 'impact', impact,
                    'formula', formula, 'inputs', inputs, 'assumption', assumption, 'actions', actions, 'status', status, 'reason', reason,
                    'snoozeUntil', snooze_until, 'decidedBy', decided_by, 'decidedAt', decided_at, 'outcome', outcome, 'outcomeAt', outcome_at,
                    'firstSeen', first_seen) order by priority, impact desc), '[]'::jsonb)
                    from public.profit_suggestions where tenant_id = v_t
                     and (case p_status when 'all' then true when 'decided' then status in ('accepted', 'dismissed') else status = p_status end)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Swiggy / Zomato / Petpooja CSV import (weekly)
-- ---------------------------------------------------------------------------
-- Suggested menu item for each name in the report: saved mapping first, then the closest menu name
create function public.aggregator_match(p_platform text, p_names text[]) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
begin
    perform public.require_perm('finance.create');
    return (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'menuItemId', coalesce(
                (select menu_item_id from public.aggregator_item_map where tenant_id = v_t and platform = lower(p_platform) and external_name = lower(trim(n))),
                (select m.id from public.menu_items m where m.tenant_id = v_t
                    and similarity(lower(m.name), lower(trim(n))) > 0.3 order by similarity(lower(m.name), lower(trim(n))) desc limit 1)),
            'saved', exists (select 1 from public.aggregator_item_map where tenant_id = v_t and platform = lower(p_platform) and external_name = lower(trim(n))))), '[]'::jsonb)
              from unnest(p_names) n);
end;
$$;

-- p: {platform, fileName, payoutAccount: 'bank', commission, rows: [{orderId, date, item, qty, amount}], mappings: {name: menuItemId}}
-- amount = what the customer paid for that line (food value, before the platform's cut). GST on aggregator food orders is paid
-- by the platform (section 9(5)), so these orders carry no GST of their own.
create function public.import_aggregator(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_platform text := lower(coalesce(nullif(p ->> 'platform', ''), 'other'));
    v_acc uuid := public.account_id(public.current_tenant_id(), coalesce(nullif(p ->> 'payoutAccount', ''), 'bank'));
    v_commission numeric := round(coalesce(nullif(p ->> 'commission', '')::numeric, 0), 2);
    v_name text;
    v_unmapped text[];
    o record;
    v_order uuid;
    v_imported integer := 0;
    v_skipped integer := 0;
    v_gross numeric := 0;
    v_from date;
    v_to date;
    v_exp uuid;
    v_cat uuid;
    v_import uuid;
    v_when timestamptz;
begin
    perform public.require_perm('finance.create');
    if v_platform not in ('swiggy', 'zomato', 'petpooja', 'other') then raise exception 'Unknown platform'; end if;
    if jsonb_array_length(coalesce(p -> 'rows', '[]')) = 0 then raise exception 'No rows to import'; end if;
    -- Save the mappings for next week
    for v_name in select jsonb_object_keys(coalesce(p -> 'mappings', '{}')) loop
        if nullif(p -> 'mappings' ->> v_name, '') is not null
           and exists (select 1 from public.menu_items where id = (p -> 'mappings' ->> v_name)::uuid and tenant_id = v_t) then
            insert into public.aggregator_item_map (tenant_id, platform, external_name, menu_item_id)
            values (v_t, v_platform, lower(trim(v_name)), (p -> 'mappings' ->> v_name)::uuid)
            on conflict (tenant_id, platform, external_name) do update set menu_item_id = excluded.menu_item_id;
        end if;
    end loop;
    select array_agg(distinct r ->> 'item') into v_unmapped from jsonb_array_elements(p -> 'rows') r
     where not exists (select 1 from public.aggregator_item_map mp where mp.tenant_id = v_t and mp.platform = v_platform
                         and mp.external_name = lower(trim(r ->> 'item')));
    if v_unmapped is not null then
        raise exception 'Match these items to the menu first: %', array_to_string(v_unmapped, ', ');
    end if;

    for o in select r ->> 'orderId' oid, min(r ->> 'date') d, jsonb_agg(r) lines
               from jsonb_array_elements(p -> 'rows') r group by r ->> 'orderId' loop
        if coalesce(o.oid, '') = '' then raise exception 'A row has no order id'; end if;
        if exists (select 1 from public.orders where tenant_id = v_t and client_id = 'agg:' || v_platform || ':' || o.oid) then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        v_when := case when o.d ~ '^\d{4}-\d{2}-\d{2}$' then ((o.d || ' 13:00')::timestamp at time zone v_tz)
                       else (o.d::timestamp at time zone v_tz) end;
        insert into public.orders (tenant_id, order_number, subtotal, discount, tax, total, status, channel, payment_method,
                                   client_id, staff_name, created_at, restaurant_info)
        values (v_t, upper(left(v_platform, 3)) || '-' || o.oid || '-' || substr(v_t::text, 1, 4), 0, 0, 0, 0, 'paid', 'aggregator', 'online',
                'agg:' || v_platform || ':' || o.oid, initcap(v_platform) || ' import', v_when, '{}'::jsonb)
        returning id into v_order;
        insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, net_amount, tax_rate, tax_amount)
        select v_order, mp.menu_item_id, m.name, round((l ->> 'amount')::numeric / greatest((l ->> 'qty')::integer, 1), 2),
               greatest((l ->> 'qty')::integer, 1), round((l ->> 'amount')::numeric, 2), round((l ->> 'amount')::numeric, 2), 0, 0
          from jsonb_array_elements(o.lines) l
          join public.aggregator_item_map mp on mp.tenant_id = v_t and mp.platform = v_platform and mp.external_name = lower(trim(l ->> 'item'))
          join public.menu_items m on m.id = mp.menu_item_id;
        update public.orders set subtotal = (select coalesce(sum(total), 0) from public.order_items where order_id = v_order),
                                 total = (select coalesce(sum(total), 0) from public.order_items where order_id = v_order),
                                 amount_paid = (select coalesce(sum(total), 0) from public.order_items where order_id = v_order)
         where id = v_order;
        perform public.post_ledger(v_t, v_acc, (select total from public.orders where id = v_order), 'aggregator', v_platform, v_order,
                                   p_note => initcap(v_platform) || ' order ' || o.oid);
        v_gross := v_gross + (select total from public.orders where id = v_order);
        v_from := least(v_from, (v_when at time zone v_tz)::date);
        v_to := greatest(v_to, (v_when at time zone v_tz)::date);
        v_imported := v_imported + 1;
    end loop;

    if v_imported > 0 and v_commission > 0 then
        select id into v_cat from public.expense_categories where tenant_id = v_t and name = 'Aggregator commission';
        if v_cat is null then
            insert into public.expense_categories (tenant_id, name) values (v_t, 'Aggregator commission') returning id into v_cat;
        end if;
        v_exp := public.record_expense(jsonb_build_object('categoryId', v_cat, 'amount', v_commission,
                    'accountCode', coalesce(nullif(p ->> 'payoutAccount', ''), 'bank'), 'date', coalesce(v_to, public.cafe_today(v_t)),
                    'note', initcap(v_platform) || ' commission and fees ' || coalesce(to_char(v_from, 'DD Mon'), '') || '–' || coalesce(to_char(v_to, 'DD Mon'), ''),
                    'clientId', 'aggcomm:' || v_platform || ':' || coalesce(p ->> 'fileName', '') || ':' || v_imported || ':' || round(v_gross)));
    end if;
    insert into public.aggregator_imports (tenant_id, platform, file_name, period_from, period_to, orders, skipped, gross, commission, payout,
                                           expense_id, created_by)
    values (v_t, v_platform, coalesce(p ->> 'fileName', ''), v_from, v_to, v_imported, v_skipped, v_gross,
            case when v_imported > 0 then v_commission else 0 end, v_gross - case when v_imported > 0 then v_commission else 0 end, v_exp, public.actor_name())
    returning id into v_import;
    return jsonb_build_object('id', v_import, 'imported', v_imported, 'skipped', v_skipped, 'gross', v_gross,
                              'commission', case when v_imported > 0 then v_commission else 0 end,
                              'payout', v_gross - case when v_imported > 0 then v_commission else 0 end);
end;
$$;

create function public.list_aggregator_imports() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'platform', platform, 'fileName', file_name, 'from', period_from, 'to', period_to,
                                                         'orders', orders, 'skipped', skipped, 'gross', gross, 'commission', commission,
                                                         'payout', payout, 'createdBy', created_by, 'createdAt', created_at)
                                      order by created_at desc), '[]'::jsonb)
              from public.aggregator_imports where tenant_id = public.current_tenant_id());
end;
$$;

commit;
