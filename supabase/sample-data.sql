-- Optional demo data for a new cafe. Paste into the Supabase SQL editor
-- (or psql) once; safe to skip for a real cafe.

insert into public.categories (name, description, sort_order) values
    ('Hot Beverages', 'Tea and coffee', 1),
    ('Cold Beverages', 'Shakes and coolers', 2),
    ('Snacks', 'Quick bites', 3),
    ('Desserts', 'Something sweet', 4)
on conflict (name) do nothing;

insert into public.menu_items (name, description, price, category_id, is_veg, is_best_seller, is_new_item, is_recommended, is_upsell)
select v.name, v.description, v.price, c.id, v.is_veg, v.best, v.new, v.rec, v.upsell
from (values
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
join public.categories c on c.name = v.category
where not exists (select 1 from public.menu_items m where m.name = v.name);

insert into public.collections (name, icon, type, sort_order) values
    ('Bestsellers', '⭐', 'bestseller', 1),
    ('New Arrivals', '✨', 'new', 2)
on conflict do nothing;

insert into public.dining_tables (table_number, capacity)
select n::text, 4 from generate_series(1, 6) n
on conflict (table_number) do nothing;
