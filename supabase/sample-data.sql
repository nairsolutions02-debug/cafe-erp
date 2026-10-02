-- Optional demo data for a cafe. Paste into the Supabase SQL editor (or psql) once.
-- Change 'default' below to the cafe's slug to load it into another cafe.

with t as (select id from public.tenants where slug = 'default')
insert into public.categories (tenant_id, name, description, sort_order)
select t.id, v.name, v.description, v.sort_order from t, (values
    ('Hot Beverages', 'Tea and coffee', 1),
    ('Cold Beverages', 'Shakes and coolers', 2),
    ('Snacks', 'Quick bites', 3),
    ('Desserts', 'Something sweet', 4)
) as v(name, description, sort_order)
on conflict (tenant_id, name) do nothing;

with t as (select id from public.tenants where slug = 'default')
insert into public.menu_items (tenant_id, name, description, price, category_id, is_veg, is_best_seller, is_new_item, is_recommended, is_upsell)
select t.id, v.name, v.description, v.price, c.id, v.is_veg, v.best, v.new, v.rec, v.upsell
from t, (values
    ('Masala Chai', 'Ginger and cardamom tea', 30, 'Hot Beverages', true, true, false, false, false),
    ('Filter Coffee', 'South Indian style', 40, 'Hot Beverages', true, true, false, false, false),
    ('Cold Coffee', 'With ice cream', 90, 'Cold Beverages', true, false, true, true, false),
    ('Fresh Lime Soda', 'Sweet or salted', 60, 'Cold Beverages', true, false, false, true, false),
    ('Water Bottle', '500 ml', 20, 'Cold Beverages', true, false, false, false, true),
    ('Veg Sandwich', 'Grilled, with chutney', 80, 'Snacks', true, true, false, false, false),
    ('Paneer Roll', 'Spicy paneer tikka wrap', 110, 'Snacks', true, false, true, false, false),
    ('Chicken Puff', 'Flaky pastry', 50, 'Snacks', false, false, false, false, false),
    ('Brownie', 'Warm chocolate brownie', 90, 'Desserts', true, false, true, true, false)
) as v(name, description, price, category, is_veg, best, new, rec, upsell)
join public.categories c on c.name = v.category and c.tenant_id = (select id from t)
where not exists (select 1 from public.menu_items m where m.tenant_id = t.id and m.name = v.name);

with t as (select id from public.tenants where slug = 'default')
insert into public.collections (tenant_id, name, icon, type, sort_order)
select t.id, v.name, v.icon, v.type, v.sort_order from t, (values
    ('Bestsellers', '⭐', 'bestseller', 1),
    ('New Arrivals', '✨', 'new', 2)
) as v(name, icon, type, sort_order)
where not exists (select 1 from public.collections c where c.tenant_id = t.id and c.type = v.type);

with t as (select id from public.tenants where slug = 'default')
insert into public.dining_tables (tenant_id, table_number, capacity)
select t.id, n::text, 4 from t, generate_series(1, 6) n
on conflict (tenant_id, table_number) do nothing;
