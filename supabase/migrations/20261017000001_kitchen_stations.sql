-- Kitchen stations: each menu category belongs to the hot kitchen, the coffee bar or the cold counter,
-- so a phone at the coffee bar can show only drinks. Sub-categories with no station follow their parent.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

alter table public.categories add column if not exists kitchen_station text
    check (kitchen_station is null or kitchen_station in ('hot', 'bar', 'cold'));

-- First guess from the category name; the owner can change it under Menu, Categories
update public.categories
   set kitchen_station = case
        when name ~* '(coffee|tea|chai|shake|juice|drink|beverage|latte|mocktail|smoothie|lassi|soda|brew|frapp|cooler|lemonade|bar)' then 'bar'
        when name ~* '(dessert|ice ?cream|cake|brownie|sweet|pastr|bakery|waffle|kulfi|gelato)' then 'cold'
        when parent_id is null then 'hot'
        else null end
 where kitchen_station is null;

-- The station of one menu item: its category, else the parent category, else the hot kitchen
create or replace function public.item_station(p_menu_item uuid) returns text
language sql stable set search_path = public, pg_temp as $$
    select coalesce((select coalesce(c.kitchen_station, p.kitchen_station)
                       from public.menu_items mi
                       left join public.categories c on c.id = mi.category_id
                       left join public.categories p on p.id = c.parent_id
                      where mi.id = p_menu_item), 'hot');
$$;

create or replace function public.kitchen_orders() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
                                                                 'station', public.item_station(oi.menu_item_id)) order by oi.name)
                               from public.order_items oi where oi.order_id = o.id))
                   order by o.created_at), '[]'::jsonb)
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where o.tenant_id = public.current_tenant_id()
           and o.status <> 'cancelled' and o.channel <> 'kiosk' and not o.held
           and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.kitchen_status <> 'served')
           and o.created_at > now() - interval '24 hours');
end;
$$;
