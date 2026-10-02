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
