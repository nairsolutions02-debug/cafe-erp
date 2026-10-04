-- Cafe ERP · Table ordering + customer app upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261013000001_table_ordering.sql ====
-- Table ordering: private table QR codes, shared tables (each customer is their own group and bill),
-- table modes, "staff confirm the first order on a table", moving orders between tables,
-- and owner-editable customer app (banners, announcement strip, what to show, reminders).

-- ---------------------------------------------------------------------------
-- Private table codes (dining_tables is publicly readable, so codes live in their own table)
-- ---------------------------------------------------------------------------
create table public.table_codes (
    table_id uuid primary key references public.dining_tables (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    code text not null,
    issued_at timestamptz not null default now(),
    unique (tenant_id, code)
);
alter table public.table_codes enable row level security;
create policy "staff read" on public.table_codes for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('tables.view')));

-- e.g. table "5" -> "5-K7Q2" (no 0/O/1/I/L so it reads cleanly when typed)
create function public.new_table_code(p_tenant uuid, p_number text) returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare
    v_abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_prefix text := left(regexp_replace(upper(coalesce(p_number, '')), '[^A-Z0-9]', '', 'g'), 6);
    v_code text;
begin
    loop
        v_code := (case when v_prefix = '' then 'T' else v_prefix end) || '-';
        for i in 1..4 loop
            v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::integer, 1);
        end loop;
        exit when not exists (select 1 from public.table_codes where tenant_id = p_tenant and code = v_code);
    end loop;
    return v_code;
end;
$$;
revoke execute on function public.new_table_code(uuid, text) from public, anon, authenticated;

create function public.dining_tables_code() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into public.table_codes (table_id, tenant_id, code)
    values (new.id, new.tenant_id, public.new_table_code(new.tenant_id, new.table_number))
    on conflict (table_id) do nothing;
    return null;
end;
$$;
create trigger dining_tables_code after insert on public.dining_tables
    for each row execute function public.dining_tables_code();

insert into public.table_codes (table_id, tenant_id, code)
select t.id, t.tenant_id, public.new_table_code(t.tenant_id, t.table_number)
  from public.dining_tables t
 where not exists (select 1 from public.table_codes c where c.table_id = t.id);

-- A new code for one table: the old printed QR stops working
create function public.reissue_table_code(p_table_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t public.dining_tables;
    v_code text;
begin
    perform public.require_perm('tables.edit');
    select * into v_t from public.dining_tables where id = p_table_id and tenant_id = public.current_tenant_id();
    if v_t.id is null then
        raise exception 'Table not found';
    end if;
    v_code := public.new_table_code(v_t.tenant_id, v_t.table_number);
    insert into public.table_codes (table_id, tenant_id, code) values (v_t.id, v_t.tenant_id, v_code)
    on conflict (table_id) do update set code = excluded.code, issued_at = now();
    perform public.audit_event(v_t.tenant_id, 'table', v_t.id::text, 'New QR code for table ' || v_t.table_number, null,
                               jsonb_build_object('table', v_t.table_number));
    return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings for tables (all per cafe, in public.settings)
--   table_mode: 'qr' (table comes from the QR, locked) | 'pick' (customer picks) | 'none' (no tables)
--   table_shared: several groups may order at one table (default on)
--   table_confirm_first: hold a table's first order until staff confirm it (default off)
--   table_legacy_links: old ?table=5 QR codes still work (default on)
-- ---------------------------------------------------------------------------
create function public.table_settings(p_tenant uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'mode', coalesce(nullif(public.get_setting('table_mode', '"qr"', p_tenant) #>> '{}', ''), 'qr'),
        'shared', coalesce((public.get_setting('table_shared', 'true', p_tenant) #>> '{}')::boolean, true),
        'confirmFirst', coalesce((public.get_setting('table_confirm_first', 'false', p_tenant) #>> '{}')::boolean, false),
        'legacyLinks', coalesce((public.get_setting('table_legacy_links', 'true', p_tenant) #>> '{}')::boolean, true));
$$;

-- Finds a table from a QR: its private code, or (old QRs) its number while legacy links are on
create function public.find_table(p_tenant uuid, p_code text) returns public.dining_tables
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t public.dining_tables;
    v_raw text := trim(coalesce(p_code, ''));
begin
    if v_raw = '' then
        return null;
    end if;
    select t.* into v_t from public.table_codes c join public.dining_tables t on t.id = c.table_id
     where c.tenant_id = p_tenant and c.code = upper(v_raw);
    if v_t.id is null and v_raw like 'n:%' and (public.table_settings(p_tenant) ->> 'legacyLinks')::boolean then
        select * into v_t from public.dining_tables where tenant_id = p_tenant and table_number = substr(v_raw, 3);
    end if;
    return v_t;
end;
$$;
revoke execute on function public.find_table(uuid, text) from public, anon, authenticated;

-- Public: what a scanned QR points to. Old QRs pass 'n:<table number>'.
create function public.resolve_table(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = public.current_customer_id()), public.view_tenant_id());
    v_t public.dining_tables := public.find_table(v_tenant, p_code);
    v_s jsonb := public.table_settings(v_tenant);
begin
    if v_s ->> 'mode' = 'none' then
        return jsonb_build_object('ok', false, 'reason', 'no_tables', 'mode', v_s ->> 'mode');
    end if;
    if v_t.id is null then
        return jsonb_build_object('ok', false, 'reason', 'unknown', 'mode', v_s ->> 'mode');
    end if;
    if not v_t.is_active or v_t.status = 'maintenance' then
        return jsonb_build_object('ok', false, 'reason', 'inactive', 'tableNumber', v_t.table_number, 'mode', v_s ->> 'mode');
    end if;
    return jsonb_build_object('ok', true, 'tableId', v_t.id, 'tableNumber', v_t.table_number,
                              'code', (select code from public.table_codes where table_id = v_t.id), 'mode', v_s ->> 'mode');
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders: held until staff confirm (first order on a table, when switched on)
-- ---------------------------------------------------------------------------
alter table public.orders add column held boolean not null default false;

-- The table a customer order goes to, following the cafe's table mode
create function public.order_table_for(p_tenant uuid, p_customer uuid, p_table_id uuid, p_table_code text) returns public.dining_tables
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_s jsonb := public.table_settings(p_tenant);
    v_t public.dining_tables;
begin
    if v_s ->> 'mode' = 'none' then
        return null;
    end if;
    if nullif(trim(coalesce(p_table_code, '')), '') is not null then
        v_t := public.find_table(p_tenant, p_table_code);
        if v_t.id is null then
            raise exception 'This table QR is no longer in use. Please ask the staff or scan the QR on your table again.';
        end if;
    elsif p_table_id is not null then
        -- Picking from a list is only for cafes in "customer picks" mode
        if v_s ->> 'mode' <> 'pick' then
            raise exception 'Please scan the QR code on your table to order to it';
        end if;
        select * into v_t from public.dining_tables where id = p_table_id and tenant_id = p_tenant;
        if v_t.id is null then
            raise exception 'Invalid table selected';
        end if;
    else
        return null;
    end if;
    if not v_t.is_active or v_t.status = 'maintenance' then
        raise exception 'Table % is not in use right now. Please ask the staff.', v_t.table_number;
    end if;
    if not (v_s ->> 'shared')::boolean and exists (
        select 1 from public.orders
         where table_id = v_t.id and status not in ('paid', 'cancelled')
           and customer_id is distinct from p_customer) then
        raise exception 'Table % already has an open bill. Please ask the staff.', v_t.table_number;
    end if;
    return v_t;
end;
$$;
revoke execute on function public.order_table_for(uuid, uuid, uuid, text) from public, anon, authenticated;

drop function public.place_order(jsonb, text, uuid, text, uuid);
create function public.place_order(
    p_items jsonb,
    p_coupon_code text default '',
    p_table_id uuid default null,
    p_special_instructions text default '',
    p_loyalty_offer_id uuid default null,
    p_table_code text default null,
    p_client_id text default null
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
    v_client text := nullif(left(trim(coalesce(p_client_id, '')), 64), '');
    v_held boolean := false;
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

    -- A double tap or a retry on a slow network returns the first order instead of placing two
    if v_client is not null then
        select id into v_order_id from public.orders
         where tenant_id = v_tenant and client_id = v_client and customer_id = v_customer_id;
        if v_order_id is not null then
            return v_order_id;
        end if;
    end if;

    v_table := public.order_table_for(v_tenant, v_customer_id, p_table_id, p_table_code);
    if v_table.id is not null then
        perform 1 from public.dining_tables where id = v_table.id for update;
        -- A table nobody has been confirmed at yet: hold the order for staff when the owner asks for it
        v_held := (public.table_settings(v_tenant) ->> 'confirmFirst')::boolean
                  and not exists (select 1 from public.orders
                                   where table_id = v_table.id and status not in ('paid', 'cancelled') and not held);
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
        special_instructions, loyalty_offer_id, points_redeemed, client_id, held)
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
        (v_calc ->> 'pointsUsed')::integer,
        v_client, v_held)
    returning id into v_order_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost)
    select v_order_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0)
      from jsonb_array_elements(v_calc -> 'lines') l;

    -- Busy/free is for staff only; customers never see it
    if v_table.id is not null then
        update public.dining_tables
           set status = 'occupied', is_occupied = true, current_order_id = v_order_id
         where id = v_table.id;
    end if;

    return v_order_id;
end;
$$;

-- New QR orders ring for staff; a held one asks them to confirm the table
create or replace function public.orders_notify_new() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.channel in ('qr') then
        perform public.notify(new.tenant_id, 'new_order',
                              case when new.held then 'Confirm table: ' else 'New order ' end
                              || coalesce(nullif('· Table ' || new.table_number, '· Table '), '')
                              || ' ' || new.order_number,
                              case when new.held then 'First order on this table. Check someone is sitting there, then confirm. '
                                   else '' end || public.inr(new.total),
                              '/admin/orders', 'orders.view', 'alarm', jsonb_build_object('orderId', new.id));
    end if;
    return null;
end;
$$;

-- Staff: release a held order to the kitchen
create function public.confirm_table_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
begin
    perform public.require_perm('orders.edit');
    update public.orders set held = false, status = case when status = 'pending' then 'confirmed' else status end
     where id = p_order_id and tenant_id = public.current_tenant_id()
    returning * into v_o;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    return public.order_json(v_o);
end;
$$;

-- Kitchen never sees a held order
create or replace function public.kitchen_orders() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', o.id, 'orderNumber', o.order_number, 'status', o.status, 'channel', o.channel,
                   'tableNumber', o.table_number, 'tokenNumber', o.token_number,
                   'customer', c.name, 'note', o.special_instructions, 'createdAt', o.created_at,
                   'kitchenStartedAt', o.kitchen_started_at,
                   'tableGroups', case when o.table_id is null then 1 else
                       (select count(distinct coalesce(x.customer_id::text, x.id::text)) from public.orders x
                         where x.table_id = o.table_id and x.status not in ('paid', 'cancelled')) end,
                   'items', (select jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
                                                                 'status', oi.kitchen_status, 'note', oi.note) order by oi.name)
                               from public.order_items oi where oi.order_id = o.id))
                   order by o.created_at), '[]'::jsonb)
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where o.tenant_id = public.current_tenant_id()
           and o.status <> 'cancelled' and o.channel <> 'kiosk' and not o.held
           and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.kitchen_status <> 'served')
           and o.created_at > now() - interval '24 hours');
end;
$$;

-- Order JSON: + held, and how many groups share the table
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
        'tableNumber', o.table_number, 'table', o.table_id, 'held', o.held,
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
-- Bills are per group: a customer asking for the bill asks only for their own orders at the table.
-- Staff asking still covers the whole table.
-- ---------------------------------------------------------------------------
create or replace function public.request_bill(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_order public.orders;
    v_staff boolean;
begin
    select * into v_order from public.orders where id = p_order_id;
    if v_order.id is null then
        raise exception 'Order not found';
    end if;
    v_staff := v_order.tenant_id = public.current_tenant_id() and public.has_perm('orders.edit');
    if v_order.customer_id is distinct from public.current_customer_id() and not v_staff then
        raise exception 'Not authorized';
    end if;

    update public.orders
       set status = 'bill_requested'
     where tenant_id = v_order.tenant_id
       and status not in ('paid', 'cancelled', 'bill_requested')
       and (id = v_order.id
            or (v_order.table_id is not null and table_id = v_order.table_id
                and (v_staff or customer_id = v_order.customer_id))
            or (v_order.table_id is null and customer_id = v_order.customer_id));

    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Moving tables
-- ---------------------------------------------------------------------------
create function public.move_orders_to_table(p_order_ids uuid[], p_table public.dining_tables) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    update public.orders set table_id = p_table.id, table_number = p_table.table_number
     where id = any(p_order_ids);
    update public.dining_tables
       set status = 'occupied', is_occupied = true,
           current_order_id = (select id from public.orders where id = any(p_order_ids) order by created_at desc limit 1)
     where id = p_table.id;
end;
$$;
revoke execute on function public.move_orders_to_table(uuid[], public.dining_tables) from public, anon, authenticated;

-- Frees every table in the list that has no open orders left
create function public.free_idle_tables(p_table_ids uuid[]) returns void
language sql security definer set search_path = public, pg_temp as $$
    update public.dining_tables t
       set status = 'available', is_occupied = false, current_order_id = null
     where t.id = any(p_table_ids) and t.status = 'occupied'
       and not exists (select 1 from public.orders o where o.table_id = t.id and o.status not in ('paid', 'cancelled'));
$$;
revoke execute on function public.free_idle_tables(uuid[]) from public, anon, authenticated;

-- Customer scanned another table's QR and said "Move to Table 7": their open orders follow them
create function public.move_my_table(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_customer uuid := public.current_customer_id();
    v_tenant uuid;
    v_t public.dining_tables;
    v_ids uuid[];
    v_old uuid[];
begin
    if v_customer is null then
        raise exception 'Please sign in first';
    end if;
    select tenant_id into v_tenant from public.customers where id = v_customer;
    v_t := public.order_table_for(v_tenant, v_customer, null, p_code);
    if v_t.id is null then
        raise exception 'Please scan the QR code on your new table';
    end if;
    select array_agg(id), array_agg(distinct table_id) filter (where table_id is not null) into v_ids, v_old
      from public.orders
     where customer_id = v_customer and tenant_id = v_tenant and status not in ('paid', 'cancelled')
       and table_id is distinct from v_t.id and created_at > now() - interval '12 hours';
    if v_ids is not null then
        perform public.move_orders_to_table(v_ids, v_t);
        perform public.free_idle_tables(v_old);
    end if;
    return jsonb_build_object('tableId', v_t.id, 'tableNumber', v_t.table_number, 'moved', coalesce(array_length(v_ids, 1), 0));
end;
$$;

-- Staff: move one order, or that customer's whole group at the table, to another table
create function public.move_order_table(p_order_id uuid, p_table_id uuid, p_whole_group boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_t public.dining_tables;
    v_ids uuid[];
begin
    perform public.require_perm('orders.edit');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id();
    if v_o.id is null or v_o.status in ('paid', 'cancelled') then
        raise exception 'Order not found or already closed';
    end if;
    select * into v_t from public.dining_tables where id = p_table_id and tenant_id = v_o.tenant_id and is_active;
    if v_t.id is null then
        raise exception 'Table not found';
    end if;
    select array_agg(id) into v_ids from public.orders
     where tenant_id = v_o.tenant_id and status not in ('paid', 'cancelled')
       and (id = v_o.id or (p_whole_group and v_o.table_id is not null and v_o.customer_id is not null
                            and table_id = v_o.table_id and customer_id = v_o.customer_id));
    perform public.move_orders_to_table(v_ids, v_t);
    if v_o.table_id is not null then
        perform public.free_idle_tables(array[v_o.table_id]);
    end if;
    perform public.audit_event(v_o.tenant_id, 'order', v_o.id::text, 'Moved order ' || v_o.order_number || ' to table ' || v_t.table_number,
                               jsonb_build_object('table', v_o.table_number), jsonb_build_object('table', v_t.table_number));
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

-- Staff: who is at each table right now (one line per group)
create function public.table_groups() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('tables.view');
    return coalesce((
        select jsonb_agg(jsonb_build_object('tableId', g.table_id, 'customerId', g.customer_id, 'name', g.name,
                                            'orders', g.n, 'total', g.total, 'due', g.due, 'held', g.held,
                                            'billRequested', g.bill, 'since', g.since) order by g.since)
          from (select o.table_id, o.customer_id, coalesce(c.name, o.staff_name, 'Walk-in') as name,
                       count(*) as n, sum(o.total) as total, sum(o.total - o.amount_paid) as due,
                       bool_or(o.held) as held, bool_or(o.status in ('bill_requested', 'bill_generated')) as bill,
                       min(o.created_at) as since
                  from public.orders o
                  left join public.customers c on c.id = o.customer_id
                 where o.tenant_id = public.current_tenant_id() and o.table_id is not null
                   and o.status not in ('paid', 'cancelled')
                 group by o.table_id, o.customer_id, coalesce(c.name, o.staff_name, 'Walk-in')) g), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer app, editable by the owner
--   portal_banners: [{id, title, text, tag, cta, linkType: none|menu|category|item|rewards|url, linkTo,
--                     style: palette key, image, from, to, active}]
--   portal_announcement: {on, text}
--   portal_theme: '#hex' (primary colour)
--   portal_show gains: rewardBar, photos, badges, infoButtons, nudgeMilestone, nudgePoints, nudgeCelebrate
-- ---------------------------------------------------------------------------
create or replace function public.portal_defaults() returns jsonb
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
                                   'feedback', true, 'review', true,
                                   'rewardBar', true, 'photos', true, 'badges', true, 'infoButtons', true,
                                   'nudgeMilestone', true, 'nudgePoints', true, 'nudgeCelebrate', true));
$$;

create or replace function public.portal_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                              public.current_tenant_id(), public.view_tenant_id());
    v_d jsonb := public.portal_defaults();
    v_today date := public.cafe_today(v_tenant);
    v_banners jsonb;
begin
    -- Only switched-on banners inside their dates; item links only to items on sale in the shop
    select coalesce(jsonb_agg(b || jsonb_build_object('item', (
               select jsonb_build_object('_id', m.id, 'name', m.name, 'price', m.price, 'image', m.image)
                 from public.menu_items m
                where b ->> 'linkType' = 'item' and m.id::text = b ->> 'linkTo' and m.tenant_id = v_tenant)) order by ord), '[]'::jsonb)
      into v_banners
      from jsonb_array_elements(coalesce(public.get_setting('portal_banners', '[]', v_tenant), '[]')) with ordinality as e(b, ord)
     where coalesce((b ->> 'active')::boolean, true)
       and (nullif(b ->> 'from', '') is null or (b ->> 'from')::date <= v_today)
       and (nullif(b ->> 'to', '') is null or (b ->> 'to')::date >= v_today)
       and (b ->> 'linkType' is distinct from 'item' or exists (
             select 1 from public.menu_items m where m.id::text = b ->> 'linkTo' and m.tenant_id = v_tenant
                and m.sold_in_shop and not m.is_restricted and m.is_available));
    return jsonb_build_object(
        'texts', (v_d -> 'texts') || coalesce(public.get_setting('portal_texts', '{}', v_tenant), '{}'),
        'show', (v_d -> 'show') || coalesce(public.get_setting('portal_show', '{}', v_tenant), '{}'),
        'googleReviewUrl', coalesce(public.get_setting('google_review_url', '""', v_tenant) #>> '{}', ''),
        'instagramHandle', coalesce(public.get_setting('instagram_handle', '""', v_tenant) #>> '{}', ''),
        'banners', v_banners,
        'announcement', coalesce(public.get_setting('portal_announcement', '{"on": false, "text": ""}', v_tenant), '{}'),
        'theme', coalesce(public.get_setting('portal_theme', '""', v_tenant) #>> '{}', ''),
        'tables', public.table_settings(v_tenant));
end;
$$;

-- Owner saves the banner list; checked here so a banner can't promote something it shouldn't
create function public.save_portal_banners(p_banners jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    b jsonb;
    v_out jsonb := '[]';
    v_m public.menu_items;
begin
    perform public.require_perm('settings.edit');
    if jsonb_typeof(p_banners) <> 'array' then
        raise exception 'Banners must be a list';
    end if;
    if jsonb_array_length(p_banners) > 12 then
        raise exception 'Up to 12 banners';
    end if;
    for b in select * from jsonb_array_elements(p_banners) loop
        if trim(coalesce(b ->> 'title', '')) = '' and coalesce(b ->> 'image', '') = '' then
            raise exception 'Each banner needs a headline or a picture';
        end if;
        if coalesce(b ->> 'linkType', 'none') not in ('none', 'menu', 'category', 'item', 'rewards', 'url') then
            raise exception 'Unknown banner link';
        end if;
        if b ->> 'linkType' = 'item' then
            select * into v_m from public.menu_items where id::text = b ->> 'linkTo' and tenant_id = v_tenant;
            if v_m.id is null then
                raise exception 'Banner "%": pick an item', b ->> 'title';
            end if;
            if v_m.is_restricted or not v_m.sold_in_shop then
                raise exception 'Banner "%": % can''t be promoted (restricted or not sold in the shop)', b ->> 'title', v_m.name;
            end if;
        end if;
        if b ->> 'linkType' = 'url' and coalesce(b ->> 'linkTo', '') !~ '^https://' then
            raise exception 'Banner "%": web links must start with https://', b ->> 'title';
        end if;
        if nullif(b ->> 'from', '') is not null and nullif(b ->> 'to', '') is not null and (b ->> 'from')::date > (b ->> 'to')::date then
            raise exception 'Banner "%": the end date is before the start date', b ->> 'title';
        end if;
        v_out := v_out || jsonb_build_object(
            'id', coalesce(nullif(b ->> 'id', ''), gen_random_uuid()::text),
            'title', left(trim(coalesce(b ->> 'title', '')), 60),
            'text', left(trim(coalesce(b ->> 'text', '')), 120),
            'tag', left(trim(coalesce(b ->> 'tag', '')), 24),
            'cta', left(trim(coalesce(b ->> 'cta', '')), 24),
            'linkType', coalesce(b ->> 'linkType', 'none'),
            'linkTo', coalesce(b ->> 'linkTo', ''),
            'style', left(coalesce(nullif(b ->> 'style', ''), 'saffron'), 20),
            'image', coalesce(b ->> 'image', ''),
            'from', coalesce(b ->> 'from', ''),
            'to', coalesce(b ->> 'to', ''),
            'active', coalesce((b ->> 'active')::boolean, true));
    end loop;
    insert into public.settings (tenant_id, key, value) values (v_tenant, 'portal_banners', v_out)
    on conflict (tenant_id, key) do update set value = excluded.value;
    return v_out;
end;
$$;

-- Owner's banner pictures go to images/banners/
drop policy if exists "staff upload images" on storage.objects;
create policy "staff upload images" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (public.has_perm('menu.create') or public.has_perm('menu.edit')
                                          or public.has_perm('collections.edit')
                                          or (public.has_perm('settings.edit') and (storage.foldername(name))[1] = 'banners')
                                          or (public.has_perm('inventory.create') and (storage.foldername(name))[1] in ('bills', 'stock'))));

-- ---------------------------------------------------------------------------
-- Checkout extras for the customer: which order this is, so the app can celebrate milestones
-- ---------------------------------------------------------------------------
create function public.my_checkout_info() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_customer uuid := public.current_customer_id();
begin
    if v_customer is null then
        return null;
    end if;
    return jsonb_build_object(
        'ordersSoFar', (select count(*) from public.orders where customer_id = v_customer and status <> 'cancelled'),
        'openAtTable', coalesce((select jsonb_agg(distinct jsonb_build_object('tableId', table_id, 'tableNumber', table_number))
                                   from public.orders
                                  where customer_id = v_customer and table_id is not null
                                    and status not in ('paid', 'cancelled')), '[]'::jsonb));
end;
$$;

commit;
