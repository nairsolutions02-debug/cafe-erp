-- Cafe ERP · Hand-over: pickup colours, pay options, points as cash upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261029000001_handover_pay.sql ====
-- Hand-over and pay options:
-- 1. Points as cash (off by default): loyalty_settings.points_as_cash uses the redemption rules (points for one rupee,
--    minimum points, most of the bill) at checkout; loyalty_settings.deals_on switches the Deals rewards on or off.
-- 2. How customers pay: setting pay_options {bill|upi|counter: {on, text: {en, hi, hg}}}; switched-off ways are refused.
-- 3. Pickup card colours: setting pickup_colors {ready, wait} for the big number card customers see.
-- No apostrophes in comments: the SQL Editor splitter treats them as quotes.

alter table public.loyalty_settings add column if not exists points_as_cash boolean not null default false;
alter table public.loyalty_settings add column if not exists deals_on boolean not null default true;

-- How customers pay, merged with the standard: bill and counter on, UPI on
create or replace function public.pay_options(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with s as (select coalesce(public.get_setting('pay_options', '{}', p_tenant), '{}'::jsonb) as v)
    select jsonb_build_object(
        'bill', jsonb_build_object('on', coalesce((v -> 'bill' ->> 'on')::boolean, true), 'text', coalesce(v -> 'bill' -> 'text', '{}'::jsonb)),
        'upi', jsonb_build_object('on', coalesce((v -> 'upi' ->> 'on')::boolean, true), 'text', coalesce(v -> 'upi' -> 'text', '{}'::jsonb)),
        'counter', jsonb_build_object('on', coalesce((v -> 'counter' ->> 'on')::boolean, true), 'text', coalesce(v -> 'counter' -> 'text', '{}'::jsonb)))
      from s;
$$;

-- What the customer app needs from the cafe settings: pay ways, pickup colours, points rules
create or replace function public.customer_screen() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with t as (select coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                               public.current_tenant_id(), public.view_tenant_id()) as id)
    select jsonb_build_object(
        'pay', public.pay_options(t.id),
        'pickupColors', coalesce(public.get_setting('pickup_colors', '{}', t.id), '{}'::jsonb),
        'points', (select jsonb_build_object('on', s.is_active, 'deals', s.deals_on, 'cash', s.points_as_cash,
                                             'ratio', s.points_to_rupee_ratio, 'minPoints', s.min_points_to_redeem,
                                             'maxPercent', s.max_redemption_percent)
                     from public.loyalty_settings s where s.tenant_id = t.id))
      from t;
$$;
grant execute on function public.customer_screen() to anon, authenticated;

-- A switched-off way to pay is refused (staff can still record any payment)
create or replace function public.check_pay_mode() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.payment_request is distinct from old.payment_request and new.payment_request in ('qr', 'counter')
       and public.current_customer_id() is not null
       and not coalesce((public.pay_options(new.tenant_id) -> case new.payment_request when 'qr' then 'upi' else 'counter' end ->> 'on')::boolean, true) then
        raise exception 'This way to pay is not available here. Please choose another.';
    end if;
    return new;
end;
$$;

drop trigger if exists orders_check_pay_mode on public.orders;
create trigger orders_check_pay_mode before update of payment_request on public.orders
    for each row execute function public.check_pay_mode();

-- Bill to the table can be switched off too
CREATE OR REPLACE FUNCTION public.request_bill(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_order public.orders;
    v_staff boolean;
    v_n integer;
    v_due numeric;
    v_where text;
begin
    select * into v_order from public.orders where id = p_order_id;
    if v_order.id is null then
        raise exception 'Order not found';
    end if;
    v_staff := v_order.tenant_id = public.current_tenant_id() and public.has_perm('orders.create');
    if v_order.customer_id is distinct from public.current_customer_id() and not v_staff then
        raise exception 'Not authorized';
    end if;

    if not v_staff and not coalesce((public.pay_options(v_order.tenant_id) -> 'bill' ->> 'on')::boolean, true) then
        raise exception 'Please pay at the counter or by UPI';
    end if;

    with changed as (
        update public.orders
           set status = 'bill_requested'
         where tenant_id = v_order.tenant_id
           and status not in ('paid', 'cancelled', 'bill_requested')
           and (id = v_order.id
                or (v_order.table_id is not null and table_id = v_order.table_id
                    and (v_staff or customer_id = v_order.customer_id))
                or (v_order.table_id is null and customer_id = v_order.customer_id))
        returning total - amount_paid as due
    )
    select count(*), coalesce(sum(due), 0) into v_n, v_due from changed;

    if v_n > 0 and not v_staff then
        v_where := coalesce(nullif('Table ' || v_order.table_number, 'Table '), 'Order ' || v_order.order_number);
        perform public.notify(v_order.tenant_id, 'payment_request',
                              v_where || ' asks for the bill · ' || public.inr(v_due),
                              'Take the bill to the table', '/admin/orders', 'orders.create', 'alarm',
                              jsonb_build_object('orderId', v_order.id, 'mode', 'bill'));
    end if;

    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$function$;

-- Checkout: price, quote and place an order with points as cash
drop function if exists public.price_order(uuid, uuid, jsonb, text, uuid, numeric);
CREATE OR REPLACE FUNCTION public.price_order(p_tenant uuid, p_customer uuid, p_items jsonb, p_coupon_code text, p_loyalty_offer_id uuid, p_manual_discount numeric DEFAULT 0, p_points_cash boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_ls public.loyalty_settings;
    v_cash_points integer := 0;
    v_default jsonb;
    v_comps jsonb;
    v_coupon_ok boolean;
    v_calc jsonb;
    v_club jsonb;
    v_club_disc numeric := 0;
    v_cap_left numeric;
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

    select * into v_ls from public.loyalty_settings where tenant_id = p_tenant;
    if p_loyalty_offer_id is not null and not coalesce(v_ls.deals_on, true) then
        raise exception 'Rewards for points are switched off at the moment';
    end if;
    -- Points as cash: the redemption rules (points for one rupee, minimum points, most of the bill) turn points into money off
    if coalesce(p_points_cash, false) and p_loyalty_offer_id is null and p_customer is not null then
        if not coalesce(v_ls.is_active, false) or not coalesce(v_ls.points_as_cash, false) then
            raise exception 'Using points as cash is switched off at the moment';
        end if;
        select loyalty_points into v_points from public.customers where id = p_customer;
        if coalesce(v_points, 0) < v_ls.min_points_to_redeem then
            raise exception 'You need at least % points to use them', v_ls.min_points_to_redeem;
        end if;
        v_offer_disc := floor(least(v_points / greatest(v_ls.points_to_rupee_ratio, 0.0001),
                                    v_eligible * v_ls.max_redemption_percent / 100,
                                    greatest(v_eligible - v_coupon_disc, 0)));
        v_cash_points := ceil(v_offer_disc * v_ls.points_to_rupee_ratio);
        if v_offer_disc <= 0 then
            v_cash_points := 0;
        end if;
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

    -- Club: tier % and member %, after coupon and points; coupon, points and club together stay within the cap
    v_club := public.club_discount_for(p_tenant, p_customer, greatest(v_eligible - v_coupon_disc - v_offer_disc, 0));
    v_club_disc := coalesce((v_club ->> 'amount')::numeric, 0);
    if v_club_disc > 0 then
        v_cap_left := greatest(round(v_eligible * coalesce((v_club ->> 'cap')::numeric, 100) / 100, 2) - v_coupon_disc - v_offer_disc, 0);
        if v_club_disc > v_cap_left then
            -- keep the split between tier and member in proportion
            v_club := v_club || jsonb_build_object(
                'tierAmount', round((v_club ->> 'tierAmount')::numeric * v_cap_left / v_club_disc, 2),
                'memberAmount', v_cap_left - round((v_club ->> 'tierAmount')::numeric * v_cap_left / v_club_disc, 2),
                'capped', true);
            v_club_disc := v_cap_left;
        end if;
        v_club := v_club || jsonb_build_object('amount', v_club_disc);
    end if;
    perform set_config('club.pricing', (v_club || jsonb_build_object('customer', p_customer))::text, true);

    -- Counter discount: on items that may be discounted (restricted items never are)
    v_manual := round(least(greatest(coalesce(p_manual_discount, 0), 0), greatest(v_eligible - v_coupon_disc - v_offer_disc - v_club_disc, 0)), 2);
    v_elig_disc := v_offer_disc + v_club_disc + v_manual;

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
        'clubDiscount', v_club_disc,
        'club', v_club - 'customer',
        'manualDiscount', v_manual,
        'discount', v_coupon_disc + v_offer_disc + v_club_disc + v_manual,
        'couponId', v_coupon.id,
        'couponCode', coalesce(v_coupon.code, ''),
        'offerId', v_offer.id,
        'pointsUsed', coalesce(v_offer.points_required, v_cash_points, 0),
        'pointsCash', v_cash_points > 0,
        'tax', (v_calc ->> 'tax')::numeric,
        'taxDetails', v_calc -> 'tax_details',
        'total', (v_calc ->> 'gross')::numeric + (v_calc ->> 'excl_tax')::numeric);
end;
$function$;

drop function if exists public.quote_order(jsonb, text, uuid);
CREATE OR REPLACE FUNCTION public.quote_order(p_items jsonb, p_coupon_code text DEFAULT ''::text, p_loyalty_offer_id uuid DEFAULT NULL::uuid, p_points_cash boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_customer uuid := public.current_customer_id();
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = v_customer), public.header_tenant_id());
    v_quote jsonb;
begin
    v_quote := public.price_order(v_tenant, v_customer, p_items, p_coupon_code, p_loyalty_offer_id, 0, p_points_cash);
    return v_quote - 'lines' - 'couponId' - 'offerId';
end;
$function$;

drop function if exists public.place_order(jsonb, text, uuid, text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_coupon_code text DEFAULT ''::text, p_table_id uuid DEFAULT NULL::uuid, p_special_instructions text DEFAULT ''::text, p_loyalty_offer_id uuid DEFAULT NULL::uuid, p_table_code text DEFAULT NULL::text, p_client_id text DEFAULT NULL::text, p_points_cash boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    v_calc := public.price_order(v_tenant, v_customer_id, p_items, p_coupon_code, p_loyalty_offer_id, 0, p_points_cash);

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
$function$;

-- Points summary for the customer: + the ways to spend them
create or replace function public.my_loyalty_points() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'currentPoints', c.loyalty_points,
        'totalEarned', c.total_points_earned,
        'pointsValue', c.loyalty_points / s.points_to_rupee_ratio,
        'canRedeem', c.loyalty_points >= s.min_points_to_redeem,
        'minPointsToRedeem', s.min_points_to_redeem,
        'pointsToRupeeRatio', s.points_to_rupee_ratio,
        'maxRedemptionPercent', s.max_redemption_percent,
        'pointsAsCash', s.points_as_cash and s.is_active,
        'dealsOn', s.deals_on and s.is_active)
      from public.customers c
      join public.loyalty_settings s on s.tenant_id = c.tenant_id
     where c.id = public.current_customer_id();
$$;

commit;
