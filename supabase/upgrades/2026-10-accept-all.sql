-- Cafe ERP · Accept every QR order before the kitchen upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261024000001_accept_all.sql ====
-- Accept every QR order: when on (default), a QR order waits for a staff member to tap Accept before the kitchen,
-- the pickup screen or the Tables page treat it as live. The first order on a table still says Confirm table.
-- Setting qr_accept_all (true by default). No apostrophes in comments: the SQL Editor splitter treats them as quotes.

alter table public.orders add column if not exists hold_reason text
    check (hold_reason is null or hold_reason in ('table', 'accept'));

-- Settings for tables: + acceptAll
create or replace function public.table_settings(p_tenant uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'mode', coalesce(nullif(public.get_setting('table_mode', '"qr"', p_tenant) #>> '{}', ''), 'qr'),
        'shared', coalesce((public.get_setting('table_shared', 'true', p_tenant) #>> '{}')::boolean, true),
        'confirmFirst', coalesce((public.get_setting('table_confirm_first', 'false', p_tenant) #>> '{}')::boolean, false),
        'acceptAll', coalesce((public.get_setting('qr_accept_all', 'true', p_tenant) #>> '{}')::boolean, true),
        'legacyLinks', coalesce((public.get_setting('table_legacy_links', 'true', p_tenant) #>> '{}')::boolean, true));
$$;

-- Before a QR order is saved: note why it is held, and hold it for Accept when the cafe asks for that
create or replace function public.orders_hold_for_accept() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.channel = 'qr' then
        if new.held then
            new.hold_reason := 'table';
        elsif (public.table_settings(new.tenant_id) ->> 'acceptAll')::boolean then
            new.held := true;
            new.hold_reason := 'accept';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists orders_hold_for_accept on public.orders;
create trigger orders_hold_for_accept before insert on public.orders
    for each row execute function public.orders_hold_for_accept();

-- New QR orders ring for staff: Confirm table for a first order, otherwise New order
create or replace function public.orders_notify_new() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.channel in ('qr') then
        perform public.notify(new.tenant_id, 'new_order',
                              case when new.hold_reason = 'table' then 'Confirm table: ' else 'New order ' end
                              || coalesce(nullif('· Table ' || new.table_number, '· Table '), '')
                              || ' ' || new.order_number,
                              case when new.hold_reason = 'table' then 'First order on this table. Check someone is sitting there, then confirm. '
                                   when new.held then 'Tap Accept to send it to the kitchen. '
                                   else '' end || public.inr(new.total),
                              '/admin/orders', 'orders.view', 'alarm', jsonb_build_object('orderId', new.id));
    end if;
    return null;
end;
$$;

-- Accepting clears the reason too
create or replace function public.confirm_table_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
begin
    perform public.require_perm('orders.edit');
    update public.orders set held = false, hold_reason = null,
           status = case when status = 'pending' then 'confirmed' else status end
     where id = p_order_id and tenant_id = public.current_tenant_id()
    returning * into v_o;
    if v_o.id is null then
        raise exception 'Order not found';
    end if;
    return public.order_json(v_o);
end;
$$;

-- Older held orders were all first orders on a table
update public.orders set hold_reason = 'table' where held and hold_reason is null;

-- Order JSON: + holdReason
create or replace function public.order_json(o public.orders) returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select jsonb_build_object(
        '_id', o.id, 'id', o.id,
        'orderNumber', o.order_number,
        'user', case when c.id is null then null else
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
                'kitchenStatus', oi.kitchen_status, 'unitName', oi.unit_name, 'note', oi.note)
                order by oi.name)
              from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = o.id), '[]'::jsonb),
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by method)
              from (select le.method, sum(le.amount) as amt from public.ledger_entries le
                     where le.order_id = o.id and le.kind in ('sale', 'refund', 'khata_sale')
                     group by le.method having sum(le.amount) <> 0) p), '[]'::jsonb),
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
$$;

commit;
