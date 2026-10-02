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
