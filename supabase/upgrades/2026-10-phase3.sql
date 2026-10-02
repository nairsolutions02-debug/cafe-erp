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

commit;
