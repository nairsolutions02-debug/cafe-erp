-- Business logic: helpers, triggers, customer login, ordering, billing, loyalty.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create function public.current_customer_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select customer_id from public.profiles where id = auth.uid();
$$;

create function public.get_setting(p_key text, p_default jsonb default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select value from public.settings where key = p_key), p_default);
$$;

create function public.cafe_timezone() returns text
language sql stable set search_path = public, pg_temp as $$
    select coalesce(public.get_setting('timezone') #>> '{}', 'Asia/Kolkata');
$$;

create function public.require_admin() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
    if not public.is_admin() then
        raise exception 'Not authorized as admin';
    end if;
end;
$$;

-- Start of an analytics period (matches the old getDateRange helper)
create function public.period_start(p_period text) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
    select case p_period
        when 'today' then (date_trunc('day', now() at time zone public.cafe_timezone())) at time zone public.cafe_timezone()
        when 'week' then now() - interval '7 days'
        when 'month' then now() - interval '1 month'
        when 'year' then now() - interval '1 year'
        else now() - interval '30 days'
    end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger orders_touch before update on public.orders
    for each row execute function public.touch_updated_at();
create trigger dining_tables_touch before update on public.dining_tables
    for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
    for each row execute function public.touch_updated_at();

-- Only one menu item can be the cart upsell
create function public.menu_items_single_upsell() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if new.is_upsell then
        update public.menu_items set is_upsell = false where id <> new.id and is_upsell;
    end if;
    return new;
end;
$$;
create trigger menu_items_single_upsell after insert or update of is_upsell on public.menu_items
    for each row when (new.is_upsell) execute function public.menu_items_single_upsell();

create function public.coupons_normalise() returns trigger
language plpgsql as $$
begin
    new.code := upper(trim(new.code));
    return new;
end;
$$;
create trigger coupons_normalise before insert or update on public.coupons
    for each row execute function public.coupons_normalise();

create function public.collections_slug() returns trigger
language plpgsql as $$
begin
    if new.slug is null or new.slug = '' or (tg_op = 'UPDATE' and new.name <> old.name) then
        new.slug := trim(both '-' from regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'))
            || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end if;
    return new;
end;
$$;
create trigger collections_slug before insert or update on public.collections
    for each row execute function public.collections_slug();

create function public.inventory_payment_status() returns trigger
language plpgsql as $$
declare
    v_total numeric := coalesce(new.current_stock, 0) * coalesce(new.cost_per_unit, 0);
begin
    new.payment_status := case
        when new.amount_paid >= v_total and v_total > 0 then 'paid'
        when new.amount_paid > 0 then 'partial'
        else 'unpaid'
    end;
    return new;
end;
$$;
create trigger inventory_payment_status before insert or update on public.inventory
    for each row execute function public.inventory_payment_status();

create function public.attendance_holiday() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.holidays where date = new.date) then
        new.status := 'holiday';
    end if;
    return new;
end;
$$;
create trigger attendance_holiday before insert or update on public.attendance
    for each row execute function public.attendance_holiday();

create function public.holidays_mark_attendance() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    update public.attendance set status = 'holiday' where date = new.date;
    return new;
end;
$$;
create trigger holidays_mark_attendance after insert on public.holidays
    for each row execute function public.holidays_mark_attendance();

-- Frees a table once none of its orders are still open
create function public.free_table_if_idle(p_table_id uuid, p_except_order uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    update public.dining_tables
       set status = 'available', is_occupied = false, current_order_id = null
     where id = p_table_id
       and status = 'occupied'
       and not exists (
           select 1 from public.orders
            where table_id = p_table_id
              and id <> p_except_order
              and status not in ('paid', 'cancelled'));
$$;

-- When an order is paid: award loyalty points and free the table.
-- When cancelled: refund redeemed points and free the table.
create function public.orders_status_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_settings public.loyalty_settings;
    v_points integer := 0;
begin
    if new.status = old.status then
        return new;
    end if;

    if new.status = 'paid' and new.points_awarded = 0 and new.customer_id is not null then
        select * into v_settings from public.loyalty_settings where id = 1;
        if v_settings.is_active and new.total >= v_settings.min_order_for_points then
            v_points := floor(new.total * v_settings.points_per_rupee);
            select v_points + coalesce(sum(mi.bonus_loyalty_points * oi.quantity), 0)
              into v_points
              from public.order_items oi
              join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = new.id;
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
create trigger orders_status_change before update of status on public.orders
    for each row execute function public.orders_status_change();

-- ---------------------------------------------------------------------------
-- Customer login (no OTP): name + 10-digit mobile.
-- The browser first signs in anonymously, then links that session to the
-- customer record for this phone number.
-- ---------------------------------------------------------------------------
create function public.link_customer(p_user uuid, p_name text, p_phone text, p_email text, p_verified boolean)
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
    if length(v_phone) = 12 and left(v_phone, 2) = '91' then
        v_phone := right(v_phone, 10);
    end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
        raise exception 'Enter a valid 10-digit mobile number';
    end if;
    if exists (select 1 from public.profiles where id = p_user and role = 'admin') then
        raise exception 'Admin accounts cannot place customer orders';
    end if;

    insert into public.customers (phone, name, email, phone_verified)
    values (v_phone, v_name, coalesce(trim(p_email), ''), p_verified)
    on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name else public.customers.name end,
            email = case when excluded.email <> '' then excluded.email else public.customers.email end,
            phone_verified = public.customers.phone_verified or excluded.phone_verified
    returning * into v_customer;

    if v_customer.name = '' then
        raise exception 'Name is required';
    end if;

    insert into public.profiles (id, role, customer_id)
    values (p_user, 'customer', v_customer.id)
    on conflict (id) do update set customer_id = excluded.customer_id;

    return v_customer;
end;
$$;
revoke execute on function public.link_customer(uuid, text, text, text, boolean) from public, anon, authenticated;

create function public.customer_sign_in(p_name text, p_phone text, p_email text default '')
returns public.customers
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    -- When OTP login is switched on, only the phone-otp Edge Function may link customers
    if coalesce((public.get_setting('otp_login_enabled') #>> '{}')::boolean, false) then
        raise exception 'OTP verification required';
    end if;
    return public.link_customer(auth.uid(), p_name, p_phone, p_email, false);
end;
$$;

create function public.me() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        '_id', coalesce(c.id, p.id),
        'id', coalesce(c.id, p.id),
        'role', p.role,
        'name', coalesce(c.name, 'Admin'),
        'phone', coalesce(c.phone, ''),
        'email', coalesce(c.email, u.email, ''),
        'loyaltyPoints', coalesce(c.loyalty_points, 0),
        'totalPointsEarned', coalesce(c.total_points_earned, 0),
        'phoneVerified', coalesce(c.phone_verified, false))
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.customers c on c.id = p.customer_id
     where p.id = auth.uid()
       and (p.role = 'admin' or c.id is not null);
$$;

create function public.update_my_profile(p_name text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_customer uuid := public.current_customer_id();
begin
    if v_customer is null then
        raise exception 'Please sign in first';
    end if;
    update public.customers
       set name = coalesce(nullif(trim(p_name), ''), name),
           email = coalesce(trim(p_email), email)
     where id = v_customer;
    return public.me();
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
-- Order in the JSON shape the frontend uses (populated user + items)
create function public.order_json(o public.orders) returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select jsonb_build_object(
        '_id', o.id, 'id', o.id,
        'orderNumber', o.order_number,
        'user', case when c.id is null then null else
            jsonb_build_object('_id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email) end,
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                '_id', oi.id,
                'menuItem', case when mi.id is null then null else
                    jsonb_build_object('_id', mi.id, 'name', mi.name, 'image', mi.image, 'price', mi.price) end,
                'name', oi.name, 'price', oi.price, 'quantity', oi.quantity, 'total', oi.total)
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

-- Read functions run as the caller, so row level security decides what is visible
create function public.my_orders() returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
      from public.orders o
     where o.customer_id = public.current_customer_id();
$$;

create function public.current_order() returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select public.order_json(o)
      from public.orders o
     where o.customer_id = public.current_customer_id()
       and o.status not in ('paid', 'cancelled')
     order by o.created_at desc
     limit 1;
$$;

create function public.get_order(p_id uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select public.order_json(o) from public.orders o where o.id = p_id;
$$;

-- Admin order lists. p_scope: 'all' or 'active'. p_date: a calendar day in the cafe's timezone.
create function public.admin_orders(p_scope text default 'all', p_status text default null, p_date date default null)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    return (
        select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
          from public.orders o
         where (p_scope <> 'active' or o.status not in ('paid', 'cancelled'))
           and (p_status is null or p_status = '' or o.status = p_status)
           and (p_date is null or (o.created_at at time zone public.cafe_timezone())::date = p_date));
end;
$$;

-- Coupon discount for a given subtotal; raises a readable error if unusable
create function public.coupon_discount(p_coupon public.coupons, p_subtotal numeric, p_applicable_subtotal numeric)
returns numeric
language plpgsql stable as $$
declare
    v_discount numeric;
begin
    if p_coupon.usage_limit <> -1 and p_coupon.used_count >= p_coupon.usage_limit then
        raise exception 'Coupon usage limit reached';
    end if;
    if p_subtotal < p_coupon.min_order_amount then
        raise exception 'Minimum order amount is ₹%', p_coupon.min_order_amount;
    end if;
    if p_coupon.discount_type = 'percentage' then
        v_discount := p_applicable_subtotal * p_coupon.discount_value / 100;
        if p_coupon.max_discount is not null and v_discount > p_coupon.max_discount then
            v_discount := p_coupon.max_discount;
        end if;
    else
        v_discount := least(p_coupon.discount_value, p_applicable_subtotal);
    end if;
    return round(least(v_discount, p_subtotal), 2);
end;
$$;

create function public.validate_coupon(p_code text, p_order_total numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_coupon public.coupons;
    v_discount numeric;
begin
    select * into v_coupon from public.coupons
     where code = upper(trim(p_code)) and is_active
       and valid_from <= now() and valid_until >= now();
    if not found then
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

-- Places an order for the signed-in customer. Prices, discounts and taxes are
-- all computed here from the database; the browser only sends item ids.
-- p_items: [{"menuItem": "<uuid>", "quantity": 2}, ...]
create function public.place_order(
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
    v_table public.dining_tables;
    v_item jsonb;
    v_menu public.menu_items;
    v_qty integer;
    v_subtotal numeric := 0;
    v_lines jsonb := '[]'::jsonb;
    v_coupon public.coupons;
    v_coupon_code text := upper(trim(coalesce(p_coupon_code, '')));
    v_applicable numeric := 0;
    v_discount numeric := 0;
    v_offer public.loyalty_offers;
    v_points_used integer := 0;
    v_tax_config jsonb;
    v_tax_details jsonb := '[]'::jsonb;
    v_tax_entry jsonb;
    v_taxable numeric;
    v_tax numeric := 0;
    v_order_id uuid;
    v_tz text := public.cafe_timezone();
begin
    if v_customer_id is null then
        raise exception 'Please sign in first';
    end if;
    select * into v_customer from public.customers where id = v_customer_id for update;

    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'No items in order';
    end if;
    if jsonb_array_length(p_items) > 50 then
        raise exception 'Too many items in one order';
    end if;

    -- Table: free, or already occupied by this customer's open session
    if p_table_id is not null then
        select * into v_table from public.dining_tables where id = p_table_id and is_active for update;
        if not found then
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

    -- Coupon (locked so usage limits hold under concurrent orders)
    if v_coupon_code <> '' then
        select * into v_coupon from public.coupons
         where code = v_coupon_code and is_active
           and valid_from <= now() and valid_until >= now()
         for update;
        if not found then
            raise exception 'Invalid coupon code';
        end if;
    end if;

    for v_item in select * from jsonb_array_elements(p_items) loop
        v_qty := (v_item ->> 'quantity')::integer;
        if v_qty is null or v_qty < 1 or v_qty > 99 then
            raise exception 'Invalid quantity';
        end if;
        select * into v_menu from public.menu_items where id = (v_item ->> 'menuItem')::uuid;
        if not found then
            raise exception 'Menu item not found';
        end if;
        if not v_menu.is_available then
            raise exception '% is not available', v_menu.name;
        end if;
        v_subtotal := v_subtotal + v_menu.price * v_qty;
        if v_coupon.id is not null and (
            (cardinality(v_coupon.applicable_items) = 0 and cardinality(v_coupon.applicable_categories) = 0)
            or v_menu.id = any (v_coupon.applicable_items)
            or v_menu.category_id = any (v_coupon.applicable_categories)) then
            v_applicable := v_applicable + v_menu.price * v_qty;
        end if;
        v_lines := v_lines || jsonb_build_object(
            'menu_item_id', v_menu.id, 'name', v_menu.name, 'price', v_menu.price,
            'quantity', v_qty, 'total', v_menu.price * v_qty);
    end loop;

    if v_coupon.id is not null then
        v_discount := public.coupon_discount(v_coupon, v_subtotal, v_applicable);
        update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
    end if;

    -- Loyalty offer: spend points for a flat discount
    if p_loyalty_offer_id is not null then
        select * into v_offer from public.loyalty_offers where id = p_loyalty_offer_id and is_active;
        if not found then
            raise exception 'This reward is no longer available';
        end if;
        if not (select is_active from public.loyalty_settings where id = 1) then
            raise exception 'Loyalty program is currently disabled';
        end if;
        if v_customer.loyalty_points < v_offer.points_required then
            raise exception 'Not enough loyalty points for this reward';
        end if;
        if v_subtotal < v_offer.min_order_value then
            raise exception 'Minimum order for this reward is ₹%', v_offer.min_order_value;
        end if;
        v_points_used := v_offer.points_required;
        v_discount := v_discount + v_offer.discount_value;
        update public.customers set loyalty_points = loyalty_points - v_points_used where id = v_customer_id;
    end if;

    v_discount := round(least(v_discount, v_subtotal), 2);
    v_taxable := v_subtotal - v_discount;

    v_tax_config := public.get_setting('tax_config',
        jsonb_build_array(jsonb_build_object('name', 'GST', 'rate', public.get_setting('gst_rate', '5'))));
    for v_tax_entry in select * from jsonb_array_elements(v_tax_config) loop
        v_tax_details := v_tax_details || jsonb_build_object(
            'name', v_tax_entry ->> 'name',
            'rate', (v_tax_entry ->> 'rate')::numeric,
            'amount', round(v_taxable * (v_tax_entry ->> 'rate')::numeric / 100, 2));
        v_tax := v_tax + round(v_taxable * (v_tax_entry ->> 'rate')::numeric / 100, 2);
    end loop;

    insert into public.orders (
        order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate,
        tax_details, restaurant_info, total, table_id, table_number,
        special_instructions, loyalty_offer_id, points_redeemed)
    values (
        'ORD-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-'
            || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
        v_customer_id, v_subtotal, v_discount,
        case when v_coupon.id is null then '' else v_coupon.code end,
        v_tax, (public.get_setting('gst_rate', '5') #>> '{}')::numeric,
        v_tax_details,
        jsonb_build_object(
            'name', public.get_setting('restaurant_name', '""') #>> '{}',
            'address', public.get_setting('restaurant_address', '""') #>> '{}',
            'phone', public.get_setting('restaurant_phone', '""') #>> '{}',
            'gstNumber', public.get_setting('gst_number', '""') #>> '{}'),
        v_taxable + v_tax,
        v_table.id, coalesce(v_table.table_number, ''),
        left(coalesce(p_special_instructions, ''), 500),
        v_offer.id, v_points_used)
    returning id into v_order_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total)
    select v_order_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric
      from jsonb_array_elements(v_lines) l;

    if v_table.id is not null then
        update public.dining_tables
           set status = 'occupied', is_occupied = true, current_order_id = v_order_id
         where id = v_table.id;
    end if;

    return v_order_id;
end;
$$;

-- Customer asks for the bill: covers every open order on the same table,
-- or (without a table) every open order of the same customer.
create function public.request_bill(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_order public.orders;
begin
    select * into v_order from public.orders where id = p_order_id;
    if not found then
        raise exception 'Order not found';
    end if;
    if v_order.customer_id is distinct from public.current_customer_id() and not public.is_admin() then
        raise exception 'Not authorized';
    end if;

    update public.orders
       set status = 'bill_requested'
     where status not in ('paid', 'cancelled', 'bill_requested')
       and (id = v_order.id
            or (v_order.table_id is not null and table_id = v_order.table_id)
            or (v_order.table_id is null and customer_id = v_order.customer_id));

    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

create function public.update_order_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    update public.orders set status = p_status where id = p_order_id;
    if not found then
        raise exception 'Order not found';
    end if;
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

create function public.record_payment(p_order_id uuid, p_method text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_order public.orders;
begin
    perform public.require_admin();
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
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
create function public.my_loyalty_points() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'currentPoints', c.loyalty_points,
        'totalEarned', c.total_points_earned,
        'pointsValue', c.loyalty_points / s.points_to_rupee_ratio,
        'canRedeem', c.loyalty_points >= s.min_points_to_redeem,
        'minPointsToRedeem', s.min_points_to_redeem,
        'pointsToRupeeRatio', s.points_to_rupee_ratio)
      from public.customers c, public.loyalty_settings s
     where c.id = public.current_customer_id() and s.id = 1;
$$;

create function public.calculate_redemption(p_order_total numeric, p_points_to_use integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_settings public.loyalty_settings;
    v_points integer;
    v_max numeric;
    v_discount numeric;
    v_used integer;
begin
    select * into v_settings from public.loyalty_settings where id = 1;
    select loyalty_points into v_points from public.customers where id = public.current_customer_id();
    if not v_settings.is_active then
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

create function public.adjust_points(p_customer_id uuid, p_points integer, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_balance integer;
begin
    perform public.require_admin();
    update public.customers
       set loyalty_points = greatest(loyalty_points + p_points, 0),
           total_points_earned = total_points_earned + greatest(p_points, 0)
     where id = p_customer_id
    returning loyalty_points into v_balance;
    if not found then
        raise exception 'User not found';
    end if;
    return jsonb_build_object('message', format('Points adjusted by %s', p_points), 'newBalance', v_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create function public.create_tables_bulk(p_start integer, p_end integer, p_capacity integer default 4) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_created jsonb;
begin
    perform public.require_admin();
    if p_end < p_start or p_end - p_start > 200 then
        raise exception 'Invalid table range';
    end if;
    with ins as (
        insert into public.dining_tables (table_number, capacity)
        select n::text, coalesce(p_capacity, 4) from generate_series(p_start, p_end) n
        on conflict (table_number) do nothing
        returning *)
    select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_created from ins;
    return jsonb_build_object('message', format('Created %s tables', jsonb_array_length(v_created)), 'tables', v_created);
end;
$$;

create function public.restock_inventory(p_id uuid, p_quantity numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    update public.inventory
       set current_stock = current_stock + p_quantity, last_restocked = now()
     where id = p_id;
    if not found then
        raise exception 'Item not found';
    end if;
end;
$$;

-- Admin helper for setup: run in the SQL editor after creating the owner's
-- account in Authentication -> Users.  select public.make_admin('owner@cafe.com');
create function public.make_admin(p_email text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_user uuid;
begin
    select id into v_user from auth.users where lower(email) = lower(trim(p_email));
    if v_user is null then
        raise exception 'No user with email %', p_email;
    end if;
    insert into public.profiles (id, role) values (v_user, 'admin')
    on conflict (id) do update set role = 'admin', customer_id = null;
    return 'ok';
end;
$$;
revoke execute on function public.make_admin(text) from public, anon, authenticated;
