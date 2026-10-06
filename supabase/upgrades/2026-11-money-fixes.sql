-- Cafe ERP · Money fixes (returns on the day, shift UPI, GST rounding, khata points) upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261101000001_money_fixes.sql ====
-- Money fixes from the 3-day money dry run (owner approved, 2026-10-07).
-- B1  A cancel or refund on a later day no longer rewrites the day of the sale: the sale stays on its day and the
--     cancel shows as a return (credit note) on the day it happens. orders.cancelled_at records when.
-- B2  UPI and card refunds count in the shift of the drawer doing the refund.
-- B3  Khata paid by UPI or card counts in the shift of the drawer where it was taken.
-- B4  Dashboard sales use the same rules as Finance and Reports.
-- B5  The shift close alert names the money that is off (cash, UPI, card), each against the tolerance.
-- B6  One GST rounding for a bill: per tax group, shared out to the lines, so bills, the GST pack and P and L tie.
-- B7  GST pack: CGST is half the tax rounded, SGST is the rest, so they always add up to the tax.
-- B8  Cash paid out of a drawer without a category counts as an expense (Other / uncategorised).
-- B9  Dates use the cafe time zone: vendor bill due date and the date defaults of money tables.
-- Points: khata sales earn points only when the khata is paid (in proportion); a cancelled paid order gives back
-- the points it earned (balance stops at 0, the shortfall is kept on the order).
-- Functions are re-created from their latest definitions (including the orders.create switch of fix pack 3).
-- No apostrophes in comments: the SQL Editor splitter treats them as quotes.

-- ==== 1. Columns ====
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists khata_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists khata_paid numeric(10,2) not null default 0;
alter table public.orders add column if not exists points_held integer not null default 0;
alter table public.orders add column if not exists points_held_total integer not null default 0;
alter table public.orders add column if not exists points_reversed integer not null default 0;
alter table public.orders add column if not exists points_shortfall integer not null default 0;

-- Orders cancelled before this upgrade: the refund date if money was refunded, else the order date (no change)
alter table public.orders disable trigger user;
update public.orders o
   set cancelled_at = coalesce((select min(le.created_at) from public.ledger_entries le where le.order_id = o.id and le.kind = 'refund'), o.created_at)
 where o.status = 'cancelled' and o.cancelled_at is null;
alter table public.orders enable trigger user;

create or replace function public.orders_cancelled_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
        new.cancelled_at := now();
    elsif new.status <> 'cancelled' and old.status = 'cancelled' then
        new.cancelled_at := null;
    end if;
    return new;
end;
$$;
drop trigger if exists orders_cancelled_at on public.orders;
create trigger orders_cancelled_at before update of status on public.orders
    for each row execute function public.orders_cancelled_at();
create index if not exists orders_tenant_cancelled_idx on public.orders (tenant_id, cancelled_at) where status = 'cancelled';

-- B9: date defaults in the cafe time zone
alter table public.purchases alter column bill_date set default public.cafe_today(public.current_tenant_id());
alter table public.advances alter column given_on set default public.cafe_today(public.current_tenant_id());
alter table public.penalties alter column penalty_date set default public.cafe_today(public.current_tenant_id());
alter table public.employees alter column joining_date set default public.cafe_today(public.current_tenant_id());

-- ==== 2. Sales book: the original sale on its own day, a cancel on a later day as a return on that day ====
create or replace function public.sales_book(p_tenant uuid, p_from date, p_to date)
returns table (order_id uuid, day date, sign integer, is_return boolean)
language sql stable security definer set search_path = public, pg_temp as $$
    with z as (select public.cafe_timezone(p_tenant) as tz),
    o as (
        select o.id, (o.created_at at time zone z.tz)::date as d0,
               case when o.status = 'cancelled' then (coalesce(o.cancelled_at, o.created_at) at time zone z.tz)::date end as d1
          from public.orders o, z
         where o.tenant_id = p_tenant
           and o.created_at < ((p_to + 1)::timestamp at time zone z.tz)
           and (o.created_at >= (p_from::timestamp at time zone z.tz)
                or (o.status = 'cancelled' and coalesce(o.cancelled_at, o.created_at) >= (p_from::timestamp at time zone z.tz))))
    select id, d0, 1, false from o where d0 between p_from and p_to and (d1 is null or d1 > d0)
    union all
    select id, d1, -1, true from o where d1 is not null and d1 > d0 and d1 between p_from and p_to;
$$;
revoke execute on function public.sales_book(uuid, date, date) from public, anon, authenticated;

-- ==== 3. Finance > Today ====
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
            select sb.sign, sb.is_return, o.*
              from public.sales_book(v_tenant, v_day, v_day) sb join public.orders o on o.id = sb.order_id),
        voided as (
            select o.* from public.orders o
             where o.tenant_id = v_tenant and o.status = 'cancelled'
               and (coalesce(o.cancelled_at, o.created_at) at time zone v_tz)::date = v_day)
        select jsonb_build_object(
            'date', v_day,
            'sales', (select jsonb_build_object(
                        'orders', count(*) filter (where not is_return),
                        'gross', coalesce(sum(total * sign), 0),
                        'tax', coalesce(sum((tax + service_charge_tax) * sign), 0),
                        'discounts', coalesce(sum(discount * sign), 0),
                        'serviceCharge', coalesce(sum(service_charge * sign), 0),
                        'unpaid', coalesce(sum(total - amount_paid) filter (where not is_return and status not in ('cancelled', 'paid')), 0),
                        'returns', count(*) filter (where is_return),
                        'returnsValue', coalesce(sum(total) filter (where is_return), 0),
                        'returnsTax', coalesce(sum(tax + service_charge_tax) filter (where is_return), 0),
                        'avgBill', round(coalesce(avg(total) filter (where not is_return), 0), 2))
                        from b)
                     || (select jsonb_build_object(
                        'cancelled', count(*) filter (where (created_at at time zone v_tz)::date = v_day),
                        'cancelledValue', coalesce(sum(total) filter (where (created_at at time zone v_tz)::date = v_day), 0),
                        'voidsAfterKitchen', count(*) filter (where cancelled_after_kitchen))
                        from voided),
            'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'total', t, 'returns', r) order by t desc), '[]'::jsonb)
                           from (select channel, count(*) filter (where not is_return) n, sum(total * sign) t, count(*) filter (where is_return) r
                                   from b group by channel) s),
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
                                                                   'orderDate', (created_at at time zone v_tz)::date,
                                                                   'earlierDay', (created_at at time zone v_tz)::date < v_day)
                                                order by coalesce(cancelled_at, created_at)), '[]'::jsonb)
                        from voided),
            'discounts', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', order_number, 'amount', manual_discount,
                                                                       'reason', discount_reason, 'by', staff_name, 'approvedBy', discount_approved_by)
                                                    order by created_at), '[]'::jsonb)
                            from public.orders where tenant_id = v_tenant and manual_discount > 0 and (created_at at time zone v_tz)::date = v_day)));
end;
$$;

-- ==== 4. Profit and loss ====
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
begin
    select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'gross', g, 'tax', t, 'net', net, 'returns', r) order by g desc), '[]'::jsonb),
           coalesce(sum(net), 0)
      into v_sales, v_net
      from (select o.channel, count(*) filter (where not b.is_return) n, count(*) filter (where b.is_return) r,
                   sum(o.total * b.sign) g, sum((o.tax + o.service_charge_tax) * b.sign) t,
                   sum((o.total - o.tax - o.service_charge_tax - o.round_off) * b.sign) net
              from public.sales_book(p_tenant, p_from, p_to) b join public.orders o on o.id = b.order_id
             group by o.channel) s;
    select coalesce(sum(oi.unit_cost * oi.quantity * b.sign), 0), count(*) filter (where oi.unit_cost = 0 and not b.is_return)
      into v_cogs, v_unknown
      from public.sales_book(p_tenant, p_from, p_to) b join public.order_items oi on oi.order_id = b.order_id;
    select jsonb_build_object('count', count(*), 'value', coalesce(sum(o.total), 0),
                              'net', coalesce(sum(o.total - o.tax - o.service_charge_tax - o.round_off), 0))
      into v_returns
      from public.sales_book(p_tenant, p_from, p_to) b join public.orders o on o.id = b.order_id
     where b.is_return;
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
        'from', p_from, 'to', p_to, 'channels', v_sales, 'returns', v_returns,
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

-- ==== 5. GST pack: returns of earlier days are credit notes in the period of the return; CGST + SGST = tax ====
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
                              select oi.tax_rate as rate, oi.net_amount * b.sign as taxable, oi.tax_amount * b.sign as tax,
                                     case when b.is_return then 0 else 1 end as n
                                from public.sales_book(v_tenant, p_from, p_to) b join public.order_items oi on oi.order_id = b.order_id
                              union all
                              select v_default, o.service_charge * b.sign, o.service_charge_tax * b.sign, 0
                                from public.sales_book(v_tenant, p_from, p_to) b join public.orders o on o.id = b.order_id
                               where o.service_charge > 0) x
                            group by rate) s),
        'hsn', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'rate', rate, 'qty', qty, 'taxable', round(taxable, 2), 'tax', round(tax, 2))
                                         order by code, rate), '[]'::jsonb)
                  from (select coalesce(nullif(m.hsn_code, ''), v_sac) as code, oi.tax_rate as rate, sum(oi.quantity * b.sign) qty,
                               sum(oi.net_amount * b.sign) taxable, sum(oi.tax_amount * b.sign) tax
                          from public.sales_book(v_tenant, p_from, p_to) b join public.order_items oi on oi.order_id = b.order_id
                          left join public.menu_items m on m.id = oi.menu_item_id
                         group by 1, 2) s),
        'creditNotes', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'orderDate', (o.created_at at time zone v_tz)::date,
                                                                     'date', b.day, 'taxable', o.total - o.tax - o.service_charge_tax - o.round_off,
                                                                     'tax', o.tax + o.service_charge_tax, 'total', o.total, 'reason', o.cancel_reason)
                                                  order by b.day, o.order_number), '[]'::jsonb)
                          from public.sales_book(v_tenant, p_from, p_to) b join public.orders o on o.id = b.order_id
                         where b.is_return),
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

-- ==== 6. Dashboard: the same sales as Finance and Reports ====
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
begin
    perform public.require_perm('reports.view');
    return jsonb_build_object(
        'today', (select jsonb_build_object('revenue', coalesce(sum(o.total * b.sign), 0), 'orders', count(*) filter (where not b.is_return),
                                            'collected', coalesce(sum(o.total) filter (where not b.is_return and o.status = 'paid'), 0))
                    from public.sales_book(v_t, v_today, v_today) b join public.orders o on o.id = b.order_id),
        'month', (select jsonb_build_object('revenue', coalesce(sum(o.total * b.sign), 0), 'orders', count(*) filter (where not b.is_return))
                    from public.sales_book(v_t, date_trunc('month', v_today)::date, v_today) b join public.orders o on o.id = b.order_id),
        'pendingOrders', (select count(*) from public.orders
                           where tenant_id = v_t and status in ('pending', 'confirmed', 'preparing', 'ready')));
end;
$$;

-- ==== 9. Khata points: held on the credit part of a bill until the khata is paid ====
create or replace function public.hold_khata_points(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_khata numeric;
    v_earned integer;
    v_hold integer;
begin
    select * into v_o from public.orders where id = p_order for update;
    if v_o.id is null or v_o.customer_id is null or v_o.total <= 0 then
        return;
    end if;
    select coalesce(sum(amount), 0) into v_khata from public.ledger_entries where order_id = p_order and kind = 'khata_sale';
    if v_khata <= 0 then
        return;
    end if;
    v_earned := coalesce(v_o.points_awarded, 0)
                + coalesce((select sum(points) from public.reward_grants where order_id = p_order and source = 'multiplier'), 0);
    v_hold := v_earned - floor(v_earned * greatest(v_o.total - v_khata, 0) / v_o.total)::integer;
    update public.orders set khata_amount = v_khata, khata_paid = 0, points_held = v_hold, points_held_total = v_hold where id = p_order;
    if v_hold > 0 then
        update public.customers
           set loyalty_points = greatest(loyalty_points - v_hold, 0), total_points_earned = greatest(total_points_earned - v_hold, 0)
         where id = v_o.customer_id;
    end if;
end;
$$;
revoke execute on function public.hold_khata_points(uuid) from public, anon, authenticated;

-- Releases held points as khata money comes in, oldest bill first
create or replace function public.release_khata_points(p_customer uuid, p_amount numeric) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_left numeric := coalesce(p_amount, 0);
    v_k record;
    v_take numeric;
    v_paid numeric;
    v_held integer;
    v_total integer := 0;
begin
    for v_k in select id, khata_amount, khata_paid, points_held, points_held_total from public.orders
                where customer_id = p_customer and status <> 'cancelled' and khata_amount > khata_paid
                order by created_at for update loop
        exit when v_left <= 0;
        v_take := least(v_left, v_k.khata_amount - v_k.khata_paid);
        v_left := v_left - v_take;
        v_paid := v_k.khata_paid + v_take;
        v_held := v_k.points_held_total - floor(v_k.points_held_total * v_paid / v_k.khata_amount)::integer;
        update public.orders set khata_paid = v_paid, points_held = v_held where id = v_k.id;
        v_total := v_total + greatest(v_k.points_held - v_held, 0);
    end loop;
    if v_total > 0 then
        update public.customers set loyalty_points = loyalty_points + v_total, total_points_earned = total_points_earned + v_total
         where id = p_customer;
    end if;
    return v_total;
end;
$$;
revoke execute on function public.release_khata_points(uuid, numeric) from public, anon, authenticated;

-- ==== 7. Bill pricing (one GST rounding per tax group) ====
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
    v_dish jsonb;
    v_name text;
    v_note text;
    v_options jsonb;
    v_combo public.combos;
    v_slot jsonb;
    v_pick jsonb;
    v_slot_item jsonb;
    v_pick_menu public.menu_items;
    v_picks jsonb;
    v_words text[];
    v_cost numeric;
    v_restricted boolean;
    v_incl boolean;
    v_slot_no integer;
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

        if nullif(v_item ->> 'combo', '') is not null then
            -- A combo: its price, plus the upgrade on each pick and the choices on each pick
            select * into v_combo from public.combos where id = (v_item ->> 'combo')::uuid and tenant_id = p_tenant;
            if v_combo.id is null then
                raise exception 'Combo not found';
            end if;
            if not public.combo_open(v_combo) then
                raise exception '% is not on right now', v_combo.name;
            end if;
            if jsonb_typeof(v_item -> 'picks') <> 'array' or jsonb_array_length(v_item -> 'picks') <> jsonb_array_length(v_combo.slots) then
                raise exception 'Pick one dish for each part of %', v_combo.name;
            end if;
            v_unit_price := v_combo.price;
            v_picks := '[]'::jsonb;
            v_words := '{}';
            v_cost := 0;
            v_restricted := false;
            v_incl := null;
            v_menu := null;
            v_slot_no := 0;
            for v_slot in select * from jsonb_array_elements(v_combo.slots) loop
                v_pick := v_item -> 'picks' -> v_slot_no;
                v_slot_no := v_slot_no + 1;
                select si into v_slot_item from jsonb_array_elements(v_slot -> 'items') si where si ->> 'menuItem' = v_pick ->> 'menuItem';
                if v_slot_item is null then
                    raise exception 'That dish is not part of %', v_combo.name;
                end if;
                select * into v_pick_menu from public.menu_items where id = (v_pick ->> 'menuItem')::uuid and tenant_id = p_tenant;
                if v_pick_menu.id is null or not v_pick_menu.is_available then
                    raise exception '% is not available', coalesce(v_pick_menu.name, 'A dish');
                end if;
                v_dish := public.price_dish(v_pick_menu, v_pick);
                -- the combo price covers the default size and default choices; anything above that is added
                v_unit_price := v_unit_price + coalesce((v_slot_item ->> 'extra')::numeric, 0)
                              + greatest((v_dish ->> 'price')::numeric - (public.price_dish(v_pick_menu, '{}'::jsonb) ->> 'price')::numeric, 0);
                v_picks := v_picks || jsonb_build_object('menuItem', v_pick_menu.id, 'name', v_dish ->> 'name',
                                                         'options', v_dish -> 'options');
                v_words := v_words || ((v_dish ->> 'name') || case when v_dish ->> 'words' <> '' then ' [' || (v_dish ->> 'words') || ']' else '' end);
                v_cost := v_cost + coalesce(public.recipe_cost(v_pick_menu.id), v_pick_menu.cost_price);
                v_restricted := v_restricted or v_pick_menu.is_restricted;
                v_incl := coalesce(v_incl, v_pick_menu.price_includes_tax);
                if v_menu.id is null then
                    v_menu := v_pick_menu;
                end if;
            end loop;
            if v_restricted then
                raise exception '% cannot be sold as a combo', v_combo.name;
            end if;
            select components into v_comps from public.tax_groups where id = coalesce(v_combo.tax_group_id, v_menu.tax_group_id);
            v_comps := coalesce(v_comps, v_default);
            v_coupon_ok := v_coupon.id is not null
                and cardinality(v_coupon.applicable_items) = 0 and cardinality(v_coupon.applicable_categories) = 0;
            v_subtotal := v_subtotal + v_unit_price * v_qty;
            v_eligible := v_eligible + v_unit_price * v_qty;
            if v_coupon_ok then
                v_coupon_base := v_coupon_base + v_unit_price * v_qty;
            end if;
            v_note := array_to_string(v_words, ' + ');
            if trim(coalesce(v_item ->> 'note', '')) <> '' then
                v_note := v_note || ' · ' || trim(v_item ->> 'note');
            end if;
            v_lines := v_lines || jsonb_build_object(
                'menu_item_id', null, 'combo_id', v_combo.id,
                'name', v_combo.name,
                'price', v_unit_price, 'quantity', v_qty,
                'total', v_unit_price * v_qty, 'is_restricted', false,
                'price_includes_tax', coalesce(v_incl, true),
                'unit_cost', round(v_cost, 2),
                'unit_name', '', 'unit_factor', 1,
                'note', left(v_note, 300),
                'options', jsonb_build_object('combo', v_combo.id, 'picks', v_picks, 'doublePoints', v_combo.double_points),
                'coupon_ok', v_coupon_ok, 'comps', v_comps,
                'tax_rate', (select coalesce(sum((c ->> 'rate')::numeric), 0) from jsonb_array_elements(v_comps) c));
            continue;
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
        v_dish := public.price_dish(v_menu, v_item);
        v_unit_price := (v_dish ->> 'price')::numeric;
        v_name := v_dish ->> 'name';
        v_options := v_dish -> 'options';
        if nullif(v_item ->> 'unitId', '') is not null then
            select * into v_unit from public.item_units where id = (v_item ->> 'unitId')::uuid and menu_item_id = v_menu.id;
            if v_unit.id is null then
                raise exception 'Pack unit not found for %', v_menu.name;
            end if;
            v_unit_price := coalesce(v_unit.sale_price, round(v_menu.price * v_unit.factor, 2));
            v_name := v_menu.name || ' (' || v_unit.name || ')';
            v_options := '{}'::jsonb;
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
        v_note := case when v_unit.id is null then coalesce(v_dish ->> 'words', '') else '' end;
        if trim(coalesce(v_item ->> 'note', '')) <> '' then
            v_note := concat_ws(' · ', nullif(v_note, ''), trim(v_item ->> 'note'));
        end if;
        v_lines := v_lines || jsonb_build_object(
            'menu_item_id', v_menu.id, 'combo_id', null,
            'name', v_name,
            'price', v_unit_price, 'quantity', v_qty,
            'total', v_unit_price * v_qty, 'is_restricted', v_menu.is_restricted,
            'price_includes_tax', v_menu.price_includes_tax,
            'unit_cost', v_menu.cost_price * coalesce(v_unit.factor, 1),
            'unit_name', coalesce(v_unit.name, ''), 'unit_factor', coalesce(v_unit.factor, 1),
            'note', left(v_note, 300),
            'options', v_options,
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
        select *, t - disc as gross, (x -> 'comps')::text as gkey,
               case when incl then (t - disc) - (t - disc) / (1 + rate / 100) else (t - disc) * rate / 100 end as xtax
          from d),
    g as (
        select *, sum(xtax) over (partition by gkey order by ord) as xcum,
                  sum(xtax) over (partition by gkey) as gexact
          from n),
    a as (
        select *, case when gexact = 0 then 0
                       else round(round(gexact, 2) * xcum / gexact, 2) - round(round(gexact, 2) * (xcum - xtax) / gexact, 2) end as ltax
          from g),
    m as (
        select *, case when incl then gross - ltax else gross end as net from a),
    grp as (
        select gkey, (array_agg(x -> 'comps'))[1] as comps, max(rate) as grate, sum(ltax) as gtot from m group by gkey),
    cs as (
        select c ->> 'name' as name, (c ->> 'rate')::numeric as crate, grp.gtot, grp.grate,
               sum((c ->> 'rate')::numeric) over (partition by grp.gkey order by k) as rcum
          from grp, jsonb_array_elements(grp.comps) with ordinality as e(c, k)),
    csplit as (
        select name, crate, case when grate > 0 then round(gtot * rcum / grate, 2) - round(gtot * (rcum - crate) / grate, 2) else 0 end as amt
          from cs)
    select jsonb_build_object(
        'lines', (select jsonb_agg((x - 'comps' - 'coupon_ok') || jsonb_build_object(
                         'discount', disc, 'net_amount', net, 'tax_amount', ltax) order by ord) from m),
        'gross', (select sum(case when incl then gross else net end) from m),
        'tax_details', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'rate', rate, 'amount', amount)
                                                  order by name, rate), '[]'::jsonb)
                          from (select name, crate as rate, sum(amt) as amount from csplit group by 1, 2 having sum(amt) <> 0) s),
        'tax', (select coalesce(sum(ltax), 0) from m),
        'excl_tax', (select coalesce(sum(ltax) filter (where not incl), 0) from m))
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

-- ==== 8. Payments, khata, cancel, shift close, points ====
CREATE OR REPLACE FUNCTION public.settle_order(p_order_id uuid, p_payments jsonb, p_drawer text DEFAULT 'cash_counter'::text, p_client_id text DEFAULT NULL::text, p_approver_phone text DEFAULT NULL::text, p_approver_pin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    perform public.require_perm('orders.create');
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
    -- Points on the khata (credit) part of the bill wait until that money comes in
    if v_o.status = 'paid' and v_o.customer_id is not null then
        perform public.hold_khata_points(v_o.id);
        select * into v_o from public.orders where id = v_o.id;
    end if;
    return public.order_json(v_o) || jsonb_build_object('change', v_change);
end;
$function$;

CREATE OR REPLACE FUNCTION public.settle_khata(p_customer uuid, p_amount numeric, p_method text DEFAULT 'cash'::text, p_drawer text DEFAULT 'cash_counter'::text, p_client_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_tenant uuid := public.current_tenant_id();
    v_c public.customers;
    v_balance numeric;
    v_amount numeric := round(coalesce(p_amount, 0), 2);
    v_to uuid;
begin
    perform public.require_perm('orders.create');
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
                               public.open_shift_id(public.account_id(v_tenant, coalesce(nullif(p_drawer, ''), 'cash_counter'))),
                               v_c.id, 'Khata paid by ' || v_c.name, p_client_id);
    perform public.release_khata_points(v_c.id, v_amount);
    return jsonb_build_object('balance', v_balance - v_amount);
end;
$function$;

-- cancel_order gets an optional drawer: drop the old signature so named calls are not ambiguous
drop function if exists public.cancel_order(uuid, text, text, text);
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
    -- Refund each payment account (khata balances are reversed by its own entries)
    for v_e in select account_id, method, sum(amount) as amt from public.ledger_entries
                where order_id = v_o.id and kind in ('sale', 'refund', 'khata_sale')
                group by account_id, method having sum(amount) <> 0 loop
        perform public.post_ledger(v_o.tenant_id, v_e.account_id, -v_e.amt, 'refund', v_e.method, v_o.id, null, null,
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
            public.inr(v_o.total) || ' · ' || trim(p_reason) || ' · by ' || public.actor_name(), '/admin/history?q=' || v_o.order_number,
            'reports.view', 'loud');
    end if;
    return public.order_json(v_o);
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_shift(p_shift_id uuid, p_denoms jsonb, p_upi_reported numeric DEFAULT NULL::numeric, p_card_reported numeric DEFAULT NULL::numeric, p_reason text DEFAULT ''::text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_s public.shifts;
    v_j jsonb;
    v_counted numeric := public.denoms_total(p_denoms);
    v_diff numeric;
    v_tol numeric := coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50);
    v_name text;
    v_parts text[] := '{}';
    v_upi_diff numeric;
    v_card_diff numeric;
begin
    perform public.require_perm('orders.create');
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
    v_upi_diff := p_upi_reported - (v_j ->> 'upiExpected')::numeric;
    v_card_diff := p_card_reported - (v_j ->> 'cardExpected')::numeric;
    if abs(v_diff) > v_tol then
        v_parts := v_parts || ('cash ' || case when v_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_diff)));
    end if;
    if abs(coalesce(v_upi_diff, 0)) > v_tol then
        v_parts := v_parts || ('UPI ' || case when v_upi_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_upi_diff)));
    end if;
    if abs(coalesce(v_card_diff, 0)) > v_tol then
        v_parts := v_parts || ('card ' || case when v_card_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_card_diff)));
    end if;
    if cardinality(v_parts) > 0 then
        perform public.notify(v_s.tenant_id, 'shift_mismatch',
            v_name || ' closed: ' || array_to_string(v_parts, ', '),
            'Closed by ' || public.actor_name() || coalesce(' · ' || nullif(trim(p_reason), ''), '')
                || ' · cash counted ' || public.inr(v_counted) || ' vs ' || public.inr((v_j ->> 'expectedCash')::numeric)
                || case when p_upi_reported is not null then ' · UPI app ' || public.inr(p_upi_reported) || ' vs ' || public.inr((v_j ->> 'upiExpected')::numeric) else '' end
                || case when p_card_reported is not null then ' · card ' || public.inr(p_card_reported) || ' vs ' || public.inr((v_j ->> 'cardExpected')::numeric) else '' end,
            '/admin/shifts', 'finance.view', 'loud');
    end if;
    return public.shift_json(v_s);
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

    -- Cancelled: redeemed points come back; points this order earned (and were credited) are taken back.
    -- If the customer already spent them the balance stops at 0 and the shortfall is kept on the order.
    if new.status = 'cancelled' and old.status <> 'cancelled' and new.customer_id is not null then
        v_credited := greatest(coalesce(new.points_awarded, 0)
                      + coalesce((select sum(points) from public.reward_grants where order_id = new.id and source = 'multiplier'), 0)::integer
                      - coalesce(new.points_held, 0), 0);
        if v_credited > 0 or coalesce(new.points_redeemed, 0) > 0 then
            select loyalty_points into v_balance from public.customers where id = new.customer_id for update;
            v_balance := v_balance + coalesce(new.points_redeemed, 0) - v_credited;
            new.points_reversed := v_credited;
            new.points_shortfall := greatest(-v_balance, 0);
            update public.customers
               set loyalty_points = greatest(v_balance, 0),
                   total_points_earned = greatest(total_points_earned - v_credited, 0)
             where id = new.customer_id;
        end if;
        new.points_held := 0;
    end if;

    -- Stock: a cancelled order puts back what it used; reopening it takes it again
    if new.status = 'cancelled' and old.status <> 'cancelled' then
        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
        select new.tenant_id, m.item_id, m.location_id, -sum(m.quantity), max(m.unit_cost), 'sale_reversal', new.id, m.menu_item_id,
               'Order ' || new.order_number || ' cancelled', public.actor_name()
          from public.stock_moves m
         where m.order_id = new.id and m.kind in ('sale', 'sale_reversal')
         group by m.item_id, m.location_id, m.menu_item_id
        having sum(m.quantity) <> 0;
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

-- ==== 10. Vendor bills: due date in the cafe time zone ====
CREATE OR REPLACE FUNCTION public.record_purchase(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_tenant uuid := public.current_tenant_id();
    v_vendor public.vendors;
    v_loc uuid;
    v_id uuid := gen_random_uuid();
    v_line jsonb;
    v_item public.inventory;
    v_factor numeric;
    v_qty numeric;
    v_rate numeric;
    v_tax numeric;
    v_net numeric;
    v_amount numeric;
    v_base_qty numeric;
    v_base_cost numeric;
    v_old_stock numeric;
    v_change numeric;
    v_alert numeric := coalesce((public.get_setting('price_alert_pct', '10', v_tenant) #>> '{}')::numeric, 10);
    v_sub numeric := 0;
    v_taxsum numeric := 0;
    v_total numeric;
    v_paid numeric;
    v_alerts jsonb := '[]'::jsonb;
begin
    perform public.require_perm('inventory.create');
    if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
        raise exception 'Add at least one item';
    end if;
    if nullif(p ->> 'vendorId', '') is not null then
        select * into v_vendor from public.vendors where id = (p ->> 'vendorId')::uuid and tenant_id = v_tenant;
        if v_vendor.id is null then
            raise exception 'Vendor not found';
        end if;
    end if;
    v_loc := coalesce(nullif(p ->> 'locationId', '')::uuid,
                      (select id from public.stock_locations where tenant_id = v_tenant order by receives_purchases desc, sort_order limit 1));
    perform public.require_location(v_loc);

    -- First pass: validate and total
    for v_line in select * from jsonb_array_elements(p -> 'lines') loop
        if not exists (select 1 from public.inventory where id = nullif(v_line ->> 'itemId', '')::uuid and tenant_id = v_tenant) then
            raise exception 'Pick an item on every line';
        end if;
        v_factor := coalesce(nullif(v_line ->> 'factor', '')::numeric, 1);
        v_qty := nullif(v_line ->> 'quantity', '')::numeric;
        v_rate := coalesce(nullif(v_line ->> 'rate', '')::numeric, 0);
        v_tax := coalesce(nullif(v_line ->> 'taxRate', '')::numeric, 0);
        if v_qty is null or v_qty <= 0 then
            raise exception 'Quantity must be more than 0 on every line';
        end if;
        if v_factor <= 0 or v_rate < 0 or v_tax < 0 or v_tax > 50 then
            raise exception 'Check the unit, rate and tax on every line';
        end if;
        v_net := round(v_qty * v_rate, 2);
        v_sub := v_sub + v_net;
        v_taxsum := v_taxsum + round(v_net * v_tax / 100, 2);
    end loop;
    v_total := v_sub + v_taxsum;
    v_paid := least(greatest(coalesce(nullif(p ->> 'paidAmount', '')::numeric, v_total), 0), v_total);

    insert into public.purchases (id, tenant_id, vendor_id, vendor_name, bill_number, bill_date, location_id, bill_photo_url,
                                  subtotal, tax, total, paid_amount, payment_mode, due_date, note, actor_name)
    values (v_id, v_tenant, v_vendor.id, coalesce(v_vendor.name, trim(coalesce(p ->> 'vendorName', ''))),
            trim(coalesce(p ->> 'billNumber', '')), coalesce(nullif(p ->> 'billDate', '')::date, public.cafe_today(v_tenant)), v_loc,
            coalesce(p ->> 'billPhotoUrl', ''), v_sub, v_taxsum, v_total, v_paid,
            case when v_paid < v_total and coalesce(nullif(p ->> 'paymentMode', ''), 'cash') = 'cash' then 'credit'
                 else coalesce(nullif(p ->> 'paymentMode', ''), 'cash') end,
            case when v_paid < v_total
                 then coalesce(nullif(p ->> 'dueDate', '')::date,
                               coalesce(nullif(p ->> 'billDate', '')::date, public.cafe_today(v_tenant)) + coalesce(v_vendor.payment_terms_days, 0)) end,
            coalesce(p ->> 'note', ''), public.actor_name());

    -- Second pass: lines, average cost, stock
    for v_line in select * from jsonb_array_elements(p -> 'lines') loop
        v_item := public.require_stock_item((v_line ->> 'itemId')::uuid);
        v_factor := coalesce(nullif(v_line ->> 'factor', '')::numeric, 1);
        v_qty := (v_line ->> 'quantity')::numeric;
        v_rate := coalesce(nullif(v_line ->> 'rate', '')::numeric, 0);
        v_tax := coalesce(nullif(v_line ->> 'taxRate', '')::numeric, 0);
        v_net := round(v_qty * v_rate, 2);
        v_amount := v_net + round(v_net * v_tax / 100, 2);
        v_base_qty := round(v_qty * v_factor, 3);
        v_base_cost := v_amount / v_base_qty;
        v_old_stock := greatest(v_item.current_stock, 0);
        v_change := case when v_item.cost_per_unit > 0
                         then round((v_base_cost - v_item.cost_per_unit) / v_item.cost_per_unit * 100, 2) end;

        insert into public.purchase_lines (tenant_id, purchase_id, item_id, unit_name, factor, quantity, rate, tax_rate,
                                           amount, base_quantity, base_cost, previous_cost, price_change_pct)
        values (v_tenant, v_id, v_item.id, coalesce(nullif(trim(v_line ->> 'unitName'), ''), v_item.unit), v_factor, v_qty,
                v_rate, v_tax, v_amount, v_base_qty, round(v_base_cost, 4), v_item.cost_per_unit, v_change);

        update public.inventory
           set cost_per_unit = round((v_old_stock * cost_per_unit + v_amount) / (v_old_stock + v_base_qty), 4),
               vendor_id = coalesce(vendor_id, v_vendor.id)
         where id = v_item.id;

        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, purchase_id, note, actor_name)
        values (v_tenant, v_item.id, v_loc, v_base_qty, round(v_base_cost, 4), 'purchase', v_id,
                concat_ws(' · ', nullif(coalesce(v_vendor.name, p ->> 'vendorName'), ''), nullif('Bill ' || trim(coalesce(p ->> 'billNumber', '')), 'Bill ')),
                public.actor_name());

        if v_change is not null and v_change >= v_alert then
            v_alerts := v_alerts || jsonb_build_object('item', v_item.name, 'unit', v_item.unit,
                'previousCost', round(v_item.cost_per_unit, 2), 'newCost', round(v_base_cost, 2), 'changePct', v_change);
        end if;
    end loop;

    return jsonb_build_object('id', v_id, 'total', v_total, 'due', v_total - v_paid, 'priceAlerts', v_alerts);
end;
$function$;

commit;
