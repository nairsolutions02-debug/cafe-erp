-- Phase 7: profit engine (≈18 checks on the cafe's own data, ranked suggestions with ₹ impact, the formula,
-- the inputs and an assumption; actions; outcomes after 4 weeks), menu matrix, Swiggy/Zomato CSV import.
-- Pure arithmetic: no outside AI, same result every time.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
create table public.profit_suggestions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    check_key text not null,
    subject text not null default '',            -- e.g. a menu item id; '' for cafe-wide checks
    area text not null,                          -- menu, inventory, costs, sales, customers, marketing, profit, cash, kiosk
    priority integer not null default 2,         -- 1 = do today
    title text not null,
    detail text not null default '',
    impact numeric(12, 2) not null default 0,    -- ₹ per month
    formula text not null default '',
    inputs jsonb not null default '[]',          -- [{label, value}]
    assumption text not null default '',
    actions jsonb not null default '[]',         -- [{label, link} | {label, kind: 'price', itemId, price}]
    status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'snoozed', 'gone')),
    reason text not null default '',
    snooze_until timestamptz,
    decided_by text not null default '',
    decided_at timestamptz,
    baseline jsonb,
    outcome text not null default '',
    outcome_at timestamptz,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    unique (tenant_id, check_key, subject)
);
create index profit_suggestions_open on public.profit_suggestions (tenant_id, status, priority, impact desc);

create table public.aggregator_item_map (
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    platform text not null,
    external_name text not null,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    primary key (tenant_id, platform, external_name)
);

create table public.aggregator_imports (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    platform text not null,
    file_name text not null default '',
    period_from date,
    period_to date,
    orders integer not null default 0,
    skipped integer not null default 0,
    gross numeric(12, 2) not null default 0,
    commission numeric(12, 2) not null default 0,
    payout numeric(12, 2) not null default 0,
    expense_id uuid references public.expenses (id) on delete set null,
    created_by text not null default '',
    created_at timestamptz not null default now()
);

alter table public.profit_suggestions enable row level security;
alter table public.aggregator_item_map enable row level security;
alter table public.aggregator_imports enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Item sales between two cafe dates (cost from the per-line snapshot)
create function public.item_stats(p_tenant uuid, p_from date, p_to date)
returns table (menu_item_id uuid, name text, units numeric, revenue numeric, cost numeric, unknown bigint)
language sql stable security definer set search_path = public, pg_temp as $$
    select oi.menu_item_id, coalesce(max(m.name), max(oi.name)), sum(oi.quantity)::numeric, sum(oi.net_amount), sum(oi.unit_cost * oi.quantity),
           count(*) filter (where oi.unit_cost = 0)
      from public.order_items oi join public.orders o on o.id = oi.order_id
      left join public.menu_items m on m.id = oi.menu_item_id
     where o.tenant_id = p_tenant and o.status <> 'cancelled' and oi.menu_item_id is not null and not oi.is_restricted
       and (o.created_at at time zone public.cafe_timezone(p_tenant))::date between p_from and p_to
     group by oi.menu_item_id;
$$;

create function public.add_suggestion(p_tenant uuid, p_check text, p_subject text, p_area text, p_priority integer, p_title text,
                                      p_detail text, p_impact numeric, p_formula text, p_inputs jsonb, p_assumption text, p_actions jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into public.profit_suggestions as s (tenant_id, check_key, subject, area, priority, title, detail, impact, formula, inputs,
                                                assumption, actions)
    values (p_tenant, p_check, coalesce(p_subject, ''), p_area, p_priority, p_title, coalesce(p_detail, ''), round(greatest(coalesce(p_impact, 0), 0), 0),
            coalesce(p_formula, ''), coalesce(p_inputs, '[]'), coalesce(p_assumption, ''), coalesce(p_actions, '[]'))
    on conflict (tenant_id, check_key, subject) do update set
        area = excluded.area, priority = excluded.priority, title = excluded.title, detail = excluded.detail, impact = excluded.impact,
        formula = excluded.formula, inputs = excluded.inputs, assumption = excluded.assumption, actions = excluded.actions,
        last_seen = now(),
        status = case when s.status = 'gone' then 'open'
                      when s.status = 'snoozed' and s.snooze_until <= now() then 'open'
                      else s.status end,
        first_seen = case when s.status = 'gone' then now() else s.first_seen end;
end;
$$;
revoke execute on function public.add_suggestion(uuid, text, text, text, integer, text, text, numeric, text, jsonb, text, jsonb)
    from public, anon, authenticated;

create function public.rs(p numeric) returns text
language sql immutable as $$
    select '₹' || to_char(round(coalesce(p, 0)), 'FM99,99,99,999');
$$;

-- ---------------------------------------------------------------------------
-- Menu matrix (Kasavana & Smith): popularity × contribution per unit vs the menu's averages
-- ---------------------------------------------------------------------------
create function public.menu_matrix_core(p_tenant uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with s as (select * from public.item_stats(p_tenant, p_from, p_to) where units > 0 and unknown = 0),
         t as (select count(*) n, sum(units) units, sum(revenue - cost) cm from s)
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'menuItemId', s.menu_item_id, 'name', s.name, 'units', s.units, 'revenue', round(s.revenue, 2),
                    'cmPerUnit', round((s.revenue - s.cost) / s.units, 2), 'contribution', round(s.revenue - s.cost, 2),
                    'mixPct', round(s.units * 100 / t.units, 1),
                    'class', case when s.units >= t.units / t.n * 0.7 then
                                       case when (s.revenue - s.cost) / s.units >= t.cm / t.units then 'star' else 'plowhorse' end
                                  else case when (s.revenue - s.cost) / s.units >= t.cm / t.units then 'puzzle' else 'dog' end end)
                    order by s.revenue - s.cost desc) from s, t), '[]'::jsonb),
        'popularityThreshold', (select round(units / nullif(n, 0) * 0.7, 1) from t),
        'avgCmPerUnit', (select round(cm / nullif(units, 0), 2) from t),
        'withoutCost', (select count(*) from public.item_stats(p_tenant, p_from, p_to) where unknown > 0));
$$;

create function public.menu_matrix(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('reports.view');
    if not public.has_perm('sensitive.see_profit') then raise exception 'Not authorized (sensitive.see_profit)'; end if;
    return public.menu_matrix_core(public.current_tenant_id(), p_from, p_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- The checks
-- ---------------------------------------------------------------------------
create function public.run_profit_checks() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_today date := public.cafe_today(public.current_tenant_id());
    v_from date := public.cafe_today(public.current_tenant_id()) - 29;
    v_pfrom date := public.cafe_today(public.current_tenant_id()) - 59;
    v_pto date := public.cafe_today(public.current_tenant_id()) - 30;
    v_run timestamptz := now();
    v_target_fc numeric := coalesce((public.get_setting('target_food_cost_pct', '32', public.current_tenant_id()) #>> '{}')::numeric, 32);
    v_gst numeric := coalesce((public.get_setting('gst_rate', '5', public.current_tenant_id()) #>> '{}')::numeric, 5);
    v_pnl jsonb;
    v_gm numeric;            -- gross margin share of net sales (0..1)
    v_avg_bill numeric;
    v_matrix jsonb;
    v_avg_cm numeric;
    x record;
    y record;
    v_n integer;
    v_val numeric;
    v_val2 numeric;
    v_text text;
    v_delta numeric;
    v_price numeric;
    v_count integer;
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then raise exception 'Not authorized (sensitive.see_profit)'; end if;

    v_pnl := public.pnl_core(v_t, v_from, v_today);
    v_gm := coalesce((v_pnl ->> 'grossProfit')::numeric / nullif((v_pnl ->> 'netSales')::numeric, 0), 0.6);
    select coalesce(avg(total), 0) into v_avg_bill from public.orders
     where tenant_id = v_t and status = 'paid' and (created_at at time zone v_tz)::date between v_from and v_today;

    -- 1. Menu matrix
    v_matrix := public.menu_matrix_core(v_t, v_from, v_today);
    v_avg_cm := (v_matrix ->> 'avgCmPerUnit')::numeric;
    for x in select (i ->> 'menuItemId')::uuid id, i ->> 'name' name, (i ->> 'units')::numeric units, (i ->> 'cmPerUnit')::numeric cm,
                    i ->> 'class' cls, m.price
               from jsonb_array_elements(v_matrix -> 'items') i join public.menu_items m on m.id = (i ->> 'menuItemId')::uuid
              where (i ->> 'units')::numeric >= 5 loop
        if x.cls = 'plowhorse' then
            v_delta := greatest(5, ceil(x.price * 0.05 / 5) * 5);
            v_val := x.units * 0.95 * (x.cm + v_delta / (1 + v_gst / 100)) - x.units * x.cm;
            perform public.add_suggestion(v_t, 'matrix', x.id::text, 'menu', 2,
                'Raise ' || x.name || ' from ' || public.rs(x.price) || ' to ' || public.rs(x.price + v_delta),
                'Popular (' || x.units || ' sold in 30 days) but earns ' || public.rs(x.cm) || ' per unit vs the menu average of '
                    || public.rs(v_avg_cm) || ' — a Plowhorse in the menu matrix. Or cut its recipe cost.',
                v_val, 'units × 95% × (profit per unit + rise without GST) − units × profit per unit',
                jsonb_build_array(jsonb_build_object('label', 'Sold (30 days)', 'value', x.units),
                                  jsonb_build_object('label', 'Profit per unit', 'value', public.rs(x.cm)),
                                  jsonb_build_object('label', 'Menu average per unit', 'value', public.rs(v_avg_cm)),
                                  jsonb_build_object('label', 'Price rise', 'value', public.rs(v_delta))),
                'Sales drop at most 5% after the rise.',
                jsonb_build_array(jsonb_build_object('label', 'Change price to ' || public.rs(x.price + v_delta), 'kind', 'price', 'itemId', x.id, 'price', x.price + v_delta),
                                  jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name)));
        elsif x.cls = 'puzzle' then
            perform public.add_suggestion(v_t, 'matrix', x.id::text, 'menu', 2,
                'Promote ' || x.name,
                'Earns ' || public.rs(x.cm) || ' per unit (above the ' || public.rs(v_avg_cm) || ' average) but sells only ' || x.units
                    || ' a month — a Puzzle. Put it on the homepage, suggest it at the counter, or add it to a combo.',
                x.units * 0.2 * x.cm, 'units × 20% more × profit per unit',
                jsonb_build_array(jsonb_build_object('label', 'Sold (30 days)', 'value', x.units),
                                  jsonb_build_object('label', 'Profit per unit', 'value', public.rs(x.cm))),
                'Promotion lifts its sales by 20%.',
                jsonb_build_array(jsonb_build_object('label', 'Homepage sections', 'link', '/admin/collections'),
                                  jsonb_build_object('label', 'Open in menu', 'link', '/admin/menu?q=' || x.name)));
        elsif x.cls = 'dog' then
            perform public.add_suggestion(v_t, 'matrix', x.id::text, 'menu', 3,
                'Rework or remove ' || x.name,
                'Sells little (' || x.units || ' a month) and earns little (' || public.rs(x.cm) || ' per unit) — a Dog. Fix the recipe and price, or drop it to simplify the kitchen.',
                x.units * greatest(v_avg_cm - x.cm, 0), 'units × (menu average profit per unit − its profit per unit)',
                jsonb_build_array(jsonb_build_object('label', 'Sold (30 days)', 'value', x.units),
                                  jsonb_build_object('label', 'Profit per unit', 'value', public.rs(x.cm)),
                                  jsonb_build_object('label', 'Menu average per unit', 'value', public.rs(v_avg_cm))),
                'Customers who bought it buy an average item instead.',
                jsonb_build_array(jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name),
                                  jsonb_build_object('label', 'Open in menu', 'link', '/admin/menu?q=' || x.name)));
        end if;
    end loop;

    -- 2. Food cost % above target
    for x in select s.menu_item_id id, s.name, s.units, s.revenue, s.cost from public.item_stats(v_t, v_from, v_today) s
              where s.unknown = 0 and s.units >= 5 and s.revenue > 0 and s.cost / s.revenue * 100 > v_target_fc + 2 loop
        perform public.add_suggestion(v_t, 'food_cost', x.id::text, 'menu', 2,
            x.name || ' food cost ' || round(x.cost / x.revenue * 100) || '% vs ' || round(v_target_fc) || '% target',
            'Ingredients take too big a share of its price. Check portion sizes and ingredient prices, or raise the price.',
            (x.cost / x.revenue - v_target_fc / 100) * x.revenue, '(food cost % − target %) × sales of the dish (30 days)',
            jsonb_build_array(jsonb_build_object('label', 'Sales (30 days, without GST)', 'value', public.rs(x.revenue)),
                              jsonb_build_object('label', 'Ingredient cost', 'value', public.rs(x.cost)),
                              jsonb_build_object('label', 'Target', 'value', round(v_target_fc) || '% (Settings key target_food_cost_pct)')),
            'Bringing it to the target keeps the same sales.',
            jsonb_build_array(jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name)));
    end loop;

    -- 3. Low rated and falling
    for x in select f.menu_item_id id, m.name, round(avg(f.rating), 1) a, count(*) n,
                    (select coalesce(sum(units), 0) from public.item_stats(v_t, v_from, v_today) s where s.menu_item_id = f.menu_item_id) u_now,
                    (select coalesce(sum(units), 0) from public.item_stats(v_t, v_pfrom, v_pto) s where s.menu_item_id = f.menu_item_id) u_prev,
                    (select coalesce(sum(revenue - cost), 0) from public.item_stats(v_t, v_from, v_today) s where s.menu_item_id = f.menu_item_id) cm
               from public.dish_feedback f join public.menu_items m on m.id = f.menu_item_id
              where f.tenant_id = v_t and (f.created_at at time zone v_tz)::date between v_from and v_today
              group by f.menu_item_id, m.name having count(*) >= 3 and avg(f.rating) < 3.5 loop
        perform public.add_suggestion(v_t, 'low_rated', x.id::text, 'menu', 2,
            x.name || ' rated ' || x.a || '★' || case when x.u_prev > 0 and x.u_now < x.u_prev
                then ', sales ' || round((x.u_now - x.u_prev) * 100.0 / x.u_prev) || '%' else '' end || ': fix the recipe',
            'Customers rate it low (' || x.n || ' ratings). Read the comments in Rewards → Feedback.',
            greatest(x.cm * 0.2, (x.u_prev - x.u_now) * x.cm / nullif(x.u_now, 0)),
            'profit from the dish (30 days) × 20% at risk, or the profit already lost to falling sales',
            jsonb_build_array(jsonb_build_object('label', 'Average rating', 'value', x.a),
                              jsonb_build_object('label', 'Sold (30 days / previous 30)', 'value', x.u_now || ' / ' || x.u_prev)),
            'Unhappy customers order it less over time.',
            jsonb_build_array(jsonb_build_object('label', 'Read feedback', 'link', '/admin/rewards?tab=feedback'),
                              jsonb_build_object('label', 'Edit recipe', 'link', '/admin/recipes?q=' || x.name)));
    end loop;

    -- 4–6. Inventory (needs inventory access)
    if public.has_perm('inventory.view') then
        -- 4. Reorder today
        select count(*), string_agg((s ->> 'name') || ' ' || round((s ->> 'suggestedQty')::numeric, 1) || ' ' || (s ->> 'unit'), ', ')
          into v_count, v_text
          from (select s from jsonb_array_elements(public.stock_overview(null)) s where (s ->> 'reorder')::boolean
                 order by coalesce((s ->> 'daysLeft')::numeric, 0) limit 6) z;
        if v_count > 0 then
            perform public.add_suggestion(v_t, 'reorder', '', 'inventory', 1, 'Order ' || v_count || ' item' || case when v_count > 1 then 's' else '' end || ' today',
                v_text || '. Days of stock left are below the vendor''s lead time.', 0,
                'days left = stock ÷ daily use (last 14 days); reorder when days left ≤ lead time',
                '[]', 'Use stays like the last 2 weeks.',
                jsonb_build_array(jsonb_build_object('label', 'Reorder list', 'link', '/admin/inventory')));
        end if;
        -- 5. Dead / slow stock
        select count(*), coalesce(sum(i.current_stock * i.cost_per_unit), 0), string_agg(i.name, ', ')
          into v_count, v_val, v_text
          from public.inventory i
         where i.tenant_id = v_t and i.track_stock and i.current_stock > 0 and i.cost_per_unit > 0
           and i.created_at < now() - interval '21 days'
           and not exists (select 1 from public.stock_moves m where m.item_id = i.id and m.quantity < 0 and m.created_at > now() - interval '21 days');
        if v_count > 0 and v_val >= 500 then
            perform public.add_suggestion(v_t, 'dead_stock', '', 'inventory', 3,
                public.rs(v_val) || ' stuck in ' || v_count || ' slow item' || case when v_count > 1 then 's' else '' end,
                v_text || ' — nothing used in 21 days. Run a combo, use them up, or stop buying.', v_val * 0.2,
                'stock value × 20% a month', jsonb_build_array(jsonb_build_object('label', 'Value in stock', 'value', public.rs(v_val))),
                'About a fifth spoils, expires or ties up cash each month.',
                jsonb_build_array(jsonb_build_object('label', 'Stock', 'link', '/admin/inventory')));
        end if;
        -- 6. Leaks (counts short + wastage)
        for x in select (l ->> 'itemId') id, l ->> 'item' name, -(l ->> 'lostValue')::numeric lost
                   from jsonb_array_elements(public.stock_leaks(7)) l where (l ->> 'lostValue')::numeric < -200 limit 5 loop
            perform public.add_suggestion(v_t, 'leak', x.id, 'inventory', 2,
                x.name || ': ' || public.rs(x.lost) || ' lost this week',
                'Count shortfall plus wastage. Check portions against the recipe, storage and who handles it.',
                x.lost * 4.3, 'lost this week × 4.3 weeks',
                jsonb_build_array(jsonb_build_object('label', 'Lost in 7 days', 'value', public.rs(x.lost))),
                'The leak continues at this week''s rate.',
                jsonb_build_array(jsonb_build_object('label', 'Counts & leaks', 'link', '/admin/inventory?tab=counts')));
        end loop;
        -- 7. Vendor price creep
        for x in select pl.item_id id, i.name, i.unit,
                        avg(pl.base_cost) filter (where p.bill_date > v_today - 30) now_cost,
                        avg(pl.base_cost) filter (where p.bill_date between v_today - 90 and v_today - 31) old_cost,
                        sum(pl.base_quantity) filter (where p.bill_date > v_today - 30) qty
                   from public.purchase_lines pl join public.purchases p on p.id = pl.purchase_id join public.inventory i on i.id = pl.item_id
                  where p.tenant_id = v_t and not p.is_void and p.bill_date > v_today - 90
                  group by pl.item_id, i.name, i.unit loop
            if x.old_cost > 0 and x.now_cost > x.old_cost * 1.10 then
                perform public.add_suggestion(v_t, 'price_creep', x.id::text, 'inventory', 2,
                    x.name || ' up ' || round((x.now_cost / x.old_cost - 1) * 100) || '% in 60 days: compare vendors',
                    'You now pay ' || public.rs(x.now_cost * case when x.unit in ('g', 'ml') then 1000 else 1 end) || case when x.unit = 'g' then '/kg' when x.unit = 'ml' then '/L' else '/' || x.unit end
                        || ' vs ' || public.rs(x.old_cost * case when x.unit in ('g', 'ml') then 1000 else 1 end) || ' before.',
                    (x.now_cost - x.old_cost) * x.qty, '(price now − price 1–3 months ago) × quantity bought in the last 30 days',
                    jsonb_build_array(jsonb_build_object('label', 'Bought (30 days)', 'value', round(x.qty, 1) || ' ' || x.unit)),
                    'You keep buying the same quantity.',
                    jsonb_build_array(jsonb_build_object('label', 'Purchases', 'link', '/admin/inventory?tab=purchases'),
                                      jsonb_build_object('label', 'Vendors', 'link', '/admin/inventory?tab=vendors')));
            end if;
        end loop;
    end if;

    -- 8. Expense category above its 3-month average
    for x in select c.id, c.name,
                    coalesce(sum(e.amount) filter (where e.expense_date between v_from and v_today), 0) cur,
                    coalesce(sum(e.amount) filter (where e.expense_date between v_from - 90 and v_from - 1), 0) / 3 avg3
               from public.expense_categories c join public.expenses e on e.category_id = c.id and not e.is_void
              where c.tenant_id = v_t and c.name not in ('Salaries', 'Aggregator commission') and coalesce(e.spread_months, 1) <= 1
              group by c.id, c.name loop
        if x.avg3 > 0 and x.cur > x.avg3 * 1.25 and x.cur - x.avg3 >= 500 then
            perform public.add_suggestion(v_t, 'expense_up', x.id::text, 'costs', 2,
                x.name || ' +' || round((x.cur / x.avg3 - 1) * 100) || '% vs its average',
                public.rs(x.cur) || ' in the last 30 days vs ' || public.rs(x.avg3) || ' a month on average before. Check the bill and usage.',
                x.cur - x.avg3, 'last 30 days − average of the 3 months before',
                jsonb_build_array(jsonb_build_object('label', 'Last 30 days', 'value', public.rs(x.cur)),
                                  jsonb_build_object('label', '3-month average', 'value', public.rs(x.avg3))),
                'The extra is avoidable, not a new normal.',
                jsonb_build_array(jsonb_build_object('label', 'Expenses', 'link', '/admin/finance?tab=expenses')));
        end if;
    end loop;

    -- 9. Staff cost share of sales
    if (v_pnl ->> 'netSales')::numeric > 0 and (v_pnl ->> 'staffCost')::numeric / (v_pnl ->> 'netSales')::numeric > 0.35 then
        v_val := (v_pnl ->> 'staffCost')::numeric / (v_pnl ->> 'netSales')::numeric * 100;
        perform public.add_suggestion(v_t, 'staff_cost', '', 'costs', 2,
            'Staff cost is ' || round(v_val) || '% of sales',
            'Above the 35% cafes usually aim for. Look at shifts in slow hours (see the weak-hours suggestion) or push sales in them.',
            (v_val - 35) / 100 * (v_pnl ->> 'netSales')::numeric, '(staff cost % − 35%) × net sales (30 days)',
            jsonb_build_array(jsonb_build_object('label', 'Staff cost (30 days)', 'value', public.rs((v_pnl ->> 'staffCost')::numeric)),
                              jsonb_build_object('label', 'Net sales (30 days)', 'value', public.rs((v_pnl ->> 'netSales')::numeric))),
            '35% is a common ceiling for cafes.', jsonb_build_array(jsonb_build_object('label', 'Attendance', 'link', '/admin/attendance')));
    end if;

    -- 10. Weak hours: the 3-hour block with the smallest share of sales (over hours that have sales)
    select h, share, sales into y from (
        select hh.h, sum(b.sales) over w3 / nullif(sum(b.sales) over (), 0) * 100 share, sum(b.sales) over w3 sales, count(*) over w3 n
          from (select distinct extract(hour from created_at at time zone v_tz)::integer h from public.orders
                 where tenant_id = v_t and status = 'paid' and created_at > now() - interval '28 days') hh
          join lateral (select coalesce(sum(o.total), 0) sales from public.orders o where o.tenant_id = v_t and o.status = 'paid'
                          and o.created_at > now() - interval '28 days' and extract(hour from o.created_at at time zone v_tz)::integer = hh.h) b on true
        window w3 as (order by hh.h rows between current row and 2 following)) z
     where n = 3 order by share limit 1;
    if y.share is not null and y.share < 10 and (select count(*) from public.orders where tenant_id = v_t and status = 'paid' and created_at > now() - interval '28 days') >= 30 then
        perform public.add_suggestion(v_t, 'weak_hours', '', 'sales', 3,
            to_char(make_time(y.h, 0, 0), 'FMHH12 am') || '–' || to_char(make_time((y.h + 3) % 24, 0, 0), 'FMHH12 am') || ' is ' || round(y.share) || '% of sales: try a combo',
            'Your slowest 3 hours. A time-bound combo (e.g. tea + snack) or a happy-hour price can fill them; staff fewer people then.',
            y.sales / 28 * 30 * 0.2 * v_gm, 'sales in those hours (a month) × 20% lift × gross margin',
            jsonb_build_array(jsonb_build_object('label', 'Sales in the block (28 days)', 'value', public.rs(y.sales)),
                              jsonb_build_object('label', 'Gross margin', 'value', round(v_gm * 100) || '%')),
            'A combo lifts those hours by 20%.', jsonb_build_array(jsonb_build_object('label', 'Coupons', 'link', '/admin/coupons')));
    end if;

    -- 11. Average bill falling
    select avg(total) filter (where created_at > now() - interval '28 days'), avg(total) filter (where created_at <= now() - interval '28 days'),
           count(*) filter (where created_at > now() - interval '28 days')
      into v_val, v_val2, v_n
      from public.orders where tenant_id = v_t and status = 'paid' and created_at > now() - interval '56 days';
    if v_n >= 20 and v_val2 > 0 and v_val < v_val2 * 0.95 then
        perform public.add_suggestion(v_t, 'avg_bill', '', 'sales', 2,
            'Average bill ' || public.rs(v_val2) || ' → ' || public.rs(v_val) || ' in 4 weeks: push add-ons',
            'Suggest a dessert, a drink upgrade or a combo at the counter; show add-ons in the menu.',
            (v_val2 - v_val) * v_n / 28 * 30 * v_gm, '(previous average − current average) × orders a month × gross margin',
            jsonb_build_array(jsonb_build_object('label', 'Orders (28 days)', 'value', v_n)),
            'Half the drop can be won back with add-ons; the figure shows the full gap.', '[]');
    end if;

    -- 12. Slipping regulars
    select count(*) into v_n from public.customers c where c.tenant_id = v_t and c.group_code = 'slipping'
       and (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'paid') >= 3;
    if v_n >= 3 then
        perform public.add_suggestion(v_t, 'slipping', '', 'customers', 2,
            v_n || ' regulars haven''t visited lately: send a win-back',
            'They used to come often and are now late by twice their usual gap. Message them from Rewards → Groups → Slipping, or add a rule "moves into Slipping → 20% off".',
            v_n * 0.3 * v_avg_bill * v_gm * 2, 'regulars × 30% come back × average bill × gross margin × 2 visits',
            jsonb_build_array(jsonb_build_object('label', 'Average bill', 'value', public.rs(v_avg_bill))),
            '30% return after a message and visit twice in the month.',
            jsonb_build_array(jsonb_build_object('label', 'Slipping customers', 'link', '/admin/rewards?tab=groups')));
    end if;

    -- 13. New customers not returning
    select count(*), count(*) filter (where n >= 2) into v_n, v_count from (
        select c.id, (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'paid') n
          from public.customers c where c.tenant_id = v_t
           and (select min(created_at) from public.orders o where o.customer_id = c.id and o.status = 'paid')
               between now() - interval '60 days' and now() - interval '30 days') z;
    if v_n >= 5 and v_count::numeric / v_n < 0.3 then
        perform public.add_suggestion(v_t, 'new_return', '', 'customers', 2,
            'Only ' || round(v_count * 100.0 / v_n) || '% of new customers come back: add a first-return offer',
            'A reward rule "First order → ₹X off the next visit" (coupon valid 14 days) turns first-timers into regulars.',
            v_n * (0.3 - v_count::numeric / v_n) * v_avg_bill * v_gm, 'new customers a month × (30% − return rate) × average bill × gross margin',
            jsonb_build_array(jsonb_build_object('label', 'New customers (30–60 days ago)', 'value', v_n),
                              jsonb_build_object('label', 'Came back', 'value', v_count)),
            'An offer lifts the return rate to 30%.', jsonb_build_array(jsonb_build_object('label', 'Reward rules', 'link', '/admin/rewards')));
    end if;

    -- 14. Reward ROI (last 60 days)
    for x in select r.id, r.name, sum(g.cost) cost,
                    coalesce((select sum(o.total) from public.orders o
                               where o.status = 'paid' and exists (select 1 from public.reward_grants g2 where g2.rule_id = r.id
                                                                     and g2.customer_id = o.customer_id and o.created_at between g2.created_at and g2.created_at + interval '14 days')), 0) after_sales
               from public.reward_rules r join public.reward_grants g on g.rule_id = r.id
              where r.tenant_id = v_t and g.created_at > now() - interval '60 days'
              group by r.id, r.name having sum(g.cost) >= 300 loop
        if x.after_sales * v_gm < x.cost then
            perform public.add_suggestion(v_t, 'reward_roi', x.id::text, 'marketing', 2,
                'Reward "' || x.name || '" cost ' || public.rs(x.cost) || ' and brought ' || public.rs(x.after_sales * v_gm) || ' profit: lower it',
                'Rewarded customers'' orders in the 14 days after the reward didn''t cover its cost. Lower the reward, raise the trigger, or add a budget.',
                (x.cost - x.after_sales * v_gm) / 2, '(reward cost − gross profit of rewarded customers'' next-14-day orders) ÷ 2 months',
                jsonb_build_array(jsonb_build_object('label', 'Reward cost (60 days)', 'value', public.rs(x.cost)),
                                  jsonb_build_object('label', 'Their sales in the 14 days after', 'value', public.rs(x.after_sales))),
                'Those orders would partly have happened anyway, so this is generous to the reward.',
                jsonb_build_array(jsonb_build_object('label', 'Edit rule', 'link', '/admin/rewards')));
        end if;
    end loop;

    -- 15. Rewards over budget (% of gross profit this month)
    select coalesce(sum(cost), 0) into v_val from public.reward_grants
     where tenant_id = v_t and created_at >= (date_trunc('month', v_today)::timestamp at time zone v_tz);
    v_val2 := greatest((public.pnl_core(v_t, date_trunc('month', v_today)::date, v_today) ->> 'grossProfit')::numeric, 0)
              * coalesce((public.get_setting('reward_budget_pct', '5', v_t) #>> '{}')::numeric, 5) / 100;
    if v_val > 0 and v_val > v_val2 then
        perform public.add_suggestion(v_t, 'reward_budget', '', 'marketing', 2,
            'Rewards cost ' || public.rs(v_val) || ' this month, over the ' || public.rs(v_val2) || ' budget',
            'Rewards are capped at a share of gross profit (Settings key reward_budget_pct). Add monthly budgets to the biggest rules.',
            v_val - v_val2, 'reward cost this month − budget % × gross profit this month', '[]', '', jsonb_build_array(jsonb_build_object('label', 'Reward rules', 'link', '/admin/rewards')));
    end if;

    -- 16. Shift mismatches by person
    for x in select closed_by, count(*) n, sum(abs(difference)) filter (where difference < 0) short
               from public.shifts where tenant_id = v_t and status = 'closed' and closed_at > now() - interval '30 days'
                and abs(coalesce(difference, 0)) > coalesce((public.get_setting('shift_tolerance', '50', v_t) #>> '{}')::numeric, 50)
              group by closed_by having count(*) >= 3 loop
        perform public.add_suggestion(v_t, 'shift_mismatch', x.closed_by, 'cash', 1,
            x.n || ' cash mismatches at shift close by ' || x.closed_by || ' this month',
            'Count the drawer together at the next close and check payouts are recorded.',
            coalesce(x.short, 0), 'total shortages in 30 days', jsonb_build_array(jsonb_build_object('label', 'Mismatched closes', 'value', x.n)),
            'Shortages continue at this rate.', jsonb_build_array(jsonb_build_object('label', 'Cash & shifts', 'link', '/admin/shifts')));
    end loop;

    -- 17. Kiosk: pack vs loose margin
    for x in select m.id, m.name, m.price loose, u.factor, u.sale_price pack,
                    (select coalesce(sum(oi.quantity), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                      where oi.menu_item_id = m.id and oi.unit_name = u.name and o.status <> 'cancelled' and o.created_at > now() - interval '30 days') packs
               from public.item_units u join public.menu_items m on m.id = u.menu_item_id
              where m.tenant_id = v_t and u.sale_price is not null and u.factor > 1 and m.price > u.sale_price / u.factor * 1.02 loop
        if x.packs > 0 then
            perform public.add_suggestion(v_t, 'pack_loose', x.id::text, 'kiosk', 3,
                'Loose ' || x.name || ' earns ' || public.rs(x.loose - x.pack / x.factor) || '/piece more than packs: keep loose stock up',
                'A ' || x.factor::integer || '-pack sells for ' || public.rs(x.pack) || ' (' || to_char(x.pack / x.factor, 'FM990.00') || ' a piece) vs ' || public.rs(x.loose) || ' loose.',
                (x.loose - x.pack / x.factor) * x.factor * x.packs * 0.3, 'difference per piece × pieces in packs sold × 30% who would buy loose',
                jsonb_build_array(jsonb_build_object('label', 'Packs sold (30 days)', 'value', x.packs)),
                '30% of pack buyers would buy loose if it''s in stock.', jsonb_build_array(jsonb_build_object('label', 'Kiosk', 'link', '/admin/kiosk')));
        end if;
    end loop;

    -- Retire suggestions that no longer apply
    update public.profit_suggestions set status = 'gone'
     where tenant_id = v_t and status in ('open', 'snoozed') and last_seen < v_run and check_key <> 'forecast';

    -- 18. Forecast vs target, with the 3 biggest open actions
    v_val := coalesce((public.get_setting('profit_target_monthly', '0', v_t) #>> '{}')::numeric, 0);
    if v_val > 0 then
        v_pnl := public.pnl_core(v_t, date_trunc('month', v_today)::date, v_today);
        v_val2 := (v_pnl ->> 'netProfit')::numeric
                  * ((date_trunc('month', v_today) + interval '1 month')::date - date_trunc('month', v_today)::date)
                  / (v_today - date_trunc('month', v_today)::date + 1);
        if v_val2 < v_val then
            select string_agg(title || ' (+' || public.rs(impact) || ')', '; ' order by impact desc) into v_text
              from (select title, impact from public.profit_suggestions where tenant_id = v_t and status = 'open' and impact > 0
                     order by impact desc limit 3) z;
            perform public.add_suggestion(v_t, 'forecast', '', 'profit', 1,
                'On track for ' || public.rs(v_val2) || ' vs ' || public.rs(v_val) || ' target this month',
                coalesce('Biggest actions: ' || v_text || '.', 'Add more data (recipes, expenses) for specific actions.'),
                v_val - v_val2, 'target − (profit so far ÷ days gone × days in month)',
                jsonb_build_array(jsonb_build_object('label', 'Profit so far', 'value', public.rs((v_pnl ->> 'netProfit')::numeric)),
                                  jsonb_build_object('label', 'Monthly target', 'value', public.rs(v_val))),
                'The rest of the month goes like the days so far.', jsonb_build_array(jsonb_build_object('label', 'Profit & loss', 'link', '/admin/reports')));
        else
            update public.profit_suggestions set status = 'gone' where tenant_id = v_t and check_key = 'forecast' and status = 'open';
        end if;
    end if;

    perform public.evaluate_suggestion_outcomes(v_t);
    insert into public.settings (tenant_id, key, value, description) values (v_t, 'profit_check_at', to_jsonb(now()), 'Last profit engine run')
    on conflict (tenant_id, key) do update set value = excluded.value;
    return jsonb_build_object('open', (select count(*) from public.profit_suggestions where tenant_id = v_t and status = 'open'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Decisions and outcomes
-- ---------------------------------------------------------------------------
-- What we measure before and 4 weeks after: the dish's units and profit a day, or the cafe's net sales and gross profit a day
create function public.suggestion_metric(p_tenant uuid, p_subject text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_days numeric := p_to - p_from + 1;
    v_pnl jsonb;
    v_item uuid;
begin
    begin
        v_item := nullif(p_subject, '')::uuid;
    exception when others then
        v_item := null;
    end;
    if v_item is not null and exists (select 1 from public.menu_items where id = v_item) then
        return (select jsonb_build_object('kind', 'item', 'units', round(coalesce(sum(units), 0) / v_days, 2),
                                          'profit', round(coalesce(sum(revenue - cost), 0) / v_days, 2),
                                          'price', (select price from public.menu_items where id = v_item))
                  from public.item_stats(p_tenant, p_from, p_to) where menu_item_id = v_item);
    end if;
    v_pnl := public.pnl_core(p_tenant, p_from, p_to);
    return jsonb_build_object('kind', 'cafe', 'sales', round((v_pnl ->> 'netSales')::numeric / v_days, 2),
                              'profit', round((v_pnl ->> 'grossProfit')::numeric / v_days, 2));
end;
$$;

create function public.evaluate_suggestion_outcomes(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.profit_suggestions;
    v_d date;
    a jsonb;
    b jsonb;
    v_units text;
    v_profit numeric;
begin
    for s in select * from public.profit_suggestions where tenant_id = p_tenant and status in ('accepted', 'dismissed')
                and outcome = '' and decided_at < now() - interval '28 days' and baseline is not null loop
        v_d := (s.decided_at at time zone public.cafe_timezone(p_tenant))::date;
        a := s.baseline;
        b := public.suggestion_metric(p_tenant, s.subject, v_d + 1, v_d + 28);
        v_profit := ((b ->> 'profit')::numeric - (a ->> 'profit')::numeric) * 30;
        if b ->> 'kind' = 'item' then
            v_units := case when (a ->> 'units')::numeric > 0
                            then 'sales ' || to_char(((b ->> 'units')::numeric / (a ->> 'units')::numeric - 1) * 100, 'FMSG990') || '%' else 'sales n/a' end;
        else
            v_units := case when (a ->> 'sales')::numeric > 0
                            then 'cafe sales ' || to_char(((b ->> 'sales')::numeric / (a ->> 'sales')::numeric - 1) * 100, 'FMSG990') || '%' else 'sales n/a' end;
        end if;
        update public.profit_suggestions set
            outcome = case when s.status = 'accepted' then 'Done' else 'Dismissed' end || '; 4 weeks later: ' || v_units
                      || ', profit ' || case when v_profit >= 0 then '+' else '−' end || public.rs(abs(v_profit)) || '/month',
            outcome_at = now()
         where id = s.id;
    end loop;
end;
$$;
revoke execute on function public.evaluate_suggestion_outcomes(uuid) from public, anon, authenticated;

create function public.decide_suggestion(p_id uuid, p_decision text, p_reason text default '', p_days integer default 14) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.profit_suggestions;
    v_today date := public.cafe_today(public.current_tenant_id());
begin
    perform public.require_perm('finance.view');
    select * into s from public.profit_suggestions where id = p_id and tenant_id = public.current_tenant_id();
    if s.id is null then raise exception 'Not found'; end if;
    if p_decision not in ('accepted', 'dismissed', 'snoozed', 'open') then raise exception 'Bad decision'; end if;
    if p_decision = 'dismissed' and trim(coalesce(p_reason, '')) = '' then raise exception 'Say why (it helps judge the advice later)'; end if;
    update public.profit_suggestions set status = p_decision, reason = trim(coalesce(p_reason, '')),
           snooze_until = case when p_decision = 'snoozed' then now() + make_interval(days => greatest(coalesce(p_days, 14), 1)) end,
           decided_by = public.actor_name(), decided_at = now(),
           baseline = case when p_decision in ('accepted', 'dismissed') then public.suggestion_metric(s.tenant_id, s.subject, v_today - 27, v_today) else baseline end,
           outcome = '', outcome_at = null
     where id = s.id;
end;
$$;

-- "Change price" straight from a suggestion
create function public.apply_suggestion_price(p_id uuid, p_price numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    s public.profit_suggestions;
    v_item uuid;
begin
    perform public.require_perm('menu.edit');
    select * into s from public.profit_suggestions where id = p_id and tenant_id = public.current_tenant_id();
    if s.id is null then raise exception 'Not found'; end if;
    select (a ->> 'itemId')::uuid into v_item from jsonb_array_elements(s.actions) a where a ->> 'kind' = 'price' limit 1;
    if v_item is null or p_price is null or p_price <= 0 then raise exception 'No price change in this suggestion'; end if;
    perform public.decide_suggestion(p_id, 'accepted', 'Price changed to ' || public.rs(p_price));
    update public.menu_items set price = round(p_price, 2) where id = v_item and tenant_id = s.tenant_id;
end;
$$;

create function public.profit_suggestions(p_status text default 'open') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then raise exception 'Not authorized (sensitive.see_profit)'; end if;
    update public.profit_suggestions set status = 'open' where tenant_id = v_t and status = 'snoozed' and snooze_until <= now();
    return jsonb_build_object(
        'lastRun', public.get_setting('profit_check_at', 'null', v_t),
        'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.profit_suggestions
                    where tenant_id = v_t group by status) z),
        'totalImpact', (select coalesce(sum(impact), 0) from public.profit_suggestions where tenant_id = v_t and status = 'open'),
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', id, 'check', check_key, 'area', area, 'priority', priority, 'title', title, 'detail', detail, 'impact', impact,
                    'formula', formula, 'inputs', inputs, 'assumption', assumption, 'actions', actions, 'status', status, 'reason', reason,
                    'snoozeUntil', snooze_until, 'decidedBy', decided_by, 'decidedAt', decided_at, 'outcome', outcome, 'outcomeAt', outcome_at,
                    'firstSeen', first_seen) order by priority, impact desc), '[]'::jsonb)
                    from public.profit_suggestions where tenant_id = v_t
                     and (case p_status when 'all' then true when 'decided' then status in ('accepted', 'dismissed') else status = p_status end)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Swiggy / Zomato / Petpooja CSV import (weekly)
-- ---------------------------------------------------------------------------
-- Suggested menu item for each name in the report: saved mapping first, then the closest menu name
create function public.aggregator_match(p_platform text, p_names text[]) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
begin
    perform public.require_perm('finance.create');
    return (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'menuItemId', coalesce(
                (select menu_item_id from public.aggregator_item_map where tenant_id = v_t and platform = lower(p_platform) and external_name = lower(trim(n))),
                (select m.id from public.menu_items m where m.tenant_id = v_t
                    and similarity(lower(m.name), lower(trim(n))) > 0.3 order by similarity(lower(m.name), lower(trim(n))) desc limit 1)),
            'saved', exists (select 1 from public.aggregator_item_map where tenant_id = v_t and platform = lower(p_platform) and external_name = lower(trim(n))))), '[]'::jsonb)
              from unnest(p_names) n);
end;
$$;

-- p: {platform, fileName, payoutAccount: 'bank', commission, rows: [{orderId, date, item, qty, amount}], mappings: {name: menuItemId}}
-- amount = what the customer paid for that line (food value, before the platform's cut). GST on aggregator food orders is paid
-- by the platform (section 9(5)), so these orders carry no GST of their own.
create function public.import_aggregator(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_platform text := lower(coalesce(nullif(p ->> 'platform', ''), 'other'));
    v_acc uuid := public.account_id(public.current_tenant_id(), coalesce(nullif(p ->> 'payoutAccount', ''), 'bank'));
    v_commission numeric := round(coalesce(nullif(p ->> 'commission', '')::numeric, 0), 2);
    v_name text;
    v_unmapped text[];
    o record;
    v_order uuid;
    v_imported integer := 0;
    v_skipped integer := 0;
    v_gross numeric := 0;
    v_from date;
    v_to date;
    v_exp uuid;
    v_cat uuid;
    v_import uuid;
    v_when timestamptz;
begin
    perform public.require_perm('finance.create');
    if v_platform not in ('swiggy', 'zomato', 'petpooja', 'other') then raise exception 'Unknown platform'; end if;
    if jsonb_array_length(coalesce(p -> 'rows', '[]')) = 0 then raise exception 'No rows to import'; end if;
    -- Save the mappings for next week
    for v_name in select jsonb_object_keys(coalesce(p -> 'mappings', '{}')) loop
        if nullif(p -> 'mappings' ->> v_name, '') is not null
           and exists (select 1 from public.menu_items where id = (p -> 'mappings' ->> v_name)::uuid and tenant_id = v_t) then
            insert into public.aggregator_item_map (tenant_id, platform, external_name, menu_item_id)
            values (v_t, v_platform, lower(trim(v_name)), (p -> 'mappings' ->> v_name)::uuid)
            on conflict (tenant_id, platform, external_name) do update set menu_item_id = excluded.menu_item_id;
        end if;
    end loop;
    select array_agg(distinct r ->> 'item') into v_unmapped from jsonb_array_elements(p -> 'rows') r
     where not exists (select 1 from public.aggregator_item_map mp where mp.tenant_id = v_t and mp.platform = v_platform
                         and mp.external_name = lower(trim(r ->> 'item')));
    if v_unmapped is not null then
        raise exception 'Match these items to the menu first: %', array_to_string(v_unmapped, ', ');
    end if;

    for o in select r ->> 'orderId' oid, min(r ->> 'date') d, jsonb_agg(r) lines
               from jsonb_array_elements(p -> 'rows') r group by r ->> 'orderId' loop
        if coalesce(o.oid, '') = '' then raise exception 'A row has no order id'; end if;
        if exists (select 1 from public.orders where tenant_id = v_t and client_id = 'agg:' || v_platform || ':' || o.oid) then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        v_when := case when o.d ~ '^\d{4}-\d{2}-\d{2}$' then ((o.d || ' 13:00')::timestamp at time zone v_tz)
                       else (o.d::timestamp at time zone v_tz) end;
        insert into public.orders (tenant_id, order_number, subtotal, discount, tax, total, status, channel, payment_method,
                                   client_id, staff_name, created_at, restaurant_info)
        values (v_t, upper(left(v_platform, 3)) || '-' || o.oid || '-' || substr(v_t::text, 1, 4), 0, 0, 0, 0, 'paid', 'aggregator', 'online',
                'agg:' || v_platform || ':' || o.oid, initcap(v_platform) || ' import', v_when, '{}'::jsonb)
        returning id into v_order;
        insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, net_amount, tax_rate, tax_amount)
        select v_order, mp.menu_item_id, m.name, round((l ->> 'amount')::numeric / greatest((l ->> 'qty')::integer, 1), 2),
               greatest((l ->> 'qty')::integer, 1), round((l ->> 'amount')::numeric, 2), round((l ->> 'amount')::numeric, 2), 0, 0
          from jsonb_array_elements(o.lines) l
          join public.aggregator_item_map mp on mp.tenant_id = v_t and mp.platform = v_platform and mp.external_name = lower(trim(l ->> 'item'))
          join public.menu_items m on m.id = mp.menu_item_id;
        update public.orders set subtotal = (select coalesce(sum(total), 0) from public.order_items where order_id = v_order),
                                 total = (select coalesce(sum(total), 0) from public.order_items where order_id = v_order),
                                 amount_paid = (select coalesce(sum(total), 0) from public.order_items where order_id = v_order)
         where id = v_order;
        perform public.post_ledger(v_t, v_acc, (select total from public.orders where id = v_order), 'aggregator', v_platform, v_order,
                                   p_note => initcap(v_platform) || ' order ' || o.oid);
        v_gross := v_gross + (select total from public.orders where id = v_order);
        v_from := least(v_from, (v_when at time zone v_tz)::date);
        v_to := greatest(v_to, (v_when at time zone v_tz)::date);
        v_imported := v_imported + 1;
    end loop;

    if v_imported > 0 and v_commission > 0 then
        select id into v_cat from public.expense_categories where tenant_id = v_t and name = 'Aggregator commission';
        if v_cat is null then
            insert into public.expense_categories (tenant_id, name) values (v_t, 'Aggregator commission') returning id into v_cat;
        end if;
        v_exp := public.record_expense(jsonb_build_object('categoryId', v_cat, 'amount', v_commission,
                    'accountCode', coalesce(nullif(p ->> 'payoutAccount', ''), 'bank'), 'date', coalesce(v_to, public.cafe_today(v_t)),
                    'note', initcap(v_platform) || ' commission and fees ' || coalesce(to_char(v_from, 'DD Mon'), '') || '–' || coalesce(to_char(v_to, 'DD Mon'), ''),
                    'clientId', 'aggcomm:' || v_platform || ':' || coalesce(p ->> 'fileName', '') || ':' || v_imported || ':' || round(v_gross)));
    end if;
    insert into public.aggregator_imports (tenant_id, platform, file_name, period_from, period_to, orders, skipped, gross, commission, payout,
                                           expense_id, created_by)
    values (v_t, v_platform, coalesce(p ->> 'fileName', ''), v_from, v_to, v_imported, v_skipped, v_gross,
            case when v_imported > 0 then v_commission else 0 end, v_gross - case when v_imported > 0 then v_commission else 0 end, v_exp, public.actor_name())
    returning id into v_import;
    return jsonb_build_object('id', v_import, 'imported', v_imported, 'skipped', v_skipped, 'gross', v_gross,
                              'commission', case when v_imported > 0 then v_commission else 0 end,
                              'payout', v_gross - case when v_imported > 0 then v_commission else 0 end);
end;
$$;

create function public.list_aggregator_imports() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'platform', platform, 'fileName', file_name, 'from', period_from, 'to', period_to,
                                                         'orders', orders, 'skipped', skipped, 'gross', gross, 'commission', commission,
                                                         'payout', payout, 'createdBy', created_by, 'createdAt', created_at)
                                      order by created_at desc), '[]'::jsonb)
              from public.aggregator_imports where tenant_id = public.current_tenant_id());
end;
$$;
