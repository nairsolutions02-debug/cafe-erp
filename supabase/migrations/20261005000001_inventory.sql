-- Phase 1 · 1/2: inventory, recipes and purchasing — tables and the stock ledger.
-- Every stock change is one row in stock_moves. Stock per location (stock_levels) and the
-- item total (inventory.current_stock) are kept in step by a trigger on that ledger.

-- ---------------------------------------------------------------------------
-- Stock locations: Main store, Kitchen, Kiosk … (each cafe can add more)
-- ---------------------------------------------------------------------------
create table public.stock_locations (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    sort_order integer not null default 0,
    receives_purchases boolean not null default false,
    default_for_sales boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);
create unique index stock_locations_one_purchase on public.stock_locations (tenant_id) where receives_purchases;
create unique index stock_locations_one_sales on public.stock_locations (tenant_id) where default_for_sales;

create function public.seed_stock_locations(p_tenant uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.stock_locations (tenant_id, name, sort_order, receives_purchases, default_for_sales)
    select p_tenant, v.name, v.sort_order, v.purchases, v.sales from (values
        ('Main store', 1, true, false),
        ('Kitchen', 2, false, true),
        ('Kiosk', 3, false, false)) v(name, sort_order, purchases, sales)
    where not exists (select 1 from public.stock_locations where tenant_id = p_tenant);
$$;
revoke execute on function public.seed_stock_locations(uuid) from public, anon, authenticated;

create function public.tenants_seed_stock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.seed_stock_locations(new.id);
    return null;
end;
$$;
create trigger tenants_seed_stock after insert on public.tenants
    for each row execute function public.tenants_seed_stock();

do $$ begin perform public.seed_stock_locations(id) from public.tenants; end $$;

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------
create table public.vendors (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    phone text not null default '',
    gstin text not null default '',
    address text not null default '',
    lead_time_days integer not null default 1 check (lead_time_days between 0 and 60),
    order_cycle_days integer not null default 7 check (order_cycle_days between 1 and 90),
    payment_terms_days integer not null default 0 check (payment_terms_days between 0 and 180),
    notes text not null default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- Stock items (the existing inventory table): ingredients, resale stock, packaging
-- ---------------------------------------------------------------------------
alter table public.inventory drop constraint if exists inventory_category_check;
alter table public.inventory drop column is_low_stock;
alter table public.inventory
    add constraint inventory_category_check
        check (category in ('ingredient', 'resale', 'packaging', 'equipment', 'other')),
    alter column cost_per_unit type numeric(14, 4),
    alter column current_stock type numeric(14, 3),
    alter column minimum_stock type numeric(14, 3),
    alter column minimum_stock set default 0,
    add column vendor_id uuid references public.vendors (id) on delete set null,
    add column track_stock boolean not null default true,
    add column count_frequency text not null default 'weekly'
        check (count_frequency in ('daily', 'weekly', 'monthly', 'never')),
    add column shelf_order integer not null default 0,
    add column sku text not null default '',
    add column is_active boolean not null default true,
    add column updated_at timestamptz not null default now();
alter table public.inventory
    add column is_low_stock boolean generated always as (track_stock and current_stock <= minimum_stock) stored;
create index inventory_name_trgm on public.inventory using gin (lower(name) extensions.gin_trgm_ops);

-- Pack units for buying: 1 Crate = 24 pc, 1 Can = 5 L (1 L = 1000 ml when the base unit is ml)
create table public.stock_units (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    item_id uuid not null references public.inventory (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    factor numeric(14, 3) not null check (factor > 0),
    created_at timestamptz not null default now(),
    unique (item_id, name)
);

create table public.stock_levels (
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    item_id uuid not null references public.inventory (id) on delete cascade,
    location_id uuid not null references public.stock_locations (id) on delete cascade,
    quantity numeric(14, 3) not null default 0,
    primary key (item_id, location_id)
);
create index stock_levels_tenant_idx on public.stock_levels (tenant_id);

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
create table public.purchases (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    vendor_id uuid references public.vendors (id) on delete set null,
    vendor_name text not null default '',
    bill_number text not null default '',
    bill_date date not null default current_date,
    location_id uuid not null references public.stock_locations (id),
    bill_photo_url text not null default '',
    subtotal numeric(12, 2) not null default 0,
    tax numeric(12, 2) not null default 0,
    total numeric(12, 2) not null default 0,
    paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
    payment_mode text not null default 'cash' check (payment_mode in ('cash', 'upi', 'bank', 'card', 'credit')),
    due_date date,
    note text not null default '',
    is_void boolean not null default false,
    actor_name text not null default '',
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now()
);
create index purchases_tenant_date_idx on public.purchases (tenant_id, bill_date desc, created_at desc);
create index purchases_vendor_idx on public.purchases (vendor_id);

create table public.purchase_lines (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    purchase_id uuid not null references public.purchases (id) on delete cascade,
    item_id uuid not null references public.inventory (id),
    unit_name text not null,
    factor numeric(14, 3) not null check (factor > 0),
    quantity numeric(14, 3) not null check (quantity > 0),
    rate numeric(14, 4) not null check (rate >= 0),
    tax_rate numeric(6, 3) not null default 0 check (tax_rate >= 0),
    amount numeric(12, 2) not null,
    base_quantity numeric(14, 3) not null,
    base_cost numeric(14, 4) not null,
    previous_cost numeric(14, 4) not null default 0,
    price_change_pct numeric(8, 2)
);
create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id);
create index purchase_lines_item_idx on public.purchase_lines (item_id);

-- ---------------------------------------------------------------------------
-- Recipes: ingredients per menu item (quantity in the ingredient's base unit)
-- ---------------------------------------------------------------------------
create table public.recipe_lines (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    item_id uuid not null references public.inventory (id) on delete cascade,
    quantity numeric(14, 4) not null check (quantity > 0),
    waste_pct numeric(5, 2) not null default 0 check (waste_pct >= 0 and waste_pct < 90),
    sort_order integer not null default 0,
    unique (menu_item_id, item_id)
);
create index recipe_lines_item_idx on public.recipe_lines (item_id);

-- Where each sale takes stock from: item → its category → parent category → the cafe's sales location
alter table public.menu_items add column stock_location_id uuid references public.stock_locations (id) on delete set null;
alter table public.categories add column stock_location_id uuid references public.stock_locations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Counts
-- ---------------------------------------------------------------------------
create table public.stock_counts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    location_id uuid not null references public.stock_locations (id),
    scope text not null default 'all' check (scope in ('daily', 'weekly', 'all')),
    status text not null default 'open' check (status in ('open', 'posted', 'cancelled')),
    note text not null default '',
    started_by text not null default '',
    posted_by text not null default '',
    variance_value numeric(12, 2) not null default 0,
    created_at timestamptz not null default now(),
    posted_at timestamptz
);
create index stock_counts_tenant_idx on public.stock_counts (tenant_id, created_at desc);

create table public.stock_count_lines (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    count_id uuid not null references public.stock_counts (id) on delete cascade,
    item_id uuid not null references public.inventory (id) on delete cascade,
    expected numeric(14, 3) not null default 0,
    counted numeric(14, 3) check (counted is null or counted >= 0),
    unit_cost numeric(14, 4) not null default 0,
    unique (count_id, item_id)
);

-- ---------------------------------------------------------------------------
-- The stock ledger. quantity is signed, in the item's base unit.
-- ---------------------------------------------------------------------------
create table public.stock_moves (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    item_id uuid not null references public.inventory (id),
    location_id uuid not null references public.stock_locations (id),
    quantity numeric(14, 3) not null check (quantity <> 0),
    unit_cost numeric(14, 4) not null default 0,
    kind text not null check (kind in ('opening', 'purchase', 'purchase_void', 'sale', 'sale_reversal', 'transfer',
                                       'wastage', 'staff_meal', 'complimentary', 'adjustment', 'count')),
    reason text not null default '',
    note text not null default '',
    photo_url text not null default '',
    order_id uuid references public.orders (id) on delete set null,
    menu_item_id uuid references public.menu_items (id) on delete set null,
    purchase_id uuid references public.purchases (id) on delete set null,
    count_id uuid references public.stock_counts (id) on delete set null,
    transfer_id uuid,
    actor_name text not null default '',
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now()
);
create index stock_moves_tenant_idx on public.stock_moves (tenant_id, created_at desc);
create index stock_moves_item_idx on public.stock_moves (item_id, created_at desc);
create index stock_moves_order_idx on public.stock_moves (order_id) where order_id is not null;

-- Apply a move to stock_levels and the item total. Opening stock that is already in
-- inventory.current_stock (set app.opening = on) only fills stock_levels.
create function public.stock_moves_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not exists (select 1 from public.inventory where id = new.item_id and tenant_id = new.tenant_id)
       or not exists (select 1 from public.stock_locations where id = new.location_id and tenant_id = new.tenant_id) then
        raise exception 'Item and location must belong to the same cafe';
    end if;
    insert into public.stock_levels (tenant_id, item_id, location_id, quantity)
    values (new.tenant_id, new.item_id, new.location_id, new.quantity)
    on conflict (item_id, location_id) do update set quantity = public.stock_levels.quantity + excluded.quantity;
    if coalesce(current_setting('app.opening', true), '') <> 'on' then
        perform set_config('app.stock_sync', 'on', true);
        update public.inventory
           set current_stock = current_stock + new.quantity,
               last_restocked = case when new.kind = 'purchase' then now() else last_restocked end
         where id = new.item_id;
        perform set_config('app.stock_sync', 'off', true);
    end if;
    return null;
end;
$$;
create trigger stock_moves_apply after insert on public.stock_moves
    for each row execute function public.stock_moves_apply();

-- The ledger is append-only
create function public.stock_moves_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
        return old;
    end if;
    raise exception 'Stock movements cannot be changed; record a correcting entry instead';
end;
$$;
create trigger stock_moves_immutable before update on public.stock_moves
    for each row execute function public.stock_moves_immutable();

-- Quantities only change through the ledger
create function public.inventory_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if tg_op = 'UPDATE' then
        if new.current_stock is distinct from old.current_stock
           and coalesce(current_setting('app.stock_sync', true), '') <> 'on' then
            raise exception 'Stock can only change through a purchase, count, wastage, transfer or adjustment';
        end if;
        new.updated_at := now();
    end if;
    return new;
end;
$$;
create trigger inventory_guard before update on public.inventory
    for each row execute function public.inventory_guard();

-- A new item created with stock gets an opening entry at the purchase location
create function public.inventory_opening() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_loc uuid;
begin
    if new.current_stock <> 0 then
        select id into v_loc from public.stock_locations
         where tenant_id = new.tenant_id order by receives_purchases desc, sort_order limit 1;
        if v_loc is not null then
            perform set_config('app.opening', 'on', true);
            insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, note, actor_name)
            values (new.tenant_id, new.id, v_loc, new.current_stock, new.cost_per_unit, 'opening', 'Opening stock', public.actor_name());
            perform set_config('app.opening', 'off', true);
        end if;
    end if;
    return null;
end;
$$;
create trigger inventory_opening after insert on public.inventory
    for each row execute function public.inventory_opening();

-- Existing stock becomes opening stock at each cafe's main store
do $$
begin
    perform set_config('app.opening', 'on', true);
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, note, actor_name)
    select i.tenant_id, i.id,
           (select l.id from public.stock_locations l where l.tenant_id = i.tenant_id order by l.receives_purchases desc, l.sort_order limit 1),
           i.current_stock, i.cost_per_unit, 'opening', 'Stock before Phase 1', 'System'
      from public.inventory i
     where i.current_stock <> 0;
    perform set_config('app.opening', 'off', true);
end $$;

-- ---------------------------------------------------------------------------
-- Audit: vendors, purchases, locations, stock items (quantity changes are in the ledger)
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ignore text[] := array['updated_at', 'failed_attempts', 'last_login_at', 'locked_until',
                             'current_stock', 'last_restocked', 'is_low_stock', 'cost_per_unit', 'paid_amount'];
    v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'pin_hash' - 'salary' end;
    v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'pin_hash' - 'salary' end;
    v_row jsonb := coalesce(v_new, v_old);
    v_summary text;
begin
    if tg_op = 'UPDATE' and (v_old - v_ignore) = (v_new - v_ignore) then
        if tg_table_name = 'purchases' and v_old ->> 'paid_amount' is distinct from v_new ->> 'paid_amount' then
            v_summary := 'Payment: ' || coalesce(v_new ->> 'vendor_name', '') || ' bill ' || coalesce(v_new ->> 'bill_number', '')
                         || ' paid ₹' || (v_new ->> 'paid_amount');
        elsif tg_table_name <> 'staff_users' then
            return null;
        -- (nested: a record field can only be read on the table that has it)
        elsif old.pin_hash is distinct from new.pin_hash then
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
    if tg_table_name = 'purchases' and v_summary is null then
        v_summary := 'Purchase: ' || coalesce(v_row ->> 'vendor_name', '') || ' bill ' || coalesce(v_row ->> 'bill_number', '')
                     || ' ₹' || coalesce(v_row ->> 'total', '0')
                     || case when (v_row ->> 'is_void')::boolean then ' (undone)' else '' end;
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
    foreach t in array array['vendors', 'purchases', 'stock_locations', 'inventory'] loop
        execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    end loop;
end $$;

-- Free-form audit entry from inside a function (recipes, counts)
create function public.audit_event(p_tenant uuid, p_entity text, p_entity_id text, p_summary text,
                                   p_old jsonb default null, p_new jsonb default null) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.audit_log (tenant_id, actor_user, actor_staff, actor_name, action, entity, entity_id, summary, old_data, new_data)
    values (p_tenant, auth.uid(), (select staff_id from public.profiles where id = auth.uid()), public.actor_name(),
            'update', p_entity, coalesce(p_entity_id, ''), p_summary, p_old, p_new);
$$;
revoke execute on function public.audit_event(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
