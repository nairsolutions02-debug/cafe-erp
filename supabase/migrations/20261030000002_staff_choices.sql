-- Staff screens: sizes, choices and combos
--   kitchen_orders: each line also says whether it is a combo, and for a combo the stations of its picks,
--                   so the coffee bar sees a combo that holds a drink
--   order_json:     each line also carries comboId and options (size, choices, combo picks)
--   deduct_order_line: kiosk sales take stock from the kiosk again and packs count their pieces (lost in the redesign file)

create or replace function public.kitchen_orders()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform public.require_perm('orders.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', o.id, 'orderNumber', o.order_number, 'status', o.status, 'channel', o.channel,
                   'tableNumber', o.table_number, 'tokenNumber', o.token_number,
                   'customer', c.name, 'note', o.special_instructions, 'createdAt', o.created_at,
                   'kitchenStartedAt', o.kitchen_started_at,
                   'tableGroups', case when o.table_id is null then 1 else
                       (select count(distinct coalesce(x.customer_id::text, x.id::text)) from public.orders x
                         where x.table_id = o.table_id and x.status not in ('paid', 'cancelled')) end,
                   'items', (select jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
                                                                 'status', oi.kitchen_status, 'note', oi.note,
                                                                 'combo', oi.combo_id is not null,
                                                                 'station', public.item_station(oi.menu_item_id),
                                                                 'stations', case when oi.combo_id is null then null else
                                                                     (select coalesce(jsonb_agg(distinct public.item_station((pk ->> 'menuItem')::uuid)), '[]'::jsonb)
                                                                        from jsonb_array_elements(coalesce(oi.options -> 'picks', '[]'::jsonb)) pk
                                                                       where nullif(pk ->> 'menuItem', '') is not null) end)
                                       order by oi.name)
                               from public.order_items oi where oi.order_id = o.id))
                   order by o.created_at), '[]'::jsonb)
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where o.tenant_id = public.current_tenant_id()
           and o.status <> 'cancelled' and o.channel <> 'kiosk' and not o.held
           and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.kitchen_status <> 'served')
           and o.created_at > now() - interval '24 hours');
end;
$function$;

create or replace function public.order_json(o orders)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
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

-- Stock for a sale line: kiosk sales take stock from the kiosk location, packs count their pieces,
-- and a combo takes the recipe of each dish picked (the combo line has no dish of its own)
create or replace function public.deduct_order_line(p_line public.order_items) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_kiosk uuid;
    v_loc uuid;
    v_mi uuid;
    v_mult numeric := p_line.quantity * coalesce(p_line.unit_factor, 1);
begin
    select * into v_o from public.orders where id = p_line.order_id;
    if v_o.channel = 'kiosk' then
        v_kiosk := (select id from public.stock_locations where tenant_id = v_o.tenant_id and default_for_kiosk and is_active);
    end if;
    for v_mi in
        select p_line.menu_item_id where p_line.menu_item_id is not null
        union all
        select (pk ->> 'menuItem')::uuid from jsonb_array_elements(coalesce(p_line.options -> 'picks', '[]'::jsonb)) pk
         where p_line.menu_item_id is null and nullif(pk ->> 'menuItem', '') is not null
    loop
        v_loc := coalesce(v_kiosk, public.sale_location(v_mi));
        if v_loc is null then
            continue;
        end if;
        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
        select v_o.tenant_id, r.item_id, v_loc, -round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3), i.cost_per_unit,
               'sale', p_line.order_id, v_mi, p_line.name || ' × ' || p_line.quantity, 'Sale'
          from public.recipe_lines r join public.inventory i on i.id = r.item_id
         where r.menu_item_id = v_mi and i.track_stock
           and round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3) <> 0;
    end loop;
end;
$$;
revoke execute on function public.deduct_order_line(public.order_items) from public, anon, authenticated;
