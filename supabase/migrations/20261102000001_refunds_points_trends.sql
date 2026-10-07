-- Partial refunds, points and deals at the counter, sales trends that match Finance (owner approved, 2026-10-07).
-- 1. Refund some items of a paid bill: refund_items() writes a return (order_returns + order_return_lines) with the
--    taxable value, GST, discount share and cost of each line, pays the money back from the right drawer and shift,
--    puts chosen lines back in stock and takes back the points those items earned.
-- 2. One sales book for every money screen: sales_events() (one row per bill, partial refund, later-day cancel) and
--    sales_lines() (the same, line by line). Finance, P and L, GST pack, Dashboard, Analytics and Item economics
--    all read it, so a refund counts negative on the day it happens everywhere.
-- 3. Counter rewards: create_staff_order and quote_staff_order take a loyalty deal or points as cash, with the same
--    rules as the customer app; counter_rewards() lists what the attached customer can use.
-- Functions are re-created from their latest definitions (20261101000001_money_fixes and the live database).
-- No apostrophes in comments: the SQL Editor splitter treats them as quotes.

-- ==== 1. Tables and columns ====
alter table public.orders add column if not exists refunded_amount numeric(10,2) not null default 0;

create table if not exists public.order_returns (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    order_id uuid not null references public.orders(id) on delete cascade,
    return_number integer not null default 1,
    method text not null check (method in ('cash', 'upi', 'card', 'khata')),
    amount numeric(10,2) not null check (amount >= 0),
    taxable numeric(10,2) not null default 0,
    tax numeric(10,2) not null default 0,
    discount numeric(10,2) not null default 0,
    service_charge numeric(10,2) not null default 0,
    service_charge_tax numeric(10,2) not null default 0,
    round_off numeric(10,2) not null default 0,
    tax_details jsonb not null default '[]'::jsonb,
    cost_back numeric(10,2) not null default 0,
    points_reversed integer not null default 0,
    points_shortfall integer not null default 0,
    reason text not null default '',
    approved_by text not null default '',
    account_id uuid references public.money_accounts(id),
    shift_id uuid references public.shifts(id) on delete set null,
    staff_id uuid references public.staff_users(id) on delete set null,
    actor_name text not null default '',
    client_id text,
    created_at timestamptz not null default now());
create index if not exists order_returns_order_idx on public.order_returns (order_id);
create index if not exists order_returns_tenant_idx on public.order_returns (tenant_id, created_at);
create unique index if not exists order_returns_client_key on public.order_returns (tenant_id, client_id) where client_id is not null;

create table if not exists public.order_return_lines (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    return_id uuid not null references public.order_returns(id) on delete cascade,
    order_id uuid not null references public.orders(id) on delete cascade,
    order_item_id uuid not null references public.order_items(id) on delete cascade,
    menu_item_id uuid references public.menu_items(id) on delete set null,
    combo_id uuid references public.combos(id) on delete set null,
    name text not null default '',
    quantity integer not null check (quantity > 0),
    amount numeric(10,2) not null default 0,
    net_amount numeric(10,2) not null default 0,
    tax_amount numeric(10,2) not null default 0,
    discount numeric(10,2) not null default 0,
    tax_rate numeric(6,3) not null default 0,
    tax_split jsonb not null default '[]'::jsonb,
    unit_cost numeric(10,2) not null default 0,
    is_restricted boolean not null default false,
    restock boolean not null default false);
create index if not exists order_return_lines_return_idx on public.order_return_lines (return_id);
create index if not exists order_return_lines_order_idx on public.order_return_lines (order_id);
create index if not exists order_return_lines_item_idx on public.order_return_lines (order_item_id);

-- Read through the order (staff of the cafe, or the customer of the order); written only by refund_items
alter table public.order_returns enable row level security;
alter table public.order_return_lines enable row level security;
drop policy if exists "via order" on public.order_returns;
create policy "via order" on public.order_returns for select
    using (exists (select 1 from public.orders o where o.id = order_returns.order_id));
drop policy if exists "via order" on public.order_return_lines;
create policy "via order" on public.order_return_lines for select
    using (exists (select 1 from public.orders o where o.id = order_return_lines.order_id));
revoke insert, update, delete on public.order_returns from anon, authenticated;
revoke insert, update, delete on public.order_return_lines from anon, authenticated;

-- ==== 2. Stock a line used: from the sale moves of its order, shared by units of the same dish ====
create or replace function public.line_stock_use(p_line public.order_items, p_qty numeric)
returns table (item_id uuid, location_id uuid, menu_item_id uuid, quantity numeric, unit_cost numeric)
language sql stable security definer set search_path = public, pg_temp as $$
    with mine as (
        select x.mi, count(*) as n from (
            select p_line.menu_item_id as mi where p_line.menu_item_id is not null
            union all
            select (pk ->> 'menuItem')::uuid from jsonb_array_elements(coalesce(p_line.options -> 'picks', '[]'::jsonb)) pk
             where p_line.menu_item_id is null and nullif(pk ->> 'menuItem', '') is not null) x
         group by x.mi),
    units as (
        select x.mi, sum(x.u) as u from (
            select oi.menu_item_id as mi, oi.quantity * oi.unit_factor as u
              from public.order_items oi where oi.order_id = p_line.order_id and oi.menu_item_id is not null
            union all
            select (pk ->> 'menuItem')::uuid, oi.quantity * oi.unit_factor
              from public.order_items oi, jsonb_array_elements(coalesce(oi.options -> 'picks', '[]'::jsonb)) pk
             where oi.order_id = p_line.order_id and oi.menu_item_id is null and nullif(pk ->> 'menuItem', '') is not null) x
         group by x.mi),
    used as (
        select m.item_id, m.location_id, m.menu_item_id, -sum(m.quantity) as q, max(m.unit_cost) as uc
          from public.stock_moves m where m.order_id = p_line.order_id and m.kind = 'sale'
         group by m.item_id, m.location_id, m.menu_item_id)
    select u.item_id, u.location_id, u.menu_item_id,
           round(u.q * p_qty * p_line.unit_factor * mine.n / units.u, 3), u.uc
      from used u join mine on mine.mi = u.menu_item_id join units on units.mi = u.menu_item_id
     where units.u > 0 and u.q > 0;
$$;
revoke execute on function public.line_stock_use(public.order_items, numeric) from public, anon, authenticated;

-- ==== 3. The sales book ====
-- One row per money event, already signed: the bill on the day it was made (sale), each partial refund on its day
-- (refund), a cancel on a later day for what was left of the bill (cancel), and for a bill cancelled the same day only
-- the cost of food refunded earlier that day and not put back in stock (waste). A bill cancelled the same day it was
-- made is otherwise left out, refunds included.
create or replace function public.sales_events(p_tenant uuid, p_from date, p_to date)
returns table (order_id uuid, return_id uuid, day date, kind text, total numeric, tax numeric, discount numeric,
               service_charge numeric, service_charge_tax numeric, round_off numeric, net numeric, cogs numeric)
language sql stable security definer set search_path = public, pg_temp as $$
    with lo as (
        select public.cafe_timezone(p_tenant) as tz,
               (p_from::timestamp at time zone public.cafe_timezone(p_tenant)) as t0,
               ((p_to + 1)::timestamp at time zone public.cafe_timezone(p_tenant)) as t1),
    o as (
        select o.id, o.total, o.tax, o.discount, o.service_charge, o.service_charge_tax, o.round_off,
               (o.created_at at time zone lo.tz)::date as d0,
               case when o.status = 'cancelled' then (coalesce(o.cancelled_at, o.created_at) at time zone lo.tz)::date end as d1
          from public.orders o, lo
         where o.tenant_id = p_tenant and o.created_at < lo.t1
           and (o.created_at >= lo.t0
                or (o.status = 'cancelled' and coalesce(o.cancelled_at, o.created_at) >= lo.t0)
                or o.id in (select r.order_id from public.order_returns r
                             where r.tenant_id = p_tenant and r.created_at >= lo.t0 and r.created_at < lo.t1))),
    rt as (
        select r.*, (r.created_at at time zone lo.tz)::date as dr
          from public.order_returns r, lo where r.order_id in (select id from o)),
    rsum as (
        select rt.order_id, sum(rt.amount) as amount, sum(rt.tax) as tax, sum(rt.discount) as discount,
               sum(rt.service_charge) as sc, sum(rt.service_charge_tax) as sct, sum(rt.round_off) as ro
          from rt group by rt.order_id),
    cost as (
        select oi.order_id, sum(oi.unit_cost * oi.quantity) as cogs
          from public.order_items oi where oi.order_id in (select id from o) group by oi.order_id),
    rl as (
        select l.return_id, l.order_id,
               coalesce(sum(l.unit_cost * l.quantity) filter (where l.restock), 0) as back,
               coalesce(sum(l.unit_cost * l.quantity) filter (where not l.restock), 0) as kept,
               sum(l.unit_cost * l.quantity) as all_cost
          from public.order_return_lines l where l.order_id in (select id from o) group by l.return_id, l.order_id),
    rq as (select rl.order_id, sum(rl.all_cost) as cost_ret, sum(rl.kept) as kept from rl group by rl.order_id)
    select o.id, null::uuid, o.d0, 'sale'::text, o.total, o.tax, o.discount, o.service_charge, o.service_charge_tax, o.round_off,
           o.total - o.tax - o.service_charge_tax - o.round_off, coalesce(c.cogs, 0)
      from o left join cost c on c.order_id = o.id
     where o.d0 between p_from and p_to and (o.d1 is null or o.d1 > o.d0)
    union all
    select r.order_id, r.id, r.dr, 'refund', -r.amount, -r.tax, -r.discount, -r.service_charge, -r.service_charge_tax, -r.round_off,
           -(r.amount - r.tax - r.service_charge_tax - r.round_off), -coalesce(x.back, 0)
      from rt r join o on o.id = r.order_id left join rl x on x.return_id = r.id
     where r.dr between p_from and p_to and (o.d1 is null or o.d1 > o.d0)
    union all
    select o.id, null::uuid, o.d1, 'cancel',
           -(o.total - coalesce(s.amount, 0)), -(o.tax - coalesce(s.tax, 0)), -(o.discount - coalesce(s.discount, 0)),
           -(o.service_charge - coalesce(s.sc, 0)), -(o.service_charge_tax - coalesce(s.sct, 0)), -(o.round_off - coalesce(s.ro, 0)),
           -((o.total - o.tax - o.service_charge_tax - o.round_off)
             - coalesce(s.amount - s.tax - s.sct - s.ro, 0)),
           -(coalesce(c.cogs, 0) - coalesce(q.cost_ret, 0))
      from o left join rsum s on s.order_id = o.id left join cost c on c.order_id = o.id left join rq q on q.order_id = o.id
     where o.d1 > o.d0 and o.d1 between p_from and p_to
    union all
    select o.id, null::uuid, o.d0, 'waste', 0, 0, 0, 0, 0, 0, 0, q.kept
      from o join rq q on q.order_id = o.id
     where o.d1 = o.d0 and o.d0 between p_from and p_to and q.kept > 0;
$$;
revoke execute on function public.sales_events(uuid, date, date) from public, anon, authenticated;

-- The same book line by line (quantities, taxable value, GST and cost signed the same way)
create or replace function public.sales_lines(p_tenant uuid, p_from date, p_to date)
returns table (order_id uuid, return_id uuid, order_item_id uuid, day date, kind text, menu_item_id uuid, combo_id uuid,
               name text, quantity integer, net_amount numeric, tax_amount numeric, tax_rate numeric, discount numeric,
               unit_cost numeric, cogs numeric)
language sql stable security definer set search_path = public, pg_temp as $$
    with e as materialized (select * from public.sales_events(p_tenant, p_from, p_to)),
    back as (
        select l.order_item_id, sum(l.quantity) as q, sum(l.net_amount) as n, sum(l.tax_amount) as t, sum(l.discount) as d
          from public.order_return_lines l where l.order_id in (select e.order_id from e where e.kind = 'cancel')
         group by l.order_item_id)
    select e.order_id, null::uuid, oi.id, e.day, e.kind, oi.menu_item_id, oi.combo_id, oi.name, oi.quantity,
           oi.net_amount::numeric, oi.tax_amount::numeric, oi.tax_rate::numeric, oi.discount::numeric, oi.unit_cost::numeric,
           (oi.unit_cost * oi.quantity)::numeric
      from e join public.order_items oi on oi.order_id = e.order_id where e.kind = 'sale'
    union all
    select e.order_id, e.return_id, l.order_item_id, e.day, e.kind, l.menu_item_id, l.combo_id, l.name, -l.quantity,
           -l.net_amount, -l.tax_amount, l.tax_rate, -l.discount, l.unit_cost,
           case when l.restock then -(l.unit_cost * l.quantity) else 0 end
      from e join public.order_return_lines l on l.return_id = e.return_id where e.kind = 'refund'
    union all
    select e.order_id, null::uuid, oi.id, e.day, e.kind, oi.menu_item_id, oi.combo_id, oi.name,
           -(oi.quantity - coalesce(b.q, 0))::integer, -(oi.net_amount - coalesce(b.n, 0)), -(oi.tax_amount - coalesce(b.t, 0)),
           oi.tax_rate, -(oi.discount - coalesce(b.d, 0)), oi.unit_cost, -(oi.unit_cost * (oi.quantity - coalesce(b.q, 0)))
      from e join public.order_items oi on oi.order_id = e.order_id left join back b on b.order_item_id = oi.id
     where e.kind = 'cancel'
       and (oi.quantity - coalesce(b.q, 0) <> 0 or oi.net_amount - coalesce(b.n, 0) <> 0 or oi.tax_amount - coalesce(b.t, 0) <> 0)
    union all
    select e.order_id, null::uuid, l.order_item_id, e.day, e.kind, l.menu_item_id, l.combo_id, l.name, 0, 0, 0, l.tax_rate, 0,
           l.unit_cost, l.unit_cost * l.quantity
      from e join public.order_return_lines l on l.order_id = e.order_id and not l.restock where e.kind = 'waste';
$$;
revoke execute on function public.sales_lines(uuid, date, date) from public, anon, authenticated;

-- The old order-level book now reads the new one (a partial refund shows as a return row of its order)
create or replace function public.sales_book(p_tenant uuid, p_from date, p_to date)
returns table (order_id uuid, day date, sign integer, is_return boolean)
language sql stable security definer set search_path = public, pg_temp as $$
    select e.order_id, e.day, case when e.kind = 'sale' then 1 else -1 end, e.kind <> 'sale'
      from public.sales_events(p_tenant, p_from, p_to) e where e.kind in ('sale', 'cancel', 'refund');
$$;
revoke execute on function public.sales_book(uuid, date, date) from public, anon, authenticated;

-- Periods of the Analytics screen as cafe dates
create or replace function public.period_dates(p_tenant uuid, p_period text, out d_from date, out d_to date)
language sql stable set search_path = public, pg_temp as $$
    select case coalesce(p_period, '')
               when 'today' then public.cafe_today(p_tenant)
               when 'week' then public.cafe_today(p_tenant) - 6
               when 'month' then (public.cafe_today(p_tenant) - interval '1 month')::date + 1
               when 'year' then (public.cafe_today(p_tenant) - interval '1 year')::date + 1
               when 'all' then date '2000-01-01'
               else public.cafe_today(p_tenant) - 29 end,
           public.cafe_today(p_tenant);
$$;

-- ==== 4. Finance > Today ====
create or replace function public.day_summary(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_day date := coalesce(p_date, public.cafe_today(public.current_tenant_id()));
begin
    if not (public.has_perm('finance.view') or public.has_perm('reports.view')) then
        raise exception 'Not authorized (finance.view)';
    end if;
    return (
        with b as (
            select e.*, o.channel, o.status, o.amount_paid, o.total as bill_total
              from public.sales_events(v_tenant, v_day, v_day) e join public.orders o on o.id = e.order_id),
        voided as (
            select o.* from public.orders o
             where o.tenant_id = v_tenant and o.status = 'cancelled'
               and (coalesce(o.cancelled_at, o.created_at) at time zone v_tz)::date = v_day),
        refunds as (
            select r.*, o.order_number, o.created_at as order_created
              from public.order_returns r join public.orders o on o.id = r.order_id
             where r.tenant_id = v_tenant and (r.created_at at time zone v_tz)::date = v_day)
        select jsonb_build_object(
            'date', v_day,
            'sales', (select jsonb_build_object(
                        'orders', count(*) filter (where kind = 'sale'),
                        'gross', coalesce(sum(total), 0),
                        'tax', coalesce(sum(tax + service_charge_tax), 0),
                        'discounts', coalesce(sum(discount), 0),
                        'serviceCharge', coalesce(sum(service_charge), 0),
                        'net', coalesce(sum(net), 0),
                        'unpaid', coalesce(sum(bill_total - amount_paid) filter (where kind = 'sale' and status not in ('cancelled', 'paid')), 0),
                        'returns', count(*) filter (where kind = 'cancel'),
                        'returnsValue', coalesce(-sum(total) filter (where kind = 'cancel'), 0),
                        'returnsTax', coalesce(-sum(tax + service_charge_tax) filter (where kind = 'cancel'), 0),
                        'refunds', count(*) filter (where kind = 'refund'),
                        'refundsValue', coalesce(-sum(total) filter (where kind = 'refund'), 0),
                        'refundsTax', coalesce(-sum(tax + service_charge_tax) filter (where kind = 'refund'), 0),
                        'avgBill', round(coalesce(avg(total) filter (where kind = 'sale'), 0), 2))
                        from b)
                     || (select jsonb_build_object(
                        'cancelled', count(*) filter (where (created_at at time zone v_tz)::date = v_day),
                        'cancelledValue', coalesce(sum(total) filter (where (created_at at time zone v_tz)::date = v_day), 0),
                        'voidsAfterKitchen', count(*) filter (where cancelled_after_kitchen))
                        from voided),
            'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'total', t, 'returns', r, 'refunds', f) order by t desc), '[]'::jsonb)
                           from (select channel, count(*) filter (where kind = 'sale') n, sum(total) t,
                                        count(*) filter (where kind = 'cancel') r, count(*) filter (where kind = 'refund') f
                                   from b where kind <> 'waste' group by channel) s),
            'money', (select coalesce(jsonb_agg(jsonb_build_object('account', a.name, 'code', a.code, 'in', i, 'out', o) order by a.sort_order), '[]'::jsonb)
                        from (select account_id, coalesce(sum(amount) filter (where amount > 0), 0) i, coalesce(-sum(amount) filter (where amount < 0), 0) o
                                from public.ledger_entries where tenant_id = v_tenant and entry_date = v_day group by account_id) s
                        join public.money_accounts a on a.id = s.account_id),
            'expenses', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', t) order by t desc), '[]'::jsonb)
                           from (select c.name as category, sum(e.amount) t
                                   from public.expenses e join public.expense_categories c on c.id = e.category_id
                                  where e.tenant_id = v_tenant and not e.is_void and e.expense_date = v_day group by c.name
                                 union all
                                 select 'Other / uncategorised', -sum(le.amount) from public.ledger_entries le
                                  where le.tenant_id = v_tenant and le.kind = 'payout' and le.entry_date = v_day
                                 having coalesce(sum(le.amount), 0) <> 0) s),
            'purchases', (select coalesce(sum(total), 0) from public.purchases where tenant_id = v_tenant and not is_void and bill_date = v_day),
            'shifts', (select coalesce(jsonb_agg(public.shift_json(s) order by s.opened_at), '[]'::jsonb)
                         from public.shifts s where s.tenant_id = v_tenant and (s.opened_at at time zone v_tz)::date = v_day),
            'voids', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', order_number, 'total', total, 'reason', cancel_reason,
                                                                   'afterKitchen', cancelled_after_kitchen, 'by', staff_name,
                                                                   'refundedBefore', refunded_amount,
                                                                   'orderDate', (created_at at time zone v_tz)::date,
                                                                   'earlierDay', (created_at at time zone v_tz)::date < v_day)
                                                order by coalesce(cancelled_at, created_at)), '[]'::jsonb)
                        from voided),
            'refundList', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'orderNumber', r.order_number, 'amount', r.amount, 'method', r.method, 'reason', r.reason,
                                     'by', r.actor_name, 'approvedBy', r.approved_by,
                                     'orderDate', (r.order_created at time zone v_tz)::date,
                                     'earlierDay', (r.order_created at time zone v_tz)::date < v_day,
                                     'items', (select coalesce(string_agg(l.quantity || ' × ' || l.name, ', ' order by l.name), '')
                                                 from public.order_return_lines l where l.return_id = r.id))
                                 order by r.created_at), '[]'::jsonb)
                             from refunds r),
            'discounts', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', order_number, 'amount', manual_discount,
                                                                       'reason', discount_reason, 'by', staff_name, 'approvedBy', discount_approved_by)
                                                    order by created_at), '[]'::jsonb)
                            from public.orders where tenant_id = v_tenant and manual_discount > 0 and (created_at at time zone v_tz)::date = v_day)));
end;
$$;

-- ==== 5. Profit and loss ====
create or replace function public.pnl_core(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone(p_tenant);
    v_sales jsonb;
    v_net numeric;
    v_cogs numeric;
    v_unknown integer;
    v_loss numeric;
    v_exp jsonb;
    v_exp_total numeric;
    v_staff jsonb;
    v_gross numeric;
    v_returns jsonb;
    v_refunds jsonb;
begin
    select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'gross', g, 'tax', t, 'net', net, 'returns', r, 'refunds', f) order by g desc), '[]'::jsonb),
           coalesce(sum(net), 0)
      into v_sales, v_net
      from (select o.channel, count(*) filter (where e.kind = 'sale') n, count(*) filter (where e.kind = 'cancel') r,
                   count(*) filter (where e.kind = 'refund') f,
                   sum(e.total) g, sum(e.tax + e.service_charge_tax) t, sum(e.net) net
              from public.sales_events(p_tenant, p_from, p_to) e join public.orders o on o.id = e.order_id
             where e.kind <> 'waste'
             group by o.channel) s;
    select coalesce(sum(e.cogs), 0) into v_cogs from public.sales_events(p_tenant, p_from, p_to) e;
    select count(*) into v_unknown
      from public.sales_events(p_tenant, p_from, p_to) e join public.order_items oi on oi.order_id = e.order_id
     where e.kind = 'sale' and oi.unit_cost = 0;
    select jsonb_build_object('count', count(*), 'value', coalesce(-sum(e.total), 0), 'net', coalesce(-sum(e.net), 0))
      into v_returns from public.sales_events(p_tenant, p_from, p_to) e where e.kind = 'cancel';
    select jsonb_build_object('count', count(*), 'value', coalesce(-sum(e.total), 0), 'net', coalesce(-sum(e.net), 0),
                              'costBack', coalesce(-sum(e.cogs), 0))
      into v_refunds from public.sales_events(p_tenant, p_from, p_to) e where e.kind = 'refund';
    select coalesce(-sum(m.quantity * m.unit_cost), 0) into v_loss
      from public.stock_moves m
     where m.tenant_id = p_tenant and m.kind in ('wastage', 'count', 'staff_meal', 'complimentary')
       and (m.created_at at time zone v_tz)::date between p_from and p_to;
    -- Expenses, plus cash paid out of a drawer without a category
    select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb),
           coalesce(sum(amount), 0)
      into v_exp, v_exp_total
      from (select category, amount from public.expense_allocation(p_tenant, p_from, p_to) where category <> 'Salaries'
            union all
            select 'Other / uncategorised', -sum(le.amount) from public.ledger_entries le
             where le.tenant_id = p_tenant and le.kind = 'payout' and le.entry_date between p_from and p_to
            having coalesce(sum(le.amount), 0) <> 0) x;
    v_staff := public.staff_cost(p_tenant, p_from, p_to);
    v_gross := v_net - v_cogs;
    return jsonb_build_object(
        'from', p_from, 'to', p_to, 'channels', v_sales, 'returns', v_returns, 'refunds', v_refunds,
        'grossSales', (select coalesce(sum((x ->> 'gross')::numeric), 0) from jsonb_array_elements(v_sales) x),
        'taxes', (select coalesce(sum((x ->> 'tax')::numeric), 0) from jsonb_array_elements(v_sales) x),
        'netSales', round(v_net, 2), 'cogs', round(v_cogs, 2), 'linesWithoutCost', v_unknown,
        'grossProfit', round(v_gross, 2), 'grossMarginPct', case when v_net > 0 then round(v_gross / v_net * 100, 1) end,
        'stockLosses', round(v_loss, 2), 'expenses', v_exp, 'expensesTotal', round(v_exp_total, 2),
        'staffCost', (v_staff ->> 'amount')::numeric, 'staffCostEstimated', (v_staff ->> 'estimate')::boolean,
        'netProfit', round(v_gross - v_loss - v_exp_total - (v_staff ->> 'amount')::numeric, 2));
end;
$$;
revoke execute on function public.pnl_core(uuid, date, date) from public, anon, authenticated;

-- ==== 6. GST pack: partial refunds and later-day cancels are credit notes in the period they happen ====
create or replace function public.gst_pack(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_sac text := coalesce(public.get_setting('sac_code', '"996331"', public.current_tenant_id()) #>> '{}', '996331');
    v_default numeric;
begin
    perform public.require_perm('finance.view');
    select coalesce(sum((c ->> 'rate')::numeric), 0) into v_default
      from jsonb_array_elements(coalesce(public.get_setting('tax_config', '[]', v_tenant), '[]'::jsonb)) c;
    return jsonb_build_object(
        'from', p_from, 'to', p_to,
        'gstin', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
        'filing', public.get_setting('gst_filing', '"monthly"', v_tenant) #>> '{}',
        -- Sales by GST rate, net of credit notes. CGST is half the tax (rounded), SGST is the rest, so they always add up.
        'byRate', (select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'taxable', round(taxable, 2), 'tax', round(tax, 2),
                                                               'cgst', round(round(tax, 2) / 2, 2),
                                                               'sgst', round(tax, 2) - round(round(tax, 2) / 2, 2), 'lines', n)
                                            order by rate), '[]'::jsonb)
                     from (select rate, sum(taxable) taxable, sum(tax) tax, sum(n) n from (
                              select l.tax_rate as rate, l.net_amount as taxable, l.tax_amount as tax,
                                     case when l.kind = 'sale' then 1 else 0 end as n
                                from public.sales_lines(v_tenant, p_from, p_to) l where l.kind <> 'waste'
                              union all
                              select v_default, e.service_charge, e.service_charge_tax, 0
                                from public.sales_events(v_tenant, p_from, p_to) e
                               where e.service_charge <> 0 or e.service_charge_tax <> 0) x
                            group by rate
                           having sum(taxable) <> 0 or sum(tax) <> 0 or sum(n) > 0) s),
        'hsn', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'rate', rate, 'qty', qty, 'taxable', round(taxable, 2), 'tax', round(tax, 2))
                                         order by code, rate), '[]'::jsonb)
                  from (select coalesce(nullif(m.hsn_code, ''), v_sac) as code, l.tax_rate as rate, sum(l.quantity) qty,
                               sum(l.net_amount) taxable, sum(l.tax_amount) tax
                          from public.sales_lines(v_tenant, p_from, p_to) l
                          left join public.menu_items m on m.id = l.menu_item_id
                         where l.kind <> 'waste'
                         group by 1, 2) s),
        'creditNotes', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'orderDate', (o.created_at at time zone v_tz)::date,
                                                                     'date', e.day, 'kind', e.kind,
                                                                     'taxable', -e.net, 'tax', -(e.tax + e.service_charge_tax), 'total', -e.total,
                                                                     'reason', case when e.kind = 'refund' then r.reason else o.cancel_reason end,
                                                                     'items', case when e.kind = 'refund' then
                                                                         (select string_agg(l.quantity || ' × ' || l.name, ', ' order by l.name)
                                                                            from public.order_return_lines l where l.return_id = e.return_id) end)
                                                  order by e.day, o.order_number), '[]'::jsonb)
                          from public.sales_events(v_tenant, p_from, p_to) e join public.orders o on o.id = e.order_id
                          left join public.order_returns r on r.id = e.return_id
                         where e.kind in ('cancel', 'refund')),
        'purchases', (select coalesce(jsonb_agg(jsonb_build_object('date', p.bill_date, 'vendor', p.vendor_name, 'gstin', v.gstin,
                                                                   'billNumber', p.bill_number, 'taxable', p.subtotal, 'tax', p.tax, 'total', p.total)
                                                order by p.bill_date), '[]'::jsonb)
                        from public.purchases p left join public.vendors v on v.id = p.vendor_id
                       where p.tenant_id = v_tenant and not p.is_void and p.bill_date between p_from and p_to),
        'orders', (select jsonb_build_object('count', count(*), 'first', min(order_number), 'last', max(order_number),
                                             'cancelled', count(*) filter (where status = 'cancelled'))
                     from public.orders where tenant_id = v_tenant and (created_at at time zone v_tz)::date between p_from and p_to));
end;
$$;

-- ==== 7. Dashboard: the same sales as Finance and Reports ====
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
begin
    perform public.require_perm('reports.view');
    return jsonb_build_object(
        'today', (select jsonb_build_object('revenue', coalesce(sum(e.total), 0), 'orders', count(*) filter (where e.kind = 'sale'),
                                            'net', coalesce(sum(e.net), 0),
                                            'refunds', coalesce(-sum(e.total) filter (where e.kind in ('refund', 'cancel')), 0),
                                            'collected', coalesce(sum(o.total) filter (where e.kind = 'sale' and o.status = 'paid'), 0))
                    from public.sales_events(v_t, v_today, v_today) e join public.orders o on o.id = e.order_id),
        'month', (select jsonb_build_object('revenue', coalesce(sum(e.total), 0), 'orders', count(*) filter (where e.kind = 'sale'),
                                            'net', coalesce(sum(e.net), 0))
                    from public.sales_events(v_t, date_trunc('month', v_today)::date, v_today) e),
        'pendingOrders', (select count(*) from public.orders
                           where tenant_id = v_t and status in ('pending', 'confirmed', 'preparing', 'ready')));
end;
$$;

-- ==== 8. Sales trends (Analytics) = Finance: same book, net sales without GST, each day on its own ====
drop function if exists public.revenue_series(text);
create or replace function public.revenue_series(p_period text default 'week', p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_from date := coalesce(p_from, (public.period_dates(public.current_tenant_id(), p_period)).d_from);
    v_to date := coalesce(p_to, (public.period_dates(public.current_tenant_id(), p_period)).d_to);
    v_margin numeric := coalesce((public.get_setting('profit_margin', '30') #>> '{}')::numeric, 30) / 100;
    v_profit boolean := public.has_perm('sensitive.see_profit');
begin
    perform public.require_perm('reports.view');
    if v_to < v_from or v_to - v_from > 400 then
        raise exception 'Pick a period of up to 400 days';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', to_char(day, 'YYYY-MM-DD'), 'revenue', round(net, 2), 'gross', round(gross, 2), 'tax', round(tax, 2),
                   'orders', orders, 'refunds', round(refunds, 2),
                   'profit', case when v_profit then round(net * v_margin, 2) end)
                   order by day), '[]'::jsonb)
          from (select e.day, sum(e.net) as net, sum(e.total) as gross, sum(e.tax + e.service_charge_tax) as tax,
                       count(*) filter (where e.kind = 'sale') as orders,
                       coalesce(-sum(e.total) filter (where e.kind in ('refund', 'cancel')), 0) as refunds
                  from public.sales_events(v_t, v_from, v_to) e
                 where e.kind <> 'waste'
                 group by e.day) d);
end;
$$;

drop function if exists public.category_sales(text);
create or replace function public.category_sales(p_period text default 'month', p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_from date := coalesce(p_from, (public.period_dates(public.current_tenant_id(), p_period)).d_from);
    v_to date := coalesce(p_to, (public.period_dates(public.current_tenant_id(), p_period)).d_to);
begin
    perform public.require_perm('reports.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object('_id', name, 'total', round(total, 2), 'count', qty)
                   order by total desc), '[]'::jsonb)
          from (select case when l.menu_item_id is null and l.combo_id is not null then 'Combos'
                            else coalesce(c.name, 'Other') end as name,
                       sum(l.net_amount) as total, sum(l.quantity) as qty
                  from public.sales_lines(v_t, v_from, v_to) l
                  left join public.menu_items mi on mi.id = l.menu_item_id
                  left join public.categories c on c.id = mi.category_id
                 where l.kind <> 'waste'
                 group by 1
                having sum(l.net_amount) <> 0 or sum(l.quantity) <> 0) s);
end;
$$;

drop function if exists public.top_items();
create or replace function public.top_items(p_period text default 'month', p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_from date := coalesce(p_from, (public.period_dates(public.current_tenant_id(), p_period)).d_from);
    v_to date := coalesce(p_to, (public.period_dates(public.current_tenant_id(), p_period)).d_to);
begin
    perform public.require_perm('reports.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', id, 'name', name, 'totalQuantity', qty, 'totalRevenue', round(revenue, 2))
                   order by qty desc, revenue desc), '[]'::jsonb)
          from (select coalesce(l.menu_item_id, l.combo_id) as id, coalesce(min(m.name), min(cb.name), min(l.name)) as name,
                       sum(l.quantity) as qty, sum(l.net_amount) as revenue
                  from public.sales_lines(v_t, v_from, v_to) l
                  left join public.menu_items m on m.id = l.menu_item_id
                  left join public.combos cb on cb.id = l.combo_id
                 where l.kind <> 'waste'
                 group by coalesce(l.menu_item_id, l.combo_id)
                having sum(l.quantity) > 0
                 order by qty desc, revenue desc
                 limit 10) t);
end;
$$;

create or replace function public.item_economics(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_len integer := p_to - p_from + 1;
begin
    perform public.require_perm('reports.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    return (
        with cur as (
            select l.menu_item_id, l.combo_id, max(l.name) as name, sum(l.quantity) as units, sum(l.net_amount) as revenue,
                   sum(l.cogs) as cost, count(*) filter (where l.kind = 'sale' and l.unit_cost = 0) as unknown
              from public.sales_lines(v_tenant, p_from, p_to) l
             group by l.menu_item_id, l.combo_id),
        prev as (
            select l.menu_item_id, l.combo_id, sum(l.quantity) as units
              from public.sales_lines(v_tenant, p_from - v_len, p_from - 1) l
             group by l.menu_item_id, l.combo_id),
        tot as (select nullif(sum(revenue - cost), 0) as contribution from cur)
        select coalesce(jsonb_agg(jsonb_build_object(
                   'menuItemId', c.menu_item_id, 'comboId', c.combo_id, 'name', coalesce(m.name, cb.name, c.name), 'units', c.units,
                   'revenue', round(c.revenue, 2), 'cost', round(c.cost, 2), 'costKnown', c.unknown = 0,
                   'contribution', round(c.revenue - c.cost, 2),
                   'contributionPct', case when c.revenue > 0 then round((c.revenue - c.cost) / c.revenue * 100, 1) end,
                   'perUnit', round((c.revenue - c.cost) / nullif(c.units, 0), 2),
                   'sharePct', round((c.revenue - c.cost) / (select contribution from tot) * 100, 1),
                   'prevUnits', coalesce(p.units, 0),
                   'trendPct', case when coalesce(p.units, 0) > 0 then round((c.units - p.units) * 100.0 / p.units, 1) end)
                   order by c.revenue - c.cost desc), '[]'::jsonb)
          from cur c
          left join prev p on p.menu_item_id is not distinct from c.menu_item_id and p.combo_id is not distinct from c.combo_id
          left join public.menu_items m on m.id = c.menu_item_id
          left join public.combos cb on cb.id = c.combo_id
         where c.units <> 0 or c.revenue <> 0 or c.cost <> 0);
end;
$$;

-- Top customers: what they spent, less what was refunded
create or replace function public.user_analytics(p_period text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone();
    v_start timestamptz := public.period_start(p_period);
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
begin
    perform public.require_perm('reports.view');
    return jsonb_build_object(
        'totalUsers', (select count(*) from public.customers where tenant_id = v_t),
        'newUsers', (select count(*) from public.customers where tenant_id = v_t and created_at >= v_start),
        'activeUsers', (select count(distinct customer_id) from public.orders
                         where tenant_id = v_t and status = 'paid' and created_at >= v_start),
        'returningCustomers', (select count(*) from (
                                  select customer_id from public.orders where tenant_id = v_t and status = 'paid'
                                   group by customer_id having count(*) > 1) r),
        'userGrowth', (select coalesce(jsonb_agg(jsonb_build_object('date', to_char(day, 'FMDD Mon'), 'users', n)
                                   order by day), '[]'::jsonb)
                         from (select (created_at at time zone v_tz)::date as day, count(*) as n
                                 from public.customers where tenant_id = v_t and created_at >= v_start group by 1) g),
        'topCustomers', (select coalesce(jsonb_agg(jsonb_build_object(
                                   '_id', c.id, 'name', c.name,
                                   'phone', case when v_phone then c.phone else public.mask_phone(c.phone) end,
                                   'orderCount', t.order_count, 'totalSpent', t.spent)
                                   order by t.spent desc), '[]'::jsonb)
                           from (select customer_id, count(*) as order_count, sum(total - refunded_amount) as spent
                                   from public.orders where tenant_id = v_t and status <> 'cancelled' and customer_id is not null
                                  group by customer_id order by spent desc limit 5) t
                           join public.customers c on c.id = t.customer_id));
end;
$$;

-- ==== 9. Refund some items of a paid bill ====
-- p_lines: [{orderItemId, quantity, restock}]. A combo is refunded as a whole combo line.
-- The money for each line is what the customer paid for those units: its taxable value after its share of every
-- discount, plus its GST, plus its share of the service charge and that GST. Shares are taken on the running total,
-- so refunding a line bit by bit adds up to exactly the line; the last refund of a bill also returns the round-off.
-- p_preview = true checks and prices the refund without saving anything (the dialog shows the amount).
create or replace function public.refund_items(p_order_id uuid, p_lines jsonb, p_method text default 'cash', p_reason text default '',
                                               p_drawer text default null, p_approver_phone text default null,
                                               p_approver_pin text default null, p_preview boolean default false,
                                               p_client_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_l jsonb;
    v_oi public.order_items;
    v_qty integer;
    v_prev record;
    v_cum integer;
    v_lines jsonb := '[]'::jsonb;
    v_net numeric;
    v_tax numeric;
    v_disc numeric;
    v_sum_net numeric := 0;
    v_sum_tax numeric := 0;
    v_sum_disc numeric := 0;
    v_lines_net numeric;
    v_prev_net numeric;
    v_sc numeric := 0;
    v_sct numeric := 0;
    v_ro numeric := 0;
    v_amount numeric;
    v_prev_ret record;
    v_all_done boolean;
    v_by text := '';
    v_acc uuid;
    v_shift uuid;
    v_khata_left numeric;
    v_ret uuid;
    v_no integer;
    v_earned integer;
    v_base_total numeric;
    v_base_back numeric;
    v_take integer := 0;
    v_from_held integer := 0;
    v_from_bal integer := 0;
    v_bal integer;
    v_short integer := 0;
    v_cost_back numeric := 0;
    v_ids uuid[] := '{}';
    v_restock boolean;
    v_tax_details jsonb;
begin
    perform public.require_perm('orders.create');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    if p_client_id is not null and exists (select 1 from public.order_returns where tenant_id = v_o.tenant_id and client_id = p_client_id) then
        return public.order_json(v_o) || jsonb_build_object('duplicate', true);
    end if;
    if v_o.status = 'cancelled' then
        raise exception 'This order was cancelled';
    end if;
    -- An unpaid bill has nothing to give back: take the items off the bill, or cancel it
    if v_o.status <> 'paid' or v_o.amount_paid < v_o.total then
        raise exception 'This bill is not paid yet, so there is nothing to refund. Change the bill or cancel it instead.';
    end if;
    if p_method not in ('cash', 'upi', 'card', 'khata') then
        raise exception 'Pick how the money goes back: cash, UPI, card or khata';
    end if;
    if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
        raise exception 'Pick at least one item to refund';
    end if;

    -- Price each line
    for v_l in select * from jsonb_array_elements(p_lines) loop
        v_qty := nullif(v_l ->> 'quantity', '')::integer;
        if v_qty is null or v_qty < 1 then
            raise exception 'Check the quantity on every line';
        end if;
        select * into v_oi from public.order_items where id = nullif(v_l ->> 'orderItemId', '')::uuid and order_id = v_o.id;
        if v_oi.id is null then
            raise exception 'That item is not on this bill';
        end if;
        if v_oi.id = any (v_ids) then
            raise exception '% is listed twice', v_oi.name;
        end if;
        v_ids := v_ids || v_oi.id;
        select coalesce(sum(quantity), 0)::integer as q, coalesce(sum(net_amount), 0) as n, coalesce(sum(tax_amount), 0) as t,
               coalesce(sum(discount), 0) as d
          into v_prev from public.order_return_lines where order_item_id = v_oi.id;
        if v_qty > v_oi.quantity - v_prev.q then
            raise exception '%: only % left to refund', v_oi.name, v_oi.quantity - v_prev.q;
        end if;
        v_cum := v_prev.q + v_qty;
        v_net := round(v_oi.net_amount * v_cum / v_oi.quantity, 2) - v_prev.n;
        v_tax := round(v_oi.tax_amount * v_cum / v_oi.quantity, 2) - v_prev.t;
        v_disc := round(v_oi.discount * v_cum / v_oi.quantity, 2) - v_prev.d;
        v_restock := coalesce((v_l ->> 'restock')::boolean, false);
        v_sum_net := v_sum_net + v_net;
        v_sum_tax := v_sum_tax + v_tax;
        v_sum_disc := v_sum_disc + v_disc;
        if v_restock then
            v_cost_back := v_cost_back + v_oi.unit_cost * v_qty;
        end if;
        v_lines := v_lines || jsonb_build_object(
            'orderItemId', v_oi.id, 'menuItemId', v_oi.menu_item_id, 'comboId', v_oi.combo_id, 'name', v_oi.name,
            'quantity', v_qty, 'sold', v_oi.quantity, 'alreadyRefunded', v_prev.q,
            'net', v_net, 'tax', v_tax, 'discount', v_disc, 'amount', v_net + v_tax, 'taxRate', v_oi.tax_rate,
            'unitCost', v_oi.unit_cost, 'restricted', v_oi.is_restricted, 'restock', v_restock,
            'taxSplit', case when v_tax <> 0 then jsonb_build_array(
                jsonb_build_object('name', 'CGST', 'rate', v_oi.tax_rate / 2, 'amount', round(v_tax / 2, 2)),
                jsonb_build_object('name', 'SGST', 'rate', v_oi.tax_rate / 2, 'amount', v_tax - round(v_tax / 2, 2))) else '[]'::jsonb end);
    end loop;

    -- Service charge share (on the running total of taxable value refunded) and, on the last refund, the round-off
    select coalesce(sum(amount), 0) as amount, coalesce(sum(service_charge), 0) as sc, coalesce(sum(service_charge_tax), 0) as sct,
           coalesce(max(return_number), 0) as n
      into v_prev_ret from public.order_returns where order_id = v_o.id;
    select coalesce(sum(net_amount), 0) into v_lines_net from public.order_items where order_id = v_o.id;
    select coalesce(sum(net_amount), 0) into v_prev_net from public.order_return_lines where order_id = v_o.id;
    if v_o.service_charge <> 0 and v_lines_net > 0 then
        v_sc := round(v_o.service_charge * (v_prev_net + v_sum_net) / v_lines_net, 2) - v_prev_ret.sc;
        v_sct := round(v_o.service_charge_tax * (v_prev_net + v_sum_net) / v_lines_net, 2) - v_prev_ret.sct;
    end if;
    v_all_done := not exists (
        select 1 from public.order_items oi
         where oi.order_id = v_o.id
           and oi.quantity > coalesce((select sum(quantity) from public.order_return_lines r where r.order_item_id = oi.id), 0)
                             + coalesce((select (x ->> 'quantity')::integer from jsonb_array_elements(v_lines) x
                                          where (x ->> 'orderItemId')::uuid = oi.id), 0));
    v_amount := v_sum_net + v_sum_tax + v_sc + v_sct;
    if v_all_done then
        v_ro := (v_o.total - v_prev_ret.amount) - v_amount;
        v_amount := v_o.total - v_prev_ret.amount;
    end if;
    if v_amount > v_o.amount_paid - v_o.refunded_amount + 0.001 then
        raise exception 'Only % of this bill is left to refund', public.inr(v_o.amount_paid - v_o.refunded_amount);
    end if;

    -- Khata: only the part of this bill still owed on the khata can be taken off it
    if p_method = 'khata' then
        if v_o.customer_id is null then
            raise exception 'This bill has no customer, so it cannot go on a khata';
        end if;
        v_khata_left := coalesce((select sum(le.amount) from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
                                   where le.order_id = v_o.id and a.kind = 'khata'), 0);
        if v_o.khata_amount > 0 then
            v_khata_left := least(v_khata_left, v_o.khata_amount - v_o.khata_paid);
        end if;
        v_khata_left := least(v_khata_left, public.khata_balance(v_o.customer_id));
        if v_khata_left <= 0 then
            raise exception 'Nothing of this bill is on the khata now. Give the money back in cash, UPI or card.';
        end if;
        if v_amount > v_khata_left + 0.001 then
            raise exception 'Only % of this bill is still on the khata. Refund the rest in cash, UPI or card.', public.inr(v_khata_left);
        end if;
    end if;

    v_tax_details := (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'rate', rate, 'amount', amount) order by name, rate), '[]'::jsonb)
                        from (select s ->> 'name' as name, (s ->> 'rate')::numeric as rate, sum((s ->> 'amount')::numeric) as amount
                                from jsonb_array_elements(v_lines) x, jsonb_array_elements(x -> 'taxSplit') s group by 1, 2) t);

    if p_preview then
        return jsonb_build_object('orderId', v_o.id, 'amount', v_amount, 'taxable', v_sum_net + v_sc, 'tax', v_sum_tax + v_sct,
                                  'discount', v_sum_disc, 'serviceCharge', v_sc, 'serviceChargeTax', v_sct, 'roundOff', v_ro,
                                  'lines', v_lines, 'taxDetails', v_tax_details, 'last', v_all_done,
                                  'needsApproval', not public.has_perm('sensitive.void_bill'),
                                  'khataLeft', v_khata_left);
    end if;

    if trim(coalesce(p_reason, '')) = '' then
        raise exception 'Give a reason for the refund';
    end if;
    if not public.has_perm('sensitive.void_bill') then
        if nullif(p_approver_phone, '') is null then
            raise exception 'A manager must approve: enter their mobile and PIN';
        end if;
        v_by := public.verify_approver(v_o.tenant_id, p_approver_phone, p_approver_pin, 'sensitive.void_bill');
    end if;

    -- Where the money comes from. Cash: the drawer named by the device, else the drawer that took the cash, else the counter.
    -- UPI and card: their account, in the shift of the drawer doing the refund (same rule as cancel_order).
    v_shift := coalesce(
        case when nullif(p_drawer, '') is not null then public.open_shift_id(public.account_id(v_o.tenant_id, p_drawer)) end,
        (select public.open_shift_id(s.account_id) from public.ledger_entries le join public.shifts s on s.id = le.shift_id
          where le.order_id = v_o.id and le.kind in ('sale', 'khata_sale') order by le.created_at desc limit 1),
        (select s.id from public.shifts s where s.tenant_id = v_o.tenant_id and s.status = 'open'
            and s.opened_by_staff = public.my_staff_id() order by s.opened_at desc limit 1));
    if p_method = 'cash' then
        if nullif(p_drawer, '') is not null then
            v_acc := public.account_id(v_o.tenant_id, p_drawer);
            if v_acc is null or not exists (select 1 from public.money_accounts where id = v_acc and is_drawer) then
                raise exception 'Unknown cash drawer';
            end if;
        else
            v_acc := coalesce(
                (select le.account_id from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
                  where le.order_id = v_o.id and le.kind = 'sale' and a.is_drawer order by le.amount desc limit 1),
                public.account_id(v_o.tenant_id, 'cash_counter'));
        end if;
        v_shift := public.open_shift_id(v_acc);
    elsif p_method = 'khata' then
        v_acc := public.account_id(v_o.tenant_id, 'khata');
    else
        v_acc := public.account_id(v_o.tenant_id, p_method);
    end if;
    if v_acc is null then
        raise exception 'Money account not found';
    end if;

    v_no := v_prev_ret.n + 1;
    insert into public.order_returns (tenant_id, order_id, return_number, method, amount, taxable, tax, discount, service_charge,
                                      service_charge_tax, round_off, tax_details, cost_back, reason, approved_by, account_id, shift_id,
                                      staff_id, actor_name, client_id)
    values (v_o.tenant_id, v_o.id, v_no, p_method, v_amount, v_sum_net + v_sc, v_sum_tax, v_sum_disc, v_sc, v_sct, v_ro,
            v_tax_details, v_cost_back, trim(p_reason), v_by, v_acc, v_shift, public.my_staff_id(), public.actor_name(), p_client_id)
    returning id into v_ret;
    insert into public.order_return_lines (tenant_id, return_id, order_id, order_item_id, menu_item_id, combo_id, name, quantity,
                                           amount, net_amount, tax_amount, discount, tax_rate, tax_split, unit_cost, is_restricted, restock)
    select v_o.tenant_id, v_ret, v_o.id, (x ->> 'orderItemId')::uuid, (x ->> 'menuItemId')::uuid, (x ->> 'comboId')::uuid, x ->> 'name',
           (x ->> 'quantity')::integer, (x ->> 'amount')::numeric, (x ->> 'net')::numeric, (x ->> 'tax')::numeric,
           (x ->> 'discount')::numeric, (x ->> 'taxRate')::numeric, x -> 'taxSplit', (x ->> 'unitCost')::numeric,
           (x ->> 'restricted')::boolean, (x ->> 'restock')::boolean
      from jsonb_array_elements(v_lines) x;

    -- The money goes out
    if v_amount > 0 then
        perform public.post_ledger(v_o.tenant_id, v_acc, -v_amount, 'refund', p_method, v_o.id, null, null, v_shift, v_o.customer_id,
                                   'Refund of items: ' || trim(p_reason), p_client_id);
    end if;
    if p_method = 'khata' and v_o.khata_amount > 0 then
        update public.orders set khata_amount = greatest(khata_amount - v_amount, khata_paid) where id = v_o.id;
    end if;

    -- Back in stock (only the lines the staff chose)
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
    select v_o.tenant_id, s.item_id, s.location_id, s.quantity, s.unit_cost, 'sale_reversal', v_o.id, s.menu_item_id,
           'Order ' || v_o.order_number || ' refund: ' || oi.name || ' × ' || l.quantity, public.actor_name()
      from public.order_return_lines l join public.order_items oi on oi.id = l.order_item_id,
           lateral public.line_stock_use(oi, l.quantity) s
     where l.return_id = v_ret and l.restock and s.quantity <> 0;

    -- Points earned by these items are taken back in proportion (on the points base: items that earn points, after discounts).
    -- Points still held for an unpaid khata go first; the balance stops at 0 and the shortfall is kept.
    if v_o.customer_id is not null then
        v_earned := coalesce(v_o.points_awarded, 0)
                    + coalesce((select sum(points) from public.reward_grants where order_id = v_o.id and source = 'multiplier'), 0)::integer;
        select coalesce(sum(total - discount), 0) into v_base_total from public.order_items where order_id = v_o.id and not is_restricted;
        select coalesce(sum((oi.total - oi.discount) * r.q / oi.quantity), 0) into v_base_back
          from public.order_items oi
          join (select order_item_id, sum(quantity) q from public.order_return_lines where order_id = v_o.id group by order_item_id) r
            on r.order_item_id = oi.id
         where not oi.is_restricted;
        if v_earned > 0 and v_base_total > 0 then
            v_take := greatest(floor(v_earned * least(v_base_back / v_base_total, 1))::integer - coalesce(v_o.points_reversed, 0), 0);
        end if;
        if v_take > 0 then
            v_from_held := least(v_take, coalesce(v_o.points_held, 0));
            v_from_bal := v_take - v_from_held;
            select loyalty_points into v_bal from public.customers where id = v_o.customer_id for update;
            v_short := greatest(v_from_bal - v_bal, 0);
            update public.customers
               set loyalty_points = greatest(v_bal - v_from_bal, 0),
                   total_points_earned = greatest(total_points_earned - v_from_bal, 0)
             where id = v_o.customer_id;
            update public.order_returns set points_reversed = v_take, points_shortfall = v_short where id = v_ret;
        end if;
    end if;

    update public.orders
       set refunded_amount = refunded_amount + v_amount,
           points_reversed = points_reversed + v_take,
           points_shortfall = points_shortfall + v_short,
           points_held = greatest(points_held - v_from_held, 0),
           points_held_total = greatest(points_held_total - v_from_held, 0)
     where id = v_o.id
    returning * into v_o;

    perform public.notify(v_o.tenant_id, 'void', 'Refund ' || public.inr(v_amount) || ' on order ' || v_o.order_number,
        (select string_agg(l.quantity || ' × ' || l.name, ', ') from public.order_return_lines l where l.return_id = v_ret)
            || ' · ' || upper(p_method) || ' · ' || trim(p_reason) || ' · by ' || public.actor_name()
            || case when v_by <> '' then ' (approved by ' || v_by || ')' else '' end,
        '/admin/history?q=' || v_o.order_number, 'reports.view', 'normal', '{}'::jsonb);

    return public.order_json(v_o) || jsonb_build_object('refund', jsonb_build_object(
        'id', v_ret, 'number', v_no, 'amount', v_amount, 'method', p_method, 'lines', v_lines, 'taxDetails', v_tax_details,
        'serviceCharge', v_sc, 'serviceChargeTax', v_sct, 'roundOff', v_ro, 'pointsReversed', v_take, 'pointsShortfall', v_short,
        'approvedBy', v_by, 'reason', trim(p_reason)));
end;
$$;

-- ==== 10. Cancel after partial refunds: only what is left goes back ====
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text, p_approver_phone text DEFAULT NULL::text, p_approver_pin text DEFAULT NULL::text, p_drawer text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_o public.orders;
    v_by text := '';
    v_after boolean;
    v_e record;
    v_shift uuid;
    v_left numeric;
    v_take numeric;
begin
    perform public.require_perm('orders.create');
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

    -- The shift of the drawer doing the refund: the drawer named by the device, else the drawer that took the money,
    -- else a shift this staff member has open
    v_shift := coalesce(
        case when nullif(p_drawer, '') is not null then public.open_shift_id(public.account_id(v_o.tenant_id, p_drawer)) end,
        (select public.open_shift_id(s.account_id) from public.ledger_entries le join public.shifts s on s.id = le.shift_id
          where le.order_id = v_o.id and le.kind in ('sale', 'khata_sale') order by le.created_at desc limit 1),
        (select s.id from public.shifts s where s.tenant_id = v_o.tenant_id and s.status = 'open'
            and s.opened_by_staff = public.my_staff_id() order by s.opened_at desc limit 1));
    -- What is still to give back = everything taken less every refund so far. It goes back to each payment account
    -- that still holds money of this bill, the biggest first (khata balances are reversed by their own entries).
    select coalesce(sum(amount), 0) into v_left from public.ledger_entries
     where order_id = v_o.id and kind in ('sale', 'refund', 'khata_sale');
    for v_e in select account_id, method, sum(amount) as amt from public.ledger_entries
                where order_id = v_o.id and kind in ('sale', 'refund', 'khata_sale')
                group by account_id, method having sum(amount) > 0 order by sum(amount) desc loop
        exit when v_left <= 0;
        v_take := least(v_e.amt, v_left);
        v_left := v_left - v_take;
        perform public.post_ledger(v_o.tenant_id, v_e.account_id, -v_take, 'refund', v_e.method, v_o.id, null, null,
                                   case when exists (select 1 from public.money_accounts where id = v_e.account_id and is_drawer)
                                        then public.open_shift_id(v_e.account_id) else v_shift end,
                                   v_o.customer_id, 'Refund: ' || trim(p_reason));
    end loop;

    update public.orders
       set status = 'cancelled', cancel_reason = trim(p_reason) || case when v_by <> '' then ' (approved by ' || v_by || ')' else '' end,
           cancelled_after_kitchen = v_after, payment_request = ''
     where id = v_o.id
    returning * into v_o;
    if v_after then
        perform public.notify(v_o.tenant_id, 'void', 'Order ' || v_o.order_number || ' cancelled after the kitchen started',
            public.inr(v_o.total - v_o.refunded_amount) || ' · ' || trim(p_reason) || ' · by ' || public.actor_name(), '/admin/history?q=' || v_o.order_number,
            'reports.view', 'loud');
    end if;
    return public.order_json(v_o);
end;
$function$;

CREATE OR REPLACE FUNCTION public.orders_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_settings public.loyalty_settings;
    v_base numeric;
    v_points integer := 0;
    v_line public.order_items;
    v_credited integer;
    v_balance integer;
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

    -- Cancelled: redeemed points come back; points this order earned that are still credited are taken back
    -- (earned less those held for an unpaid khata, less those already taken back by partial refunds).
    -- If the customer already spent them the balance stops at 0 and the shortfall is kept on the order.
    if new.status = 'cancelled' and old.status <> 'cancelled' and new.customer_id is not null then
        v_credited := greatest(coalesce(new.points_awarded, 0)
                      + coalesce((select sum(points) from public.reward_grants where order_id = new.id and source = 'multiplier'), 0)::integer
                      - coalesce(new.points_held, 0) - coalesce(old.points_reversed, 0), 0);
        if v_credited > 0 or coalesce(new.points_redeemed, 0) > 0 then
            select loyalty_points into v_balance from public.customers where id = new.customer_id for update;
            v_balance := v_balance + coalesce(new.points_redeemed, 0) - v_credited;
            new.points_reversed := coalesce(old.points_reversed, 0) + v_credited;
            new.points_shortfall := coalesce(old.points_shortfall, 0) + greatest(-v_balance, 0);
            update public.customers
               set loyalty_points = greatest(v_balance, 0),
                   total_points_earned = greatest(total_points_earned - v_credited, 0)
             where id = new.customer_id;
        end if;
        new.points_held := 0;
    end if;

    -- Stock: a cancelled order puts back what it used, except food refunded earlier and not put back;
    -- reopening it takes it again
    if new.status = 'cancelled' and old.status <> 'cancelled' then
        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
        select new.tenant_id, x.item_id, x.location_id, x.q, x.uc, 'sale_reversal', new.id, x.menu_item_id,
               'Order ' || new.order_number || ' cancelled', public.actor_name()
          from (select m.item_id, m.location_id, m.menu_item_id,
                       round(-sum(m.quantity) - coalesce(max(w.q), 0), 3) as q, max(m.unit_cost) as uc
                  from public.stock_moves m
                  left join (select s.item_id, s.location_id, s.menu_item_id, sum(s.quantity) as q
                               from public.order_return_lines l join public.order_items oi on oi.id = l.order_item_id,
                                    lateral public.line_stock_use(oi, l.quantity) s
                              where l.order_id = new.id and not l.restock
                              group by s.item_id, s.location_id, s.menu_item_id) w
                    on w.item_id = m.item_id and w.location_id = m.location_id and w.menu_item_id is not distinct from m.menu_item_id
                 where m.order_id = new.id and m.kind in ('sale', 'sale_reversal')
                 group by m.item_id, m.location_id, m.menu_item_id) x
         where x.q > 0;
    elsif old.status = 'cancelled' and new.status <> 'cancelled' then
        for v_line in select * from public.order_items where order_id = new.id loop
            perform public.deduct_order_line(v_line);
        end loop;
    end if;

    if new.status in ('paid', 'cancelled') and new.table_id is not null then
        perform public.free_table_if_idle(new.table_id, new.id);
    end if;

    return new;
end;
$function$;


-- ==== 11. Counter rewards ====
-- create_staff_order: a loyalty deal (loyaltyOfferId) or points as cash (pointsCash) for the attached customer
CREATE OR REPLACE FUNCTION public.create_staff_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_offer uuid := nullif(p ->> 'loyaltyOfferId', '')::uuid;
    v_points_cash boolean := coalesce((p ->> 'pointsCash')::boolean, false);
    v_used integer;
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

    -- One reward per bill at the counter: a loyalty deal or points as cash (same rules as the customer app)
    if v_offer is not null and v_points_cash then
        raise exception 'Pick one reward: a deal or points as cash';
    end if;
    if (v_offer is not null or v_points_cash) and v_customer is null then
        raise exception 'Add the customer (mobile number) to use their points';
    end if;
    if v_offer is not null or v_points_cash then
        perform 1 from public.customers where id = v_customer for update;
    end if;

    if v_manual > 0 then
        if trim(coalesce(p ->> 'discountReason', '')) = '' then
            raise exception 'Give a reason for the discount';
        end if;
    end if;
    v_calc := public.price_order(v_tenant, v_customer, p -> 'items', p ->> 'couponCode', v_offer, v_manual, v_points_cash);
    if v_points_cash and coalesce((v_calc ->> 'pointsUsed')::integer, 0) = 0 then
        raise exception 'No points can be used on this bill';
    end if;
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
    v_used := coalesce((v_calc ->> 'pointsUsed')::integer, 0);
    if v_used > 0 then
        update public.customers set loyalty_points = loyalty_points - v_used where id = v_customer and loyalty_points >= v_used;
        if not found then
            raise exception 'Not enough loyalty points for this reward';
        end if;
    end if;

    insert into public.orders (
        tenant_id, order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate, tax_details, restaurant_info,
        total, table_id, table_number, special_instructions, status, channel, token_number, client_id, device_code,
        created_by_staff, staff_name, manual_discount, discount_reason, discount_approved_by, loyalty_offer_id, points_redeemed)
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
        trim(coalesce(p ->> 'discountReason', '')), v_by, (v_calc ->> 'offerId')::uuid, v_used)
    returning id into v_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost,
                                    unit_name, unit_factor, note, options, combo_id)
    select v_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0),
           l ->> 'unit_name', (l ->> 'unit_factor')::numeric, coalesce(l ->> 'note', ''),
           coalesce(l -> 'options', '{}'::jsonb), (l ->> 'combo_id')::uuid
      from jsonb_array_elements(v_calc -> 'lines') l;

    if v_table.id is not null then
        update public.dining_tables set status = 'occupied', is_occupied = true, current_order_id = v_id where id = v_table.id;
    end if;
    -- Kiosk sales are handed over at once; they never go to the kitchen
    if v_channel = 'kiosk' then
        update public.order_items set kitchen_status = 'served' where order_id = v_id;
    end if;

    -- payFullBy: pay exactly what the bill comes to (used by offline devices, which cannot price the bill)
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
$function$;

CREATE OR REPLACE FUNCTION public.quote_staff_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_q jsonb;
    v_offer uuid := nullif(p ->> 'loyaltyOfferId', '')::uuid;
    v_points_cash boolean := coalesce((p ->> 'pointsCash')::boolean, false);
begin
    perform public.require_perm('orders.create');
    if v_offer is not null and v_points_cash then
        raise exception 'Pick one reward: a deal or points as cash';
    end if;
    if (v_offer is not null or v_points_cash) and nullif(p ->> 'customerId', '') is null then
        raise exception 'Add the customer (mobile number) to use their points';
    end if;
    v_q := public.price_order(public.current_tenant_id(), nullif(p ->> 'customerId', '')::uuid, p -> 'items', p ->> 'couponCode', v_offer,
                              round(coalesce(nullif(p ->> 'manualDiscount', '')::numeric, 0), 2), v_points_cash);
    return (v_q - 'couponId') || jsonb_build_object('discountLimit', public.my_discount_limit());
end;
$function$;

-- What the attached customer can use at the counter: points, the deals they can afford, points as cash
create or replace function public.counter_rewards(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_c public.customers;
    v_s public.loyalty_settings;
begin
    perform public.require_perm('orders.create');
    select * into v_c from public.customers where id = p_customer and tenant_id = public.current_tenant_id();
    if v_c.id is null then
        raise exception 'Customer not found';
    end if;
    select * into v_s from public.loyalty_settings where tenant_id = v_c.tenant_id;
    return jsonb_build_object(
        'customerId', v_c.id, 'points', v_c.loyalty_points,
        'programOn', coalesce(v_s.is_active, false),
        'dealsOn', coalesce(v_s.is_active, false) and coalesce(v_s.deals_on, true),
        'pointsCash', jsonb_build_object(
            'on', coalesce(v_s.is_active, false) and coalesce(v_s.points_as_cash, false),
            'minPoints', coalesce(v_s.min_points_to_redeem, 0),
            'pointsPerRupee', coalesce(v_s.points_to_rupee_ratio, 10),
            'maxPct', coalesce(v_s.max_redemption_percent, 0),
            'canUse', coalesce(v_s.is_active, false) and coalesce(v_s.points_as_cash, false)
                      and v_c.loyalty_points >= coalesce(v_s.min_points_to_redeem, 0) and v_c.loyalty_points > 0,
            'worth', floor(v_c.loyalty_points / greatest(coalesce(v_s.points_to_rupee_ratio, 10), 0.0001))),
        'offers', case when coalesce(v_s.is_active, false) and coalesce(v_s.deals_on, true) then (
                     select coalesce(jsonb_agg(jsonb_build_object('id', lo.id, 'name', lo.name, 'description', lo.description,
                                                                  'pointsRequired', lo.points_required, 'discount', lo.discount_value,
                                                                  'minOrder', lo.min_order_value,
                                                                  'eligible', v_c.loyalty_points >= lo.points_required)
                                               order by lo.points_required), '[]'::jsonb)
                       from public.loyalty_offers lo where lo.tenant_id = v_c.tenant_id and lo.is_active)
                     else '[]'::jsonb end);
end;
$$;

-- ==== 12. Orders as the app sees them: refunds included ====
CREATE OR REPLACE FUNCTION public.order_json(o orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
        '_id', o.id, 'id', o.id,
        'orderNumber', o.order_number,
        'user', case when c.id is null then public.order_customer_brief(o.customer_id, o.tenant_id) else
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
                'netAmount', oi.net_amount, 'taxAmount', oi.tax_amount,
                'refundedQty', coalesce((select sum(rl.quantity) from public.order_return_lines rl where rl.order_item_id = oi.id), 0),
                'restockDefault', coalesce(oi.is_restricted or mi.item_type = 'resale', false),
                'kitchenStatus', oi.kitchen_status, 'unitName', oi.unit_name, 'note', oi.note,
                'comboId', oi.combo_id, 'options', oi.options)
                order by oi.name)
              from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = o.id), '[]'::jsonb),
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by method)
              from (select le.method, sum(le.amount) as amt from public.ledger_entries le
                     where le.order_id = o.id and le.kind in ('sale', 'refund', 'khata_sale')
                     group by le.method having sum(le.amount) <> 0) p), '[]'::jsonb),
        'refunded', o.refunded_amount,
        'refunds', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'number', r.return_number, 'at', r.created_at, 'amount', r.amount, 'method', r.method,
                'reason', r.reason, 'by', r.actor_name, 'approvedBy', r.approved_by,
                'taxable', r.taxable, 'tax', r.tax, 'serviceCharge', r.service_charge, 'serviceChargeTax', r.service_charge_tax,
                'roundOff', r.round_off, 'taxDetails', r.tax_details, 'pointsReversed', r.points_reversed,
                'lines', (select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'quantity', l.quantity, 'amount', l.amount,
                                                                       'restock', l.restock) order by l.name), '[]'::jsonb)
                            from public.order_return_lines l where l.return_id = r.id))
                order by r.return_number)
              from public.order_returns r where r.order_id = o.id), '[]'::jsonb),
        'subtotal', o.subtotal, 'discount', o.discount, 'couponCode', o.coupon_code,
        'manualDiscount', o.manual_discount, 'discountReason', o.discount_reason,
        'tax', o.tax, 'gstRate', o.gst_rate, 'taxDetails', o.tax_details,
        'serviceCharge', o.service_charge, 'serviceChargeTax', o.service_charge_tax,
        'serviceChargeRemoved', o.service_charge_removed, 'roundOff', o.round_off,
        'restaurantInfo', o.restaurant_info, 'total', o.total, 'status', o.status,
        'paymentMethod', o.payment_method, 'amountPaid', o.amount_paid,
        'paymentRequest', o.payment_request, 'paymentRequestedAt', o.payment_requested_at,
        'tableNumber', o.table_number, 'table', o.table_id, 'held', o.held, 'holdReason', o.hold_reason,
        'channel', o.channel, 'tokenNumber', o.token_number, 'staffName', o.staff_name, 'deviceCode', o.device_code,
        'cancelReason', o.cancel_reason, 'cancelledAfterKitchen', o.cancelled_after_kitchen,
        'specialInstructions', o.special_instructions,
        'loyaltyOffer', o.loyalty_offer_id, 'pointsRedeemed', o.points_redeemed,
        'pointsAwarded', o.points_awarded,
        'paidAt', o.paid_at, 'readyAt', o.ready_at,
        'createdAt', o.created_at, 'updatedAt', o.updated_at)
      from (select 1) x
      left join public.customers c on c.id = o.customer_id;
$function$;

-- ==== 13. Who may call what ====
revoke execute on function public.refund_items(uuid, jsonb, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.refund_items(uuid, jsonb, text, text, text, text, text, boolean, text) to authenticated;
revoke execute on function public.counter_rewards(uuid) from public, anon;
grant execute on function public.counter_rewards(uuid) to authenticated;
grant execute on function public.revenue_series(text, date, date) to authenticated;
grant execute on function public.category_sales(text, date, date) to authenticated;
grant execute on function public.top_items(text, date, date) to authenticated;
revoke execute on function public.period_dates(uuid, text) from public, anon;

notify pgrst, 'reload schema';
