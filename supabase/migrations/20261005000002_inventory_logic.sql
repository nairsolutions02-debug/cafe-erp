-- Phase 1 · 2/2: inventory logic — purchases (weighted average cost), recipes and automatic
-- deduction on every sale, wastage, transfers, counts with variance, reorder alerts, usage,
-- menu costing, search and row security.

-- ---------------------------------------------------------------------------
-- Superadmin: set the owner PIN, creating the owner's PIN login if the cafe has none
-- (e.g. a cafe moved over from before Phase 0, where the owner used email only)
-- ---------------------------------------------------------------------------
create or replace function public.sa_reset_owner_pin(p_tenant uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
    v_staff uuid;
    v_tenant public.tenants;
    v_phone text;
begin
    perform public.require_platform();
    if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
        raise exception 'PIN must be 4 to 6 digits';
    end if;
    select s.id into v_staff from public.staff_users s join public.roles r on r.id = s.role_id
     where s.tenant_id = p_tenant and r.is_owner order by s.created_at limit 1;
    if v_staff is null then
        select * into v_tenant from public.tenants where id = p_tenant;
        if v_tenant.id is null then
            raise exception 'Cafe not found';
        end if;
        v_phone := right(regexp_replace(coalesce(v_tenant.owner_phone, ''), '\D', '', 'g'), 10);
        if v_phone !~ '^[0-9]{10}$' then
            raise exception 'Add the owner''s 10-digit mobile number first (Edit cafe), then set the PIN';
        end if;
        begin
            insert into public.staff_users (tenant_id, name, phone, role_id, pin_hash)
            values (p_tenant, coalesce(nullif(trim(v_tenant.owner_name), ''), 'Owner'), v_phone,
                    (select id from public.roles where tenant_id = p_tenant and is_owner limit 1),
                    crypt(p_pin, gen_salt('bf')));
        exception when unique_violation then
            raise exception 'A staff member already uses mobile %. Change the owner''s mobile or that staff member''s.', v_phone;
        end;
        return;
    end if;
    update public.staff_users set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null, is_active = true
     where id = v_staff;
    delete from public.profiles where staff_id = v_staff;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Where a menu item's sale takes stock from
create function public.sale_location(p_menu_item uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select l.id from public.stock_locations l where l.id = m.stock_location_id and l.is_active),
        (select l.id from public.stock_locations l where l.id = c.stock_location_id and l.is_active),
        (select l.id from public.stock_locations l where l.id = pc.stock_location_id and l.is_active),
        (select l.id from public.stock_locations l where l.tenant_id = m.tenant_id and l.default_for_sales),
        (select l.id from public.stock_locations l where l.tenant_id = m.tenant_id order by l.sort_order limit 1))
      from public.menu_items m
      left join public.categories c on c.id = m.category_id
      left join public.categories pc on pc.id = c.parent_id
     where m.id = p_menu_item;
$$;

-- Cost of one portion = Σ quantity × (1 + waste %) × ingredient average cost; null without a recipe
create function public.recipe_cost(p_menu_item uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select sum(r.quantity * (1 + r.waste_pct / 100) * i.cost_per_unit)
      from public.recipe_lines r join public.inventory i on i.id = r.item_id
     where r.menu_item_id = p_menu_item;
$$;
revoke execute on function public.recipe_cost(uuid) from public, anon;

create function public.location_qty(p_item uuid, p_location uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select quantity from public.stock_levels where item_id = p_item and location_id = p_location), 0);
$$;

create function public.require_location(p_location uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not exists (select 1 from public.stock_locations where id = p_location and tenant_id = public.current_tenant_id()) then
        raise exception 'Location not found';
    end if;
end;
$$;

create function public.require_stock_item(p_item uuid) returns public.inventory
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_item public.inventory;
begin
    select * into v_item from public.inventory where id = p_item and tenant_id = public.current_tenant_id() for update;
    if v_item.id is null then
        raise exception 'Stock item not found';
    end if;
    return v_item;
end;
$$;
revoke execute on function public.require_stock_item(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sales: snapshot the dish cost on each order line and deduct its recipe
-- ---------------------------------------------------------------------------
create function public.deduct_order_line(p_line public.order_items) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid;
    v_loc uuid;
begin
    if p_line.menu_item_id is null then
        return;
    end if;
    select tenant_id into v_tenant from public.orders where id = p_line.order_id;
    v_loc := public.sale_location(p_line.menu_item_id);
    if v_loc is null then
        return;
    end if;
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
    select v_tenant, r.item_id, v_loc, -round(r.quantity * (1 + r.waste_pct / 100) * p_line.quantity, 3), i.cost_per_unit,
           'sale', p_line.order_id, p_line.menu_item_id, p_line.name || ' × ' || p_line.quantity, 'Sale'
      from public.recipe_lines r join public.inventory i on i.id = r.item_id
     where r.menu_item_id = p_line.menu_item_id and i.track_stock
       and round(r.quantity * (1 + r.waste_pct / 100) * p_line.quantity, 3) <> 0;
end;
$$;
revoke execute on function public.deduct_order_line(public.order_items) from public, anon, authenticated;

create function public.order_items_cost() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_cost numeric;
begin
    if new.menu_item_id is not null then
        v_cost := public.recipe_cost(new.menu_item_id);
        if v_cost is not null then
            new.unit_cost := round(v_cost, 2);
        end if;
    end if;
    return new;
end;
$$;
create trigger order_items_cost before insert on public.order_items
    for each row execute function public.order_items_cost();

create function public.order_items_deduct() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.orders where id = new.order_id and status <> 'cancelled') then
        perform public.deduct_order_line(new);
    end if;
    return null;
end;
$$;
create trigger order_items_deduct after insert on public.order_items
    for each row execute function public.order_items_deduct();

create or replace function public.orders_status_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_settings public.loyalty_settings;
    v_base numeric;
    v_points integer := 0;
    v_line public.order_items;
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

    if new.status = 'cancelled' and old.status <> 'cancelled'
       and new.points_redeemed > 0 and new.customer_id is not null then
        update public.customers
           set loyalty_points = loyalty_points + new.points_redeemed
         where id = new.customer_id;
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
$$;

-- ---------------------------------------------------------------------------
-- Stock items
-- ---------------------------------------------------------------------------
create function public.save_stock_item(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_id uuid := nullif(p ->> 'id', '')::uuid;
    v_old public.inventory;
    v_name text := trim(coalesce(p ->> 'name', ''));
    v_unit text := trim(coalesce(p ->> 'unit', ''));
    v_loc uuid;
    v_opening numeric := coalesce(nullif(p ->> 'openingStock', '')::numeric, 0);
    v_cost numeric := nullif(p ->> 'avgCost', '')::numeric;
    v_u jsonb;
begin
    if v_name = '' then
        raise exception 'Name is required';
    end if;
    if v_unit = '' then
        raise exception 'Unit is required (e.g. g, ml, pc)';
    end if;
    if exists (select 1 from public.inventory where tenant_id = v_tenant and lower(name) = lower(v_name) and id is distinct from v_id) then
        raise exception 'A stock item called "%" already exists', v_name;
    end if;
    if nullif(p ->> 'vendorId', '') is not null
       and not exists (select 1 from public.vendors where id = (p ->> 'vendorId')::uuid and tenant_id = v_tenant) then
        raise exception 'Vendor not found';
    end if;
    if v_cost is not null and v_cost < 0 then
        raise exception 'Cost cannot be negative';
    end if;

    if v_id is null then
        perform public.require_perm('inventory.create');
        if v_cost is not null and not public.has_perm('sensitive.see_cost') then
            v_cost := null;
        end if;
        insert into public.inventory (tenant_id, name, category, unit, minimum_stock, cost_per_unit, vendor_id, track_stock,
                                      count_frequency, shelf_order, sku, is_active, supplier)
        values (v_tenant, v_name, coalesce(nullif(p ->> 'category', ''), 'ingredient'), v_unit,
                coalesce(nullif(p ->> 'minimumStock', '')::numeric, 0), coalesce(v_cost, 0),
                nullif(p ->> 'vendorId', '')::uuid, coalesce((p ->> 'trackStock')::boolean, true),
                coalesce(nullif(p ->> 'countFrequency', ''), 'weekly'), coalesce(nullif(p ->> 'shelfOrder', '')::integer, 0),
                coalesce(p ->> 'sku', ''), coalesce((p ->> 'isActive')::boolean, true), '')
        returning id into v_id;
        if v_opening <> 0 then
            v_loc := coalesce(nullif(p ->> 'locationId', '')::uuid,
                              (select id from public.stock_locations where tenant_id = v_tenant order by receives_purchases desc, sort_order limit 1));
            perform public.require_location(v_loc);
            insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, note, actor_name)
            values (v_tenant, v_id, v_loc, v_opening, coalesce(v_cost, 0), 'opening', 'Opening stock', public.actor_name());
        end if;
    else
        perform public.require_perm('inventory.edit');
        v_old := public.require_stock_item(v_id);
        if v_unit <> v_old.unit and exists (select 1 from public.stock_moves where item_id = v_id) then
            raise exception 'The unit can''t change once stock has moved (quantities are stored in %). Create a new item instead.', v_old.unit;
        end if;
        update public.inventory set
            name = v_name,
            category = coalesce(nullif(p ->> 'category', ''), category),
            unit = v_unit,
            minimum_stock = coalesce(nullif(p ->> 'minimumStock', '')::numeric, minimum_stock),
            vendor_id = case when p ? 'vendorId' then nullif(p ->> 'vendorId', '')::uuid else vendor_id end,
            track_stock = coalesce((p ->> 'trackStock')::boolean, track_stock),
            count_frequency = coalesce(nullif(p ->> 'countFrequency', ''), count_frequency),
            shelf_order = coalesce(nullif(p ->> 'shelfOrder', '')::integer, shelf_order),
            sku = coalesce(p ->> 'sku', sku),
            is_active = coalesce((p ->> 'isActive')::boolean, is_active)
         where id = v_id;
        if v_cost is not null and round(v_cost, 4) <> round(v_old.cost_per_unit, 4) then
            perform public.require_perm('sensitive.see_cost');
            update public.inventory set cost_per_unit = v_cost where id = v_id;
            perform public.audit_event(v_tenant, 'inventory', v_id::text,
                'Cost changed by hand: ' || v_name || ' ₹' || round(v_old.cost_per_unit, 2) || ' → ₹' || round(v_cost, 2) || ' per ' || v_unit,
                jsonb_build_object('cost_per_unit', v_old.cost_per_unit), jsonb_build_object('cost_per_unit', v_cost));
        end if;
    end if;

    if p ? 'units' then
        delete from public.stock_units where item_id = v_id;
        for v_u in select * from jsonb_array_elements(coalesce(p -> 'units', '[]')) loop
            if trim(coalesce(v_u ->> 'name', '')) <> '' and coalesce((v_u ->> 'factor')::numeric, 0) > 0 then
                insert into public.stock_units (tenant_id, item_id, name, factor)
                values (v_tenant, v_id, trim(v_u ->> 'name'), (v_u ->> 'factor')::numeric)
                on conflict (item_id, name) do update set factor = excluded.factor;
            end if;
        end loop;
    end if;
    return v_id;
end;
$$;

create function public.delete_stock_item(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_item public.inventory;
    v_dishes text;
begin
    perform public.require_perm('inventory.delete');
    v_item := public.require_stock_item(p_id);
    select string_agg(m.name, ', ' order by m.name) into v_dishes
      from public.recipe_lines r join public.menu_items m on m.id = r.menu_item_id where r.item_id = p_id;
    if v_dishes is not null then
        raise exception 'Used in recipes for %. Remove it from those recipes first, or mark it inactive.', v_dishes;
    end if;
    if exists (select 1 from public.stock_moves where item_id = p_id and kind <> 'opening')
       or exists (select 1 from public.purchase_lines where item_id = p_id) then
        raise exception 'This item has stock history. Mark it inactive instead.';
    end if;
    perform set_config('app.opening', 'on', true);
    delete from public.stock_moves where item_id = p_id;
    perform set_config('app.opening', 'off', true);
    delete from public.inventory where id = p_id;
end;
$$;

-- The immutability trigger allows the delete above only while app.opening is on
create or replace function public.stock_moves_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if tg_op = 'DELETE' and (coalesce(current_setting('app.opening', true), '') = 'on'
                             or not exists (select 1 from public.tenants where id = old.tenant_id)) then
        return old;
    end if;
    raise exception 'Stock movements cannot be changed; record a correcting entry instead';
end;
$$;
create trigger stock_moves_no_delete before delete on public.stock_moves
    for each row execute function public.stock_moves_immutable();

-- Everything the stock screen needs, with usage-based reorder maths:
--   daily use      = stock used (sales + wastage + staff meals + complimentary) in the last 14 days ÷ days
--   days left      = stock ÷ daily use
--   reorder when   stock ≤ reorder level, or days left ≤ vendor lead time + 1 day
--   suggested qty  = daily use × (lead time + order cycle), at least 2 × reorder level, minus stock
create function public.stock_overview(p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_cost boolean := public.has_perm('sensitive.see_cost');
begin
    perform public.require_perm('inventory.view');
    return (
        select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
            select jsonb_build_object(
                '_id', i.id, 'id', i.id, 'name', i.name, 'category', i.category, 'unit', i.unit, 'sku', i.sku,
                'trackStock', i.track_stock, 'isActive', i.is_active, 'countFrequency', i.count_frequency,
                'shelfOrder', i.shelf_order, 'minimumStock', i.minimum_stock,
                'quantity', case when p_location is null then i.current_stock else coalesce(lv.at_location, 0) end,
                'totalQuantity', i.current_stock,
                'levels', coalesce(lv.levels, '[]'::jsonb),
                'avgCost', case when v_cost then round(i.cost_per_unit, 4) end,
                'value', case when v_cost then round(greatest(i.current_stock, 0) * i.cost_per_unit, 2) end,
                'vendorId', i.vendor_id, 'vendorName', v.name, 'vendorPhone', v.phone,
                'leadTime', coalesce(v.lead_time_days, 1), 'orderCycle', coalesce(v.order_cycle_days, 7),
                'dailyUse', round(u.daily, 3),
                'daysLeft', case when u.daily > 0 then round(greatest(i.current_stock, 0) / u.daily, 1) end,
                'units', coalesce(su.units, '[]'::jsonb),
                'usedIn', coalesce(rl.dishes, 0),
                'reorder', i.track_stock and i.is_active and (
                    (i.minimum_stock > 0 and i.current_stock <= i.minimum_stock)
                    or (u.daily > 0 and greatest(i.current_stock, 0) / u.daily <= coalesce(v.lead_time_days, 1) + 1)),
                'suggestedQty', greatest(ceil(greatest(u.daily * (coalesce(v.lead_time_days, 1) + coalesce(v.order_cycle_days, 7)),
                                                       i.minimum_stock * 2) - greatest(i.current_stock, 0)), 0)
            ) x
              from public.inventory i
              left join public.vendors v on v.id = i.vendor_id
              left join lateral (
                  select sum(l.quantity) filter (where l.location_id = p_location) as at_location,
                         jsonb_agg(jsonb_build_object('locationId', l.location_id, 'name', sl.name, 'quantity', l.quantity)
                                   order by sl.sort_order) filter (where l.quantity <> 0) as levels
                    from public.stock_levels l join public.stock_locations sl on sl.id = l.location_id
                   where l.item_id = i.id) lv on true
              left join lateral (
                  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'factor', s.factor) order by s.factor) as units
                    from public.stock_units s where s.item_id = i.id) su on true
              left join lateral (select count(*) as dishes from public.recipe_lines r where r.item_id = i.id) rl on true
              left join lateral (
                  select coalesce(-sum(m.quantity), 0)
                         / greatest(1, least(14, ceil(extract(epoch from now() - i.created_at) / 86400)))::numeric as daily
                    from public.stock_moves m
                   where m.item_id = i.id and m.created_at >= now() - interval '14 days'
                     and m.kind in ('sale', 'sale_reversal', 'wastage', 'staff_meal', 'complimentary')) u on true
             where i.tenant_id = v_tenant) s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Vendors and locations
-- ---------------------------------------------------------------------------
create function public.list_vendors() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
begin
    perform public.require_perm('inventory.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', v.id, 'id', v.id, 'name', v.name, 'phone', v.phone, 'gstin', v.gstin, 'address', v.address,
                   'leadTimeDays', v.lead_time_days, 'orderCycleDays', v.order_cycle_days,
                   'paymentTermsDays', v.payment_terms_days, 'notes', v.notes, 'isActive', v.is_active,
                   'items', (select count(*) from public.inventory i where i.vendor_id = v.id),
                   'lastPurchase', (select max(p.bill_date) from public.purchases p where p.vendor_id = v.id and not p.is_void),
                   'due', case when v_cost then (select coalesce(sum(p.total - p.paid_amount), 0)
                                                   from public.purchases p where p.vendor_id = v.id and not p.is_void) end)
                   order by v.name), '[]'::jsonb)
          from public.vendors v where v.tenant_id = public.current_tenant_id());
end;
$$;

create function public.set_location_default(p_location uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
begin
    perform public.require_perm('inventory.edit');
    perform public.require_location(p_location);
    if p_kind = 'purchases' then
        update public.stock_locations set receives_purchases = false where tenant_id = v_tenant and receives_purchases;
        update public.stock_locations set receives_purchases = true, is_active = true where id = p_location;
    elsif p_kind = 'sales' then
        update public.stock_locations set default_for_sales = false where tenant_id = v_tenant and default_for_sales;
        update public.stock_locations set default_for_sales = true, is_active = true where id = p_location;
    else
        raise exception 'Unknown default';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
-- p: {vendorId, vendorName, billNumber, billDate, locationId, billPhotoUrl, paidAmount, paymentMode, dueDate, note,
--     lines: [{itemId, unitName, factor, quantity, rate, taxRate}]}
-- Stock goes up by quantity × factor; each item's average cost becomes
--   (old stock × old average + line amount incl. tax) ÷ (old stock + new quantity)
create function public.record_purchase(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
            trim(coalesce(p ->> 'billNumber', '')), coalesce(nullif(p ->> 'billDate', '')::date, current_date), v_loc,
            coalesce(p ->> 'billPhotoUrl', ''), v_sub, v_taxsum, v_total, v_paid,
            case when v_paid < v_total and coalesce(nullif(p ->> 'paymentMode', ''), 'cash') = 'cash' then 'credit'
                 else coalesce(nullif(p ->> 'paymentMode', ''), 'cash') end,
            case when v_paid < v_total
                 then coalesce(nullif(p ->> 'dueDate', '')::date,
                               coalesce(nullif(p ->> 'billDate', '')::date, current_date) + coalesce(v_vendor.payment_terms_days, 0)) end,
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
$$;

-- Undo a purchase entered by mistake: stock goes back out and the average cost is unwound
create function public.void_purchase(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p public.purchases;
    v_l public.purchase_lines;
    v_item public.inventory;
    v_rest numeric;
begin
    perform public.require_perm('inventory.delete');
    select * into v_p from public.purchases where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_p.id is null then
        raise exception 'Purchase not found';
    end if;
    if v_p.is_void then
        raise exception 'This purchase was already undone';
    end if;
    for v_l in select * from public.purchase_lines where purchase_id = p_id loop
        v_item := public.require_stock_item(v_l.item_id);
        v_rest := v_item.current_stock - v_l.base_quantity;
        if v_rest > 0 then
            update public.inventory
               set cost_per_unit = greatest(round((v_item.current_stock * v_item.cost_per_unit - v_l.amount) / v_rest, 4), 0)
             where id = v_item.id;
        end if;
        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, purchase_id, note, actor_name)
        values (v_p.tenant_id, v_l.item_id, v_p.location_id, -v_l.base_quantity, v_l.base_cost, 'purchase_void', p_id,
                'Purchase undone', public.actor_name());
    end loop;
    update public.purchases set is_void = true where id = p_id;
end;
$$;

create function public.pay_purchase(p_id uuid, p_amount numeric, p_mode text default 'cash') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p public.purchases;
begin
    perform public.require_perm('inventory.edit');
    if coalesce(p_amount, 0) <= 0 then
        raise exception 'Enter an amount';
    end if;
    select * into v_p from public.purchases where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_p.id is null or v_p.is_void then
        raise exception 'Purchase not found';
    end if;
    if p_amount > v_p.total - v_p.paid_amount then
        raise exception 'Only ₹% is due on this bill', v_p.total - v_p.paid_amount;
    end if;
    update public.purchases
       set paid_amount = paid_amount + p_amount,
           payment_mode = case when p_mode in ('cash', 'upi', 'bank', 'card') then p_mode else payment_mode end,
           due_date = case when paid_amount + p_amount >= total then null else due_date end
     where id = p_id
    returning * into v_p;
    return jsonb_build_object('paid', v_p.paid_amount, 'due', v_p.total - v_p.paid_amount);
end;
$$;

create function public.list_purchases(p_from date default null, p_to date default null, p_vendor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
begin
    perform public.require_perm('inventory.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', p.id, 'id', p.id, 'vendorId', p.vendor_id, 'vendorName', p.vendor_name, 'billNumber', p.bill_number,
                   'billDate', p.bill_date, 'location', l.name, 'billPhotoUrl', p.bill_photo_url, 'isVoid', p.is_void,
                   'paymentMode', p.payment_mode, 'dueDate', p.due_date, 'note', p.note, 'createdBy', p.actor_name,
                   'createdAt', p.created_at,
                   'items', (select string_agg(i.name, ', ' order by i.name) from public.purchase_lines pl
                               join public.inventory i on i.id = pl.item_id where pl.purchase_id = p.id),
                   'total', case when v_cost then p.total end,
                   'paid', case when v_cost then p.paid_amount end,
                   'due', case when v_cost then p.total - p.paid_amount end)
                   order by p.bill_date desc, p.created_at desc), '[]'::jsonb)
          from (select * from public.purchases
                 where tenant_id = public.current_tenant_id()
                   and (p_from is null or bill_date >= p_from)
                   and (p_to is null or bill_date <= p_to)
                   and (p_vendor is null or vendor_id = p_vendor)
                 order by bill_date desc, created_at desc limit 300) p
          left join public.stock_locations l on l.id = p.location_id);
end;
$$;

create function public.get_purchase(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
    v_p public.purchases;
begin
    perform public.require_perm('inventory.view');
    select * into v_p from public.purchases where id = p_id and tenant_id = public.current_tenant_id();
    if v_p.id is null then
        raise exception 'Purchase not found';
    end if;
    return jsonb_build_object(
        'id', v_p.id, 'vendorName', v_p.vendor_name, 'billNumber', v_p.bill_number, 'billDate', v_p.bill_date,
        'billPhotoUrl', v_p.bill_photo_url, 'isVoid', v_p.is_void, 'note', v_p.note, 'createdBy', v_p.actor_name,
        'location', (select name from public.stock_locations where id = v_p.location_id),
        'subtotal', case when v_cost then v_p.subtotal end, 'tax', case when v_cost then v_p.tax end,
        'total', case when v_cost then v_p.total end, 'paid', case when v_cost then v_p.paid_amount end,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                      'item', i.name, 'unit', i.unit, 'unitName', pl.unit_name, 'factor', pl.factor, 'quantity', pl.quantity,
                      'baseQuantity', pl.base_quantity,
                      'rate', case when v_cost then pl.rate end, 'taxRate', pl.tax_rate,
                      'amount', case when v_cost then pl.amount end,
                      'baseCost', case when v_cost then pl.base_cost end,
                      'changePct', case when v_cost then pl.price_change_pct end) order by i.name), '[]'::jsonb)
                    from public.purchase_lines pl join public.inventory i on i.id = pl.item_id where pl.purchase_id = v_p.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Wastage, staff meals, complimentary, adjustments, transfers
-- ---------------------------------------------------------------------------
-- p: {kind, itemId, locationId, quantity, reason, note, photoUrl}
--   wastage / staff_meal / complimentary: quantity taken out (positive)
--   adjustment: newQuantity (the right amount at that location) or quantity (+/-)
create function public.record_stock_change(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_kind text := p ->> 'kind';
    v_item public.inventory;
    v_loc uuid := nullif(p ->> 'locationId', '')::uuid;
    v_qty numeric;
begin
    if v_kind in ('wastage', 'staff_meal', 'complimentary') then
        perform public.require_perm('inventory.create');
    elsif v_kind = 'adjustment' then
        perform public.require_perm('inventory.edit');
    else
        raise exception 'Unknown stock change';
    end if;
    v_item := public.require_stock_item(nullif(p ->> 'itemId', '')::uuid);
    perform public.require_location(v_loc);
    if v_kind = 'adjustment' then
        if nullif(p ->> 'newQuantity', '') is not null then
            v_qty := (p ->> 'newQuantity')::numeric - public.location_qty(v_item.id, v_loc);
        else
            v_qty := nullif(p ->> 'quantity', '')::numeric;
        end if;
        if trim(coalesce(p ->> 'reason', '')) = '' then
            raise exception 'Give a reason for the adjustment';
        end if;
    else
        v_qty := -abs(coalesce(nullif(p ->> 'quantity', '')::numeric, 0));
    end if;
    if coalesce(v_qty, 0) = 0 then
        raise exception 'Nothing to change';
    end if;
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, reason, note, photo_url, actor_name)
    values (v_item.tenant_id, v_item.id, v_loc, round(v_qty, 3), v_item.cost_per_unit, v_kind,
            trim(coalesce(p ->> 'reason', '')), trim(coalesce(p ->> 'note', '')), coalesce(p ->> 'photoUrl', ''), public.actor_name());
end;
$$;

-- p: {fromId, toId, note, lines: [{itemId, quantity}]}
create function public.transfer_stock(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_from uuid := nullif(p ->> 'fromId', '')::uuid;
    v_to uuid := nullif(p ->> 'toId', '')::uuid;
    v_transfer uuid := gen_random_uuid();
    v_line jsonb;
    v_item public.inventory;
    v_qty numeric;
    v_note text;
begin
    perform public.require_perm('inventory.edit');
    perform public.require_location(v_from);
    perform public.require_location(v_to);
    if v_from = v_to then
        raise exception 'Pick two different locations';
    end if;
    if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
        raise exception 'Add at least one item';
    end if;
    v_note := (select name from public.stock_locations where id = v_from) || ' → ' || (select name from public.stock_locations where id = v_to)
              || coalesce(nullif(' · ' || trim(coalesce(p ->> 'note', '')), ' · '), '');
    for v_line in select * from jsonb_array_elements(p -> 'lines') loop
        v_item := public.require_stock_item(nullif(v_line ->> 'itemId', '')::uuid);
        v_qty := round(coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0), 3);
        if v_qty <= 0 then
            raise exception 'Quantity must be more than 0 for %', v_item.name;
        end if;
        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, transfer_id, note, actor_name)
        values (v_item.tenant_id, v_item.id, v_from, -v_qty, v_item.cost_per_unit, 'transfer', v_transfer, v_note, public.actor_name()),
               (v_item.tenant_id, v_item.id, v_to, v_qty, v_item.cost_per_unit, 'transfer', v_transfer, v_note, public.actor_name());
    end loop;
    return v_transfer;
end;
$$;

-- p: {itemId, kind, locationId, from, to, limit}
create function public.list_stock_moves(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
    v_tz text := public.cafe_timezone();
begin
    perform public.require_perm('inventory.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', m.id, 'createdAt', m.created_at, 'item', i.name, 'itemId', i.id, 'unit', i.unit,
                   'location', l.name, 'quantity', m.quantity, 'kind', m.kind, 'reason', m.reason, 'note', m.note,
                   'photoUrl', m.photo_url, 'by', m.actor_name, 'orderNumber', o.order_number, 'orderId', m.order_id,
                   'purchaseId', m.purchase_id,
                   'unitCost', case when v_cost then m.unit_cost end,
                   'value', case when v_cost then round(m.quantity * m.unit_cost, 2) end)
                   order by m.created_at desc), '[]'::jsonb)
          from (select * from public.stock_moves
                 where tenant_id = public.current_tenant_id()
                   and (nullif(p ->> 'itemId', '') is null or item_id = (p ->> 'itemId')::uuid)
                   and (nullif(p ->> 'locationId', '') is null or location_id = (p ->> 'locationId')::uuid)
                   and (nullif(p ->> 'kind', '') is null or kind = p ->> 'kind'
                        or (p ->> 'kind' = 'sale' and kind = 'sale_reversal')
                        or (p ->> 'kind' = 'purchase' and kind = 'purchase_void'))
                   and (nullif(p ->> 'from', '') is null or (created_at at time zone v_tz)::date >= (p ->> 'from')::date)
                   and (nullif(p ->> 'to', '') is null or (created_at at time zone v_tz)::date <= (p ->> 'to')::date)
                 order by created_at desc
                 limit least(coalesce(nullif(p ->> 'limit', '')::integer, 200), 1000)) m
          join public.inventory i on i.id = m.item_id
          join public.stock_locations l on l.id = m.location_id
          left join public.orders o on o.id = m.order_id);
end;
$$;

-- Which dishes used an ingredient: "Milk: 61% coffees, 22% shakes, 17% chai"
create function public.usage_breakdown(p_item uuid, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_item public.inventory;
begin
    perform public.require_perm('inventory.view');
    select * into v_item from public.inventory where id = p_item and tenant_id = public.current_tenant_id();
    if v_item.id is null then
        raise exception 'Stock item not found';
    end if;
    return (
        with used as (
            select case when m.kind in ('sale', 'sale_reversal') then coalesce(mi.name, 'Deleted menu item')
                        when m.kind = 'wastage' then 'Wastage'
                        when m.kind = 'staff_meal' then 'Staff meals'
                        else 'Complimentary' end as label,
                   m.kind in ('sale', 'sale_reversal') as is_sale,
                   -sum(m.quantity) as qty
              from public.stock_moves m
              left join public.menu_items mi on mi.id = m.menu_item_id
             where m.item_id = p_item and m.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
               and m.kind in ('sale', 'sale_reversal', 'wastage', 'staff_meal', 'complimentary')
             group by 1, 2
            having -sum(m.quantity) > 0),
        total as (select sum(qty) as t from used)
        select jsonb_build_object(
            'item', v_item.name, 'unit', v_item.unit, 'days', p_days,
            'total', coalesce((select round(t, 3) from total), 0),
            'rows', coalesce(jsonb_agg(jsonb_build_object('label', label, 'isSale', is_sale, 'quantity', round(qty, 3),
                                                          'pct', round(qty * 100 / nullif((select t from total), 0), 1))
                                       order by qty desc), '[]'::jsonb))
          from used);
end;
$$;

-- ---------------------------------------------------------------------------
-- Counts
-- ---------------------------------------------------------------------------
-- One open count per location. scope: daily items / daily + weekly / everything tracked
create function public.start_count(p_location uuid, p_scope text default 'all') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_id uuid;
begin
    perform public.require_perm('inventory.create');
    perform public.require_location(p_location);
    select id into v_id from public.stock_counts where location_id = p_location and status = 'open';
    if v_id is not null then
        return v_id;
    end if;
    insert into public.stock_counts (tenant_id, location_id, scope, started_by)
    values (v_tenant, p_location, coalesce(nullif(p_scope, ''), 'all'), public.actor_name())
    returning id into v_id;
    insert into public.stock_count_lines (tenant_id, count_id, item_id, expected, unit_cost)
    select v_tenant, v_id, i.id, public.location_qty(i.id, p_location), i.cost_per_unit
      from public.inventory i
     where i.tenant_id = v_tenant and i.is_active and i.track_stock and i.count_frequency <> 'never'
       and (p_scope = 'all' or i.count_frequency = 'daily' or (p_scope = 'weekly' and i.count_frequency = 'weekly'))
       and (exists (select 1 from public.stock_levels sl where sl.item_id = i.id and sl.location_id = p_location and sl.quantity <> 0)
            or exists (select 1 from public.stock_moves sm where sm.item_id = i.id and sm.location_id = p_location)
            or (select default_for_sales or receives_purchases from public.stock_locations where id = p_location));
    return v_id;
end;
$$;

create function public.get_count(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
    v_c public.stock_counts;
begin
    perform public.require_perm('inventory.view');
    select * into v_c from public.stock_counts where id = p_id and tenant_id = public.current_tenant_id();
    if v_c.id is null then
        raise exception 'Count not found';
    end if;
    return jsonb_build_object(
        'id', v_c.id, 'status', v_c.status, 'scope', v_c.scope, 'locationId', v_c.location_id,
        'location', (select name from public.stock_locations where id = v_c.location_id),
        'startedBy', v_c.started_by, 'postedBy', v_c.posted_by, 'createdAt', v_c.created_at, 'postedAt', v_c.posted_at,
        'varianceValue', case when v_cost then v_c.variance_value end,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                      'itemId', i.id, 'name', i.name, 'unit', i.unit, 'category', i.category, 'shelfOrder', i.shelf_order,
                      'units', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'factor', s.factor) order by s.factor), '[]'::jsonb)
                                  from public.stock_units s where s.item_id = i.id),
                      'expected', case when v_c.status = 'open' and cl.counted is null
                                       then public.location_qty(i.id, v_c.location_id) else cl.expected end,
                      'counted', cl.counted,
                      'variance', case when cl.counted is not null then cl.counted - cl.expected end,
                      'value', case when v_cost and cl.counted is not null then round((cl.counted - cl.expected) * cl.unit_cost, 2) end)
                      order by i.shelf_order, i.name), '[]'::jsonb)
                    from public.stock_count_lines cl join public.inventory i on i.id = cl.item_id
                   where cl.count_id = v_c.id));
end;
$$;

-- p_lines: [{itemId, counted}] — counted null clears the line. The expected quantity is
-- taken at the moment each line is saved, so sales during the count don't show as loss.
create function public.save_count(p_id uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_c public.stock_counts;
    v_line jsonb;
    v_item uuid;
    v_counted numeric;
begin
    perform public.require_perm('inventory.create');
    select * into v_c from public.stock_counts where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_c.id is null or v_c.status <> 'open' then
        raise exception 'This count is closed';
    end if;
    for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        v_item := nullif(v_line ->> 'itemId', '')::uuid;
        v_counted := nullif(v_line ->> 'counted', '')::numeric;
        if v_counted is not null and v_counted < 0 then
            raise exception 'Counted quantity cannot be negative';
        end if;
        if not exists (select 1 from public.inventory where id = v_item and tenant_id = v_c.tenant_id) then
            raise exception 'Stock item not found';
        end if;
        insert into public.stock_count_lines (tenant_id, count_id, item_id, expected, counted, unit_cost)
        values (v_c.tenant_id, p_id, v_item, public.location_qty(v_item, v_c.location_id), round(v_counted, 3),
                (select cost_per_unit from public.inventory where id = v_item))
        on conflict (count_id, item_id) do update
           set counted = excluded.counted,
               expected = case when public.stock_count_lines.counted is distinct from excluded.counted
                               then excluded.expected else public.stock_count_lines.expected end,
               unit_cost = excluded.unit_cost;
    end loop;
end;
$$;

-- Variance = counted − expected; the stock is corrected by that much and the ₹ value is recorded
create function public.post_count(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_c public.stock_counts;
    v_value numeric;
    v_lines integer;
    v_off integer;
begin
    perform public.require_perm('inventory.edit');
    select * into v_c from public.stock_counts where id = p_id and tenant_id = public.current_tenant_id() for update;
    if v_c.id is null or v_c.status <> 'open' then
        raise exception 'This count is closed';
    end if;
    select count(*) filter (where counted is not null), count(*) filter (where counted is not null and counted <> expected),
           coalesce(sum((counted - expected) * unit_cost) filter (where counted is not null), 0)
      into v_lines, v_off, v_value
      from public.stock_count_lines where count_id = p_id;
    if v_lines = 0 then
        raise exception 'Enter at least one counted quantity';
    end if;
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, count_id, note, actor_name)
    select v_c.tenant_id, cl.item_id, v_c.location_id, cl.counted - cl.expected, cl.unit_cost, 'count', p_id,
           'Counted ' || cl.counted || ', expected ' || cl.expected, public.actor_name()
      from public.stock_count_lines cl
     where cl.count_id = p_id and cl.counted is not null and cl.counted <> cl.expected;
    update public.stock_counts
       set status = 'posted', posted_by = public.actor_name(), posted_at = now(), variance_value = round(v_value, 2)
     where id = p_id;
    perform public.audit_event(v_c.tenant_id, 'stock_counts', p_id::text,
        'Count posted: ' || (select name from public.stock_locations where id = v_c.location_id) || ', ' || v_lines
        || ' items, ' || v_off || ' off, variance ₹' || round(v_value, 2));
    return jsonb_build_object('items', v_lines, 'itemsOff', v_off,
                              'varianceValue', case when public.has_perm('sensitive.see_cost') then round(v_value, 2) end);
end;
$$;

create function public.cancel_count(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('inventory.edit');
    update public.stock_counts set status = 'cancelled'
     where id = p_id and tenant_id = public.current_tenant_id() and status = 'open';
    if not found then
        raise exception 'This count is closed';
    end if;
end;
$$;

create function public.list_counts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
begin
    perform public.require_perm('inventory.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', c.id, 'status', c.status, 'scope', c.scope, 'location', l.name, 'locationId', c.location_id,
                   'startedBy', c.started_by, 'postedBy', c.posted_by, 'createdAt', c.created_at, 'postedAt', c.posted_at,
                   'lines', (select count(*) from public.stock_count_lines where count_id = c.id),
                   'counted', (select count(*) from public.stock_count_lines where count_id = c.id and counted is not null),
                   'varianceValue', case when v_cost then c.variance_value end)
                   order by c.created_at desc), '[]'::jsonb)
          from (select * from public.stock_counts where tenant_id = public.current_tenant_id()
                 order by created_at desc limit 60) c
          join public.stock_locations l on l.id = c.location_id);
end;
$$;

-- Where stock went missing: count variance and wastage per item over the last N days (₹ lost first)
create function public.stock_leaks(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
begin
    perform public.require_perm('inventory.view');
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'itemId', item_id, 'item', name, 'unit', unit,
                   'countVariance', count_qty, 'wastage', waste_qty,
                   'countValue', case when v_cost then round(count_value, 2) end,
                   'wastageValue', case when v_cost then round(waste_value, 2) end,
                   'lostValue', case when v_cost then round(least(count_value, 0) - waste_value, 2) end)
                   order by least(count_value, 0) - waste_value, count_qty), '[]'::jsonb)
          from (select m.item_id, i.name, i.unit,
                       coalesce(sum(m.quantity) filter (where m.kind = 'count'), 0) as count_qty,
                       coalesce(sum(m.quantity * m.unit_cost) filter (where m.kind = 'count'), 0) as count_value,
                       coalesce(-sum(m.quantity) filter (where m.kind = 'wastage'), 0) as waste_qty,
                       coalesce(-sum(m.quantity * m.unit_cost) filter (where m.kind = 'wastage'), 0) as waste_value
                  from public.stock_moves m join public.inventory i on i.id = m.item_id
                 where m.tenant_id = public.current_tenant_id()
                   and m.kind in ('count', 'wastage')
                   and m.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
                 group by m.item_id, i.name, i.unit) s
         where count_qty < 0 or waste_qty > 0);
end;
$$;

-- Dashboard card: what to reorder and the biggest leaks this week
create function public.inventory_alerts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_stock jsonb;
begin
    perform public.require_perm('inventory.view');
    v_stock := public.stock_overview(null);
    return jsonb_build_object(
        'reorderCount', (select count(*) from jsonb_array_elements(v_stock) x where (x ->> 'reorder')::boolean),
        'reorder', (select coalesce(jsonb_agg(x order by coalesce((x ->> 'daysLeft')::numeric, 0)), '[]'::jsonb)
                      from (select x from jsonb_array_elements(v_stock) x where (x ->> 'reorder')::boolean
                             order by coalesce((x ->> 'daysLeft')::numeric, 0) limit 5) s),
        'leaks', (select coalesce(jsonb_agg(x), '[]'::jsonb)
                    from (select x from jsonb_array_elements(public.stock_leaks(7)) x limit 5) s),
        'negative', (select count(*) from jsonb_array_elements(v_stock) x
                      where (x ->> 'trackStock')::boolean and (x ->> 'totalQuantity')::numeric < 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Recipes and menu costing
-- ---------------------------------------------------------------------------
create function public.get_recipe(p_menu_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_cost boolean := public.has_perm('sensitive.see_cost');
    v_m public.menu_items;
begin
    if not (public.has_perm('menu.view') or public.has_perm('inventory.view')) then
        raise exception 'Not authorized';
    end if;
    select * into v_m from public.menu_items where id = p_menu_item and tenant_id = public.current_tenant_id();
    if v_m.id is null then
        raise exception 'Menu item not found';
    end if;
    return jsonb_build_object(
        'menuItemId', v_m.id, 'name', v_m.name, 'price', v_m.price, 'itemType', v_m.item_type,
        'stockLocationId', v_m.stock_location_id,
        'saleLocation', (select name from public.stock_locations where id = public.sale_location(v_m.id)),
        'cost', case when v_cost then round(public.recipe_cost(v_m.id), 2) end,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                      'itemId', i.id, 'name', i.name, 'unit', i.unit, 'quantity', r.quantity, 'wastePct', r.waste_pct,
                      'avgCost', case when v_cost then i.cost_per_unit end,
                      'cost', case when v_cost then round(r.quantity * (1 + r.waste_pct / 100) * i.cost_per_unit, 2) end)
                      order by r.sort_order, i.name), '[]'::jsonb)
                    from public.recipe_lines r join public.inventory i on i.id = r.item_id
                   where r.menu_item_id = v_m.id));
end;
$$;

-- p_lines: [{itemId, quantity, wastePct}] (replaces the recipe); p_location: '' = automatic
create function public.save_recipe(p_menu_item uuid, p_lines jsonb, p_location text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_m public.menu_items;
    v_old jsonb;
    v_line jsonb;
    v_n integer := 0;
begin
    perform public.require_perm('menu.edit');
    select * into v_m from public.menu_items where id = p_menu_item and tenant_id = v_tenant for update;
    if v_m.id is null then
        raise exception 'Menu item not found';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('item', i.name, 'quantity', r.quantity, 'unit', i.unit, 'wastePct', r.waste_pct)
                              order by r.sort_order), '[]'::jsonb)
      into v_old
      from public.recipe_lines r join public.inventory i on i.id = r.item_id where r.menu_item_id = p_menu_item;

    delete from public.recipe_lines where menu_item_id = p_menu_item;
    for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        if not exists (select 1 from public.inventory where id = nullif(v_line ->> 'itemId', '')::uuid and tenant_id = v_tenant) then
            raise exception 'Pick an ingredient on every line';
        end if;
        if coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0) <= 0 then
            raise exception 'Quantity must be more than 0 on every line';
        end if;
        v_n := v_n + 1;
        insert into public.recipe_lines (tenant_id, menu_item_id, item_id, quantity, waste_pct, sort_order)
        values (v_tenant, p_menu_item, (v_line ->> 'itemId')::uuid, (v_line ->> 'quantity')::numeric,
                coalesce(nullif(v_line ->> 'wastePct', '')::numeric, 0), v_n)
        on conflict (menu_item_id, item_id) do update
           set quantity = public.recipe_lines.quantity + excluded.quantity;
    end loop;

    if p_location is not null then
        if p_location <> '' then
            perform public.require_location(p_location::uuid);
        end if;
        update public.menu_items set stock_location_id = nullif(p_location, '')::uuid where id = p_menu_item;
    end if;

    perform public.audit_event(v_tenant, 'recipes', p_menu_item::text, 'Recipe: ' || v_m.name || ' (' || v_n || ' ingredients)',
        jsonb_build_object('lines', v_old),
        jsonb_build_object('lines', (select coalesce(jsonb_agg(jsonb_build_object('item', i.name, 'quantity', r.quantity,
                                                                                   'unit', i.unit, 'wastePct', r.waste_pct)
                                                               order by r.sort_order), '[]'::jsonb)
                                       from public.recipe_lines r join public.inventory i on i.id = r.item_id
                                      where r.menu_item_id = p_menu_item)));
    return public.get_recipe(p_menu_item);
end;
$$;

-- Resale product (Coke, cigarettes): create its stock item and a 1-piece recipe in one step
create function public.track_menu_item_stock(p_menu_item uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_m public.menu_items;
    v_item uuid;
begin
    perform public.require_perm('menu.edit');
    perform public.require_perm('inventory.create');
    select * into v_m from public.menu_items where id = p_menu_item and tenant_id = v_tenant;
    if v_m.id is null then
        raise exception 'Menu item not found';
    end if;
    select id into v_item from public.inventory where tenant_id = v_tenant and lower(name) = lower(v_m.name);
    if v_item is null then
        insert into public.inventory (tenant_id, name, category, unit, cost_per_unit, minimum_stock, supplier)
        values (v_tenant, v_m.name, case when v_m.item_type = 'resale' then 'resale' else 'ingredient' end,
                coalesce(nullif(v_m.unit, ''), 'pc'), coalesce(v_m.cost_price, 0), 0, '')
        returning id into v_item;
    end if;
    insert into public.recipe_lines (tenant_id, menu_item_id, item_id, quantity)
    values (v_tenant, p_menu_item, v_item, 1)
    on conflict (menu_item_id, item_id) do nothing;
    return v_item;
end;
$$;

-- Every menu item with its cost, margin and food cost %.
--   net price = price, or price ÷ (1 + tax %) when the price already includes tax
--   margin    = net price − cost;  food cost % = cost ÷ net price × 100
create function public.menu_costing() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_cost boolean := public.has_perm('sensitive.see_cost');
    v_profit boolean := public.has_perm('sensitive.see_profit');
    v_default numeric;
begin
    if not (public.has_perm('menu.view') or public.has_perm('inventory.view')) then
        raise exception 'Not authorized';
    end if;
    select coalesce(sum((c ->> 'rate')::numeric), 0) into v_default
      from jsonb_array_elements(coalesce(public.get_setting('tax_config', '[]', v_tenant), '[]'::jsonb)) c;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'menuItemId', id, 'name', name, 'category', category, 'itemType', item_type, 'price', price,
                   'isAvailable', is_available, 'ingredients', ingredients, 'hasRecipe', ingredients > 0,
                   'costSource', case when ingredients > 0 then 'recipe' when cost_price > 0 then 'manual' else 'none' end,
                   'cost', case when v_cost then round(cost, 2) end,
                   'netPrice', round(net_price, 2),
                   'margin', case when v_profit and cost is not null then round(net_price - cost, 2) end,
                   'foodCostPct', case when v_profit and cost is not null and net_price > 0
                                       then round(cost / net_price * 100, 1) end)
                   order by category nulls last, name), '[]'::jsonb)
          from (select m.id, m.name, c.name as category, m.item_type, m.price, m.is_available, m.cost_price,
                       (select count(*) from public.recipe_lines r where r.menu_item_id = m.id) as ingredients,
                       coalesce(public.recipe_cost(m.id), nullif(m.cost_price, 0)) as cost,
                       case when m.price_includes_tax
                            then m.price / (1 + coalesce((select sum((x ->> 'rate')::numeric)
                                                            from public.tax_groups tg, jsonb_array_elements(tg.components) x
                                                           where tg.id = m.tax_group_id), v_default) / 100)
                            else m.price end as net_price
                  from public.menu_items m
                  left join public.categories c on c.id = m.category_id
                 where m.tenant_id = v_tenant) s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Legacy restock button: now a purchase-type stock entry at the purchase location
-- ---------------------------------------------------------------------------
create or replace function public.restock_inventory(p_id uuid, p_quantity numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_item public.inventory;
begin
    perform public.require_perm('inventory.edit');
    if coalesce(p_quantity, 0) <= 0 then
        raise exception 'Quantity must be positive';
    end if;
    v_item := public.require_stock_item(p_id);
    insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, note, actor_name)
    values (v_item.tenant_id, v_item.id,
            (select id from public.stock_locations where tenant_id = v_item.tenant_id order by receives_purchases desc, sort_order limit 1),
            p_quantity, v_item.cost_per_unit, 'purchase', 'Quick restock', public.actor_name());
end;
$$;

-- ---------------------------------------------------------------------------
-- Global search: + stock items and vendors
-- ---------------------------------------------------------------------------
create or replace function public.global_search(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_q text := lower(trim(coalesce(p_query, '')));
    v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
    v_phone boolean := public.has_perm('sensitive.see_customer_phone');
    v_out jsonb := '{}'::jsonb;
begin
    perform public.require_admin();
    if length(v_q) < 2 then
        return v_out;
    end if;

    if public.has_perm('menu.view') then
        v_out := v_out || jsonb_build_object('items', (
            select coalesce(jsonb_agg(r order by score desc), '[]'::jsonb) from (select r, score from (
                select jsonb_build_object('id', m.id, 'title', m.name,
                         'subtitle', concat_ws(' · ', c.name, b.name, '₹' || m.price), 'available', m.is_available) as r,
                       greatest(word_similarity(v_q, lower(m.name)), similarity(lower(m.name), v_q),
                                case when lower(m.name) like '%' || v_q || '%' then 0.9 else 0 end,
                                case when lower(coalesce(b.name, '')) like '%' || v_q || '%' then 0.6 else 0 end) as score
                  from public.menu_items m
                  left join public.categories c on c.id = m.category_id
                  left join public.brands b on b.id = m.brand_id
                 where m.tenant_id = v_tenant) s
             where score > 0.3 order by score desc limit 8) t));
        v_out := v_out || jsonb_build_object('categories', (
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', name) order by name), '[]'::jsonb) from (
                select id, name from public.categories
                 where tenant_id = v_tenant
                   and (lower(name) like '%' || v_q || '%' or similarity(lower(name), v_q) > 0.35)
                 limit 5) s));
        v_out := v_out || jsonb_build_object('brands', (
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', name) order by name), '[]'::jsonb) from (
                select id, name from public.brands
                 where tenant_id = v_tenant
                   and (lower(name) like '%' || v_q || '%' or similarity(lower(name), v_q) > 0.35)
                 limit 5) s));
    end if;

    if public.has_perm('inventory.view') then
        v_out := v_out || jsonb_build_object('stock', (
            select coalesce(jsonb_agg(r order by score desc), '[]'::jsonb) from (select r, score from (
                select jsonb_build_object('id', i.id, 'title', i.name,
                         'subtitle', concat_ws(' · ', round(i.current_stock, 2) || ' ' || i.unit,
                                               case when i.is_low_stock then 'low' end, v.name)) as r,
                       greatest(word_similarity(v_q, lower(i.name)), similarity(lower(i.name), v_q),
                                case when lower(i.name) like '%' || v_q || '%' then 0.9 else 0 end) as score
                  from public.inventory i left join public.vendors v on v.id = i.vendor_id
                 where i.tenant_id = v_tenant) s
             where score > 0.3 order by score desc limit 6) t));
        v_out := v_out || jsonb_build_object('vendors', (
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', name, 'subtitle', nullif(phone, '')) order by name), '[]'::jsonb)
              from (select id, name, phone from public.vendors
                     where tenant_id = v_tenant
                       and (lower(name) like '%' || v_q || '%' or similarity(lower(name), v_q) > 0.35
                            or (length(v_digits) >= 4 and phone like '%' || v_digits || '%'))
                     limit 5) s));
    end if;

    if public.has_perm('customers.view') then
        v_out := v_out || jsonb_build_object('customers', (
            select coalesce(jsonb_agg(r order by score desc), '[]'::jsonb) from (select r, score from (
                select jsonb_build_object('id', c.id, 'title', c.name,
                         'subtitle', case when v_phone then c.phone else public.mask_phone(c.phone) end
                                     || ' · ' || c.loyalty_points || ' pts') as r,
                       greatest(word_similarity(v_q, lower(c.name)),
                                case when lower(c.name) like '%' || v_q || '%' then 0.9 else 0 end,
                                case when v_phone and length(v_digits) >= 3 and c.phone like '%' || v_digits || '%' then 0.95
                                     when length(v_digits) >= 4 and right(c.phone, length(v_digits)) = v_digits then 0.9
                                     else 0 end) as score
                  from public.customers c where c.tenant_id = v_tenant) s
             where score > 0.3 order by score desc limit 8) t));
    end if;

    if public.has_perm('orders.view') then
        v_out := v_out || jsonb_build_object('orders', (
            select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.order_number,
                       'subtitle', concat_ws(' · ', nullif('Table ' || o.table_number, 'Table '), o.status, '₹' || o.total,
                                             to_char(o.created_at at time zone public.cafe_timezone(), 'DD Mon HH24:MI')))
                       order by o.created_at desc), '[]'::jsonb)
              from (select * from public.orders o
                     where o.tenant_id = v_tenant
                       and (lower(o.order_number) like '%' || v_q || '%'
                            or (length(v_digits) between 1 and 3 and o.table_number = v_digits))
                     order by o.created_at desc limit 8) o));
    end if;

    if public.has_perm('staff.view') then
        v_out := v_out || jsonb_build_object('staff', (
            select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.name, 'subtitle', r.name) order by s.name), '[]'::jsonb)
              from public.staff_users s join public.roles r on r.id = s.role_id
             where s.tenant_id = v_tenant
               and (lower(s.name) like '%' || v_q || '%' or similarity(lower(s.name), v_q) > 0.35)));
    end if;

    return v_out;
end;
$$;

-- Internal helpers are not callable from the browser
revoke execute on function public.sale_location(uuid) from public, anon, authenticated;
revoke execute on function public.location_qty(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_location(uuid) from public, anon, authenticated;
revoke execute on function public.recipe_cost(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Row security. Ledger-type tables are read-only from the browser: every write goes
-- through the functions above, which check permissions and keep the ledger consistent.
-- Raw rows that carry costs also need "See cost prices".
-- ---------------------------------------------------------------------------
drop policy if exists "staff view" on public.inventory;
drop policy if exists "staff create" on public.inventory;
drop policy if exists "staff edit" on public.inventory;
drop policy if exists "staff delete" on public.inventory;

alter table public.stock_locations enable row level security;
alter table public.vendors enable row level security;
alter table public.stock_units enable row level security;
alter table public.stock_levels enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_moves enable row level security;

do $$
declare
    r record;
begin
    -- Plain records: view / create / edit / delete by inventory permission
    for r in select * from (values ('stock_locations'), ('vendors')) v(tbl) loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('inventory.view')))$p$, r.tbl);
        execute format($p$create policy "staff create" on public.%I for insert
            with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('inventory.create')))$p$, r.tbl);
        execute format($p$create policy "staff edit" on public.%I for update
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('inventory.edit')))
            with check (tenant_id = (select public.current_tenant_id()))$p$, r.tbl);
        execute format($p$create policy "staff delete" on public.%I for delete
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('inventory.delete')))$p$, r.tbl);
    end loop;

    -- Read-only without costs
    for r in select * from (values ('stock_units'), ('stock_levels'), ('stock_counts')) v(tbl) loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('inventory.view')))$p$, r.tbl);
    end loop;

    -- Read-only, carries costs
    for r in select * from (values ('inventory'), ('purchases'), ('purchase_lines'), ('stock_moves'), ('stock_count_lines')) v(tbl) loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('inventory.view'))
                   and (select public.has_perm('sensitive.see_cost')))$p$, r.tbl);
    end loop;
end $$;

create policy "staff view" on public.recipe_lines for select
    using (tenant_id = (select public.current_tenant_id())
           and ((select public.has_perm('menu.view')) or (select public.has_perm('inventory.view'))));

-- A location in use can't be deleted (its history stays); deactivate it instead
create function public.stock_locations_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.tenants where id = old.tenant_id)
       and (exists (select 1 from public.stock_moves where location_id = old.id)
            or exists (select 1 from public.purchases where location_id = old.id)
            or exists (select 1 from public.stock_counts where location_id = old.id)) then
        raise exception 'This location has stock history. Turn it off instead of deleting it.';
    end if;
    if exists (select 1 from public.tenants where id = old.tenant_id) and (old.receives_purchases or old.default_for_sales) then
        raise exception 'Make another location the default first';
    end if;
    return old;
end;
$$;
create trigger stock_locations_guard before delete on public.stock_locations
    for each row execute function public.stock_locations_guard();

-- Bill and wastage photos: staff who record purchases or wastage may upload to bills/ and stock/
drop policy if exists "staff upload images" on storage.objects;
create policy "staff upload images" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (public.has_perm('menu.create') or public.has_perm('menu.edit')
                                          or public.has_perm('collections.edit')
                                          or (public.has_perm('inventory.create') and (storage.foldername(name))[1] in ('bills', 'stock'))));
