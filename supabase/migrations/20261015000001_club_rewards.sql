-- FiKA Club: birthdays (asked at sign-in, set once, owner-approved changes, gift in a window once a year),
-- monthly tiers that reset on the 1st, monthly milestones, owner-only leaderboard, special rewards,
-- and a paid Members Club earned over a rolling 12 months. Every rule is set per cafe.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

-- ---------------------------------------------------------------------------
-- Settings: one jsonb per cafe (settings.club_config), merged over these defaults
-- ---------------------------------------------------------------------------
create function public.club_defaults() returns jsonb
language sql immutable as $$
    select '{
      "tiers": [
        {"name": "Bronze", "color": "#9A6B3F", "orders": 0, "multiplier": 1, "pct": 0, "perks": ""},
        {"name": "Silver", "color": "#7C8A93", "orders": 4, "multiplier": 1.25, "pct": 0, "perks": ""},
        {"name": "Gold", "color": "#B7841A", "orders": 8, "multiplier": 1.5, "pct": 5, "perks": ""},
        {"name": "Platinum", "color": "#3C4A57", "orders": 15, "multiplier": 2, "pct": 10, "perks": ""}
      ],
      "carry": false,
      "minOrderValue": 100,
      "discountCap": 25,
      "clubOn": true,
      "graceDays": 3,
      "levels": [
        {"name": "Club", "orders": 60, "price": 199, "months": 1, "pct": 10, "cap": 50, "multiplier": 2,
         "perks": "Free filter coffee every week · priority pickup"},
        {"name": "Club Elite", "orders": 120, "price": 349, "months": 1, "pct": 15, "cap": 80, "multiplier": 3,
         "perks": "Free coffee and dessert every week · priority pickup"}
      ],
      "birthday": {"askAtSignin": true, "before": 3, "after": 7, "minOrders": 1, "minAccountDays": 30, "bonusPoints": 100}
    }'::jsonb;
$$;

create function public.club_config(p_tenant uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select d || coalesce(s, '{}'::jsonb)
           || jsonb_build_object('birthday', (d -> 'birthday') || coalesce(s -> 'birthday', '{}'::jsonb))
      from (select public.club_defaults() d,
                   public.get_setting('club_config', null, coalesce(p_tenant, public.view_tenant_id())) s) x;
$$;

-- Owner saves the whole club setup; checked here so a typo cannot break bills
create function public.save_club_config(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_c jsonb := public.club_defaults() || coalesce(p, '{}');
    t jsonb;
    v_prev numeric := -1;
    v_i integer := 0;
begin
    perform public.require_perm('settings.edit');
    if jsonb_typeof(v_c -> 'tiers') <> 'array' or jsonb_array_length(v_c -> 'tiers') not between 1 and 6 then
        raise exception 'Set between 1 and 6 tiers';
    end if;
    for t in select * from jsonb_array_elements(v_c -> 'tiers') loop
        if trim(coalesce(t ->> 'name', '')) = '' then raise exception 'Every tier needs a name'; end if;
        if (t ->> 'orders')::numeric <= v_prev then raise exception 'Tiers must go up: each needs more orders than the one before'; end if;
        if v_i = 0 and (t ->> 'orders')::numeric <> 0 then raise exception 'The first tier starts at 0 orders'; end if;
        if coalesce((t ->> 'pct')::numeric, 0) not between 0 and 50 then raise exception 'Tier discount must be 0 to 50%%'; end if;
        if coalesce((t ->> 'multiplier')::numeric, 1) not between 1 and 5 then raise exception 'Points multiplier must be 1 to 5'; end if;
        v_prev := (t ->> 'orders')::numeric;
        v_i := v_i + 1;
    end loop;
    v_prev := 0;
    if jsonb_typeof(v_c -> 'levels') <> 'array' or jsonb_array_length(v_c -> 'levels') > 3 then
        raise exception 'Set up to 3 Club levels';
    end if;
    for t in select * from jsonb_array_elements(v_c -> 'levels') loop
        if trim(coalesce(t ->> 'name', '')) = '' then raise exception 'Every Club level needs a name'; end if;
        if (t ->> 'orders')::numeric <= v_prev then raise exception 'Club levels must go up: each needs more orders than the one before'; end if;
        if coalesce((t ->> 'price')::numeric, -1) < 0 then raise exception 'Club price cannot be negative'; end if;
        if coalesce((t ->> 'months')::integer, 0) not between 1 and 12 then raise exception 'Membership length is 1 to 12 months'; end if;
        if coalesce((t ->> 'pct')::numeric, 0) not between 0 and 50 then raise exception 'Member discount must be 0 to 50%%'; end if;
        if coalesce((t ->> 'cap')::numeric, 0) < 0 then raise exception 'Member discount cap cannot be negative'; end if;
        if coalesce((t ->> 'multiplier')::numeric, 1) not between 1 and 5 then raise exception 'Points multiplier must be 1 to 5'; end if;
        v_prev := (t ->> 'orders')::numeric;
    end loop;
    if coalesce((v_c ->> 'discountCap')::numeric, -1) not between 0 and 100 then raise exception 'Discount cap must be 0 to 100%%'; end if;
    if coalesce((v_c ->> 'minOrderValue')::numeric, -1) < 0 then raise exception 'Minimum order value cannot be negative'; end if;
    if coalesce((v_c ->> 'graceDays')::integer, -1) not between 0 and 14 then raise exception 'Grace days must be 0 to 14'; end if;
    if coalesce((v_c #>> '{birthday,before}')::integer, -1) not between 0 and 14
       or coalesce((v_c #>> '{birthday,after}')::integer, -1) not between 0 and 30 then
        raise exception 'Birthday window: up to 14 days before and 30 days after';
    end if;
    if coalesce((v_c #>> '{birthday,minAccountDays}')::integer, -1) not between 0 and 365
       or coalesce((v_c #>> '{birthday,minOrders}')::integer, -1) not between 0 and 50
       or coalesce((v_c #>> '{birthday,bonusPoints}')::integer, -1) not between 0 and 10000 then
        raise exception 'Check the birthday rules: account age 0 to 365 days, 0 to 50 orders, 0 to 10000 points';
    end if;
    insert into public.settings (tenant_id, key, value, description)
    values (v_tenant, 'club_config', v_c, 'FiKA Club: tiers, Club levels, birthday rules')
    on conflict (tenant_id, key) do update set value = excluded.value;
    perform public.audit_event(v_tenant, 'settings', 'club_config', 'Club settings saved', null, v_c);
    return v_c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Counting: paid orders worth at least the minimum, never cancelled; membership fees are not orders of the customer
-- ---------------------------------------------------------------------------
create function public.club_month_start(p_tenant uuid, p_day date default null) returns date
language sql stable set search_path = public, pg_temp as $$
    select date_trunc('month', coalesce(p_day, public.cafe_today(p_tenant)))::date;
$$;

create function public.club_orders_between(p_customer uuid, p_from date, p_to date) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
    select count(*)::integer
      from public.orders o join public.customers c on c.id = o.customer_id
     where o.customer_id = p_customer and o.status = 'paid'
       and o.total >= coalesce((public.club_config(c.tenant_id) ->> 'minOrderValue')::numeric, 0)
       and public.order_local_date(o) >= p_from and public.order_local_date(o) < p_to;
$$;

-- Tier for a count of orders this month
create function public.club_tier_for(p_cfg jsonb, p_orders integer) returns jsonb
language sql immutable as $$
    select coalesce((select t || jsonb_build_object('index', ord - 1)
                       from jsonb_array_elements(p_cfg -> 'tiers') with ordinality e(t, ord)
                      where (t ->> 'orders')::numeric <= p_orders order by (t ->> 'orders')::numeric desc limit 1),
                    (p_cfg -> 'tiers' -> 0) || '{"index": 0}'::jsonb);
$$;

create function public.club_level_for(p_cfg jsonb, p_orders integer) returns jsonb
language sql immutable as $$
    select (select t || jsonb_build_object('index', ord - 1)
              from jsonb_array_elements(p_cfg -> 'levels') with ordinality e(t, ord)
             where (t ->> 'orders')::numeric <= p_orders order by (t ->> 'orders')::numeric desc limit 1);
$$;

-- Month-end memory: last month tier is saved once and not changed by later cancellations
create table public.club_month_snapshots (
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    customer_id uuid not null references public.customers (id) on delete cascade,
    month date not null,
    orders integer not null,
    tier text not null,
    tier_index integer not null,
    primary key (customer_id, month)
);
alter table public.club_month_snapshots enable row level security;

-- Read-only (bill quotes run in read-only transactions): the saved snapshot, or last month counted now
create function public.club_last_month(p_customer uuid) returns public.club_month_snapshots
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := (select tenant_id from public.customers where id = p_customer);
    v_this date := public.club_month_start(v_tenant);
    v_last date := (v_this - interval '1 month')::date;
    s public.club_month_snapshots;
    v_t jsonb;
begin
    select * into s from public.club_month_snapshots where customer_id = p_customer and month = v_last;
    if s.customer_id is null then
        s.tenant_id := v_tenant; s.customer_id := p_customer; s.month := v_last;
        s.orders := public.club_orders_between(p_customer, v_last, v_this);
        v_t := public.club_tier_for(public.club_config(v_tenant), s.orders);
        s.tier := v_t ->> 'name'; s.tier_index := (v_t ->> 'index')::integer;
    end if;
    return s;
end;
$$;
revoke execute on function public.club_last_month(uuid) from public, anon, authenticated;

-- Saves last month once (called from the customer Club screen and the daily check)
create function public.club_save_last_month(p_customer uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.club_month_snapshots := public.club_last_month(p_customer);
begin
    if s.customer_id is not null then
        insert into public.club_month_snapshots (tenant_id, customer_id, month, orders, tier, tier_index)
        values (s.tenant_id, s.customer_id, s.month, s.orders, s.tier, s.tier_index)
        on conflict (customer_id, month) do nothing;
    end if;
end;
$$;
revoke execute on function public.club_save_last_month(uuid) from public, anon, authenticated;

-- Everything about a customer standing, used by pricing, points, the app and the counter
create function public.club_status(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_cfg jsonb;
    v_today date;
    v_m date;
    v_y date;
    v_month integer;
    v_year integer;
    v_tier jsonb;
    v_last public.club_month_snapshots;
    v_level jsonb;
    v_mem record;
begin
    select * into c from public.customers where id = p_customer;
    if c.id is null then return null; end if;
    v_cfg := public.club_config(c.tenant_id);
    v_today := public.cafe_today(c.tenant_id);
    v_m := public.club_month_start(c.tenant_id);
    v_y := (v_m - interval '11 months')::date;
    v_month := public.club_orders_between(c.id, v_m, v_today + 1);
    v_year := public.club_orders_between(c.id, v_y, v_today + 1);
    v_tier := public.club_tier_for(v_cfg, v_month);
    v_last := public.club_last_month(c.id);
    -- Optional: a tier reached last month stays through this month
    if coalesce((v_cfg ->> 'carry')::boolean, false) and v_last.tier_index > (v_tier ->> 'index')::integer then
        v_tier := (v_cfg -> 'tiers' -> v_last.tier_index) || jsonb_build_object('index', v_last.tier_index, 'carried', true);
    end if;
    v_level := public.club_level_for(v_cfg, v_year);
    select m.* into v_mem from public.club_memberships m
     where m.customer_id = c.id and m.status = 'active'
       and v_today <= m.ends_on + coalesce((v_cfg ->> 'graceDays')::integer, 0)
     order by m.ends_on desc limit 1;
    return jsonb_build_object(
        'monthOrders', v_month, 'yearOrders', v_year,
        'tier', v_tier,
        'nextTier', (select t from jsonb_array_elements(v_cfg -> 'tiers') t where (t ->> 'orders')::numeric > v_month
                      order by (t ->> 'orders')::numeric limit 1),
        'lastMonth', jsonb_build_object('tier', v_last.tier, 'orders', v_last.orders, 'month', v_last.month),
        'level', v_level,
        'nextLevel', (select t from jsonb_array_elements(v_cfg -> 'levels') t where (t ->> 'orders')::numeric > v_year
                       order by (t ->> 'orders')::numeric limit 1),
        'member', case when v_mem.id is null then null else jsonb_build_object(
            'id', v_mem.id, 'level', v_mem.level_name, 'levelIndex', v_mem.level_index, 'code', v_mem.member_code,
            'startsOn', v_mem.starts_on, 'endsOn', v_mem.ends_on, 'inGrace', v_today > v_mem.ends_on,
            'pct', v_mem.pct, 'cap', v_mem.cap, 'multiplier', v_mem.multiplier) end);
end;
$$;
revoke execute on function public.club_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Members Club
-- ---------------------------------------------------------------------------
create table public.club_memberships (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    customer_id uuid not null references public.customers (id) on delete cascade,
    level_index integer not null,
    level_name text not null,
    status text not null default 'requested' check (status in ('requested', 'active', 'cancelled', 'declined')),
    price numeric(10, 2) not null default 0,
    months integer not null default 1,
    pct numeric(5, 2) not null default 0,
    cap numeric(10, 2) not null default 0,
    multiplier numeric(4, 2) not null default 1,
    member_code text not null default '',
    starts_on date,
    ends_on date,
    order_id uuid references public.orders (id) on delete set null,
    payment_method text not null default '',
    activated_by text not null default '',
    note text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index club_memberships_customer on public.club_memberships (customer_id, status, ends_on desc);
create index club_memberships_tenant on public.club_memberships (tenant_id, status);
alter table public.club_memberships enable row level security;
create policy "staff read" on public.club_memberships for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('customers.view')));

-- Customer: ask to join (eligibility on the last 12 months)
create function public.request_club_join(p_level integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_cfg jsonb;
    v_st jsonb;
    v_lv jsonb;
    v_idx integer;
    v_id uuid;
begin
    select * into c from public.customers where id = public.current_customer_id();
    if c.id is null then raise exception 'Please sign in first'; end if;
    v_cfg := public.club_config(c.tenant_id);
    if not coalesce((v_cfg ->> 'clubOn')::boolean, false) then raise exception 'The Members Club is not open right now'; end if;
    v_st := public.club_status(c.id);
    v_idx := coalesce(p_level, (v_st #>> '{level,index}')::integer);
    v_lv := v_cfg -> 'levels' -> v_idx;
    if v_lv is null or (v_st ->> 'yearOrders')::integer < (v_lv ->> 'orders')::integer then
        raise exception 'You need % orders in the last 12 months for %', coalesce(v_lv ->> 'orders', '?'), coalesce(v_lv ->> 'name', 'the Club');
    end if;
    if v_st -> 'member' is not null and not (v_st #>> '{member,inGrace}')::boolean then
        raise exception 'You are already a member till %', to_char((v_st #>> '{member,endsOn}')::date, 'DD Mon');
    end if;
    select id into v_id from public.club_memberships where customer_id = c.id and status = 'requested';
    if v_id is not null then
        update public.club_memberships set level_index = v_idx, level_name = v_lv ->> 'name', price = (v_lv ->> 'price')::numeric,
               updated_at = now() where id = v_id;
    else
        insert into public.club_memberships (tenant_id, customer_id, level_index, level_name, price, months)
        values (c.tenant_id, c.id, v_idx, v_lv ->> 'name', (v_lv ->> 'price')::numeric, (v_lv ->> 'months')::integer)
        returning id into v_id;
        perform public.notify(c.tenant_id, 'reward',
            coalesce(nullif(c.name, ''), 'Customer ' || right(c.phone, 4)) || ' wants to join ' || (v_lv ->> 'name'),
            'Take ' || public.inr((v_lv ->> 'price')::numeric) || ' at the counter, then activate in Customers → Club',
            '/admin/club?tab=members', 'customers.view', 'normal', jsonb_build_object('membershipId', v_id));
    end if;
    return jsonb_build_object('id', v_id, 'level', v_lv ->> 'name', 'price', (v_lv ->> 'price')::numeric);
end;
$$;

-- Staff: take the fee at the counter and switch membership on. The fee is a bill of its own
-- (CGST 9% + SGST 9% included), so cash, UPI, the drawer, GST and daily reports all see it.
create function public.activate_club_membership(p_customer uuid, p_level integer, p_method text,
                                                p_drawer text default 'cash_counter', p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    c public.customers;
    v_cfg jsonb;
    v_st jsonb;
    v_lv jsonb;
    v_price numeric;
    v_net numeric;
    v_tax numeric;
    v_tz text;
    v_order uuid;
    v_start date;
    v_end date;
    v_req uuid;
    v_id uuid;
    v_code text;
begin
    perform public.require_perm('orders.edit');
    if p_method not in ('cash', 'upi', 'card') then raise exception 'Choose cash, UPI or card'; end if;
    select * into c from public.customers where id = p_customer and tenant_id = v_tenant;
    if c.id is null then raise exception 'Customer not found'; end if;
    v_cfg := public.club_config(v_tenant);
    v_lv := v_cfg -> 'levels' -> p_level;
    if v_lv is null then raise exception 'Club level not found'; end if;
    v_st := public.club_status(c.id);
    if (v_st ->> 'yearOrders')::integer < (v_lv ->> 'orders')::integer then
        if not (p_override and public.has_perm('settings.edit')) then
            raise exception '% has % orders in the last 12 months; % needs %', coalesce(nullif(c.name, ''), 'This customer'),
                v_st ->> 'yearOrders', v_lv ->> 'name', v_lv ->> 'orders';
        end if;
    end if;
    v_price := round((v_lv ->> 'price')::numeric, 2);
    v_tz := public.cafe_timezone(v_tenant);
    -- Renewal starts the day after the current membership ends
    v_start := greatest(public.cafe_today(v_tenant),
                        coalesce((select max(ends_on) + 1 from public.club_memberships where customer_id = c.id and status = 'active'), '-infinity'::date));
    v_end := (v_start + make_interval(months => (v_lv ->> 'months')::integer) - interval '1 day')::date;

    if v_price > 0 then
        v_net := round(v_price / 1.18, 2);
        v_tax := v_price - v_net;
        insert into public.orders (tenant_id, order_number, customer_id, subtotal, discount, tax, gst_rate, tax_details, restaurant_info,
                                   total, status, channel, special_instructions, created_by_staff, staff_name)
        values (v_tenant, 'MEM-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6)),
                null, v_price, 0, v_tax, 18,
                jsonb_build_array(jsonb_build_object('name', 'CGST', 'rate', 9, 'amount', round(v_tax / 2, 2)),
                                  jsonb_build_object('name', 'SGST', 'rate', 9, 'amount', v_tax - round(v_tax / 2, 2))),
                jsonb_build_object(
                    'name', public.get_setting('restaurant_name', '""', v_tenant) #>> '{}',
                    'address', public.get_setting('restaurant_address', '""', v_tenant) #>> '{}',
                    'phone', public.get_setting('restaurant_phone', '""', v_tenant) #>> '{}',
                    'gstNumber', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
                    'fssaiNumber', public.get_setting('fssai_number', '""', v_tenant) #>> '{}'),
                v_price, 'confirmed', 'takeaway',
                'Members Club: ' || coalesce(nullif(c.name, ''), 'Customer') || ' · ' || right(c.phone, 4),
                public.my_staff_id(), public.actor_name())
        returning id into v_order;
        insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted, price_includes_tax,
                                        tax_rate, discount, net_amount, tax_amount, unit_cost, kitchen_status)
        values (v_order, null, (v_lv ->> 'name') || ' membership · ' || (v_lv ->> 'months') || ' month' ||
                               case when (v_lv ->> 'months')::integer > 1 then 's' else '' end,
                v_price, 1, v_price, false, true, 18, 0, v_net, v_tax, 0, 'served');
        perform public.settle_order(v_order, jsonb_build_array(jsonb_build_object('method', p_method, 'amount', v_price)), p_drawer, null);
    end if;

    v_code := 'FK-' || lpad(((select count(*) from public.club_memberships where tenant_id = v_tenant and member_code <> '') + 1001)::text, 4, '0');
    select id into v_req from public.club_memberships where customer_id = c.id and status = 'requested' limit 1;
    if v_req is not null then
        update public.club_memberships
           set status = 'active', level_index = p_level, level_name = v_lv ->> 'name', price = v_price,
               months = (v_lv ->> 'months')::integer, pct = coalesce((v_lv ->> 'pct')::numeric, 0), cap = coalesce((v_lv ->> 'cap')::numeric, 0),
               multiplier = coalesce((v_lv ->> 'multiplier')::numeric, 1), member_code = v_code, starts_on = v_start, ends_on = v_end,
               order_id = v_order, payment_method = p_method, activated_by = public.actor_name(), updated_at = now()
         where id = v_req returning id into v_id;
    else
        insert into public.club_memberships (tenant_id, customer_id, level_index, level_name, status, price, months, pct, cap, multiplier,
                                             member_code, starts_on, ends_on, order_id, payment_method, activated_by)
        values (v_tenant, c.id, p_level, v_lv ->> 'name', 'active', v_price, (v_lv ->> 'months')::integer,
                coalesce((v_lv ->> 'pct')::numeric, 0), coalesce((v_lv ->> 'cap')::numeric, 0), coalesce((v_lv ->> 'multiplier')::numeric, 1),
                v_code, v_start, v_end, v_order, p_method, public.actor_name())
        returning id into v_id;
    end if;
    perform public.audit_event(v_tenant, 'club_membership', v_id::text,
        'Members Club ' || (v_lv ->> 'name') || ' for ' || coalesce(nullif(c.name, ''), c.phone) || ' till ' || to_char(v_end, 'DD Mon YYYY'),
        null, jsonb_build_object('price', v_price, 'method', p_method, 'override', p_override));
    return jsonb_build_object('id', v_id, 'code', v_code, 'level', v_lv ->> 'name', 'startsOn', v_start, 'endsOn', v_end, 'orderId', v_order);
end;
$$;

create function public.cancel_club_membership(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('settings.edit');
    if trim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason'; end if;
    update public.club_memberships
       set status = case when status = 'requested' then 'declined' else 'cancelled' end, note = trim(p_reason), updated_at = now()
     where id = p_id and tenant_id = public.current_tenant_id() and status in ('requested', 'active');
    if not found then raise exception 'Membership not found'; end if;
    perform public.audit_event(public.current_tenant_id(), 'club_membership', p_id::text, 'Members Club cancelled: ' || trim(p_reason), null, null);
end;
$$;

create function public.club_members() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
    v_grace integer := coalesce((public.club_config(public.current_tenant_id()) ->> 'graceDays')::integer, 0);
begin
    perform public.require_perm('customers.view');
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', m.id, 'customerId', c.id, 'name', c.name,
                   'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end,
                   'level', m.level_name, 'levelIndex', m.level_index, 'status', m.status, 'price', m.price, 'code', m.member_code,
                   'startsOn', m.starts_on, 'endsOn', m.ends_on, 'method', m.payment_method, 'by', m.activated_by, 'note', m.note,
                   'requestedAt', m.created_at,
                   'state', case when m.status = 'requested' then 'requested'
                                 when m.status <> 'active' then m.status
                                 when v_today > m.ends_on + v_grace then 'lapsed'
                                 when v_today > m.ends_on then 'grace'
                                 when m.ends_on - v_today <= 7 then 'expiring'
                                 else 'active' end,
                   'yearOrders', public.club_orders_between(c.id, (public.club_month_start(v_tenant) - interval '11 months')::date, v_today + 1))
               order by (m.status = 'requested') desc, m.ends_on nulls first)
          from public.club_memberships m join public.customers c on c.id = m.customer_id
         where m.tenant_id = v_tenant and (m.status in ('requested', 'active') or m.updated_at > now() - interval '60 days')), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pricing: tier % and member % on items that may be discounted, with one cap on combined discounts per bill.
-- price_order passes what it applied to the order insert through a transaction setting (club.pricing).
-- ---------------------------------------------------------------------------
alter table public.orders
    add column club_discount numeric(10, 2) not null default 0,
    add column club_detail jsonb not null default '{}';

create function public.club_discount_for(p_tenant uuid, p_customer uuid, p_base numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_st jsonb;
    v_tier_pct numeric := 0;
    v_mem_pct numeric := 0;
    v_mem_cap numeric := 0;
    v_tier_amt numeric := 0;
    v_mem_amt numeric := 0;
    v_used_today boolean;
begin
    if p_customer is null or coalesce(p_base, 0) <= 0 then
        return jsonb_build_object('amount', 0);
    end if;
    v_st := public.club_status(p_customer);
    v_tier_pct := coalesce((v_st #>> '{tier,pct}')::numeric, 0);
    if v_st -> 'member' is not null then
        v_mem_pct := coalesce((v_st #>> '{member,pct}')::numeric, 0);
        v_mem_cap := coalesce((v_st #>> '{member,cap}')::numeric, 0);
        -- One member-discounted bill per day
        select exists (select 1 from public.orders o where o.customer_id = p_customer and o.status <> 'cancelled'
                         and public.order_local_date(o) = public.cafe_today(p_tenant)
                         and coalesce((o.club_detail ->> 'memberAmount')::numeric, 0) > 0) into v_used_today;
        if v_used_today then v_mem_pct := 0; end if;
    end if;
    v_tier_amt := round(p_base * v_tier_pct / 100, 2);
    v_mem_amt := round(p_base * v_mem_pct / 100, 2);
    if v_mem_cap > 0 then v_mem_amt := least(v_mem_amt, v_mem_cap); end if;
    return jsonb_build_object('tier', v_st #>> '{tier,name}', 'tierPct', v_tier_pct, 'tierAmount', v_tier_amt,
                              'member', v_st #>> '{member,level}', 'memberPct', v_mem_pct, 'memberAmount', v_mem_amt,
                              'memberUsedToday', coalesce(v_used_today, false),
                              'amount', v_tier_amt + v_mem_amt,
                              'cap', coalesce((public.club_config(p_tenant) ->> 'discountCap')::numeric, 100));
end;
$$;
revoke execute on function public.club_discount_for(uuid, uuid, numeric) from public, anon, authenticated;

create or replace function public.price_order(p_tenant uuid, p_customer uuid, p_items jsonb, p_coupon_code text, p_loyalty_offer_id uuid,
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
        'pointsUsed', coalesce(v_offer.points_required, 0),
        'tax', (v_calc ->> 'tax')::numeric,
        'taxDetails', v_calc -> 'tax_details',
        'total', (v_calc ->> 'gross')::numeric + (v_calc ->> 'excl_tax')::numeric);
end;
$$;

-- The order remembers the club discount it got (needed for "one member discount a day" and reports)
create function public.orders_club_detail() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_raw text := current_setting('club.pricing', true);
    v jsonb;
begin
    if coalesce(v_raw, '') <> '' then
        v := v_raw::jsonb;
        if new.customer_id is not null and (v ->> 'customer') = new.customer_id::text then
            new.club_discount := coalesce((v ->> 'amount')::numeric, 0);
            new.club_detail := v - 'customer';
        end if;
        perform set_config('club.pricing', '', true);
    end if;
    return new;
end;
$$;
create trigger orders_club_detail before insert on public.orders
    for each row execute function public.orders_club_detail();

-- ---------------------------------------------------------------------------
-- Points: the best of a points boost, the monthly tier and the membership multiplies the points of a paid order
-- ---------------------------------------------------------------------------
-- 1.5 → "1.5", 2.00 → "2"
create function public.fmt_multiplier(p numeric) returns text
language sql immutable as $$
    select case when p = trunc(p) then trunc(p)::text else rtrim(round(p, 2)::text, '0') end;
$$;

create or replace function public.orders_rewards_paid() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_extra integer;
    v_group text;
    v_st jsonb;
    v_mult numeric := 1;
    v_why text := '';
begin
    if new.status <> 'paid' or old.status = 'paid' or new.customer_id is null then
        return null;
    end if;
    select * into c from public.customers where id = new.customer_id;
    if c.points_multiplier > 1 and c.multiplier_until > now() then
        v_mult := c.points_multiplier; v_why := 'Points boost';
    end if;
    v_st := public.club_status(c.id);
    if coalesce((v_st #>> '{tier,multiplier}')::numeric, 1) > v_mult then
        v_mult := (v_st #>> '{tier,multiplier}')::numeric; v_why := (v_st #>> '{tier,name}') || ' tier';
    end if;
    if coalesce((v_st #>> '{member,multiplier}')::numeric, 1) > v_mult then
        v_mult := (v_st #>> '{member,multiplier}')::numeric; v_why := (v_st #>> '{member,level}') || ' member';
    end if;
    if v_mult > 1 and new.points_awarded > 0 then
        v_extra := floor(new.points_awarded * (v_mult - 1));
        if v_extra > 0 then
            update public.customers set loyalty_points = loyalty_points + v_extra, total_points_earned = total_points_earned + v_extra
             where id = c.id;
            insert into public.reward_grants (tenant_id, customer_id, order_id, source, title, reward_label, reward_type, points, cost, created_by)
            values (new.tenant_id, c.id, new.id, 'multiplier', v_why || ' ' || public.fmt_multiplier(v_mult) || '× points',
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

-- ---------------------------------------------------------------------------
-- Monthly milestones are reward rules (kind month_milestone): the Nth paid order this month, once per month
-- ---------------------------------------------------------------------------
alter table public.reward_rules drop constraint reward_rules_trigger_kind_check;
alter table public.reward_rules add constraint reward_rules_trigger_kind_check
    check (trigger_kind in ('nth_order', 'spend_crosses', 'first_order', 'streak', 'birthday', 'anniversary', 'inactive',
                            'group', 'instagram', 'manual', 'month_milestone'));

create or replace function public.evaluate_order_rewards(p_order uuid) returns integer
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
    v_month integer;
begin
    select * into o from public.orders where id = p_order;
    if o.customer_id is null or o.status <> 'paid' then return 0; end if;
    v_tz := public.cafe_timezone(o.tenant_id);
    v_month := public.club_orders_between(o.customer_id, public.club_month_start(o.tenant_id, public.order_local_date(o)),
                                          (public.club_month_start(o.tenant_id, public.order_local_date(o)) + interval '1 month')::date);
    for r in select * from public.reward_rules
              where tenant_id = o.tenant_id and is_active
                and trigger_kind in ('nth_order', 'spend_crosses', 'first_order', 'streak', 'month_milestone')
              order by trigger_kind = 'month_milestone', trigger_value, created_at loop
        if not public.reward_conditions_ok(r, o) then continue; end if;
        v_from := case when r.trigger_period = 'month'
                       then (date_trunc('month', public.order_local_date(o))::timestamp at time zone v_tz) else '-infinity' end;
        v_hit := false;
        if r.trigger_kind = 'month_milestone' then
            -- reached N this month and not given yet this month (per-month limit in reward_blocked)
            v_hit := r.trigger_value >= 1 and v_month >= r.trigger_value::integer;
            v_title := 'Order ' || r.trigger_value::integer || ' this month';
        elsif r.trigger_kind in ('nth_order', 'first_order') then
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

-- A cancelled order that earned a milestone gift: the unused gift coupon stops working
create function public.orders_void_milestone_gifts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
        update public.coupons set is_active = false
         where id in (select g.coupon_id from public.reward_grants g join public.reward_rules r on r.id = g.rule_id
                       where g.order_id = new.id and g.used_at is null and g.coupon_id is not null and r.trigger_kind = 'month_milestone');
        update public.reward_grants g set title = g.title || ' (order cancelled)', expires_at = now()
          from public.reward_rules r
         where r.id = g.rule_id and g.order_id = new.id and g.used_at is null and r.trigger_kind = 'month_milestone';
    end if;
    return null;
end;
$$;
create trigger orders_void_milestone_gifts after update of status on public.orders
    for each row execute function public.orders_void_milestone_gifts();

-- ---------------------------------------------------------------------------
-- Birthdays: day and month (stored in year 2000, a leap year, so 29 Feb works), set once,
-- changes only through an owner-approved request, one approved change per 12 months
-- ---------------------------------------------------------------------------
create table public.birthday_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    customer_id uuid not null references public.customers (id) on delete cascade,
    old_birthday date,
    new_birthday date not null,
    reason text not null default '',
    status text not null default 'open' check (status in ('open', 'approved', 'rejected')),
    decided_by text not null default '',
    decided_at timestamptz,
    note text not null default '',
    created_at timestamptz not null default now()
);
create index birthday_requests_tenant on public.birthday_requests (tenant_id, status, created_at desc);
alter table public.birthday_requests enable row level security;

create function public.birthday_from(p_day integer, p_month integer) returns date
language plpgsql immutable as $$
begin
    if p_month is null or p_day is null or p_month not between 1 and 12 or p_day < 1
       or p_day > extract(day from (make_date(2000, p_month, 1) + interval '1 month' - interval '1 day')) then
        raise exception 'Pick a real date';
    end if;
    return make_date(2000, p_month, p_day);
end;
$$;

create function public.set_my_birthday(p_day integer, p_month integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_b date := public.birthday_from(p_day, p_month);
begin
    select * into c from public.customers where id = public.current_customer_id() for update;
    if c.id is null then raise exception 'Please sign in first'; end if;
    if c.birthday is not null then
        if to_char(c.birthday, 'MMDD') = to_char(v_b, 'MMDD') then
            return jsonb_build_object('day', p_day, 'month', p_month, 'locked', true);
        end if;
        raise exception 'Your birthday is already saved. Ask the cafe to change it.';
    end if;
    update public.customers set birthday = v_b where id = c.id;
    return jsonb_build_object('day', p_day, 'month', p_month, 'locked', true);
end;
$$;

create function public.request_birthday_change(p_day integer, p_month integer, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_b date := public.birthday_from(p_day, p_month);
    v_id uuid;
begin
    select * into c from public.customers where id = public.current_customer_id();
    if c.id is null then raise exception 'Please sign in first'; end if;
    if c.birthday is null then raise exception 'Add your birthday first; it can be set once without a request'; end if;
    if to_char(c.birthday, 'MMDD') = to_char(v_b, 'MMDD') then raise exception 'That is already your saved birthday'; end if;
    if trim(coalesce(p_reason, '')) = '' then raise exception 'Tell the cafe why the date is wrong'; end if;
    if exists (select 1 from public.birthday_requests where customer_id = c.id and status = 'open') then
        raise exception 'You already have a request waiting';
    end if;
    if exists (select 1 from public.birthday_requests where customer_id = c.id and status = 'approved' and decided_at > now() - interval '12 months') then
        raise exception 'Your birthday was changed in the last 12 months. Please talk to the cafe.';
    end if;
    insert into public.birthday_requests (tenant_id, customer_id, old_birthday, new_birthday, reason)
    values (c.tenant_id, c.id, c.birthday, v_b, left(trim(p_reason), 200))
    returning id into v_id;
    perform public.notify(c.tenant_id, 'approval',
        coalesce(nullif(c.name, ''), 'Customer ' || right(c.phone, 4)) || ' asks to change birthday to ' || to_char(v_b, 'DD Mon'),
        'Check an ID at the counter, then approve in Customers → Club → Requests', '/admin/club?tab=requests', 'customers.view', 'normal');
    return v_id;
end;
$$;

create function public.birthday_requests_list(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.view');
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', r.id, 'customerId', c.id, 'name', c.name,
                   'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end,
                   'from', to_char(r.old_birthday, 'DD Mon'), 'to', to_char(r.new_birthday, 'DD Mon'), 'reason', r.reason,
                   'status', r.status, 'by', r.decided_by, 'note', r.note, 'createdAt', r.created_at, 'decidedAt', r.decided_at)
               order by r.created_at desc)
          from public.birthday_requests r join public.customers c on c.id = r.customer_id
         where r.tenant_id = public.current_tenant_id()
           and (p_status = 'all' or r.status = p_status or (p_status = 'open' and r.decided_at > now() - interval '3 days'))), '[]'::jsonb);
end;
$$;

create function public.decide_birthday_request(p_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r public.birthday_requests;
begin
    perform public.require_perm('customers.edit');
    select * into r from public.birthday_requests where id = p_id and tenant_id = public.current_tenant_id() for update;
    if r.id is null or r.status <> 'open' then raise exception 'Request not found or already decided'; end if;
    update public.birthday_requests set status = case when p_approve then 'approved' else 'rejected' end,
           decided_by = public.actor_name(), decided_at = now(), note = left(coalesce(p_note, ''), 200)
     where id = p_id;
    if p_approve then
        update public.customers set birthday = r.new_birthday where id = r.customer_id;
    end if;
    perform public.audit_event(r.tenant_id, 'customer', r.customer_id::text,
        'Birthday change ' || case when p_approve then 'approved' else 'rejected' end || ': '
        || to_char(r.old_birthday, 'DD Mon') || ' → ' || to_char(r.new_birthday, 'DD Mon'),
        jsonb_build_object('birthday', r.old_birthday), jsonb_build_object('birthday', case when p_approve then r.new_birthday else r.old_birthday end));
end;
$$;

-- Customers with the same name and birthday on different numbers (possible second accounts)
create function public.birthday_duplicates() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('customers.view');
    return coalesce((
        select jsonb_agg(jsonb_build_object('name', min(c.name), 'birthday', to_char(c.birthday, 'DD Mon'), 'count', count(*),
                                            'phones', jsonb_agg(public.mask_phone(c.phone))))
          from public.customers c
         where c.tenant_id = public.current_tenant_id() and c.birthday is not null and trim(c.name) <> ''
         group by lower(trim(c.name)), to_char(c.birthday, 'MMDD') having count(*) > 1), '[]'::jsonb);
end;
$$;

-- This year (or next) birthday date for a stored birthday; 29 Feb falls on 28 Feb in other years
create function public.birthday_in_year(p_birthday date, p_year integer) returns date
language sql immutable as $$
    select case when extract(month from p_birthday) = 2 and extract(day from p_birthday) = 29
                     and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0))
                then make_date(p_year, 2, 28)
                else make_date(p_year, extract(month from p_birthday)::integer, extract(day from p_birthday)::integer) end;
$$;

-- The birthday being celebrated now (window open), or null
create function public.birthday_window(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_cfg jsonb;
    v_today date;
    v_d date;
    v_before integer;
    v_after integer;
    y integer;
begin
    select * into c from public.customers where id = p_customer;
    if c.birthday is null then return null; end if;
    v_cfg := public.club_config(c.tenant_id) -> 'birthday';
    v_today := public.cafe_today(c.tenant_id);
    v_before := coalesce((v_cfg ->> 'before')::integer, 3);
    v_after := coalesce((v_cfg ->> 'after')::integer, 7);
    for y in select generate_series(extract(year from v_today)::integer - 1, extract(year from v_today)::integer + 1) loop
        v_d := public.birthday_in_year(c.birthday, y);
        if v_today between v_d - v_before and v_d + v_after then
            return jsonb_build_object('date', v_d, 'from', v_d - v_before, 'to', v_d + v_after, 'open', true);
        end if;
    end loop;
    -- next one
    v_d := public.birthday_in_year(c.birthday, extract(year from v_today)::integer);
    if v_d < v_today then v_d := public.birthday_in_year(c.birthday, extract(year from v_today)::integer + 1); end if;
    return jsonb_build_object('date', v_d, 'from', v_d - v_before, 'to', v_d + v_after, 'open', false, 'inDays', v_d - v_today);
end;
$$;

-- Why a customer cannot get the gift this time (null = can)
create function public.birthday_blocked(p_customer uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_cfg jsonb;
    v_w jsonb := public.birthday_window(p_customer);
begin
    select * into c from public.customers where id = p_customer;
    if v_w is null then return 'No birthday saved'; end if;
    v_cfg := public.club_config(c.tenant_id) -> 'birthday';
    if (select count(*) from public.orders where customer_id = c.id and status = 'paid') < coalesce((v_cfg ->> 'minOrders')::integer, 0) then
        return 'Your birthday gift starts after your first order with us';
    end if;
    if (c.created_at at time zone public.cafe_timezone(c.tenant_id))::date
         > (v_w ->> 'date')::date - coalesce((v_cfg ->> 'minAccountDays')::integer, 0) then
        return 'New accounts get the birthday gift from the next birthday';
    end if;
    -- once a year, whatever the date (a changed birthday does not give a second gift)
    if exists (select 1 from public.reward_grants g join public.reward_rules r on r.id = g.rule_id
                where g.customer_id = c.id and r.trigger_kind = 'birthday' and g.created_at > now() - interval '330 days') then
        return 'Birthday gift already given this year';
    end if;
    if not exists (select 1 from public.reward_rules where tenant_id = c.tenant_id and trigger_kind = 'birthday' and is_active) then
        return 'This cafe has no birthday gift right now';
    end if;
    return null;
end;
$$;

-- Give the birthday gift when the window is open; safe to call any number of times
create function public.club_birthday_check(p_customer uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_w jsonb := public.birthday_window(p_customer);
    r public.reward_rules;
    v_grant uuid;
    v_pts integer;
    v_until timestamptz;
begin
    if v_w is null or not (v_w ->> 'open')::boolean or public.birthday_blocked(p_customer) is not null then
        return null;
    end if;
    select * into c from public.customers where id = p_customer for update;
    -- re-check under the lock (two screens at once)
    if public.birthday_blocked(p_customer) is not null then return null; end if;
    select * into r from public.reward_rules where tenant_id = c.tenant_id and trigger_kind = 'birthday' and is_active order by created_at limit 1;
    if public.reward_blocked(r, c.id) is not null and public.reward_blocked(r, c.id) <> 'Customer limit reached' then
        return null;
    end if;
    v_grant := public.grant_reward(r.id, c.id, null, 'rule', 'Happy birthday');
    -- valid through the end of the birthday window
    v_until := (((v_w ->> 'to')::date + 1)::timestamp at time zone public.cafe_timezone(c.tenant_id)) - interval '1 second';
    update public.reward_grants set expires_at = case when coupon_id is not null then v_until else expires_at end where id = v_grant;
    update public.coupons set valid_until = v_until where id = (select coupon_id from public.reward_grants where id = v_grant);
    v_pts := coalesce((public.club_config(c.tenant_id) #>> '{birthday,bonusPoints}')::integer, 0);
    if v_pts > 0 and r.reward_type <> 'points' then
        update public.customers set loyalty_points = loyalty_points + v_pts, total_points_earned = total_points_earned + v_pts where id = c.id;
        update public.reward_grants set points = points + v_pts, reward_label = reward_label || ' + ' || v_pts || ' points' where id = v_grant;
    end if;
    return v_grant;
end;
$$;
revoke execute on function public.club_birthday_check(uuid) from public, anon, authenticated;

-- Daily check: birthdays now use the window above; everything else as before
create or replace function public.run_reward_checks() returns jsonb
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

    update public.reward_rules set paused_reason = ''
     where tenant_id = v_tenant and paused_reason = 'Monthly budget used up' and extract(day from v_today) = 1;

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

    -- Birthdays: everyone whose window is open
    for c in select cu.id from public.customers cu where cu.tenant_id = v_tenant and cu.birthday is not null loop
        if public.club_birthday_check(c.id) is not null then v_n := v_n + 1; end if;
    end loop;

    -- New month: remember each customer tier of last month
    if extract(day from v_today) <= 3 then
        for c in select distinct o.customer_id as id from public.orders o
                  where o.tenant_id = v_tenant and o.customer_id is not null and o.status = 'paid'
                    and public.order_local_date(o) >= (public.club_month_start(v_tenant) - interval '1 month')::date
                    and public.order_local_date(o) < public.club_month_start(v_tenant) loop
            perform public.club_save_last_month(c.id);
        end loop;
    end if;

    for r in select * from public.reward_rules where tenant_id = v_tenant and is_active and trigger_kind in ('anniversary', 'inactive') loop
        for c in select cu.id from public.customers cu
                  where cu.tenant_id = v_tenant
                    and case r.trigger_kind
                        when 'anniversary' then to_char(cu.anniversary, 'MMDD') = to_char(v_today, 'MMDD')
                        else (select max(public.order_local_date(o)) from public.orders o where o.customer_id = cu.id and o.status = 'paid')
                                 <= v_today - greatest(r.trigger_value, 1)::integer
                             and not exists (select 1 from public.reward_grants g where g.rule_id = r.id and g.customer_id = cu.id
                                               and g.created_at > (select max(o.created_at) from public.orders o
                                                                    where o.customer_id = cu.id and o.status = 'paid')) end loop
            if public.reward_blocked(r, c.id) is null then
                perform public.grant_reward(r.id, c.id, null, 'rule',
                    case r.trigger_kind when 'anniversary' then 'Happy anniversary' else 'Missed you: ' || r.trigger_value::integer || '+ days' end);
                v_n := v_n + 1;
            end if;
        end loop;
    end loop;

    -- Members Club ending in 3 days: one reminder to staff
    if exists (select 1 from public.club_memberships where tenant_id = v_tenant and status = 'active' and ends_on = v_today + 3) then
        perform public.notify(v_tenant, 'reward',
            (select count(*) from public.club_memberships where tenant_id = v_tenant and status = 'active' and ends_on = v_today + 3)
            || ' Members Club membership(s) end in 3 days', 'Remind them to renew at the counter', '/admin/club?tab=members', 'customers.view', 'normal');
    end if;

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
-- Customer app: everything for My Month, Club level and Birthday screens
-- ---------------------------------------------------------------------------
create function public.club_public_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = public.current_customer_id()), public.view_tenant_id());
    v_cfg jsonb := public.club_config(v_tenant);
    r public.reward_rules;
begin
    select * into r from public.reward_rules where tenant_id = v_tenant and trigger_kind = 'birthday' and is_active order by created_at limit 1;
    return jsonb_build_object(
        'askBirthday', coalesce((v_cfg #>> '{birthday,askAtSignin}')::boolean, true),
        'birthdayGift', case when r.id is null then null
                             else public.reward_label(r) || case when coalesce((v_cfg #>> '{birthday,bonusPoints}')::integer, 0) > 0 and r.reward_type <> 'points'
                                                              then ' + ' || (v_cfg #>> '{birthday,bonusPoints}') || ' points' else '' end end,
        'clubOn', coalesce((v_cfg ->> 'clubOn')::boolean, true));
end;
$$;

create function public.my_club() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c public.customers;
    v_cfg jsonb;
    v_st jsonb;
    v_today date;
    v_m date;
    v_month_start timestamptz;
    v_series jsonb;
    v_w jsonb;
    v_gift jsonb;
    v_req jsonb;
begin
    select * into c from public.customers where id = public.current_customer_id();
    if c.id is null then raise exception 'Please sign in'; end if;
    perform public.club_birthday_check(c.id);
    perform public.club_save_last_month(c.id);
    select * into c from public.customers where id = c.id; -- points may have changed with the birthday gift
    v_cfg := public.club_config(c.tenant_id);
    v_st := public.club_status(c.id);
    v_today := public.cafe_today(c.tenant_id);
    v_m := public.club_month_start(c.tenant_id);
    v_month_start := v_m::timestamp at time zone public.cafe_timezone(c.tenant_id);
    select jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon'), 'start', m,
                                        'orders', public.club_orders_between(c.id, m, (m + interval '1 month')::date)) order by m)
      into v_series
      from generate_series((v_m - interval '11 months')::date, v_m, interval '1 month') g(m0), lateral (select g.m0::date m) x;
    v_w := public.birthday_window(c.id);
    select jsonb_build_object('title', g.title, 'reward', g.reward_label, 'code', g.coupon_code, 'expiresAt', g.expires_at,
                              'used', g.used_at is not null)
      into v_gift
      from public.reward_grants g join public.reward_rules r on r.id = g.rule_id
     where g.customer_id = c.id and r.trigger_kind = 'birthday' and g.created_at > now() - interval '60 days'
     order by g.created_at desc limit 1;
    select jsonb_build_object('status', b.status, 'to', to_char(b.new_birthday, 'DD Mon'), 'note', b.note, 'decidedAt', b.decided_at)
      into v_req
      from public.birthday_requests b where b.customer_id = c.id and (b.status = 'open' or b.decided_at > now() - interval '14 days')
     order by b.created_at desc limit 1;
    return jsonb_build_object(
        'name', c.name, 'points', c.loyalty_points,
        'month', jsonb_build_object(
            'label', to_char(v_m, 'FMMonth'), 'orders', v_st -> 'monthOrders', 'tier', v_st -> 'tier', 'next', v_st -> 'nextTier',
            'resetsOn', (v_m + interval '1 month')::date, 'daysLeft', ((v_m + interval '1 month')::date - v_today),
            'lastMonth', v_st -> 'lastMonth', 'tiers', v_cfg -> 'tiers', 'minOrderValue', v_cfg -> 'minOrderValue',
            'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                                'n', r.trigger_value::integer, 'reward', public.reward_label(r),
                                'done', exists (select 1 from public.reward_grants g where g.rule_id = r.id and g.customer_id = c.id
                                                  and g.created_at >= v_month_start))
                            order by r.trigger_value)
                              from public.reward_rules r where r.tenant_id = c.tenant_id and r.trigger_kind = 'month_milestone'
                               and r.is_active and r.show_customer), '[]'::jsonb)),
        'club', jsonb_build_object(
            'on', coalesce((v_cfg ->> 'clubOn')::boolean, true),
            'yearOrders', v_st -> 'yearOrders', 'level', v_st -> 'level', 'next', v_st -> 'nextLevel',
            'levels', v_cfg -> 'levels', 'series', v_series, 'member', v_st -> 'member',
            'request', (select jsonb_build_object('level', level_name, 'price', price, 'at', created_at)
                          from public.club_memberships where customer_id = c.id and status = 'requested' limit 1)),
        'birthday', jsonb_build_object(
            'day', extract(day from c.birthday), 'month', extract(month from c.birthday),
            'label', to_char(c.birthday, 'FMDD FMMonth'),
            'window', v_w, 'gift', v_gift, 'blocked', case when c.birthday is null then null else public.birthday_blocked(c.id) end,
            'request', v_req,
            'giftLabel', public.club_public_config() ->> 'birthdayGift'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner leaderboard (customers never see it) and special rewards
-- ---------------------------------------------------------------------------
create function public.club_leaderboard(p_period text default 'month', p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_cfg jsonb := public.club_config(public.current_tenant_id());
    v_today date := public.cafe_today(public.current_tenant_id());
    v_m date := public.club_month_start(public.current_tenant_id());
    v_y date;
    v_min numeric;
begin
    perform public.require_perm('customers.view');
    v_y := (v_m - interval '11 months')::date;
    v_min := coalesce((v_cfg ->> 'minOrderValue')::numeric, 0);
    return coalesce((
        select jsonb_agg(row_json order by rk) from (
            select jsonb_build_object(
                       'rank', row_number() over w, 'id', c.id, 'name', c.name,
                       'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end,
                       'month', s.month_n, 'year', s.year_n, 'spend', s.spend, 'lastVisit', s.last_at, 'group', c.group_code,
                       'points', c.loyalty_points,
                       'tier', public.club_tier_for(v_cfg, s.month_n::integer) ->> 'name',
                       'tierColor', public.club_tier_for(v_cfg, s.month_n::integer) ->> 'color',
                       'level', public.club_level_for(v_cfg, s.year_n::integer) ->> 'name',
                       'member', (select m.level_name from public.club_memberships m where m.customer_id = c.id and m.status = 'active'
                                     and v_today <= m.ends_on order by m.ends_on desc limit 1)) as row_json,
                   row_number() over w as rk
              from public.customers c
              join lateral (
                  select count(*) filter (where public.order_local_date(o) >= v_m and o.total >= v_min) as month_n,
                         count(*) filter (where public.order_local_date(o) >= v_y and o.total >= v_min) as year_n,
                         coalesce(sum(o.total) filter (where public.order_local_date(o) >= v_y), 0) as spend,
                         max(o.created_at) as last_at
                    from public.orders o where o.customer_id = c.id and o.status = 'paid') s on true
             where c.tenant_id = v_tenant
               and (case when p_period = 'year' then s.year_n else s.month_n end) > 0
               and not exists (select 1 from public.staff_users su where su.tenant_id = v_tenant and su.phone = c.phone)
            window w as (order by case when p_period = 'year' then s.year_n else s.month_n end desc, s.spend desc, c.created_at)
            limit greatest(least(coalesce(p_limit, 100), 500), 1)) x), '[]'::jsonb);
end;
$$;

-- One-off gifts from the owner to one customer or a whole list: points, ₹ or % coupon, or a free item
create function public.give_special_reward(p_customers uuid[], p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_type text := coalesce(p ->> 'type', '');
    v_value numeric := coalesce(nullif(p ->> 'value', '')::numeric, 0);
    v_days integer := coalesce(nullif(p ->> 'days', '')::integer, 14);
    v_note text := left(trim(coalesce(p ->> 'note', '')), 120);
    v_item public.menu_items;
    v_rule uuid;
    v_c uuid;
    v_n integer := 0;
begin
    perform public.require_perm('customers.edit');
    if v_type not in ('points', 'flat_coupon', 'pct_coupon', 'free_item') then raise exception 'Choose what to give'; end if;
    if p_customers is null or cardinality(p_customers) = 0 then raise exception 'Pick at least one customer'; end if;
    if cardinality(p_customers) > 500 then raise exception 'Up to 500 customers at once'; end if;
    if v_type = 'free_item' then
        select * into v_item from public.menu_items where id = nullif(p ->> 'itemId', '')::uuid and tenant_id = v_tenant;
        if v_item.id is null then raise exception 'Pick the free item'; end if;
        if v_item.is_restricted then raise exception '% cannot be given as a gift', v_item.name; end if;
    elsif v_value <= 0 then
        raise exception 'Enter how much to give';
    end if;
    if v_type = 'pct_coupon' and v_value > 100 then raise exception 'A percent coupon is at most 100%%'; end if;
    if v_days not between 1 and 365 then raise exception 'Valid for 1 to 365 days'; end if;
    -- A hidden rule carries the gift so the usual coupon, WhatsApp and to-do machinery applies
    insert into public.reward_rules (tenant_id, name, is_active, trigger_kind, reward_type, reward_value, reward_cap, reward_item_id,
                                     per_customer_limit, expiry_days, show_customer, whatsapp_template, conditions)
    values (v_tenant, coalesce(nullif(v_note, ''), 'Special reward'), false, 'manual', v_type, v_value,
            nullif(p ->> 'cap', '')::numeric, v_item.id, 0, v_days, true,
            'Hi {name}, a special thank-you from {cafe}: {reward}' || case when v_type <> 'points' then ', code {code}, valid till {expiry}' else '' end || '.',
            '{"special": true}')
    returning id into v_rule;
    foreach v_c in array p_customers loop
        if exists (select 1 from public.customers where id = v_c and tenant_id = v_tenant) then
            perform public.grant_reward(v_rule, v_c, null, 'manual', coalesce(nullif(v_note, ''), 'Special reward'));
            v_n := v_n + 1;
        end if;
    end loop;
    perform public.audit_event(v_tenant, 'reward', v_rule::text, 'Special reward to ' || v_n || ' customer(s): ' || coalesce(nullif(v_note, ''), v_type),
                               null, p || jsonb_build_object('count', v_n));
    return jsonb_build_object('given', v_n);
end;
$$;

-- The Rules list leaves out the one-off special rewards (they live in the reward history)
create or replace function public.list_reward_rules() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('rewards.view');
    return (select coalesce(jsonb_agg(public.reward_rule_json(r) order by r.is_active desc, r.created_at), '[]'::jsonb)
              from public.reward_rules r where r.tenant_id = public.current_tenant_id()
               and not coalesce((r.conditions ->> 'special')::boolean, false));
end;
$$;

-- Counter search: tier, Club level, member and a ready birthday gift next to each customer
create or replace function public.find_customers(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_q text := lower(trim(coalesce(p_query, '')));
    v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
    v_cfg jsonb := public.club_config(public.current_tenant_id());
    v_m date := public.club_month_start(public.current_tenant_id());
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
                   'points', c.loyalty_points, 'balance', public.khata_balance(c.id), 'limit', c.credit_limit,
                   'tier', public.club_tier_for(v_cfg, public.club_orders_between(c.id, v_m, (v_m + interval '1 month')::date)) ->> 'name',
                   'member', (select m.level_name from public.club_memberships m where m.customer_id = c.id and m.status = 'active'
                                 and public.cafe_today(c.tenant_id) <= m.ends_on + coalesce((v_cfg ->> 'graceDays')::integer, 0)
                               order by m.ends_on desc limit 1),
                   'birthdayGift', (select g.coupon_code from public.reward_grants g join public.reward_rules r on r.id = g.rule_id
                                     where g.customer_id = c.id and r.trigger_kind = 'birthday' and g.used_at is null
                                       and g.coupon_code <> '' and (g.expires_at is null or g.expires_at > now()) limit 1)) order by c.name), '[]'::jsonb)
          from (select * from public.customers c
                 where c.tenant_id = public.current_tenant_id()
                   and ((length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
                        or (length(v_digits) = 0 and lower(c.name) like '%' || v_q || '%'))
                 order by c.name limit 8) c);
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed every cafe: monthly milestones (3rd, 5th, 10th, 15th order), and the birthday gift switched on
-- ---------------------------------------------------------------------------
create function public.seed_club(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not exists (select 1 from public.reward_rules where tenant_id = p_tenant and trigger_kind = 'month_milestone') then
        insert into public.reward_rules (tenant_id, name, is_active, trigger_kind, trigger_value, trigger_period, reward_type, reward_value,
                                         per_customer_limit, per_customer_period, expiry_days, show_customer)
        values (p_tenant, '3rd order this month', true, 'month_milestone', 3, 'month', 'points', 20, 1, 'month', 0, true),
               (p_tenant, '5th order this month', true, 'month_milestone', 5, 'month', 'flat_coupon', 30, 1, 'month', 14, true),
               (p_tenant, '10th order this month', true, 'month_milestone', 10, 'month', 'flat_coupon', 50, 1, 'month', 14, true),
               (p_tenant, '15th order this month', true, 'month_milestone', 15, 'month', 'points', 100, 1, 'month', 0, true);
    end if;
    if not exists (select 1 from public.reward_rules where tenant_id = p_tenant and trigger_kind = 'birthday') then
        insert into public.reward_rules (tenant_id, name, is_active, trigger_kind, reward_type, reward_value, per_customer_limit,
                                         per_customer_period, expiry_days, show_customer, whatsapp_template)
        values (p_tenant, 'Birthday treat', true, 'birthday', 'flat_coupon', 150, 1, 'year', 10, true,
                'Happy birthday {name}! 🎂 {cafe} has a gift for you: {reward}, code {code}, valid till {expiry}.');
    elsif not exists (select 1 from public.reward_rules where tenant_id = p_tenant and trigger_kind = 'birthday' and is_active) then
        update public.reward_rules set is_active = true
         where id = (select id from public.reward_rules where tenant_id = p_tenant and trigger_kind = 'birthday' order by created_at limit 1);
    end if;
end;
$$;
revoke execute on function public.seed_club(uuid) from public, anon, authenticated;

create function public.tenants_seed_club() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.seed_club(new.id);
    return null;
end;
$$;
create trigger tenants_seed_zclub after insert on public.tenants for each row execute function public.tenants_seed_club();

select public.seed_club(id) from public.tenants;
