-- Fix pack 3, from the cashier and chef test run.
-- 1. Money, drawers, cancels, table moves and Accept need orders.create (people who take orders and money:
--    cashier, waiter, kiosk, manager, owner). orders.edit alone (the chef) keeps the kitchen work: marking dishes
--    started, ready and served.
-- 2. Orders are changed only through the app functions: staff can no longer update or delete order rows directly,
--    so totals, discounts and payments always go through the rules (discount limits, the money ledger, the audit).
-- No apostrophes in comments: the SQL Editor splitter treats them as quotes.

-- 1. Switch the money functions from orders.edit to orders.create (same body otherwise)
do $do$
declare
    f record;
    v_def text;
begin
    for f in
        select p.oid, p.proname
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and p.proname in ('activate_club_membership', 'cancel_order', 'cash_movement', 'close_shift', 'confirm_table_order',
                             'move_order_table', 'open_shift', 'record_payment', 'remove_service_charge', 'settle_khata',
                             'settle_order', 'current_shifts', 'khata_accounts', 'khata_history', 'request_bill', 'request_payment')
    loop
        v_def := pg_get_functiondef(f.oid);
        if position('orders.edit' in v_def) > 0 then
            execute replace(replace(v_def, '''orders.edit''', '''orders.create'''), '(orders.edit)', '(orders.create)');
        end if;
    end loop;
end;
$do$;

-- Settings, Alerts: bill and UPI requests go to the people who can take the money
do $do$
declare
    v_def text := pg_get_functiondef('public.notification_kinds'::regproc);
begin
    if position('"default": "alarm", "perm": "orders.edit"' in v_def) > 0 then
        execute replace(v_def, '"kind": "payment_request", "label": "Bill / UPI payment requested", "default": "alarm", "perm": "orders.edit"',
                               '"kind": "payment_request", "label": "Bill / UPI payment requested", "default": "alarm", "perm": "orders.create"');
    end if;
end;
$do$;

-- Status changes: the kitchen moves an order along (preparing, ready, served); accepting it or making the bill
-- is front of house work
create or replace function public.update_order_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('orders.edit');
    if p_status = 'cancelled' then
        return public.cancel_order(p_order_id, 'Cancelled from the orders board');
    end if;
    if p_status = 'paid' then
        raise exception 'Record the payment to mark an order paid';
    end if;
    if p_status not in ('preparing', 'ready', 'served') then
        perform public.require_perm('orders.create');
    end if;
    update public.orders set status = p_status
     where id = p_order_id and tenant_id = public.current_tenant_id() and status not in ('paid', 'cancelled');
    if not found then
        raise exception 'Order not found or already closed';
    end if;
    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

-- Money accounts and expense categories: readable by finance and by people who handle cash
drop policy if exists "staff view" on public.money_accounts;
create policy "staff view" on public.money_accounts for select
    using (tenant_id = (select public.current_tenant_id())
           and ((select public.has_perm('finance.view')) or (select public.has_perm('orders.create'))));
drop policy if exists "staff view" on public.expense_categories;
create policy "staff view" on public.expense_categories for select
    using (tenant_id = (select public.current_tenant_id())
           and ((select public.has_perm('finance.view')) or (select public.has_perm('orders.create'))));

-- 2. No direct edits of order rows: every change goes through the app functions above
drop policy if exists "staff edit" on public.orders;
drop policy if exists "staff delete" on public.orders;
