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
