-- Shift close must balance, owner day close (owner approved, 2026-10-07).
-- 1. Every bill belongs to a shift: orders.made_shift_id (the shift it was made or first accepted or collected in) and
--    orders.shift_id (the shift that owns it now). Money taken at a drawer needs an open shift of that drawer; a QR bill
--    paid online (UPI straight to the cafe account) goes to the UPI online account and needs no drawer.
-- 2. A shift closes only when every bill it owns is paid, on khata, cancelled or refunded, or handed over to the next
--    shift of the drawer (manager PIN). Handed-over bills join the next shift when it opens.
-- 3. Balance sheet (Z-report) per shift: bills made (and received) = paid cash + UPI + card + khata + cancelled and
--    refunded + handed over. The server checks the sum; if it ever does not add up the close is refused and the owner
--    is alerted. Money not from bills (khata collected, cash in and out, expenses, drops, refunds of older bills) shows
--    apart, then expected vs counted for cash, UPI and card (UPI and card totals are required when that money was taken).
-- 4. A difference above the tolerance of that money (shift_tolerance, shift_tolerance_upi, shift_tolerance_card) needs
--    a reason and the PIN of another person who may void bills (the owner may close alone); the owner gets a loud alert.
-- 5. Paid bills cannot be changed (only refund_items or cancel_order); every bill print is logged.
-- 6. Owner day close: one report for both drawers and QR or online bills; Close the day locks that day.
-- Functions are re-created from their latest definitions (20261102000001_refunds_points_trends, 20261101000001_money_fixes
-- and the live database). No apostrophes in comments: the SQL Editor splitter treats them as quotes.

-- ==== 1. Columns and tables ====
alter table public.orders add column if not exists shift_id uuid references public.shifts(id) on delete set null;
alter table public.orders add column if not exists made_shift_id uuid references public.shifts(id) on delete set null;
alter table public.orders add column if not exists shift_note text not null default '';
alter table public.orders add column if not exists print_count integer not null default 0;
alter table public.orders add column if not exists last_print_by text not null default '';
alter table public.orders add column if not exists last_print_at timestamptz;
create index if not exists orders_shift_idx on public.orders (shift_id) where shift_id is not null;
create index if not exists orders_made_shift_idx on public.orders (made_shift_id) where made_shift_id is not null;

alter table public.shifts add column if not exists closed_by_staff uuid references public.staff_users(id) on delete set null;
alter table public.shifts add column if not exists balance jsonb;
alter table public.shifts add column if not exists upi_difference numeric(12,2);
alter table public.shifts add column if not exists card_difference numeric(12,2);
alter table public.shifts add column if not exists variance_approved_by text not null default '';
alter table public.shifts add column if not exists variance_approver uuid references public.staff_users(id) on delete set null;

-- A bill handed over from one shift to the next shift of the same drawer
create table if not exists public.bill_handovers (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    order_id uuid not null references public.orders(id) on delete cascade,
    account_id uuid not null references public.money_accounts(id),
    from_shift uuid references public.shifts(id) on delete set null,
    to_shift uuid references public.shifts(id) on delete set null,
    due numeric(10,2) not null default 0,
    status text not null default 'pending' check (status in ('pending', 'received', 'undone')),
    reason text not null default '',
    by_name text not null default '',
    by_staff uuid references public.staff_users(id) on delete set null,
    approved_by text not null default '',
    created_at timestamptz not null default now(),
    received_at timestamptz);
create index if not exists bill_handovers_order_idx on public.bill_handovers (order_id);
create index if not exists bill_handovers_pending_idx on public.bill_handovers (account_id) where status = 'pending';
create index if not exists bill_handovers_from_idx on public.bill_handovers (from_shift);
create index if not exists bill_handovers_to_idx on public.bill_handovers (to_shift);

-- Every print of a bill (the first one and reprints)
create table if not exists public.bill_prints (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    order_id uuid not null references public.orders(id) on delete cascade,
    n integer not null default 1,
    by_name text not null default '',
    staff_id uuid references public.staff_users(id) on delete set null,
    created_at timestamptz not null default now());
create index if not exists bill_prints_tenant_idx on public.bill_prints (tenant_id, created_at);

-- Owner day close
create table if not exists public.day_closes (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    day date not null,
    status text not null default 'closed' check (status in ('closed', 'reopened')),
    closed_by text not null default '',
    closed_by_staff uuid references public.staff_users(id) on delete set null,
    closed_at timestamptz not null default now(),
    note text not null default '',
    summary jsonb not null default '{}'::jsonb,
    reopened_by text not null default '',
    reopened_at timestamptz,
    reopen_reason text not null default '',
    unique (tenant_id, day));

alter table public.bill_handovers enable row level security;
alter table public.bill_prints enable row level security;
alter table public.day_closes enable row level security;
drop policy if exists "staff view" on public.bill_handovers;
create policy "staff view" on public.bill_handovers for select
    using (tenant_id = (select public.current_tenant_id()) and ((select public.has_perm('orders.create')) or (select public.has_perm('finance.view'))));
drop policy if exists "staff view" on public.bill_prints;
create policy "staff view" on public.bill_prints for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.view')));
drop policy if exists "staff view" on public.day_closes;
create policy "staff view" on public.day_closes for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('finance.view')));
revoke insert, update, delete on public.bill_handovers from anon, authenticated;
revoke insert, update, delete on public.bill_prints from anon, authenticated;
revoke insert, update, delete on public.day_closes from anon, authenticated;

-- UPI paid online (straight to the cafe account, not at a drawer)
insert into public.money_accounts (tenant_id, code, name, kind, is_drawer, sort_order)
select t.id, 'upi_online', 'UPI – Online (QR)', 'upi', false, 4 from public.tenants t
on conflict (tenant_id, code) do nothing;

-- ==== 2. Helpers ====
-- The UPI online account of a cafe (made the first time it is needed, so new cafes get it too)
create or replace function public.upi_online_account(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid := public.account_id(p_tenant, 'upi_online');
begin
    if v_id is null then
        insert into public.money_accounts (tenant_id, code, name, kind, is_drawer, sort_order)
        values (p_tenant, 'upi_online', 'UPI – Online (QR)', 'upi', false, 4)
        on conflict (tenant_id, code) do nothing;
        v_id := public.account_id(p_tenant, 'upi_online');
    end if;
    return v_id;
end;
$$;
revoke execute on function public.upi_online_account(uuid) from public, anon, authenticated;

-- The owner (or the cafe admin login)
create or replace function public.is_owner_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.tenant_id = public.current_tenant_id()
           and (p.role = 'admin'
                or exists (select 1 from public.staff_users s join public.roles r on r.id = s.role_id
                            where s.id = p.staff_id and s.is_active and r.is_owner)));
$$;

create or replace function public.approver_staff_id(p_tenant uuid, p_phone text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select id from public.staff_users
     where tenant_id = p_tenant and phone = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) and is_active;
$$;
revoke execute on function public.approver_staff_id(uuid, text) from public, anon, authenticated;

-- Difference allowed at shift close for each kind of money (UPI and card default to the cash one)
create or replace function public.shift_tolerances(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with c as (select coalesce((public.get_setting('shift_tolerance', '50', p_tenant) #>> '{}')::numeric, 50) as cash)
    select jsonb_build_object(
        'cash', c.cash,
        'upi', coalesce(nullif(public.get_setting('shift_tolerance_upi', 'null', p_tenant) #>> '{}', '')::numeric, c.cash),
        'card', coalesce(nullif(public.get_setting('shift_tolerance_card', 'null', p_tenant) #>> '{}', '')::numeric, c.cash))
      from c;
$$;

create or replace function public.day_is_closed(p_tenant uuid, p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.day_closes where tenant_id = p_tenant and day = p_day and status = 'closed');
$$;

create or replace function public.assert_day_open(p_tenant uuid, p_day date, p_what text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if p_day is not null and public.day_is_closed(p_tenant, p_day) then
        raise exception 'The owner has closed the accounts of %. % dated that day is not allowed (it goes on an open day).',
            to_char(p_day, 'DD Mon YYYY'), p_what;
    end if;
end;
$$;
revoke execute on function public.assert_day_open(uuid, date, text) from public, anon, authenticated;

-- ==== 3. Money at a drawer always belongs to an open shift of that drawer ====
CREATE OR REPLACE FUNCTION public.post_ledger(p_tenant uuid, p_account uuid, p_amount numeric, p_kind text, p_method text DEFAULT ''::text, p_order uuid DEFAULT NULL::uuid, p_purchase uuid DEFAULT NULL::uuid, p_expense uuid DEFAULT NULL::uuid, p_shift uuid DEFAULT NULL::uuid, p_customer uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text, p_client_id text DEFAULT NULL::text, p_reverses uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_id uuid;
    v_acc public.money_accounts;
begin
    if p_account is null then
        raise exception 'Money account not found';
    end if;
    if round(coalesce(p_amount, 0), 2) = 0 then
        return null;
    end if;
    -- Cash in or out of a drawer needs an open shift of that drawer (reversals and adjustments by the owner excepted)
    select * into v_acc from public.money_accounts where id = p_account;
    if v_acc.is_drawer and p_kind not in ('reversal', 'adjustment', 'transfer')
       and (p_shift is null or not exists (select 1 from public.shifts where id = p_shift and account_id = p_account and status = 'open')) then
        raise exception '% has no open shift. Open a shift on this drawer first (Cash & Shifts), then take or give money.', v_acc.name;
    end if;
    insert into public.ledger_entries (tenant_id, entry_date, account_id, amount, kind, method, order_id, purchase_id,
                                       expense_id, shift_id, customer_id, note, client_id, reverses_id, staff_id, actor_name)
    values (p_tenant, public.cafe_today(p_tenant), p_account, round(p_amount, 2), p_kind, coalesce(p_method, ''), p_order,
            p_purchase, p_expense, p_shift, p_customer, coalesce(p_note, ''), p_client_id, p_reverses,
            public.my_staff_id(), public.actor_name())
    returning id into v_id;
    return v_id;
end;
$function$;

-- ==== 4. Day lock: nothing new dated a closed day ====
create or replace function public.day_lock_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if tg_table_name = 'ledger_entries' then
        perform public.assert_day_open(new.tenant_id, new.entry_date, 'A payment or money entry');
    elsif tg_table_name = 'orders' then
        perform public.assert_day_open(new.tenant_id, (new.created_at at time zone public.cafe_timezone(new.tenant_id))::date, 'A new bill');
    elsif tg_table_name = 'expenses' then
        perform public.assert_day_open(new.tenant_id, new.expense_date, 'An expense');
        if tg_op = 'UPDATE' and (old.amount is distinct from new.amount or old.category_id is distinct from new.category_id
                                 or old.is_void is distinct from new.is_void or old.expense_date is distinct from new.expense_date) then
            perform public.assert_day_open(old.tenant_id, old.expense_date, 'Changing an expense');
        end if;
    elsif tg_table_name = 'purchases' then
        perform public.assert_day_open(new.tenant_id, new.bill_date, 'A vendor bill');
    elsif tg_table_name = 'shifts' then
        perform public.assert_day_open(new.tenant_id, (new.opened_at at time zone public.cafe_timezone(new.tenant_id))::date, 'Opening a shift');
    end if;
    return new;
end;
$$;
drop trigger if exists ledger_day_lock on public.ledger_entries;
create trigger ledger_day_lock before insert on public.ledger_entries for each row execute function public.day_lock_guard();
drop trigger if exists orders_day_lock on public.orders;
create trigger orders_day_lock before insert on public.orders for each row execute function public.day_lock_guard();
drop trigger if exists expenses_day_lock on public.expenses;
create trigger expenses_day_lock before insert or update on public.expenses for each row execute function public.day_lock_guard();
drop trigger if exists purchases_day_lock on public.purchases;
create trigger purchases_day_lock before insert on public.purchases for each row execute function public.day_lock_guard();
drop trigger if exists shifts_day_lock on public.shifts;
create trigger shifts_day_lock before insert on public.shifts for each row execute function public.day_lock_guard();

-- ==== 5. Paid bills cannot be changed quietly ====
create or replace function public.orders_paid_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if old.status in ('paid', 'cancelled')
       and (old.total, old.subtotal, old.discount, old.tax, old.service_charge, old.service_charge_tax, old.round_off,
            old.manual_discount, old.amount_paid, old.tax_details)
           is distinct from
           (new.total, new.subtotal, new.discount, new.tax, new.service_charge, new.service_charge_tax, new.round_off,
            new.manual_discount, new.amount_paid, new.tax_details) then
        raise exception 'Bill % is %: its items and prices cannot be changed. Refund items or cancel the bill instead.',
            old.order_number, case old.status when 'paid' then 'paid' else 'cancelled' end;
    end if;
    if old.status = 'paid' and new.status not in ('paid', 'cancelled') then
        raise exception 'Bill % is paid and cannot be opened again. Refund items or cancel the bill instead.', old.order_number;
    end if;
    -- A bill handed over to the next shift waits for that shift: cancel it there
    if new.status = 'cancelled' and old.status <> 'cancelled' and old.shift_id is null
       and exists (select 1 from public.bill_handovers h where h.order_id = old.id and h.status = 'pending') then
        raise exception 'Bill % was handed over to the next shift. Open the next shift of that drawer first, then cancel it there.', old.order_number;
    end if;
    return new;
end;
$$;
drop trigger if exists orders_paid_guard on public.orders;
create trigger orders_paid_guard before update on public.orders for each row execute function public.orders_paid_guard();

create or replace function public.order_items_paid_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
begin
    select * into v_o from public.orders where id = coalesce(new.order_id, old.order_id);
    if v_o.id is null or v_o.status not in ('paid', 'cancelled') then
        return coalesce(new, old);
    end if;
    if tg_op = 'UPDATE'
       and (old.order_id, old.menu_item_id, old.name, old.price, old.quantity, old.total, old.discount, old.net_amount,
            old.tax_amount, old.tax_rate, old.is_restricted, old.combo_id)
           is not distinct from
           (new.order_id, new.menu_item_id, new.name, new.price, new.quantity, new.total, new.discount, new.net_amount,
            new.tax_amount, new.tax_rate, new.is_restricted, new.combo_id) then
        return new; -- kitchen progress and notes may still move
    end if;
    raise exception 'Bill % is %: its items cannot be changed. Refund items or cancel the bill instead.',
        v_o.order_number, case v_o.status when 'paid' then 'paid' else 'cancelled' end;
end;
$$;
drop trigger if exists order_items_paid_guard on public.order_items;
create trigger order_items_paid_guard before insert or update or delete on public.order_items
    for each row execute function public.order_items_paid_guard();

-- Aggregator imports: make the bill with its lines first, then mark it paid
CREATE OR REPLACE FUNCTION public.import_aggregator(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        values (v_t, upper(left(v_platform, 3)) || '-' || o.oid || '-' || substr(v_t::text, 1, 4), 0, 0, 0, 0, 'confirmed', 'aggregator', 'online',
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
        update public.orders set status = 'paid' where id = v_order;
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
$function$;

-- Every print of a bill is logged on the bill (count, who, when); a second print and later ones are reprints
create or replace function public.log_bill_print(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
begin
    if not (public.has_perm('orders.view') or public.has_perm('orders.create')) then
        raise exception 'Not authorized (orders.view)';
    end if;
    update public.orders set print_count = print_count + 1, last_print_by = public.actor_name(), last_print_at = now()
     where id = p_order and tenant_id = public.current_tenant_id()
    returning * into v_o;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    insert into public.bill_prints (tenant_id, order_id, n, by_name, staff_id)
    values (v_o.tenant_id, v_o.id, v_o.print_count, public.actor_name(), public.my_staff_id());
    return jsonb_build_object('orderId', v_o.id, 'prints', v_o.print_count, 'reprint', v_o.print_count > 1, 'by', v_o.last_print_by);
end;
$$;

-- ==== 6. The balance sheet of a shift ====
-- Bills of the shift: made in it (or first accepted or collected in it), and received from the shift before by hand-over.
-- For each bill only what happened while the shift owned it counts (from the hand-over in, until a hand-over out).
-- value = paid here (cash, UPI, card) + khata + paid online + paid at another drawer + cancelled + refunded + handed over
--         + still open. A bill that does not add up (order and money entries disagree) makes the shift not balanced.
create or replace function public.shift_balance(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_s public.shifts;
    v_end timestamptz;
    v_bills jsonb;
    v_cash jsonb;
    v_upi jsonb;
    v_card jsonb;
    v_tol jsonb;
begin
    select * into v_s from public.shifts where id = p_shift;
    if v_s.id is null then
        return null;
    end if;
    v_end := coalesce(v_s.closed_at, 'infinity'::timestamptz);
    v_tol := public.shift_tolerances(v_s.tenant_id);

    with b as (
        select o.id, o.order_number, o.status, o.total, o.amount_paid, o.cancelled_at, o.shift_id,
               'made'::text as how, o.total::numeric as value, '-infinity'::timestamptz as t0
          from public.orders o where o.made_shift_id = p_shift
        union all
        select o.id, o.order_number, o.status, o.total, o.amount_paid, o.cancelled_at, o.shift_id,
               'received', h.due::numeric, h.created_at
          from public.bill_handovers h join public.orders o on o.id = h.order_id
         where h.to_shift = p_shift and h.status = 'received'),
    bo as (
        select b.*, coalesce(ho.due, 0)::numeric as handed, coalesce(ho.created_at, v_end) as t1
          from b left join lateral (
              select h.created_at, h.due from public.bill_handovers h
               where h.order_id = b.id and h.from_shift = p_shift and h.status <> 'undone' and h.created_at >= b.t0
               order by h.created_at limit 1) ho on true),
    le as (
        select bo.id, bo.how,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id = p_shift and e.method = 'cash'), 0) as cash,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id = p_shift and e.method = 'upi'), 0) as upi,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id = p_shift and e.method = 'card'), 0) as card,
               coalesce(sum(e.amount) filter (where a.kind = 'khata'), 0) as khata,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id is null), 0) as online,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id <> p_shift and e.method = 'cash'), 0) as o_cash,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id <> p_shift and e.method = 'upi'), 0) as o_upi,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id <> p_shift and e.method = 'card'), 0) as o_card,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.shift_id is not null and e.method not in ('cash', 'upi', 'card')), 0) as odd
          from bo left join public.ledger_entries e
            on e.order_id = bo.id and e.kind in ('sale', 'refund', 'khata_sale') and e.created_at >= bo.t0 and e.created_at < bo.t1
          left join public.money_accounts a on a.id = e.account_id
         group by bo.id, bo.how),
    rt as (
        select bo.id, bo.how, sum(r.amount) as returned
          from bo join public.order_returns r on r.order_id = bo.id and r.created_at >= bo.t0 and r.created_at < bo.t1
         group by bo.id, bo.how),
    x as (
        select bo.id, bo.order_number, bo.how, bo.value, bo.handed, bo.status,
               le.cash, le.upi, le.card, le.khata, le.online, le.o_cash, le.o_upi, le.o_card,
               le.cash + le.upi + le.card + le.khata + le.online + le.o_cash + le.o_upi + le.o_card + le.odd as kept,
               coalesce(rt.returned, 0) as returned,
               coalesce(bo.status = 'cancelled' and bo.cancelled_at >= bo.t0 and bo.cancelled_at < bo.t1, false) as cancelled_here,
               case when bo.t1 = v_end and bo.shift_id = p_shift and bo.status not in ('paid', 'cancelled')
                    then bo.total - bo.amount_paid else 0 end as open_due,
               case when bo.status = 'cancelled' then
                   (select coalesce(sum(e2.amount), 0) from public.ledger_entries e2
                     where e2.order_id = bo.id and e2.kind in ('sale', 'refund', 'khata_sale')) end as life_net
          from bo join le on le.id = bo.id and le.how = bo.how
          left join rt on rt.id = bo.id and rt.how = bo.how),
    y as (
        select x.*,
               case when cancelled_here then value - kept - returned - handed else 0 end as cancelled,
               case when cancelled_here then coalesce(life_net, 0)
                    else value - kept - returned - handed - open_due end as off
          from x)
    select jsonb_build_object(
        'madeCount', count(*) filter (where how = 'made'),
        'madeTotal', coalesce(sum(value) filter (where how = 'made'), 0),
        'receivedCount', count(*) filter (where how = 'received'),
        'receivedTotal', coalesce(sum(value) filter (where how = 'received'), 0),
        'paidCash', coalesce(sum(cash), 0), 'paidUpi', coalesce(sum(upi), 0), 'paidCard', coalesce(sum(card), 0),
        'khata', coalesce(sum(khata), 0), 'online', coalesce(sum(online), 0),
        'otherCash', coalesce(sum(o_cash), 0), 'otherUpi', coalesce(sum(o_upi), 0), 'otherCard', coalesce(sum(o_card), 0),
        'otherDrawer', coalesce(sum(o_cash + o_upi + o_card), 0),
        'cancelled', coalesce(sum(cancelled), 0), 'cancelledCount', count(*) filter (where cancelled_here),
        'refunded', coalesce(sum(returned), 0), 'refundedCount', count(*) filter (where returned <> 0),
        'handedOver', coalesce(sum(handed), 0), 'handedCount', count(*) filter (where handed <> 0),
        'open', coalesce(sum(open_due), 0), 'openCount', count(*) filter (where open_due <> 0),
        'difference', round(coalesce(sum(off), 0), 2),
        'balanced', coalesce(bool_and(abs(off) < 0.005), true),
        'problems', coalesce(jsonb_agg(jsonb_build_object('orderNumber', order_number, 'off', round(off, 2)) order by order_number)
                               filter (where abs(off) >= 0.005), '[]'::jsonb))
      into v_bills from y;

    -- Money of the shift (every entry posted in it), by kind of money
    with e as (
        select le.*, a.kind as akind, a.id = v_s.account_id as is_mine
          from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
         where le.shift_id = p_shift),
    c as (select * from e where is_mine)
    select jsonb_build_object(
        'opening', v_s.opening_cash,
        'fromBills', (v_bills ->> 'paidCash')::numeric,
        'otherBills', coalesce(sum(amount) filter (where kind in ('sale', 'refund') and order_id is not null), 0) - (v_bills ->> 'paidCash')::numeric,
        'khata', coalesce(sum(amount) filter (where kind = 'khata_settle'), 0),
        'payIns', coalesce(sum(amount) filter (where kind = 'pay_in'), 0),
        'payouts', coalesce(-sum(amount) filter (where kind = 'payout'), 0),
        'expenses', coalesce(-sum(amount) filter (where kind in ('expense', 'purchase_payment', 'salary', 'advance')), 0),
        'drops', coalesce(-sum(amount) filter (where kind = 'drop'), 0),
        'other', coalesce(sum(amount) filter (where not (kind in ('sale', 'refund') and order_id is not null)
                                                and kind not in ('khata_settle', 'pay_in', 'payout', 'expense', 'purchase_payment',
                                                                 'salary', 'advance', 'drop')), 0),
        'expected', coalesce(v_s.expected_cash, v_s.opening_cash + coalesce(sum(amount), 0)),
        'counted', v_s.counted_cash, 'difference', v_s.difference, 'tolerance', (v_tol ->> 'cash')::numeric)
      into v_cash from c;
    select jsonb_build_object(
        'fromBills', (v_bills ->> 'paidUpi')::numeric,
        'otherBills', coalesce(sum(le.amount) filter (where le.kind in ('sale', 'refund') and le.order_id is not null), 0) - (v_bills ->> 'paidUpi')::numeric,
        'khata', coalesce(sum(le.amount) filter (where le.kind = 'khata_settle'), 0),
        'other', coalesce(sum(le.amount) filter (where not (le.kind in ('sale', 'refund') and le.order_id is not null) and le.kind <> 'khata_settle'), 0),
        'expected', coalesce(v_s.upi_expected, coalesce(sum(le.amount), 0)),
        'taken', count(*) > 0,
        'counted', v_s.upi_reported, 'difference', v_s.upi_difference, 'tolerance', (v_tol ->> 'upi')::numeric)
      into v_upi from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
     where le.shift_id = p_shift and a.kind = 'upi';
    select jsonb_build_object(
        'fromBills', (v_bills ->> 'paidCard')::numeric,
        'otherBills', coalesce(sum(le.amount) filter (where le.kind in ('sale', 'refund') and le.order_id is not null), 0) - (v_bills ->> 'paidCard')::numeric,
        'khata', coalesce(sum(le.amount) filter (where le.kind = 'khata_settle'), 0),
        'other', coalesce(sum(le.amount) filter (where not (le.kind in ('sale', 'refund') and le.order_id is not null) and le.kind <> 'khata_settle'), 0),
        'expected', coalesce(v_s.card_expected, coalesce(sum(le.amount), 0)),
        'taken', count(*) > 0,
        'counted', v_s.card_reported, 'difference', v_s.card_difference, 'tolerance', (v_tol ->> 'card')::numeric)
      into v_card from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
     where le.shift_id = p_shift and a.kind = 'card';

    return jsonb_build_object('bills', v_bills, 'cash', v_cash, 'upi', v_upi, 'card', v_card,
                              'balanced', (v_bills ->> 'balanced')::boolean, 'difference', (v_bills ->> 'difference')::numeric,
                              'at', now());
end;
$$;
revoke execute on function public.shift_balance(uuid) from public, anon, authenticated;

-- A bill that is still open, as the close screen lists it
create or replace function public.open_bill_json(o public.orders) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('id', o.id, 'orderNumber', o.order_number, 'total', o.total, 'due', o.total - o.amount_paid,
                              'status', o.status, 'channel', o.channel, 'tableNumber', o.table_number, 'tokenNumber', o.token_number,
                              'createdAt', o.created_at, 'staffName', o.staff_name, 'customerId', o.customer_id,
                              'customerName', (select c.name from public.customers c where c.id = o.customer_id));
$$;
revoke execute on function public.open_bill_json(public.orders) from public, anon, authenticated;

-- ==== 7. Shift as the app sees it ====
CREATE OR REPLACE FUNCTION public.shift_json(s shifts)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (
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
        'orders', (select count(distinct order_id) from public.ledger_entries x where x.shift_id = s.id and x.kind = 'sale'),
        'upiTaken', count(*) filter (where ma.kind = 'upi') > 0,
        'cardTaken', count(*) filter (where ma.kind = 'card') > 0)
      from public.money_accounts a
      left join public.ledger_entries le on le.shift_id = s.id
      left join public.money_accounts ma on ma.id = le.account_id
     where a.id = s.account_id
     group by a.code, a.name)
    || jsonb_build_object(
        'upiDifference', s.upi_difference, 'cardDifference', s.card_difference,
        'varianceApprovedBy', s.variance_approved_by,
        'tolerance', public.shift_tolerances(s.tenant_id),
        'balance', case when s.status = 'open' then public.shift_balance(s.id) else s.balance end,
        'openBills', (select coalesce(jsonb_agg(public.open_bill_json(o) order by o.created_at), '[]'::jsonb)
                        from public.orders o where o.shift_id = s.id and o.status not in ('paid', 'cancelled')),
        'receivedBills', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'due', h.due, 'reason', h.reason,
                                                                       'by', h.by_name, 'approvedBy', h.approved_by, 'at', h.created_at,
                                                                       'status', o.status) order by h.created_at), '[]'::jsonb)
                            from public.bill_handovers h join public.orders o on o.id = h.order_id
                           where h.to_shift = s.id and h.status = 'received'),
        'handedBills', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'due', h.due, 'reason', h.reason,
                                                                     'by', h.by_name, 'approvedBy', h.approved_by, 'at', h.created_at,
                                                                     'status', h.status) order by h.created_at), '[]'::jsonb)
                          from public.bill_handovers h join public.orders o on o.id = h.order_id
                         where h.from_shift = s.id and h.status <> 'undone'));
$function$;

CREATE OR REPLACE FUNCTION public.current_shifts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_fin boolean := public.has_perm('finance.view');
begin
    if not (public.has_perm('orders.create') or v_fin) then
        raise exception 'Not authorized (orders.create)';
    end if;
    return (
        select jsonb_build_object(
            'drawers', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name,
                                                                     'lastCloseCash', case when v_fin then
                                                                         (select counted_cash from public.shifts x
                                                                           where x.account_id = a.id and x.status = 'closed'
                                                                           order by closed_at desc limit 1) end,
                                                                     -- bills handed over by the last shift, waiting for the next one
                                                                     'handedOver', (select coalesce(jsonb_agg(jsonb_build_object(
                                                                                        'orderNumber', o.order_number, 'due', h.due, 'reason', h.reason,
                                                                                        'by', h.by_name, 'approvedBy', h.approved_by) order by h.created_at), '[]'::jsonb)
                                                                                      from public.bill_handovers h join public.orders o on o.id = h.order_id
                                                                                     where h.account_id = a.id and h.status = 'pending'))
                                                  order by a.sort_order), '[]'::jsonb)
                          from public.money_accounts a where a.tenant_id = public.current_tenant_id() and a.is_drawer and a.is_active),
            'open', (select coalesce(jsonb_agg(public.shift_view(s) order by s.opened_at), '[]'::jsonb)
                       from public.shifts s where s.tenant_id = public.current_tenant_id() and s.status = 'open'),
            'tolerance', coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50),
            'tolerances', public.shift_tolerances(public.current_tenant_id()),
            'isOwner', public.is_owner_user(),
            'dayClosed', public.day_is_closed(public.current_tenant_id(), public.cafe_today(public.current_tenant_id()))));
end;
$function$;

-- ==== 8. Open, hand over, close ====
CREATE OR REPLACE FUNCTION public.open_shift(p_drawer text, p_denoms jsonb, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_tenant uuid := public.current_tenant_id();
    v_acc public.money_accounts;
    v_last numeric;
    v_cash numeric := public.denoms_total(p_denoms);
    v_s public.shifts;
    v_tol numeric := coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50);
begin
    perform public.require_perm('orders.create');
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
    -- Bills handed over by the last shift of this drawer join this shift
    with h as (
        update public.bill_handovers h set to_shift = v_s.id, status = 'received', received_at = now()
         where h.account_id = v_acc.id and h.status = 'pending'
        returning h.order_id)
    update public.orders o set shift_id = v_s.id
      from h where o.id = h.order_id and o.shift_id is null and o.status not in ('paid', 'cancelled');
    if v_last is not null and abs(v_cash - v_last) > v_tol then
        perform public.notify(v_tenant, 'shift_open_mismatch', v_acc.name || ' opened with ' || public.inr(v_cash) || ', last close counted ' || public.inr(v_last),
            'Opened by ' || public.actor_name(), '/admin/shifts', 'finance.view', 'loud');
    end if;
    return public.shift_json(v_s);
end;
$function$;

-- Hand an open bill over to the next shift of its drawer (manager PIN unless the person may void bills)
create or replace function public.handover_bill(p_order_id uuid, p_reason text, p_approver_phone text default null,
                                                p_approver_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_s public.shifts;
    v_by text := '';
begin
    perform public.require_perm('orders.create');
    select * into v_o from public.orders where id = p_order_id and tenant_id = public.current_tenant_id() for update;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    if v_o.status in ('paid', 'cancelled') then
        raise exception 'Bill % is already %', v_o.order_number, v_o.status;
    end if;
    select * into v_s from public.shifts where id = v_o.shift_id;
    if v_s.id is null or v_s.status <> 'open' then
        raise exception 'Bill % is not in an open shift', v_o.order_number;
    end if;
    if trim(coalesce(p_reason, '')) = '' then
        raise exception 'Write why the bill goes to the next shift (for example: table still eating)';
    end if;
    if not public.has_perm('sensitive.void_bill') then
        if nullif(p_approver_phone, '') is null then
            raise exception 'A manager must approve the hand-over: enter their mobile and PIN';
        end if;
        v_by := public.verify_approver(v_o.tenant_id, p_approver_phone, p_approver_pin, 'sensitive.void_bill');
    else
        v_by := public.actor_name();
    end if;
    insert into public.bill_handovers (tenant_id, order_id, account_id, from_shift, due, reason, by_name, by_staff, approved_by)
    values (v_o.tenant_id, v_o.id, v_s.account_id, v_s.id, v_o.total - v_o.amount_paid, trim(p_reason), public.actor_name(),
            public.my_staff_id(), v_by);
    update public.orders set shift_id = null where id = v_o.id returning * into v_o;
    return public.order_json(v_o) || jsonb_build_object('handedOver', true, 'approvedBy', v_by);
end;
$$;

drop function if exists public.close_shift(uuid, jsonb, numeric, numeric, text, text);
create or replace function public.close_shift(p_shift_id uuid, p_denoms jsonb, p_upi_reported numeric default null,
                                              p_card_reported numeric default null, p_reason text default '',
                                              p_note text default '', p_approver_phone text default null,
                                              p_approver_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_s public.shifts;
    v_j jsonb;
    v_bal jsonb;
    v_counted numeric := public.denoms_total(p_denoms);
    v_tol jsonb;
    v_name text;
    v_open text;
    v_diff numeric;
    v_upi_diff numeric;
    v_card_diff numeric;
    v_parts text[] := '{}';
    v_by text := '';
    v_by_staff uuid;
begin
    perform public.require_perm('orders.create');
    select * into v_s from public.shifts where id = p_shift_id and tenant_id = public.current_tenant_id() for update;
    if v_s.id is null or v_s.status <> 'open' then
        raise exception 'This shift is not open';
    end if;
    if not public.can_close_drawer(v_s) then
        raise exception 'Only % (who opened this shift) or a manager can close it', v_s.opened_by;
    end if;
    select name into v_name from public.money_accounts where id = v_s.account_id;

    -- 1. Every bill of the shift must end in a state
    select string_agg(o.order_number || ' (' || public.inr(o.total - o.amount_paid) || ')', ', ' order by o.created_at)
      into v_open from public.orders o where o.shift_id = v_s.id and o.status not in ('paid', 'cancelled');
    if v_open is not null then
        raise exception 'Bills still open in this shift: %. Collect, put on khata, cancel or hand over each one, then close.', v_open;
    end if;

    -- 2. The bills must add up (safety net: refuse and tell the owner; this commits so the alert is kept)
    v_bal := public.shift_balance(v_s.id);
    if not coalesce((v_bal ->> 'balanced')::boolean, false) then
        perform public.notify(v_s.tenant_id, 'shift_mismatch', v_name || ': bills and money do not add up',
            'Close refused for ' || public.actor_name() || ' · off by ' || public.inr((v_bal ->> 'difference')::numeric)
                || coalesce(' · ' || (select string_agg(p ->> 'orderNumber', ', ') from jsonb_array_elements(v_bal -> 'bills' -> 'problems') p), ''),
            '/admin/shifts', 'finance.view', 'loud');
        return public.shift_json(v_s) || jsonb_build_object('refused', true,
            'message', 'The bills of this shift do not add up (off by ' || public.inr((v_bal ->> 'difference')::numeric)
                       || '). The shift stays open and the owner has been told. Do not change anything; call the owner.');
    end if;

    -- 3. Counts: UPI and card totals are needed when that money was taken in this shift
    v_j := public.shift_json(v_s);
    if ((v_j ->> 'upiExpected')::numeric <> 0 or (v_j ->> 'upiTaken')::boolean) and p_upi_reported is null then
        raise exception 'Type the UPI total from the UPI app: this shift took UPI money.';
    end if;
    if ((v_j ->> 'cardExpected')::numeric <> 0 or (v_j ->> 'cardTaken')::boolean) and p_card_reported is null then
        raise exception 'Type the card machine total (settlement slip): this shift took card money.';
    end if;

    -- 4. Differences, each against its own tolerance
    v_tol := public.shift_tolerances(v_s.tenant_id);
    v_diff := v_counted - (v_j ->> 'expectedCash')::numeric;
    v_upi_diff := coalesce(p_upi_reported, 0) - (v_j ->> 'upiExpected')::numeric;
    v_card_diff := coalesce(p_card_reported, 0) - (v_j ->> 'cardExpected')::numeric;
    if abs(v_diff) > (v_tol ->> 'cash')::numeric then
        v_parts := v_parts || ('cash ' || case when v_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_diff)));
    end if;
    if abs(v_upi_diff) > (v_tol ->> 'upi')::numeric then
        v_parts := v_parts || ('UPI ' || case when v_upi_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_upi_diff)));
    end if;
    if abs(v_card_diff) > (v_tol ->> 'card')::numeric then
        v_parts := v_parts || ('card ' || case when v_card_diff < 0 then 'short' else 'over' end || ' by ' || public.inr(abs(v_card_diff)));
    end if;
    if cardinality(v_parts) > 0 then
        if trim(coalesce(p_reason, '')) = '' then
            raise exception 'Money is off (%). Write the reason to close the shift.', array_to_string(v_parts, ', ');
        end if;
        if public.is_owner_user() and nullif(p_approver_phone, '') is null then
            v_by := public.actor_name() || ' (owner)';
            v_by_staff := public.my_staff_id();
        else
            if nullif(p_approver_phone, '') is null then
                raise exception 'Money is off (%), more than allowed. A manager or the owner must check and approve with their mobile and PIN.',
                    array_to_string(v_parts, ', ');
            end if;
            v_by := public.verify_approver(v_s.tenant_id, p_approver_phone, p_approver_pin, 'sensitive.void_bill');
            v_by_staff := public.approver_staff_id(v_s.tenant_id, p_approver_phone);
            if v_by_staff is not distinct from public.my_staff_id() then
                raise exception 'Another person must approve this difference: you cannot approve your own shift close.';
            end if;
        end if;
    end if;

    update public.shifts
       set status = 'closed', closed_by = public.actor_name(), closed_by_staff = public.my_staff_id(), closed_at = now(),
           counted_cash = v_counted, closing_denoms = coalesce(p_denoms, '{}'), expected_cash = (v_j ->> 'expectedCash')::numeric,
           upi_expected = (v_j ->> 'upiExpected')::numeric, card_expected = (v_j ->> 'cardExpected')::numeric,
           upi_reported = p_upi_reported, card_reported = p_card_reported, difference = v_diff,
           upi_difference = case when p_upi_reported is null then null else v_upi_diff end,
           card_difference = case when p_card_reported is null then null else v_card_diff end,
           variance_approved_by = v_by, variance_approver = v_by_staff,
           reason = trim(coalesce(p_reason, '')), note = trim(coalesce(v_s.note || ' ' || coalesce(p_note, ''), ''))
     where id = v_s.id
    returning * into v_s;
    update public.shifts set balance = public.shift_balance(v_s.id) where id = v_s.id returning * into v_s;

    if cardinality(v_parts) > 0 then
        perform public.notify(v_s.tenant_id, 'shift_mismatch',
            v_name || ' closed: ' || array_to_string(v_parts, ', '),
            'Closed by ' || public.actor_name() || ' · approved by ' || v_by || ' · ' || trim(p_reason)
                || ' · cash counted ' || public.inr(v_counted) || ' vs ' || public.inr((v_j ->> 'expectedCash')::numeric)
                || case when p_upi_reported is not null then ' · UPI app ' || public.inr(p_upi_reported) || ' vs ' || public.inr((v_j ->> 'upiExpected')::numeric) else '' end
                || case when p_card_reported is not null then ' · card ' || public.inr(p_card_reported) || ' vs ' || public.inr((v_j ->> 'cardExpected')::numeric) else '' end,
            '/admin/shifts', 'finance.view', 'loud');
    end if;
    return public.shift_json(v_s);
end;
$$;

-- ==== 9. Taking money ====
-- p_drawer: the drawer code of this device, or online for UPI paid straight to the cafe account (QR bills, manager)
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
    v_online boolean := coalesce(p_drawer, '') = 'online';
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
    v_h public.bill_handovers;
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
        if v_online and v_method <> 'upi' then
            raise exception 'Only UPI can be paid online';
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
    if v_online then
        -- UPI straight to the cafe account: not at a drawer, so no shift. Only QR bills, and a manager confirms it.
        if v_o.channel <> 'qr' then
            raise exception 'Only QR table bills can be marked paid online. Take the money at the drawer.';
        end if;
        if not (public.has_perm('finance.edit') or public.has_perm('sensitive.void_bill')) then
            raise exception 'Only a manager or the owner can mark a bill paid online (after checking the UPI statement)';
        end if;
        v_drawer := null;
        v_shift := null;
    else
        v_drawer := public.account_id(v_o.tenant_id, coalesce(nullif(p_drawer, ''), 'cash_counter'));
        if v_drawer is null or not exists (select 1 from public.money_accounts where id = v_drawer and is_drawer) then
            raise exception 'Unknown cash drawer';
        end if;
        v_shift := public.open_shift_id(v_drawer);
        if v_shift is null then
            raise exception '% has no open shift. Open a shift on this drawer first (Cash & Shifts), then take the money.',
                (select name from public.money_accounts where id = v_drawer);
        end if;
        -- The bill belongs to a shift: a QR bill (or one waiting for the next shift) joins the shift that collects it
        if v_o.shift_id is null then
            select * into v_h from public.bill_handovers where order_id = v_o.id and status = 'pending' order by created_at desc limit 1;
            if v_h.id is not null then
                if v_h.from_shift = v_shift then
                    update public.bill_handovers set status = 'undone' where id = v_h.id;
                else
                    update public.bill_handovers set status = 'received', to_shift = v_shift, received_at = now() where id = v_h.id;
                end if;
            end if;
            update public.orders set shift_id = v_shift, made_shift_id = coalesce(made_shift_id, v_shift)
             where id = v_o.id returning * into v_o;
        end if;
    end if;

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
                    case when v_online then public.upi_online_account(v_o.tenant_id)
                         when v_method = 'cash' then v_drawer else public.account_id(v_o.tenant_id, v_method) end,
                    v_amount, 'sale', v_method, v_o.id, null, null, v_shift, v_o.customer_id,
                    'Order ' || v_o.order_number || case when v_online then ' · paid online' else '' end,
                    case when p_client_id is null then null else p_client_id || ':' || v_n end);
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

-- Khata collected at a drawer (cash, UPI or card) belongs to the open shift of that drawer
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
    v_drawer uuid;
    v_shift uuid;
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
    v_drawer := public.account_id(v_tenant, coalesce(nullif(p_drawer, ''), 'cash_counter'));
    if v_drawer is null or not exists (select 1 from public.money_accounts where id = v_drawer and is_drawer) then
        raise exception 'Unknown cash drawer';
    end if;
    v_shift := public.open_shift_id(v_drawer);
    if v_shift is null then
        raise exception '% has no open shift. Open a shift on this drawer first (Cash & Shifts), then take the money.',
            (select name from public.money_accounts where id = v_drawer);
    end if;
    v_to := case p_method when 'cash' then v_drawer else public.account_id(v_tenant, p_method) end;
    perform public.post_ledger(v_tenant, public.account_id(v_tenant, 'khata'), -v_amount, 'khata_settle', p_method,
                               null, null, null, null, v_c.id, 'Khata paid by ' || v_c.name);
    perform public.post_ledger(v_tenant, v_to, v_amount, 'khata_settle', p_method, null, null, null, v_shift,
                               v_c.id, 'Khata paid by ' || v_c.name, p_client_id);
    perform public.release_khata_points(v_c.id, v_amount);
    return jsonb_build_object('balance', v_balance - v_amount);
end;
$function$;

-- A QR order accepted at a drawer joins its open shift (else it joins the shift that collects it)
drop function if exists public.confirm_table_order(uuid);
create or replace function public.confirm_table_order(p_order_id uuid, p_drawer text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_shift uuid := public.open_shift_id(public.account_id(public.current_tenant_id(), coalesce(nullif(p_drawer, ''), 'cash_counter')));
begin
    perform public.require_perm('orders.create');
    update public.orders set held = false, hold_reason = null,
           status = case when status = 'pending' then 'confirmed' else status end,
           shift_id = case when shift_id is null and made_shift_id is null and status not in ('paid', 'cancelled') then v_shift else shift_id end,
           made_shift_id = case when shift_id is null and made_shift_id is null and status not in ('paid', 'cancelled') then v_shift else made_shift_id end
     where id = p_order_id and tenant_id = public.current_tenant_id()
    returning * into v_o;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    return public.order_json(v_o);
end;
$$;

-- Every bill belongs to the open shift of its drawer (offline bills: the shift they were made in)
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
    v_drawer text;
    v_shift uuid;
    v_asked public.shifts;
    v_shift_note text := '';
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

    -- Every bill belongs to the open shift of its drawer. A bill sent from an offline device carries the shift it was
    -- made in; if that shift has closed since, the bill joins the open shift of the same drawer with a note.
    v_drawer := coalesce(nullif(p ->> 'drawer', ''), case when v_channel = 'kiosk' then 'cash_kiosk' else 'cash_counter' end);
    if nullif(p ->> 'shiftId', '') is not null then
        select * into v_asked from public.shifts where id = (p ->> 'shiftId')::uuid and tenant_id = v_tenant;
    end if;
    if v_asked.id is not null then
        v_drawer := coalesce((select code from public.money_accounts where id = v_asked.account_id), v_drawer);
    end if;
    if v_asked.id is not null and v_asked.status = 'open' then
        v_shift := v_asked.id;
    else
        v_shift := public.open_shift_id(public.account_id(v_tenant, v_drawer));
        if v_shift is null then
            raise exception '% has no open shift. Open a shift on this drawer first (Cash & Shifts): every bill belongs to a shift.',
                coalesce((select name from public.money_accounts where tenant_id = v_tenant and code = v_drawer), 'This drawer');
        end if;
        if v_asked.id is not null then
            v_shift_note := 'Made offline in the shift opened ' || to_char(v_asked.opened_at at time zone v_tz, 'DD Mon HH24:MI')
                            || ' by ' || v_asked.opened_by || ', which closed before the bill reached the server; counted in this shift';
        end if;
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
        created_by_staff, staff_name, manual_discount, discount_reason, discount_approved_by, loyalty_offer_id, points_redeemed,
        shift_id, made_shift_id, shift_note)
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
        trim(coalesce(p ->> 'discountReason', '')), v_by, (v_calc ->> 'offerId')::uuid, v_used,
        v_shift, v_shift, v_shift_note)
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
                                   v_drawer, coalesce(v_client, v_id::text) || ':pay',
                                   p ->> 'approverPhone', p ->> 'approverPin');
    end if;
    if jsonb_typeof(p -> 'payments') = 'array' and jsonb_array_length(p -> 'payments') > 0 then
        return public.settle_order(v_id, p -> 'payments', v_drawer,
                                   coalesce(v_client, v_id::text) || ':pay',
                                   p ->> 'approverPhone', p ->> 'approverPin');
    end if;
    select * into v_o from public.orders where id = v_id;
    return public.order_json(v_o);
end;
$function$;

-- Cash goes back from a drawer with an open shift
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
    v_acc uuid;
    v_mine uuid;
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
    -- Cash goes back from the drawer that took it; if that drawer has no open shift now, from the drawer of this device
    v_mine := case when nullif(p_drawer, '') is not null then public.account_id(v_o.tenant_id, p_drawer) end;
    for v_e in select account_id, method, sum(amount) as amt from public.ledger_entries
                where order_id = v_o.id and kind in ('sale', 'refund', 'khata_sale')
                group by account_id, method having sum(amount) > 0 order by sum(amount) desc loop
        exit when v_left <= 0;
        v_take := least(v_e.amt, v_left);
        v_left := v_left - v_take;
        v_acc := v_e.account_id;
        if exists (select 1 from public.money_accounts where id = v_acc and is_drawer) and public.open_shift_id(v_acc) is null
           and v_mine is not null and public.open_shift_id(v_mine) is not null then
            v_acc := v_mine;
        end if;
        perform public.post_ledger(v_o.tenant_id, v_acc, -v_take, 'refund', v_e.method, v_o.id, null, null,
                                   case when exists (select 1 from public.money_accounts where id = v_acc and is_drawer)
                                        then public.open_shift_id(v_acc) else v_shift end,
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

-- ==== 10. Owner day close ====
-- Adds up the numbers of a list of objects (keys that are numbers), e.g. the balance sheets of several shifts
create or replace function public.json_sum(p jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select e.key as k, round(sum(e.value::text::numeric), 2) as v
          from jsonb_array_elements(coalesce(p, '[]'::jsonb)) o, jsonb_each(o) e
         where jsonb_typeof(o) = 'object' and jsonb_typeof(e.value) = 'number'
         group by e.key) z;
$$;

-- One report for a day (or several days): every drawer, every shift, QR and online bills, the same balance equation
-- summed, money by kind, exceptions, and whether the day can be closed.
create or replace function public.day_close_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_tz text := public.cafe_timezone(public.current_tenant_id());
    v_today date := public.cafe_today(public.current_tenant_id());
    v_from date := coalesce(p_from, public.cafe_today(public.current_tenant_id()));
    v_to date;
    v_t0 timestamptz;
    v_t1 timestamptz;
    v_ids uuid[];
    v_shifts jsonb;
    v_drawers jsonb;
    v_qr jsonb;
    v_b jsonb;
    v_comb jsonb;
    v_modes jsonb;
    v_money jsonb;
    v_exc jsonb;
    v_reasons text[] := '{}';
    v_recv_before numeric;
    v_recv_inside numeric;
    v_online_upi numeric;
    v_noshift_card numeric;
    v_made numeric;
    v_outcome numeric;
    v_diff numeric;
    v_closed jsonb;
    v_n integer;
    v_v numeric;
begin
    perform public.require_perm('finance.view');
    v_to := coalesce(p_to, v_from);
    if v_to < v_from then
        raise exception 'The end date is before the start date';
    end if;
    if v_to - v_from > 92 then
        raise exception 'Pick up to 3 months at a time';
    end if;
    v_t0 := v_from::timestamp at time zone v_tz;
    v_t1 := (v_to + 1)::timestamp at time zone v_tz;

    -- Shifts opened on these days, each with its balance sheet (shifts closed before this update get one worked out now)
    select coalesce(array_agg(s.id), '{}') into v_ids from public.shifts s
     where s.tenant_id = v_t and s.opened_at >= v_t0 and s.opened_at < v_t1;
    select coalesce(jsonb_agg(public.shift_json(s)
                              || case when s.status = 'closed' and s.balance is null
                                      then jsonb_build_object('balance', public.shift_balance(s.id), 'oldClose', true)
                                      else '{}'::jsonb end
                              order by s.opened_at), '[]'::jsonb)
      into v_shifts from public.shifts s where s.id = any (v_ids);

    -- Each drawer: its shifts added up
    select coalesce(jsonb_agg(jsonb_build_object(
               'code', a.code, 'name', a.name,
               'shifts', (select count(*) from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code),
               'openShifts', (select count(*) from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code and x ->> 'status' = 'open'),
               'bills', public.json_sum((select jsonb_agg(x -> 'balance' -> 'bills') from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code)),
               'cash', public.json_sum((select jsonb_agg(x -> 'balance' -> 'cash') from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code)) - 'tolerance',
               'upi', public.json_sum((select jsonb_agg(x -> 'balance' -> 'upi') from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code)) - 'tolerance',
               'card', public.json_sum((select jsonb_agg(x -> 'balance' -> 'card') from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code)) - 'tolerance',
               'balanced', coalesce((select bool_and(coalesce((x -> 'balance' ->> 'balanced')::boolean, false)) from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code), true))
               order by a.sort_order), '[]'::jsonb)
      into v_drawers
      from public.money_accounts a
     where a.tenant_id = v_t and a.is_drawer
       and (a.is_active or exists (select 1 from jsonb_array_elements(v_shifts) x where x ->> 'drawer' = a.code));

    -- QR and online bills that no drawer took (made on these days, never accepted or collected at a drawer)
    with q as (
        select o.* from public.orders o
         where o.tenant_id = v_t and o.made_shift_id is null and o.created_at >= v_t0 and o.created_at < v_t1),
    le as (
        select q.id,
               coalesce(sum(e.amount) filter (where a.kind = 'khata' and e.kind in ('khata_sale', 'refund')), 0) as khata,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.kind in ('sale', 'refund') and e.shift_id is null and e.method = 'upi'), 0) as online,
               coalesce(sum(e.amount) filter (where e.kind = 'aggregator'), 0) as agg,
               coalesce(sum(e.amount) filter (where a.kind <> 'khata' and e.kind in ('sale', 'refund')
                                                and not (e.shift_id is null and e.method = 'upi')), 0) as other
          from q left join public.ledger_entries e on e.order_id = q.id
          left join public.money_accounts a on a.id = e.account_id
         group by q.id),
    x as (
        select q.id, q.order_number, q.status, q.total as value, le.khata, le.online, le.agg, le.other,
               le.khata + le.online + le.agg + le.other as kept,
               coalesce((select sum(r.amount) from public.order_returns r where r.order_id = q.id), 0) as returned,
               case when q.status not in ('paid', 'cancelled') then q.total - q.amount_paid else 0 end as open_due
          from q join le on le.id = q.id),
    y as (
        select x.*, case when status = 'cancelled' then value - kept - returned else 0 end as cancelled,
               case when status = 'cancelled' then
                        (select coalesce(sum(e2.amount), 0) from public.ledger_entries e2
                          where e2.order_id = x.id and e2.kind in ('sale', 'refund', 'khata_sale'))
                    else value - kept - returned - open_due end as off
          from x)
    select jsonb_build_object(
        'madeCount', count(*), 'madeTotal', coalesce(sum(value), 0),
        'online', coalesce(sum(online), 0), 'aggregator', coalesce(sum(agg), 0), 'khata', coalesce(sum(khata), 0),
        'other', coalesce(sum(other), 0),
        'cancelled', coalesce(sum(cancelled), 0), 'cancelledCount', count(*) filter (where status = 'cancelled'),
        'refunded', coalesce(sum(returned), 0),
        'open', coalesce(sum(open_due), 0), 'openCount', count(*) filter (where open_due <> 0),
        'difference', round(coalesce(sum(off), 0), 2),
        'balanced', coalesce(bool_and(abs(off) < 0.005), true))
      into v_qr from y;

    -- All drawers and QR together
    v_b := public.json_sum((select jsonb_agg(x -> 'balance' -> 'bills') from jsonb_array_elements(v_shifts) x));
    select coalesce(sum(h.due) filter (where not (h.from_shift = any (v_ids))), 0),
           coalesce(sum(h.due) filter (where h.from_shift = any (v_ids)), 0)
      into v_recv_before, v_recv_inside
      from public.bill_handovers h where h.to_shift = any (v_ids) and h.status = 'received';
    v_made := coalesce((v_b ->> 'madeTotal')::numeric, 0) + (v_qr ->> 'madeTotal')::numeric;
    v_comb := jsonb_build_object(
        'madeCount', coalesce((v_b ->> 'madeCount')::numeric, 0) + (v_qr ->> 'madeCount')::numeric,
        'madeTotal', v_made,
        'receivedBefore', v_recv_before,
        'paidCash', coalesce((v_b ->> 'paidCash')::numeric, 0) + coalesce((v_b ->> 'otherCash')::numeric, 0),
        'paidUpi', coalesce((v_b ->> 'paidUpi')::numeric, 0) + coalesce((v_b ->> 'otherUpi')::numeric, 0),
        'upiOnline', coalesce((v_b ->> 'online')::numeric, 0) + (v_qr ->> 'online')::numeric,
        'paidCard', coalesce((v_b ->> 'paidCard')::numeric, 0) + coalesce((v_b ->> 'otherCard')::numeric, 0),
        'aggregator', (v_qr ->> 'aggregator')::numeric,
        'otherQr', (v_qr ->> 'other')::numeric,
        'khata', coalesce((v_b ->> 'khata')::numeric, 0) + (v_qr ->> 'khata')::numeric,
        'cancelled', coalesce((v_b ->> 'cancelled')::numeric, 0) + (v_qr ->> 'cancelled')::numeric,
        'refunded', coalesce((v_b ->> 'refunded')::numeric, 0) + (v_qr ->> 'refunded')::numeric,
        'handedOver', coalesce((v_b ->> 'handedOver')::numeric, 0) - v_recv_inside,
        'open', coalesce((v_b ->> 'open')::numeric, 0) + (v_qr ->> 'open')::numeric,
        'openCount', coalesce((v_b ->> 'openCount')::numeric, 0) + (v_qr ->> 'openCount')::numeric);
    select sum(v.value::text::numeric) into v_outcome from jsonb_each(v_comb) v
     where v.key in ('paidCash', 'paidUpi', 'upiOnline', 'paidCard', 'aggregator', 'otherQr', 'khata', 'cancelled', 'refunded', 'handedOver', 'open');
    v_diff := round(v_made + v_recv_before - coalesce(v_outcome, 0), 2);
    v_comb := v_comb || jsonb_build_object('difference', v_diff,
        'balanced', abs(v_diff) < 0.005 and (v_qr ->> 'balanced')::boolean
                    and not exists (select 1 from jsonb_array_elements(v_shifts) x where not coalesce((x -> 'balance' ->> 'balanced')::boolean, false)));

    -- Money by kind: all drawers, plus UPI and card not taken at a drawer
    select coalesce(sum(le.amount) filter (where a.kind = 'upi'), 0), coalesce(sum(le.amount) filter (where a.kind = 'card'), 0)
      into v_online_upi, v_noshift_card
      from public.ledger_entries le join public.money_accounts a on a.id = le.account_id
     where le.tenant_id = v_t and le.shift_id is null and le.kind in ('sale', 'refund', 'khata_settle')
       and le.created_at >= v_t0 and le.created_at < v_t1 and a.kind in ('upi', 'card');
    v_modes := jsonb_build_object(
        'cash', public.json_sum((select jsonb_agg(x -> 'balance' -> 'cash') from jsonb_array_elements(v_shifts) x)) - 'tolerance',
        'upi', (public.json_sum((select jsonb_agg(x -> 'balance' -> 'upi') from jsonb_array_elements(v_shifts) x)) - 'tolerance')
               || jsonb_build_object('online', v_online_upi),
        'card', (public.json_sum((select jsonb_agg(x -> 'balance' -> 'card') from jsonb_array_elements(v_shifts) x)) - 'tolerance')
                || jsonb_build_object('noDrawer', v_noshift_card));
    v_money := jsonb_build_object(
        'khataCash', coalesce((v_modes -> 'cash' ->> 'khata')::numeric, 0),
        'khataUpi', coalesce((v_modes -> 'upi' ->> 'khata')::numeric, 0),
        'khataCard', coalesce((v_modes -> 'card' ->> 'khata')::numeric, 0),
        'cashIn', coalesce((v_modes -> 'cash' ->> 'payIns')::numeric, 0),
        'payouts', coalesce((v_modes -> 'cash' ->> 'payouts')::numeric, 0),
        'expenses', coalesce((v_modes -> 'cash' ->> 'expenses')::numeric, 0),
        'drops', coalesce((v_modes -> 'cash' ->> 'drops')::numeric, 0),
        'otherBillsCash', coalesce((v_modes -> 'cash' ->> 'otherBills')::numeric, 0),
        'otherBillsUpi', coalesce((v_modes -> 'upi' ->> 'otherBills')::numeric, 0),
        'otherBillsCard', coalesce((v_modes -> 'card' ->> 'otherBills')::numeric, 0),
        'totalVariance', coalesce((v_modes -> 'cash' ->> 'difference')::numeric, 0) + coalesce((v_modes -> 'upi' ->> 'difference')::numeric, 0)
                         + coalesce((v_modes -> 'card' ->> 'difference')::numeric, 0),
        'cashToOffice', coalesce((v_modes -> 'cash' ->> 'drops')::numeric, 0));

    -- Exceptions
    v_exc := jsonb_build_object(
        'openBills', (select coalesce(jsonb_agg(public.open_bill_json(o) || jsonb_build_object(
                                 'drawerName', (select a.name from public.shifts s join public.money_accounts a on a.id = s.account_id where s.id = o.shift_id))
                             order by o.created_at), '[]'::jsonb)
                        from public.orders o
                       where o.tenant_id = v_t and o.status not in ('paid', 'cancelled')
                         and (o.shift_id = any (v_ids)
                              or (o.made_shift_id is null and o.shift_id is null and o.created_at >= v_t0 and o.created_at < v_t1
                                  and not exists (select 1 from public.bill_handovers h where h.order_id = o.id and h.status = 'pending')))),
        'handedOver', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'orderNumber', o.order_number, 'due', h.due, 'reason', h.reason, 'by', h.by_name, 'approvedBy', h.approved_by,
                                 'at', h.created_at, 'drawerName', a.name, 'status', h.status, 'billStatus', o.status,
                                 'receivedBy', ts.opened_by, 'receivedAt', h.received_at) order by h.created_at), '[]'::jsonb)
                         from public.bill_handovers h join public.orders o on o.id = h.order_id
                         join public.money_accounts a on a.id = h.account_id
                         left join public.shifts ts on ts.id = h.to_shift
                        where h.from_shift = any (v_ids) and h.status <> 'undone'),
        'variances', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'drawerName', x ->> 'drawerName', 'closedBy', x ->> 'closedBy', 'closedAt', x ->> 'closedAt',
                                 'cash', (x ->> 'difference')::numeric, 'upi', (x ->> 'upiDifference')::numeric, 'card', (x ->> 'cardDifference')::numeric,
                                 'approvedBy', x ->> 'varianceApprovedBy', 'reason', x ->> 'reason',
                                 'over', abs(coalesce((x ->> 'difference')::numeric, 0)) > (x -> 'tolerance' ->> 'cash')::numeric
                                         or abs(coalesce((x ->> 'upiDifference')::numeric, 0)) > (x -> 'tolerance' ->> 'upi')::numeric
                                         or abs(coalesce((x ->> 'cardDifference')::numeric, 0)) > (x -> 'tolerance' ->> 'card')::numeric)), '[]'::jsonb)
                        from jsonb_array_elements(v_shifts) x
                       where x ->> 'status' = 'closed'
                         and (coalesce((x ->> 'difference')::numeric, 0) <> 0 or coalesce((x ->> 'upiDifference')::numeric, 0) <> 0
                              or coalesce((x ->> 'cardDifference')::numeric, 0) <> 0)),
        'voidsAfterKitchen', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'total', o.total,
                                                                           'reason', o.cancel_reason, 'by', o.staff_name, 'at', o.cancelled_at)
                                                        order by o.cancelled_at), '[]'::jsonb)
                                from public.orders o
                               where o.tenant_id = v_t and o.status = 'cancelled' and o.cancelled_after_kitchen
                                 and o.cancelled_at >= v_t0 and o.cancelled_at < v_t1),
        'refunds', (select coalesce(jsonb_agg(r order by r ->> 'at'), '[]'::jsonb) from (
                        select jsonb_build_object('orderNumber', o.order_number, 'amount', rt.amount, 'method', rt.method, 'reason', rt.reason,
                                                  'by', rt.actor_name, 'approvedBy', rt.approved_by, 'at', rt.created_at, 'kind', 'items') as r
                          from public.order_returns rt join public.orders o on o.id = rt.order_id
                         where rt.tenant_id = v_t and rt.created_at >= v_t0 and rt.created_at < v_t1
                        union all
                        select jsonb_build_object('orderNumber', o.order_number,
                                                  'amount', o.amount_paid - o.refunded_amount,
                                                  'method', o.payment_method, 'reason', o.cancel_reason, 'by', o.staff_name, 'approvedBy', '',
                                                  'at', o.cancelled_at, 'kind', 'cancel')
                          from public.orders o
                         where o.tenant_id = v_t and o.status = 'cancelled' and o.amount_paid > 0
                           and o.cancelled_at >= v_t0 and o.cancelled_at < v_t1) z),
        'discounts', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'amount', o.manual_discount,
                                                                   'pct', round(o.manual_discount * 100 / nullif(o.subtotal, 0), 1),
                                                                   'reason', o.discount_reason, 'by', o.staff_name, 'approvedBy', o.discount_approved_by,
                                                                   'big', o.discount_approved_by <> '' or o.manual_discount * 100 / nullif(o.subtotal, 0) >= 10)
                                                order by o.created_at), '[]'::jsonb)
                        from public.orders o
                       where o.tenant_id = v_t and o.manual_discount > 0 and o.created_at >= v_t0 and o.created_at < v_t1),
        'reprints', (select coalesce(jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'prints', p.n, 'by', p.who, 'at', p.at)
                                               order by p.at), '[]'::jsonb)
                       from (select bp.order_id, max(bp.n) as n, max(bp.created_at) as at,
                                    string_agg(distinct bp.by_name, ', ') as who
                               from public.bill_prints bp
                              where bp.tenant_id = v_t and bp.created_at >= v_t0 and bp.created_at < v_t1
                              group by bp.order_id having max(bp.n) > 1) p
                       join public.orders o on o.id = p.order_id),
        'openShifts', (select coalesce(jsonb_agg(jsonb_build_object('drawerName', a.name, 'openedBy', s.opened_by, 'openedAt', s.opened_at)
                                                 order by s.opened_at), '[]'::jsonb)
                         from public.shifts s join public.money_accounts a on a.id = s.account_id
                        where s.tenant_id = v_t and s.status = 'open' and s.opened_at < v_t1));

    -- Balanced or not, and why
    v_n := jsonb_array_length(v_exc -> 'openShifts');
    if v_n > 0 then
        v_reasons := v_reasons || (v_n || case when v_n = 1 then ' shift still open' else ' shifts still open' end);
    end if;
    select count(*), coalesce(sum((b ->> 'due')::numeric), 0) into v_n, v_v from jsonb_array_elements(v_exc -> 'openBills') b;
    if v_n > 0 then
        v_reasons := v_reasons || (v_n || case when v_n = 1 then ' bill still open (' else ' bills still open (' end || public.inr(v_v) || ')');
    end if;
    if not (v_comb ->> 'balanced')::boolean then
        v_reasons := v_reasons || ('bills and money do not add up (off by ' || public.inr(v_diff) || ')');
    end if;
    select count(*) into v_n from jsonb_array_elements(v_shifts) x where coalesce((x ->> 'oldClose')::boolean, false);
    if v_n > 0 then
        v_reasons := v_reasons || (v_n || ' shift(s) closed before balance sheets existed: check them by hand');
    end if;

    if v_from = v_to then
        select jsonb_build_object('status', d.status, 'by', d.closed_by, 'at', d.closed_at, 'note', d.note,
                                  'reopenedBy', d.reopened_by, 'reopenedAt', d.reopened_at, 'reopenReason', d.reopen_reason)
          into v_closed from public.day_closes d where d.tenant_id = v_t and d.day = v_from;
    end if;

    return jsonb_build_object(
        'from', v_from, 'to', v_to, 'today', v_today,
        'shifts', v_shifts, 'drawers', v_drawers, 'qr', v_qr, 'combined', v_comb, 'modes', v_modes, 'money', v_money,
        'exceptions', v_exc,
        'status', jsonb_build_object('balanced', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons)),
        'closed', v_closed,
        'closedDays', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'by', d.closed_by, 'at', d.closed_at) order by d.day), '[]'::jsonb)
                         from public.day_closes d where d.tenant_id = v_t and d.status = 'closed' and d.day between v_from and v_to),
        'isOwner', public.is_owner_user(),
        'canClose', v_from = v_to and v_from <= v_today and cardinality(v_reasons) = 0 and public.is_owner_user()
                    and coalesce(v_closed ->> 'status', '') <> 'closed');
end;
$$;

-- Close the day (owner): everything must balance; afterwards nothing new can be dated that day
create or replace function public.close_day(p_day date, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
    v_r jsonb;
begin
    if not public.is_owner_user() then
        raise exception 'Only the owner can close the day';
    end if;
    if p_day is null or p_day > public.cafe_today(v_t) then
        raise exception 'A day can be closed only after it has started';
    end if;
    if public.day_is_closed(v_t, p_day) then
        raise exception '% is already closed', to_char(p_day, 'DD Mon YYYY');
    end if;
    v_r := public.day_close_report(p_day, p_day);
    if not (v_r -> 'status' ->> 'balanced')::boolean then
        raise exception 'Not balanced: %', (select string_agg(x, '; ') from jsonb_array_elements_text(v_r -> 'status' -> 'reasons') x);
    end if;
    insert into public.day_closes (tenant_id, day, status, closed_by, closed_by_staff, closed_at, note, summary)
    values (v_t, p_day, 'closed', public.actor_name(), public.my_staff_id(), now(), trim(coalesce(p_note, '')), v_r)
    on conflict (tenant_id, day) do update
        set status = 'closed', closed_by = excluded.closed_by, closed_by_staff = excluded.closed_by_staff,
            closed_at = excluded.closed_at, note = excluded.note, summary = excluded.summary;
    perform public.audit_event(v_t, 'day_close', p_day::text, 'Day closed: ' || to_char(p_day, 'DD Mon YYYY'), null,
                               jsonb_build_object('made', v_r -> 'combined' -> 'madeTotal', 'variance', v_r -> 'money' -> 'totalVariance'));
    return public.day_close_report(p_day, p_day);
end;
$$;

-- Open a closed day again (owner, with a reason; the owner is alerted so it is never quiet)
create or replace function public.reopen_day(p_day date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t uuid := public.current_tenant_id();
begin
    if not public.is_owner_user() then
        raise exception 'Only the owner can open a closed day again';
    end if;
    if trim(coalesce(p_reason, '')) = '' then
        raise exception 'Write why the day is opened again';
    end if;
    update public.day_closes set status = 'reopened', reopened_by = public.actor_name(), reopened_at = now(), reopen_reason = trim(p_reason)
     where tenant_id = v_t and day = p_day and status = 'closed';
    if not found then
        raise exception '% is not closed', to_char(p_day, 'DD Mon YYYY');
    end if;
    perform public.notify(v_t, 'day_reopened', to_char(p_day, 'DD Mon YYYY') || ' opened again',
        'By ' || public.actor_name() || ' · ' || trim(p_reason), '/admin/shifts?tab=day', 'finance.view', 'loud');
    return public.day_close_report(p_day, p_day);
end;
$$;

-- Orders as the app sees them: how often the bill was printed, and the shift note of an offline bill
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
        'printCount', o.print_count, 'lastPrintBy', o.last_print_by, 'shiftNote', o.shift_note,
        'createdAt', o.created_at, 'updatedAt', o.updated_at)
      from (select 1) x
      left join public.customers c on c.id = o.customer_id;
$function$;

-- ==== 11. Bills made before this update ====
-- Paid bills: the shift of their first payment. Open bills of the counter and kiosk made while a shift is still open:
-- that shift (they must be closed off like any other). Other old open bills join the shift that collects them.
alter table public.orders disable trigger user;
update public.orders o set made_shift_id = x.shift_id, shift_id = x.shift_id
  from (select distinct on (le.order_id) le.order_id, le.shift_id from public.ledger_entries le
         where le.kind in ('sale', 'khata_sale') and le.shift_id is not null and le.order_id is not null
         order by le.order_id, le.created_at) x
 where o.id = x.order_id and o.made_shift_id is null;
update public.orders o set made_shift_id = s.id, shift_id = s.id
  from public.shifts s join public.money_accounts a on a.id = s.account_id
 where o.made_shift_id is null and o.status not in ('paid', 'cancelled') and o.channel in ('dine_in', 'takeaway', 'kiosk')
   and s.tenant_id = o.tenant_id and s.status = 'open' and o.created_at >= s.opened_at
   and a.code = case when o.channel = 'kiosk' then 'cash_kiosk' else 'cash_counter' end;
alter table public.orders enable trigger user;

-- ==== 12. Who may call what ====
revoke execute on function public.handover_bill(uuid, text, text, text) from public, anon;
grant execute on function public.handover_bill(uuid, text, text, text) to authenticated;
revoke execute on function public.close_shift(uuid, jsonb, numeric, numeric, text, text, text, text) from public, anon;
grant execute on function public.close_shift(uuid, jsonb, numeric, numeric, text, text, text, text) to authenticated;
revoke execute on function public.confirm_table_order(uuid, text) from public, anon;
grant execute on function public.confirm_table_order(uuid, text) to authenticated;
revoke execute on function public.log_bill_print(uuid) from public, anon;
grant execute on function public.log_bill_print(uuid) to authenticated;
revoke execute on function public.day_close_report(date, date) from public, anon;
grant execute on function public.day_close_report(date, date) to authenticated;
revoke execute on function public.close_day(date, text) from public, anon;
grant execute on function public.close_day(date, text) to authenticated;
revoke execute on function public.reopen_day(date, text) from public, anon;
grant execute on function public.reopen_day(date, text) to authenticated;
revoke execute on function public.is_owner_user() from public, anon;
grant execute on function public.is_owner_user() to authenticated;
revoke execute on function public.shift_tolerances(uuid) from public, anon;
revoke execute on function public.day_is_closed(uuid, date) from public, anon;

notify pgrst, 'reload schema';
