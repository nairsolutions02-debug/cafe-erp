-- Phase 4: finance reports (P&L, cash flow, profit target, GST pack, item economics)
-- and payroll (pay types, leave, advances, penalties, overtime, payslips paid through the ledger).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.menu_items add column hsn_code text not null default '';

alter table public.employees
    add column pay_type text not null default 'monthly' check (pay_type in ('monthly', 'daily', 'hourly')),
    add column daily_rate numeric(10, 2) not null default 0,
    add column hourly_rate numeric(10, 2) not null default 0,
    add column ot_rate numeric(10, 2) not null default 0,
    add column shift_hours numeric(4, 2) not null default 9 check (shift_hours > 0 and shift_hours <= 16),
    add column weekly_off integer check (weekly_off between 0 and 6),
    add column staff_id uuid references public.staff_users (id) on delete set null;

alter table public.attendance
    add column check_in_at timestamptz,
    add column check_out_at timestamptz,
    add column leave_type_id uuid;

create table public.leave_types (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null check (trim(name) <> ''),
    is_paid boolean not null default true,
    yearly_quota numeric(5, 1) not null default 0 check (yearly_quota >= 0),
    is_active boolean not null default true,
    unique (tenant_id, name)
);
alter table public.attendance add constraint attendance_leave_type_fk foreign key (leave_type_id) references public.leave_types (id) on delete set null;

create table public.leave_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    leave_type_id uuid not null references public.leave_types (id),
    from_date date not null,
    to_date date not null check (to_date >= from_date),
    half_day boolean not null default false,
    reason text not null default '',
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    decided_by text not null default '',
    decided_at timestamptz,
    requested_by text not null default '',
    created_at timestamptz not null default now()
);

create table public.advances (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    given_on date not null default current_date,
    amount numeric(10, 2) not null check (amount > 0),
    instalment numeric(10, 2) not null check (instalment > 0),
    note text not null default '',
    actor_name text not null default '',
    created_at timestamptz not null default now()
);

create table public.penalties (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    penalty_date date not null default current_date,
    reason text not null check (trim(reason) <> ''),
    amount numeric(10, 2) not null check (amount > 0),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    requested_by text not null default '',
    decided_by text not null default '',
    created_at timestamptz not null default now()
);

create table public.payroll_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    month date not null check (extract(day from month) = 1),
    status text not null default 'draft' check (status in ('draft', 'final')),
    finalized_by text not null default '',
    finalized_at timestamptz,
    created_at timestamptz not null default now(),
    unique (tenant_id, month)
);

create table public.payslips (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    run_id uuid not null references public.payroll_runs (id) on delete cascade,
    employee_id uuid not null references public.employees (id) on delete cascade,
    pay_type text not null,
    rate numeric(10, 2) not null default 0,
    days_in_month integer not null,
    present_days numeric(5, 1) not null default 0,
    half_days integer not null default 0,
    paid_leave_days numeric(5, 1) not null default 0,
    unpaid_leave_days numeric(5, 1) not null default 0,
    holidays integer not null default 0,
    weekly_offs integer not null default 0,
    absent_days numeric(5, 1) not null default 0,
    payable_days numeric(5, 1) not null default 0,
    hours_worked numeric(7, 2) not null default 0,
    ot_hours numeric(7, 2) not null default 0,
    base_pay numeric(10, 2) not null default 0,
    ot_pay numeric(10, 2) not null default 0,
    incentives numeric(10, 2) not null default 0,
    advance_recovery numeric(10, 2) not null default 0,
    penalties numeric(10, 2) not null default 0,
    gross numeric(10, 2) not null default 0,
    deductions numeric(10, 2) not null default 0,
    net numeric(10, 2) not null default 0,
    paid_at timestamptz,
    paid_from uuid references public.money_accounts (id),
    unique (run_id, employee_id)
);

-- Per-cafe defaults for this phase
create or replace function public.seed_phase4(p_tenant uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.leave_types (tenant_id, name, is_paid, yearly_quota) values
        (p_tenant, 'Casual', true, 8), (p_tenant, 'Sick', true, 6), (p_tenant, 'Earned', true, 12), (p_tenant, 'Unpaid', false, 0)
    on conflict (tenant_id, name) do nothing;
    insert into public.settings (tenant_id, key, value, description) values
        (p_tenant, 'profit_target_weekly', '0', 'Weekly net profit target (₹, 0 = none)'),
        (p_tenant, 'profit_target_monthly', '0', 'Monthly net profit target (₹, 0 = none)'),
        (p_tenant, 'gst_filing', '"monthly"', 'GST filing: monthly, quarterly, composition or none'),
        (p_tenant, 'sac_code', '"996331"', 'SAC code for restaurant service (GST pack)')
    on conflict (tenant_id, key) do nothing;
$$;
revoke execute on function public.seed_phase4(uuid) from public, anon, authenticated;
do $$ begin perform public.seed_phase4(id) from public.tenants; end $$;

create or replace function public.seed_tenant_extras_p4() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.seed_phase4(new.id);
    return null;
end;
$$;
create trigger tenants_seed_phase4 after insert on public.tenants for each row execute function public.seed_tenant_extras_p4();

-- Bills entered late in the evening: "today" is the cafe's date, not the server's (UTC)
create function public.purchases_cafe_date() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.bill_date = current_date and public.cafe_today(new.tenant_id) <> current_date then
        new.bill_date := public.cafe_today(new.tenant_id);
    end if;
    return new;
end;
$$;
create trigger purchases_cafe_date before insert on public.purchases for each row execute function public.purchases_cafe_date();

-- ---------------------------------------------------------------------------
-- P&L
-- ---------------------------------------------------------------------------
-- Expenses allocated to a period: a one-month expense counts on its date; an expense spread over
-- N months is shared out evenly per day from its date for N months
create function public.expense_allocation(p_tenant uuid, p_from date, p_to date) returns table (category text, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
    select c.name, round(sum(x.part), 2)
      from (select e.category_id,
                   case when e.spread_months <= 1
                        then case when e.expense_date between p_from and p_to then e.amount else 0 end
                        else e.amount * greatest(0, least(p_to + 1, (e.expense_date + make_interval(months => e.spread_months))::date)
                                                    - greatest(p_from, e.expense_date))
                             / ((e.expense_date + make_interval(months => e.spread_months))::date - e.expense_date) end as part
              from public.expenses e
             where e.tenant_id = p_tenant and not e.is_void and e.expense_date <= p_to
               and (e.expense_date + make_interval(months => greatest(e.spread_months, 1)))::date > p_from) x
      join public.expense_categories c on c.id = x.category_id
     group by c.name
    having round(sum(x.part), 2) <> 0;
$$;
revoke execute on function public.expense_allocation(uuid, date, date) from public, anon, authenticated;

-- Staff cost of a period: finalized payslips spread over their month; months without a payroll
-- run use each active employee's monthly salary (marked as an estimate)
create function public.staff_cost(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_month date;
    v_end date;
    v_days integer;
    v_overlap integer;
    v_total numeric := 0;
    v_est boolean := false;
    v_run uuid;
begin
    v_month := date_trunc('month', p_from)::date;
    while v_month <= p_to loop
        v_end := (v_month + interval '1 month')::date - 1;
        v_days := v_end - v_month + 1;
        v_overlap := least(v_end, p_to) - greatest(v_month, p_from) + 1;
        select id into v_run from public.payroll_runs where tenant_id = p_tenant and month = v_month and status = 'final';
        if v_run is not null then
            v_total := v_total + (select coalesce(sum(gross), 0) from public.payslips where run_id = v_run) * v_overlap / v_days;
        else
            v_total := v_total + (select coalesce(sum(case pay_type when 'monthly' then salary when 'daily' then daily_rate * 26
                                                          else hourly_rate * shift_hours * 26 end), 0)
                                    from public.employees where tenant_id = p_tenant and is_active) * v_overlap / v_days;
            v_est := v_est or exists (select 1 from public.employees where tenant_id = p_tenant and is_active);
        end if;
        v_month := (v_month + interval '1 month')::date;
    end loop;
    return jsonb_build_object('amount', round(v_total, 2), 'estimate', v_est);
end;
$$;
revoke execute on function public.staff_cost(uuid, date, date) from public, anon, authenticated;

create function public.pnl_core(p_tenant uuid, p_from date, p_to date) returns jsonb
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
begin
    select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'gross', g, 'tax', t, 'net', net) order by g desc), '[]'::jsonb),
           coalesce(sum(net), 0)
      into v_sales, v_net
      from (select o.channel, count(*) n, sum(o.total) g, sum(o.tax + o.service_charge_tax) t,
                   sum(o.total - o.tax - o.service_charge_tax - o.round_off) net
              from public.orders o
             where o.tenant_id = p_tenant and o.status <> 'cancelled'
               and (o.created_at at time zone v_tz)::date between p_from and p_to
             group by o.channel) s;
    select coalesce(sum(oi.unit_cost * oi.quantity), 0), count(*) filter (where oi.unit_cost = 0)
      into v_cogs, v_unknown
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.tenant_id = p_tenant and o.status <> 'cancelled' and (o.created_at at time zone v_tz)::date between p_from and p_to;
    select coalesce(-sum(m.quantity * m.unit_cost), 0) into v_loss
      from public.stock_moves m
     where m.tenant_id = p_tenant and m.kind in ('wastage', 'count', 'staff_meal', 'complimentary')
       and (m.created_at at time zone v_tz)::date between p_from and p_to;
    select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb),
           coalesce(sum(amount), 0)
      into v_exp, v_exp_total
      from public.expense_allocation(p_tenant, p_from, p_to) where category <> 'Salaries';
    v_staff := public.staff_cost(p_tenant, p_from, p_to);
    v_gross := v_net - v_cogs;
    return jsonb_build_object(
        'from', p_from, 'to', p_to, 'channels', v_sales,
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

-- P&L for a period, with the previous period of the same length to compare
create function public.pnl(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_len integer := p_to - p_from + 1;
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    if p_to < p_from or v_len > 400 then
        raise exception 'Pick a period of up to 400 days';
    end if;
    return jsonb_build_object('current', public.pnl_core(v_tenant, p_from, p_to),
                              'previous', public.pnl_core(v_tenant, p_from - v_len, p_from - 1));
end;
$$;

-- Cash flow by account: opening + in − out = closing
create function public.cash_flow(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'code', a.code, 'name', a.name,
                   'opening', coalesce((select sum(amount) from public.ledger_entries where account_id = a.id and entry_date < p_from), 0),
                   'in', coalesce((select sum(amount) from public.ledger_entries where account_id = a.id and amount > 0 and entry_date between p_from and p_to), 0),
                   'out', coalesce((select -sum(amount) from public.ledger_entries where account_id = a.id and amount < 0 and entry_date between p_from and p_to), 0),
                   'closing', coalesce((select sum(amount) from public.ledger_entries where account_id = a.id and entry_date <= p_to), 0))
                   order by a.sort_order), '[]'::jsonb)
          from public.money_accounts a where a.tenant_id = public.current_tenant_id() and a.is_active);
end;
$$;

-- Weekly and monthly profit target: progress so far and a straight-line forecast to the period end
create function public.profit_targets() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_today date := public.cafe_today(public.current_tenant_id());
    v_wk date := v_today - ((extract(isodow from v_today)::integer) - 1);
    v_mo date := date_trunc('month', v_today)::date;
    v_mo_end date := (date_trunc('month', v_today) + interval '1 month')::date - 1;
    v_w jsonb;
    v_m jsonb;
    v_tw numeric := coalesce((public.get_setting('profit_target_weekly', '0', public.current_tenant_id()) #>> '{}')::numeric, 0);
    v_tm numeric := coalesce((public.get_setting('profit_target_monthly', '0', public.current_tenant_id()) #>> '{}')::numeric, 0);
begin
    perform public.require_perm('finance.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    v_w := public.pnl_core(v_tenant, v_wk, v_today);
    v_m := public.pnl_core(v_tenant, v_mo, v_today);
    return jsonb_build_object(
        'week', jsonb_build_object('from', v_wk, 'to', v_wk + 6, 'target', v_tw, 'profit', v_w -> 'netProfit',
                                   'daysGone', v_today - v_wk + 1, 'days', 7,
                                   'forecast', round((v_w ->> 'netProfit')::numeric * 7 / (v_today - v_wk + 1), 2)),
        'month', jsonb_build_object('from', v_mo, 'to', v_mo_end, 'target', v_tm, 'profit', v_m -> 'netProfit',
                                    'daysGone', v_today - v_mo + 1, 'days', v_mo_end - v_mo + 1,
                                    'forecast', round((v_m ->> 'netProfit')::numeric * (v_mo_end - v_mo + 1) / (v_today - v_mo + 1), 2)));
end;
$$;

-- Every item sold: units, net revenue, cost, contribution, share of total contribution, trend
create function public.item_economics(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_len integer := p_to - p_from + 1;
begin
    perform public.require_perm('reports.view');
    if not public.has_perm('sensitive.see_profit') then
        raise exception 'Not authorized (sensitive.see_profit)';
    end if;
    return (
        with cur as (
            select oi.menu_item_id, max(oi.name) as name, sum(oi.quantity) as units, sum(oi.net_amount) as revenue,
                   sum(oi.unit_cost * oi.quantity) as cost, count(*) filter (where oi.unit_cost = 0) as unknown
              from public.order_items oi join public.orders o on o.id = oi.order_id
             where o.tenant_id = v_tenant and o.status <> 'cancelled' and (o.created_at at time zone v_tz)::date between p_from and p_to
             group by oi.menu_item_id),
        prev as (
            select oi.menu_item_id, sum(oi.quantity) as units
              from public.order_items oi join public.orders o on o.id = oi.order_id
             where o.tenant_id = v_tenant and o.status <> 'cancelled'
               and (o.created_at at time zone v_tz)::date between p_from - v_len and p_from - 1
             group by oi.menu_item_id),
        tot as (select nullif(sum(revenue - cost), 0) as contribution from cur)
        select coalesce(jsonb_agg(jsonb_build_object(
                   'menuItemId', c.menu_item_id, 'name', coalesce(m.name, c.name), 'units', c.units,
                   'revenue', round(c.revenue, 2), 'cost', round(c.cost, 2), 'costKnown', c.unknown = 0,
                   'contribution', round(c.revenue - c.cost, 2),
                   'contributionPct', case when c.revenue > 0 then round((c.revenue - c.cost) / c.revenue * 100, 1) end,
                   'perUnit', round((c.revenue - c.cost) / nullif(c.units, 0), 2),
                   'sharePct', round((c.revenue - c.cost) / (select contribution from tot) * 100, 1),
                   'prevUnits', coalesce(p.units, 0),
                   'trendPct', case when coalesce(p.units, 0) > 0 then round((c.units - p.units) * 100.0 / p.units, 1) end)
                   order by c.revenue - c.cost desc), '[]'::jsonb)
          from cur c left join prev p on p.menu_item_id is not distinct from c.menu_item_id
          left join public.menu_items m on m.id = c.menu_item_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- GST pack for the CA
-- ---------------------------------------------------------------------------
create function public.gst_pack(p_from date, p_to date) returns jsonb
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
        -- Sales by GST rate (CGST = SGST = half for intra-state sales); service charge taxed at the default rate
        'byRate', (select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'taxable', round(taxable, 2), 'tax', round(tax, 2),
                                                               'cgst', round(tax / 2, 2), 'sgst', round(tax / 2, 2), 'lines', n)
                                            order by rate), '[]'::jsonb)
                     from (select rate, sum(taxable) taxable, sum(tax) tax, sum(n) n from (
                              select oi.tax_rate as rate, oi.net_amount as taxable, oi.tax_amount as tax, 1 as n
                                from public.order_items oi join public.orders o on o.id = oi.order_id
                               where o.tenant_id = v_tenant and o.status <> 'cancelled'
                                 and (o.created_at at time zone v_tz)::date between p_from and p_to
                              union all
                              select v_default, o.service_charge, o.service_charge_tax, 0
                                from public.orders o
                               where o.tenant_id = v_tenant and o.status <> 'cancelled' and o.service_charge > 0
                                 and (o.created_at at time zone v_tz)::date between p_from and p_to) x
                            group by rate) s),
        'hsn', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'rate', rate, 'qty', qty, 'taxable', round(taxable, 2), 'tax', round(tax, 2))
                                         order by code, rate), '[]'::jsonb)
                  from (select coalesce(nullif(m.hsn_code, ''), v_sac) as code, oi.tax_rate as rate, sum(oi.quantity) qty,
                               sum(oi.net_amount) taxable, sum(oi.tax_amount) tax
                          from public.order_items oi join public.orders o on o.id = oi.order_id
                          left join public.menu_items m on m.id = oi.menu_item_id
                         where o.tenant_id = v_tenant and o.status <> 'cancelled'
                           and (o.created_at at time zone v_tz)::date between p_from and p_to
                         group by 1, 2) s),
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

-- Upcoming GST due dates for the cafe's filing type (the CA files on the GST portal)
create function public.gst_due_dates() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_today date := public.cafe_today(public.current_tenant_id());
    v_filing text := coalesce(public.get_setting('gst_filing', '"monthly"', public.current_tenant_id()) #>> '{}', 'monthly');
    v_m date := date_trunc('month', v_today)::date;
    v_out jsonb := '[]'::jsonb;
    v_q date;
    i integer;
begin
    perform public.require_admin();
    for i in 0..3 loop
        v_q := (v_m + make_interval(months => i))::date;
        if v_filing = 'monthly' then
            v_out := v_out || jsonb_build_array(
                jsonb_build_object('form', 'GSTR-1', 'for', to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 10),
                jsonb_build_object('form', 'GSTR-3B', 'for', to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 19));
        elsif v_filing = 'quarterly' then
            if extract(month from v_q)::integer in (1, 4, 7, 10) then
                v_out := v_out || jsonb_build_array(
                    jsonb_build_object('form', 'GSTR-1 (QRMP)', 'for', 'quarter to ' || to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 12),
                    jsonb_build_object('form', 'GSTR-3B (QRMP)', 'for', 'quarter to ' || to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 21));
            else
                v_out := v_out || jsonb_build_array(
                    jsonb_build_object('form', 'PMT-06 tax payment', 'for', to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 24));
            end if;
        elsif v_filing = 'composition' then
            if extract(month from v_q)::integer in (1, 4, 7, 10) then
                v_out := v_out || jsonb_build_array(
                    jsonb_build_object('form', 'CMP-08', 'for', 'quarter to ' || to_char(v_q - interval '1 month', 'Mon YYYY'), 'due', v_q + 17));
            end if;
            if extract(month from v_q)::integer = 4 then
                v_out := v_out || jsonb_build_array(jsonb_build_object('form', 'GSTR-4 (annual)', 'for', 'FY ending March', 'due', v_q + 29));
            end if;
        end if;
    end loop;
    return (select coalesce(jsonb_agg(x || jsonb_build_object('daysLeft', (x ->> 'due')::date - v_today) order by (x ->> 'due')::date), '[]'::jsonb)
              from jsonb_array_elements(v_out) x
             where (x ->> 'due')::date >= v_today and (x ->> 'due')::date <= v_today + 45);
end;
$$;

-- Bell reminders: khata (Phase 3) + GST forms due within 3 days, once a day
create or replace function public.daily_reminders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_days integer := coalesce((public.get_setting('khata_reminder_days', '7', public.current_tenant_id()) #>> '{}')::integer, 7);
    v_n integer := 0;
    v_count integer;
    v_sum numeric;
    v_g jsonb;
begin
    perform public.require_admin();
    if exists (select 1 from public.notification_events where tenant_id = v_tenant and kind = 'daily_check'
                                                         and created_at > now() - interval '20 hours') then
        return 0;
    end if;
    insert into public.notification_events (tenant_id, kind, title, perm, priority, acknowledged_at, acknowledged_by)
    values (v_tenant, 'daily_check', 'Daily reminders checked', 'settings.edit', 'digest', now(), 'System');
    select count(*), coalesce(sum((x ->> 'balance')::numeric), 0) into v_count, v_sum
      from jsonb_array_elements(public.khata_accounts()) x
     where (x ->> 'balance')::numeric > 0 and coalesce((x ->> 'oldestDays')::integer, 0) > v_days;
    if v_count > 0 then
        perform public.notify(v_tenant, 'khata_due', v_count || ' khata ' || case when v_count = 1 then 'account' else 'accounts' end
                              || ' due over ' || v_days || ' days', public.inr(v_sum) || ' to collect', '/admin/khata', 'customers.view', 'normal');
        v_n := v_n + 1;
    end if;
    if public.has_perm('finance.view') then
        for v_g in select * from jsonb_array_elements(public.gst_due_dates()) x where (x ->> 'daysLeft')::integer <= 3 loop
            perform public.notify(v_tenant, 'gst_due', v_g ->> 'form' || ' for ' || (v_g ->> 'for') || ' due in ' || (v_g ->> 'daysLeft') || ' days',
                                  'Due ' || to_char((v_g ->> 'due')::date, 'DD Mon') || '. Send the GST pack to your CA.', '/admin/reports?tab=gst',
                                  'finance.view', case when (v_g ->> 'daysLeft')::integer = 0 then 'loud' else 'normal' end);
            v_n := v_n + 1;
        end loop;
    end if;
    return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
-- Hours worked on a day: from check-in/out times (timestamps from the app, or HH:MM typed by hand)
create function public.attendance_hours(a public.attendance) returns numeric
language sql immutable as $$
    select case
        when a.check_in_at is not null and a.check_out_at is not null
            then round(extract(epoch from a.check_out_at - a.check_in_at) / 3600, 2)
        when a.check_in ~ '^\d{1,2}:\d{2}' and a.check_out ~ '^\d{1,2}:\d{2}'
            then round(extract(epoch from (substr(a.check_out, 1, 5)::time - substr(a.check_in, 1, 5)::time)) / 3600, 2)
        else 0 end;
$$;

-- Advance still to recover = amount − recoveries on finalized payslips
create function public.advance_remaining(p_employee uuid, p_exclude_run uuid default null) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select greatest(coalesce((select sum(amount) from public.advances where employee_id = p_employee), 0)
                    - coalesce((select sum(ps.advance_recovery) from public.payslips ps join public.payroll_runs r on r.id = ps.run_id
                                 where ps.employee_id = p_employee and r.status = 'final' and r.id is distinct from p_exclude_run), 0), 0);
$$;

-- Build (or rebuild) the month's draft payslips from attendance, leave, advances and penalties.
--   monthly: salary × payable days ÷ days in month
--     payable days = present + ½ × half-days + paid leave + holidays + weekly offs (not marked absent)
--   daily:   daily rate × (present + ½ × half-days + paid leave + holidays)
--   hourly:  hourly rate × hours worked
--   overtime = hours beyond the shift each day × OT rate
--   net = base + overtime + incentives − advance instalment − approved penalties
create function public.run_payroll(p_month date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_month date := date_trunc('month', p_month)::date;
    v_end date := (date_trunc('month', p_month) + interval '1 month')::date - 1;
    v_days integer;
    v_run public.payroll_runs;
    v_e public.employees;
    v_present numeric; v_half integer; v_paid_leave numeric; v_unpaid_leave numeric; v_hol integer; v_off integer; v_absent numeric;
    v_hours numeric; v_ot numeric; v_payable numeric; v_base numeric; v_rate numeric; v_adv numeric; v_pen numeric; v_gross numeric;
begin
    perform public.require_perm('employees.edit');
    perform public.require_perm('sensitive.see_salary');
    v_days := v_end - v_month + 1;
    insert into public.payroll_runs (tenant_id, month) values (v_tenant, v_month)
    on conflict (tenant_id, month) do nothing;
    select * into v_run from public.payroll_runs where tenant_id = v_tenant and month = v_month for update;
    if v_run.status = 'final' then
        raise exception 'Payroll for % is final', to_char(v_month, 'Mon YYYY');
    end if;
    delete from public.payslips where run_id = v_run.id;
    for v_e in select * from public.employees
                where tenant_id = v_tenant and (is_active or exists (select 1 from public.attendance a where a.employee_id = employees.id
                                                                     and a.date between v_month and v_end))
                  and joining_date <= v_end loop
        select coalesce(count(*) filter (where status = 'present'), 0),
               coalesce(count(*) filter (where status = 'half-day'), 0),
               coalesce(count(*) filter (where status = 'leave' and coalesce((select is_paid from public.leave_types lt where lt.id = a.leave_type_id), true)), 0),
               coalesce(count(*) filter (where status = 'leave' and not coalesce((select is_paid from public.leave_types lt where lt.id = a.leave_type_id), true)), 0),
               coalesce(count(*) filter (where status = 'holiday'), 0),
               coalesce(count(*) filter (where status = 'absent'), 0),
               coalesce(sum(public.attendance_hours(a)), 0),
               coalesce(sum(greatest(public.attendance_hours(a) - v_e.shift_hours, 0)) filter (where status = 'present'), 0)
          into v_present, v_half, v_paid_leave, v_unpaid_leave, v_hol, v_absent, v_hours, v_ot
          from public.attendance a where a.employee_id = v_e.id and a.date between v_month and v_end;
        -- Weekly offs in the month (from joining) that aren't marked otherwise
        v_off := case when v_e.weekly_off is null then 0 else (
                    select count(*) from generate_series(greatest(v_month, v_e.joining_date), v_end, interval '1 day') d
                     where extract(dow from d)::integer = v_e.weekly_off
                       and not exists (select 1 from public.attendance a where a.employee_id = v_e.id and a.date = d::date)) end;
        v_payable := v_present + 0.5 * v_half + v_paid_leave + v_hol + v_off;
        v_rate := case v_e.pay_type when 'monthly' then v_e.salary when 'daily' then v_e.daily_rate else v_e.hourly_rate end;
        v_base := round(case v_e.pay_type
                    when 'monthly' then v_e.salary * least(v_payable, v_days) / v_days
                    when 'daily' then v_e.daily_rate * (v_present + 0.5 * v_half + v_paid_leave + v_hol)
                    else v_e.hourly_rate * v_hours end, 2);
        v_adv := least(public.advance_remaining(v_e.id, v_run.id),
                       coalesce((select max(instalment) from public.advances where employee_id = v_e.id), 0));
        select coalesce(sum(amount), 0) into v_pen from public.penalties
         where employee_id = v_e.id and status = 'approved' and penalty_date between v_month and v_end;
        v_gross := v_base + round(v_ot * v_e.ot_rate, 2);
        v_adv := least(v_adv, v_gross);
        insert into public.payslips (tenant_id, run_id, employee_id, pay_type, rate, days_in_month, present_days, half_days,
                                     paid_leave_days, unpaid_leave_days, holidays, weekly_offs, absent_days, payable_days,
                                     hours_worked, ot_hours, base_pay, ot_pay, advance_recovery, penalties, gross, deductions, net)
        values (v_tenant, v_run.id, v_e.id, v_e.pay_type, v_rate, v_days, v_present, v_half, v_paid_leave, v_unpaid_leave, v_hol,
                v_off, v_absent, v_payable, v_hours, v_ot, v_base, round(v_ot * v_e.ot_rate, 2), v_adv, v_pen, v_gross,
                v_adv + v_pen, greatest(v_gross - v_adv - v_pen, 0));
    end loop;
    return v_run.id;
end;
$$;

create function public.get_payroll(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_run public.payroll_runs;
begin
    perform public.require_perm('employees.view');
    perform public.require_perm('sensitive.see_salary');
    select * into v_run from public.payroll_runs where tenant_id = public.current_tenant_id() and month = date_trunc('month', p_month)::date;
    if v_run.id is null then
        return jsonb_build_object('month', date_trunc('month', p_month)::date, 'status', 'none', 'slips', '[]'::jsonb);
    end if;
    return jsonb_build_object(
        'id', v_run.id, 'month', v_run.month, 'status', v_run.status, 'finalizedBy', v_run.finalized_by, 'finalizedAt', v_run.finalized_at,
        'slips', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', ps.id, 'employeeId', e.id, 'name', e.name, 'role', e.role, 'payType', ps.pay_type, 'rate', ps.rate,
                         'daysInMonth', ps.days_in_month, 'present', ps.present_days, 'halfDays', ps.half_days,
                         'paidLeave', ps.paid_leave_days, 'unpaidLeave', ps.unpaid_leave_days, 'holidays', ps.holidays,
                         'weeklyOffs', ps.weekly_offs, 'absent', ps.absent_days, 'payableDays', ps.payable_days,
                         'hours', ps.hours_worked, 'otHours', ps.ot_hours, 'basePay', ps.base_pay, 'otPay', ps.ot_pay,
                         'incentives', ps.incentives, 'advanceRecovery', ps.advance_recovery, 'penalties', ps.penalties,
                         'gross', ps.gross, 'deductions', ps.deductions, 'net', ps.net, 'paidAt', ps.paid_at,
                         'paidFrom', (select name from public.money_accounts where id = ps.paid_from),
                         'advanceLeft', public.advance_remaining(e.id))
                         order by e.name), '[]'::jsonb)
                    from public.payslips ps join public.employees e on e.id = ps.employee_id where ps.run_id = v_run.id),
        'totals', (select jsonb_build_object('gross', coalesce(sum(gross), 0), 'net', coalesce(sum(net), 0),
                                             'paid', coalesce(sum(net) filter (where paid_at is not null), 0))
                     from public.payslips where run_id = v_run.id));
end;
$$;

create function public.finalize_payroll(p_month date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.edit');
    perform public.require_perm('sensitive.see_salary');
    update public.payroll_runs set status = 'final', finalized_by = public.actor_name(), finalized_at = now()
     where tenant_id = public.current_tenant_id() and month = date_trunc('month', p_month)::date and status = 'draft';
    if not found then
        raise exception 'Run the payroll first';
    end if;
end;
$$;

-- Pay one payslip (or all unpaid ones) from an account: money ledger "salary" entries
create function public.pay_payslips(p_month date, p_account_code text, p_payslip uuid default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_acc uuid := public.account_id(public.current_tenant_id(), p_account_code);
    v_ps record;
    v_n integer := 0;
begin
    perform public.require_perm('finance.create');
    perform public.require_perm('sensitive.see_salary');
    if v_acc is null then
        raise exception 'Pick where the salary is paid from';
    end if;
    for v_ps in select ps.*, e.name from public.payslips ps join public.payroll_runs r on r.id = ps.run_id
                  join public.employees e on e.id = ps.employee_id
                 where r.tenant_id = v_tenant and r.month = date_trunc('month', p_month)::date and r.status = 'final'
                   and ps.paid_at is null and ps.net > 0 and (p_payslip is null or ps.id = p_payslip) loop
        perform public.post_ledger(v_tenant, v_acc, -v_ps.net, 'salary', '', null, null, null, public.open_shift_id(v_acc), null,
                                   'Salary ' || to_char(p_month, 'Mon YYYY') || ': ' || v_ps.name);
        update public.payslips set paid_at = now(), paid_from = v_acc where id = v_ps.id;
        v_n := v_n + 1;
    end loop;
    if v_n = 0 then
        raise exception 'Nothing to pay (finalize the payroll first)';
    end if;
    return v_n;
end;
$$;

create function public.give_advance(p_employee uuid, p_amount numeric, p_instalment numeric, p_account_code text, p_note text default '') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_id uuid;
    v_acc uuid := public.account_id(public.current_tenant_id(), p_account_code);
    v_name text;
begin
    perform public.require_perm('employees.edit');
    select name into v_name from public.employees where id = p_employee and tenant_id = v_tenant;
    if v_name is null then
        raise exception 'Employee not found';
    end if;
    if v_acc is null then
        raise exception 'Pick where the cash came from';
    end if;
    insert into public.advances (tenant_id, employee_id, given_on, amount, instalment, note, actor_name)
    values (v_tenant, p_employee, public.cafe_today(v_tenant), p_amount, coalesce(nullif(p_instalment, 0), p_amount), coalesce(p_note, ''), public.actor_name())
    returning id into v_id;
    perform public.post_ledger(v_tenant, v_acc, -p_amount, 'advance', '', null, null, null, public.open_shift_id(v_acc), null,
                               'Advance to ' || v_name || coalesce(' · ' || nullif(p_note, ''), ''));
    return v_id;
end;
$$;

create function public.add_penalty(p_employee uuid, p_date date, p_reason text, p_amount numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    perform public.require_perm('employees.edit');
    if not exists (select 1 from public.employees where id = p_employee and tenant_id = public.current_tenant_id()) then
        raise exception 'Employee not found';
    end if;
    insert into public.penalties (tenant_id, employee_id, penalty_date, reason, amount, requested_by)
    values (public.current_tenant_id(), p_employee, coalesce(p_date, public.cafe_today(public.current_tenant_id())), p_reason, p_amount, public.actor_name())
    returning id into v_id;
    perform public.notify(public.current_tenant_id(), 'approval', 'Penalty to approve: ' || public.inr(p_amount) || ' · ' || p_reason,
                          'Requested by ' || public.actor_name(), '/admin/payroll?tab=penalties', 'sensitive.see_salary', 'loud');
    return v_id;
end;
$$;

-- Penalties need a second person (owner/manager with salary access) to approve
create function public.decide_penalty(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p public.penalties;
begin
    perform public.require_perm('employees.edit');
    perform public.require_perm('sensitive.see_salary');
    select * into v_p from public.penalties where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_p.id is null or v_p.status <> 'pending' then
        raise exception 'This penalty is already decided';
    end if;
    if v_p.requested_by = public.actor_name() and not public.has_perm('sensitive.void_bill') then
        raise exception 'Someone else must approve a penalty you added';
    end if;
    update public.penalties set status = case when p_approve then 'approved' else 'rejected' end, decided_by = public.actor_name()
     where id = p_id;
end;
$$;

-- Leave: request → manager approves → attendance rows marked leave (balances = yearly quota − approved days)
create function public.request_leave(p_employee uuid, p_type uuid, p_from date, p_to date, p_half boolean default false, p_reason text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
    v_tenant uuid := public.current_tenant_id();
begin
    if not (public.has_perm('employees.edit') or exists (select 1 from public.employees e where e.id = p_employee and e.staff_id = public.my_staff_id())) then
        raise exception 'Not authorized (employees.edit)';
    end if;
    if not exists (select 1 from public.employees where id = p_employee and tenant_id = v_tenant)
       or not exists (select 1 from public.leave_types where id = p_type and tenant_id = v_tenant) then
        raise exception 'Employee or leave type not found';
    end if;
    insert into public.leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, half_day, reason, requested_by)
    values (v_tenant, p_employee, p_type, p_from, p_to, coalesce(p_half, false) and p_from = p_to, coalesce(p_reason, ''), public.actor_name())
    returning id into v_id;
    perform public.notify(v_tenant, 'approval', 'Leave request: ' || (select name from public.employees where id = p_employee)
                          || ' ' || to_char(p_from, 'DD Mon') || case when p_to > p_from then ' – ' || to_char(p_to, 'DD Mon') else '' end,
                          coalesce(nullif(p_reason, ''), ''), '/admin/payroll?tab=leave', 'employees.edit', 'loud');
    return v_id;
end;
$$;

create function public.decide_leave(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_l public.leave_requests;
    d date;
begin
    perform public.require_perm('employees.edit');
    select * into v_l from public.leave_requests where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_l.id is null or v_l.status <> 'pending' then
        raise exception 'This request is already decided';
    end if;
    update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
                                     decided_by = public.actor_name(), decided_at = now()
     where id = p_id;
    if p_approve then
        for d in select generate_series(v_l.from_date, v_l.to_date, interval '1 day')::date loop
            insert into public.attendance (tenant_id, employee_id, date, status, leave_type_id, notes)
            values (v_l.tenant_id, v_l.employee_id, d, case when v_l.half_day then 'half-day' else 'leave' end, v_l.leave_type_id, 'Leave approved')
            on conflict (employee_id, date) do update set status = excluded.status, leave_type_id = excluded.leave_type_id, notes = excluded.notes;
        end loop;
    end if;
end;
$$;

create function public.leave_overview(p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_year integer := coalesce(p_year, extract(year from public.cafe_today(public.current_tenant_id()))::integer);
begin
    perform public.require_perm('employees.view');
    return jsonb_build_object(
        'types', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'isPaid', is_paid, 'quota', yearly_quota) order by name), '[]'::jsonb)
                    from public.leave_types where tenant_id = v_tenant and is_active),
        'balances', (select coalesce(jsonb_agg(jsonb_build_object('employeeId', e.id, 'name', e.name,
                            'leave', (select coalesce(jsonb_agg(jsonb_build_object('typeId', lt.id, 'type', lt.name, 'quota', lt.yearly_quota,
                                                     'used', (select count(*) from public.attendance a where a.employee_id = e.id and a.leave_type_id = lt.id
                                                                and a.status = 'leave' and extract(year from a.date) = v_year)
                                                           + 0.5 * (select count(*) from public.attendance a where a.employee_id = e.id and a.leave_type_id = lt.id
                                                                and a.status = 'half-day' and extract(year from a.date) = v_year))
                                                     order by lt.name), '[]'::jsonb)
                                        from public.leave_types lt where lt.tenant_id = v_tenant and lt.is_active)) order by e.name), '[]'::jsonb)
                       from public.employees e where e.tenant_id = v_tenant and e.is_active),
        'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'employee', e.name, 'type', lt.name, 'from', r.from_date, 'to', r.to_date,
                                                                  'halfDay', r.half_day, 'reason', r.reason, 'status', r.status,
                                                                  'decidedBy', r.decided_by, 'createdAt', r.created_at) order by r.created_at desc), '[]'::jsonb)
                       from public.leave_requests r join public.employees e on e.id = r.employee_id
                       join public.leave_types lt on lt.id = r.leave_type_id
                      where r.tenant_id = v_tenant and (r.status = 'pending' or r.created_at > now() - interval '90 days')));
end;
$$;

create function public.list_penalties_advances() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('employees.view');
    perform public.require_perm('sensitive.see_salary');
    return jsonb_build_object(
        'penalties', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employee', e.name, 'date', p.penalty_date, 'reason', p.reason,
                                                                   'amount', p.amount, 'status', p.status, 'requestedBy', p.requested_by,
                                                                   'decidedBy', p.decided_by) order by p.created_at desc), '[]'::jsonb)
                        from public.penalties p join public.employees e on e.id = p.employee_id
                       where p.tenant_id = public.current_tenant_id()),
        'advances', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'employeeId', e.id, 'employee', e.name, 'date', a.given_on,
                                                                  'amount', a.amount, 'instalment', a.instalment, 'note', a.note,
                                                                  'remaining', public.advance_remaining(e.id)) order by a.created_at desc), '[]'::jsonb)
                       from public.advances a join public.employees e on e.id = a.employee_id
                      where a.tenant_id = public.current_tenant_id()));
end;
$$;

revoke execute on function public.advance_remaining(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.advances enable row level security;
alter table public.penalties enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

create policy "staff view" on public.leave_types for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));
create policy "staff create" on public.leave_types for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.edit')));
create policy "staff edit" on public.leave_types for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff view" on public.leave_requests for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view')));
do $$
declare
    t text;
begin
    foreach t in array array['advances', 'penalties', 'payroll_runs', 'payslips'] loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.view'))
                   and (select public.has_perm('sensitive.see_salary')))$p$, t);
    end loop;
end $$;

-- Pay rates are as private as salaries
create or replace function public.list_employees() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_salary boolean := public.has_perm('sensitive.see_salary');
begin
    perform public.require_perm('employees.view');
    return (
        select coalesce(jsonb_agg(case when v_salary then to_jsonb(e) else to_jsonb(e) - 'salary' - 'daily_rate' - 'hourly_rate' - 'ot_rate' end
                                  order by e.name), '[]'::jsonb)
          from public.employees e where e.tenant_id = public.current_tenant_id());
end;
$$;
