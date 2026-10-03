-- Separate menus for the main shop and the kiosk: each item says where it is sold.
-- Both are on by default, so nothing changes until the owner switches items off for one place.
alter table public.menu_items
    add column sold_in_shop boolean not null default true,   -- counter, dine-in, takeaway and the customer QR menu
    add column sold_at_kiosk boolean not null default true;

-- An order line must be for an item sold where the order is taken (aggregator imports are exempt)
create function public.order_items_sold_here() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_channel text;
    v_shop boolean;
    v_kiosk boolean;
    v_name text;
begin
    if new.menu_item_id is null then
        return new;
    end if;
    select channel into v_channel from public.orders where id = new.order_id;
    select sold_in_shop, sold_at_kiosk, name into v_shop, v_kiosk, v_name from public.menu_items where id = new.menu_item_id;
    if v_channel = 'kiosk' and not v_kiosk then
        raise exception '% is not sold at the kiosk', v_name;
    end if;
    if v_channel in ('qr', 'dine_in', 'takeaway') and not v_shop then
        raise exception '% is sold only at the kiosk', v_name;
    end if;
    return new;
end;
$$;
create trigger order_items_sold_here before insert on public.order_items
    for each row execute function public.order_items_sold_here();

create or replace function public.kiosk_items() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_loc uuid := (select id from public.stock_locations where tenant_id = public.current_tenant_id() and default_for_kiosk);
begin
    perform public.require_perm('orders.create');
    return (
        select coalesce(jsonb_agg(x order by (x ->> 'sold')::numeric desc, x ->> 'name'), '[]'::jsonb) from (
            select jsonb_build_object(
                'id', m.id, 'name', m.name, 'price', m.price, 'isRestricted', m.is_restricted, 'isVeg', m.is_veg,
                'categoryId', m.category_id, 'brandId', m.brand_id, 'brand', b.name, 'category', c.name,
                'taxGroupId', m.tax_group_id, 'priceIncludesTax', m.price_includes_tax,
                'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'factor', u.factor,
                                                                       'price', coalesce(u.sale_price, round(m.price * u.factor, 2))) order by u.factor)
                                     from public.item_units u where u.menu_item_id = m.id), '[]'::jsonb),
                'sold', coalesce((select sum(oi.quantity * oi.unit_factor) from public.order_items oi join public.orders o on o.id = oi.order_id
                                   where oi.menu_item_id = m.id and o.channel = 'kiosk' and o.status <> 'cancelled'
                                     and o.created_at > now() - interval '30 days'), 0),
                'left', (select floor(min(coalesce(sl.quantity, 0) / r.quantity)) from public.recipe_lines r
                           join public.inventory i on i.id = r.item_id and i.track_stock
                           left join public.stock_levels sl on sl.item_id = r.item_id and sl.location_id = v_loc
                          where r.menu_item_id = m.id),
                'low', exists (select 1 from public.recipe_lines r join public.stock_levels sl on sl.item_id = r.item_id and sl.location_id = v_loc
                                where r.menu_item_id = m.id and sl.min_quantity > 0 and sl.quantity <= sl.min_quantity)) x
              from public.menu_items m
              left join public.brands b on b.id = m.brand_id
              left join public.categories c on c.id = m.category_id
             where m.tenant_id = v_tenant and m.is_available and m.sold_at_kiosk) s);
end;
$$;
