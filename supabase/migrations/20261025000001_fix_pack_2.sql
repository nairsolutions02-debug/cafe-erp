-- Fix pack 2, from the manager and waiter test run.
-- 1. Cash drawers: only the person who opened a shift, or someone with finance.edit (owner, manager), can close it.
--    Drawer amounts are shown only to the person who opened the shift and to people with finance.view.
-- 2. Staff without customers.view (for example waiters) see the first name of the customer on an order.
-- 3. Each role can open on its own page after login (roles.home_path). Waiters open on Orders, chefs on Kitchen.
-- No apostrophes in comments: the SQL Editor splitter treats them as quotes.

-- ---------------------------------------------------------------------------
-- 1. Drawer rights
-- ---------------------------------------------------------------------------
create or replace function public.can_see_drawer(s public.shifts) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.has_perm('finance.view') or (s.opened_by_staff is not null and s.opened_by_staff = public.my_staff_id());
$$;

create or replace function public.can_close_drawer(s public.shifts) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.has_perm('finance.edit') or (s.opened_by_staff is not null and s.opened_by_staff = public.my_staff_id());
$$;

-- What a person may see of a shift: everything, or only who opened it and when
create or replace function public.shift_view(s public.shifts) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when public.can_see_drawer(s)
                then public.shift_json(s) || jsonb_build_object('canSee', true, 'canClose', public.can_close_drawer(s) and s.status = 'open')
                else jsonb_build_object('id', s.id, 'status', s.status, 'drawer', a.code, 'drawerName', a.name,
                                        'openedBy', s.opened_by, 'openedAt', s.opened_at, 'note', s.note,
                                        'canSee', false, 'canClose', public.can_close_drawer(s) and s.status = 'open')
           end
      from public.money_accounts a where a.id = s.account_id;
$$;

create or replace function public.current_shifts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_fin boolean := public.has_perm('finance.view');
begin
    if not (public.has_perm('orders.edit') or v_fin) then
        raise exception 'Not authorized (orders.edit)';
    end if;
    return (
        select jsonb_build_object(
            'drawers', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name,
                                                                     'lastCloseCash', case when v_fin then
                                                                         (select counted_cash from public.shifts x
                                                                           where x.account_id = a.id and x.status = 'closed'
                                                                           order by closed_at desc limit 1) end)
                                                  order by a.sort_order), '[]'::jsonb)
                          from public.money_accounts a where a.tenant_id = public.current_tenant_id() and a.is_drawer and a.is_active),
            'open', (select coalesce(jsonb_agg(public.shift_view(s) order by s.opened_at), '[]'::jsonb)
                       from public.shifts s where s.tenant_id = public.current_tenant_id() and s.status = 'open'),
            'tolerance', coalesce((public.get_setting('shift_tolerance', '50', public.current_tenant_id()) #>> '{}')::numeric, 50)));
end;
$$;

-- Cash movements stay open to counter staff; the reply only shows amounts to those who may see them
create or replace function public.cash_movement_view(p_drawer text, p_kind text, p_amount numeric, p_note text default '',
                                                     p_category_id uuid default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_j jsonb := public.cash_movement(p_drawer, p_kind, p_amount, p_note, p_category_id, p_client_id);
    v_s public.shifts;
begin
    select * into v_s from public.shifts where id = (v_j ->> 'id')::uuid;
    return public.shift_view(v_s);
end;
$$;

-- Close: the person who opened it, or finance.edit
create or replace function public.close_shift_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if old.status = 'open' and new.status = 'closed' and auth.uid() is not null and not public.can_close_drawer(old) then
        raise exception 'Only % (who opened this shift) or a manager can close it', old.opened_by;
    end if;
    return new;
end;
$$;

drop trigger if exists shifts_close_guard on public.shifts;
create trigger shifts_close_guard before update on public.shifts
    for each row execute function public.close_shift_guard();

-- Finance Today also lists shifts that are still open from an earlier day
create or replace function public.list_shifts(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('finance.view');
    return (
        select coalesce(jsonb_agg(public.shift_json(s) order by s.opened_at desc), '[]'::jsonb)
          from (select * from public.shifts
                 where tenant_id = public.current_tenant_id()
                   and ((p_from is null or opened_at >= p_from::timestamp at time zone public.cafe_timezone()) or status = 'open')
                   and (p_to is null or opened_at < (p_to + 1)::timestamp at time zone public.cafe_timezone())
                 order by opened_at desc limit 200) s);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. First name of the customer for staff who cannot open customer records
-- ---------------------------------------------------------------------------
create or replace function public.order_customer_brief(p_customer uuid, p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('_id', c.id, 'name', split_part(trim(c.name), ' ', 1), 'phone', null, 'email', null)
      from public.customers c
     where c.id = p_customer and c.tenant_id = p_tenant
       and p_tenant = public.current_tenant_id() and public.has_perm('orders.view');
$$;

create or replace function public.order_json(o public.orders) returns jsonb
language sql stable set search_path = public, pg_temp as $$
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

-- ---------------------------------------------------------------------------
-- 3. The page a role opens on
-- ---------------------------------------------------------------------------
alter table public.roles add column if not exists home_path text
    check (home_path is null or home_path ~ '^/admin(/[a-z-]+)?$');

update public.roles set home_path = '/admin/orders' where name = 'Waiter' and home_path is null;
update public.roles set home_path = '/admin/kitchen' where name = 'Chef' and home_path is null;

-- New cafes: the standard Waiter and Chef roles open on their page
create or replace function public.roles_default_home() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if new.home_path is null then
        new.home_path := case new.name when 'Waiter' then '/admin/orders' when 'Chef' then '/admin/kitchen' end;
    end if;
    return new;
end;
$$;

drop trigger if exists roles_default_home on public.roles;
create trigger roles_default_home before insert on public.roles
    for each row execute function public.roles_default_home();

-- The signed-in person: + homePath
create or replace function public.me() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_profile public.profiles;
    v_customer public.customers;
    v_staff public.staff_users;
    v_role public.roles;
    v_tenant public.tenants;
    v_email text;
begin
    select * into v_profile from public.profiles where id = auth.uid();
    if v_profile.id is null then
        return null;
    end if;
    select email into v_email from auth.users where id = v_profile.id;
    if v_profile.role = 'platform' then
        return jsonb_build_object('_id', v_profile.id, 'id', v_profile.id, 'role', 'platform',
            'name', 'Platform admin', 'email', coalesce(v_email, ''), 'permissions', '[]'::jsonb);
    end if;
    select * into v_tenant from public.tenants where id = v_profile.tenant_id;
    if v_profile.role = 'customer' then
        select * into v_customer from public.customers where id = v_profile.customer_id;
        if v_customer.id is null then
            return null;
        end if;
        return jsonb_build_object(
            '_id', v_customer.id, 'id', v_customer.id, 'role', 'customer',
            'name', v_customer.name, 'phone', v_customer.phone, 'email', v_customer.email,
            'loyaltyPoints', v_customer.loyalty_points, 'totalPointsEarned', v_customer.total_points_earned,
            'phoneVerified', v_customer.phone_verified,
            'tenant', jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'slug', v_tenant.slug));
    end if;
    if v_profile.role = 'staff' then
        select * into v_staff from public.staff_users where id = v_profile.staff_id and is_active;
        if v_staff.id is null then
            return null;
        end if;
        select * into v_role from public.roles where id = v_staff.role_id;
    end if;
    return jsonb_build_object(
        '_id', v_profile.id, 'id', v_profile.id,
        'role', 'admin',
        'kind', v_profile.role,
        'staffId', v_staff.id,
        'name', coalesce(v_staff.name, 'Owner'),
        'phone', coalesce(v_staff.phone, ''),
        'email', coalesce(v_email, ''),
        'roleName', case when v_profile.role = 'admin' then 'Owner' else v_role.name end,
        'isOwner', v_profile.role = 'admin' or coalesce(v_role.is_owner, false),
        'permissions', to_jsonb(public.my_permissions()),
        'homePath', v_role.home_path,
        'pendingTerms', public.pending_terms(),
        'tenant', jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'slug', v_tenant.slug,
                                     'status', public.tenant_status(v_tenant.id), 'paidUntil', v_tenant.paid_until,
                                     'graceDays', v_tenant.grace_days));
end;
$$;
