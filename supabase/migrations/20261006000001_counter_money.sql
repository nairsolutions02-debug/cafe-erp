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
