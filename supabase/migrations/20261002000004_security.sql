-- Row level security, storage bucket and realtime.

alter table public.settings enable row level security;
alter table public.customers enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.coupons enable row level security;
alter table public.loyalty_settings enable row level security;
alter table public.loyalty_offers enable row level security;
alter table public.dining_tables enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory enable row level security;
alter table public.employees enable row level security;
alter table public.holidays enable row level security;
alter table public.attendance enable row level security;

-- Public catalogue: anyone can read, only admins write
create policy "public read" on public.settings for select using (true);
create policy "public read" on public.menu_items for select using (true);
create policy "public read" on public.collections for select using (true);
create policy "public read" on public.collection_items for select using (true);
create policy "public read" on public.loyalty_settings for select using (true);
create policy "public read" on public.dining_tables for select using (true);
create policy "public read" on public.categories for select using (is_active or public.is_admin());
create policy "public read" on public.loyalty_offers for select using (is_active or public.is_admin());
create policy "public read" on public.coupons for select
    using ((is_active and valid_from <= now() and valid_until >= now()) or public.is_admin());

create policy "admin write" on public.settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.menu_items for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.collections for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.collection_items for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.loyalty_settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.dining_tables for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.loyalty_offers for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.coupons for all using (public.is_admin()) with check (public.is_admin());

-- Customers see only their own data; changes go through functions
create policy "own or admin" on public.customers for select
    using (id = public.current_customer_id() or public.is_admin());
create policy "admin write" on public.customers for all using (public.is_admin()) with check (public.is_admin());

create policy "own or admin" on public.profiles for select using (id = auth.uid() or public.is_admin());

create policy "own or admin" on public.orders for select
    using (customer_id = public.current_customer_id() or public.is_admin());
create policy "admin write" on public.orders for update using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.orders for delete using (public.is_admin());

create policy "own or admin" on public.order_items for select
    using (exists (select 1 from public.orders o where o.id = order_id
                    and (o.customer_id = public.current_customer_id() or public.is_admin())));

-- Back office: admins only
create policy "admin only" on public.inventory for all using (public.is_admin()) with check (public.is_admin());
create policy "admin only" on public.employees for all using (public.is_admin()) with check (public.is_admin());
create policy "admin only" on public.holidays for all using (public.is_admin()) with check (public.is_admin());
create policy "admin only" on public.attendance for all using (public.is_admin()) with check (public.is_admin());

-- Images (menu items, categories): public bucket, admins upload
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "admin upload images" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and public.is_admin());
create policy "admin update images" on storage.objects for update to authenticated
    using (bucket_id = 'images' and public.is_admin());
create policy "admin delete images" on storage.objects for delete to authenticated
    using (bucket_id = 'images' and public.is_admin());

-- Live updates for the order board, order tracking and table status
alter publication supabase_realtime add table public.orders, public.dining_tables;
