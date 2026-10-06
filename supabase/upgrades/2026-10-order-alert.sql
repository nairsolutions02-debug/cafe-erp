-- Cafe ERP · Full-screen order alert: bill requests ring upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261023000001_order_alert.sql ====
-- Full-screen order alert: a customer asking for the bill (without choosing UPI or counter) now raises the same
-- full-screen alert as a payment request, with the amount due. Staff asking for a bill raise nothing.
-- Asking twice does not ring twice: only orders that were not already waiting for the bill count.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

create or replace function public.request_bill(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_order public.orders;
    v_staff boolean;
    v_n integer;
    v_due numeric;
    v_where text;
begin
    select * into v_order from public.orders where id = p_order_id;
    if v_order.id is null then
        raise exception 'Order not found';
    end if;
    v_staff := v_order.tenant_id = public.current_tenant_id() and public.has_perm('orders.edit');
    if v_order.customer_id is distinct from public.current_customer_id() and not v_staff then
        raise exception 'Not authorized';
    end if;

    with changed as (
        update public.orders
           set status = 'bill_requested'
         where tenant_id = v_order.tenant_id
           and status not in ('paid', 'cancelled', 'bill_requested')
           and (id = v_order.id
                or (v_order.table_id is not null and table_id = v_order.table_id
                    and (v_staff or customer_id = v_order.customer_id))
                or (v_order.table_id is null and customer_id = v_order.customer_id))
        returning total - amount_paid as due
    )
    select count(*), coalesce(sum(due), 0) into v_n, v_due from changed;

    if v_n > 0 and not v_staff then
        v_where := coalesce(nullif('Table ' || v_order.table_number, 'Table '), 'Order ' || v_order.order_number);
        perform public.notify(v_order.tenant_id, 'payment_request',
                              v_where || ' asks for the bill · ' || public.inr(v_due),
                              'Take the bill to the table', '/admin/orders', 'orders.edit', 'alarm',
                              jsonb_build_object('orderId', v_order.id, 'mode', 'bill'));
    end if;

    return (select public.order_json(o) from public.orders o where o.id = p_order_id);
end;
$$;

commit;
