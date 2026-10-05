-- Brand & look (part 1): the owner uploads the cafe logo to images/brand/.
-- Name, address, phone, tagline, banner text, hours and social links are rows in the settings table
-- (read by everyone for that cafe, written by people with the Settings permission), so no new table is needed.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.
drop policy if exists "staff upload images" on storage.objects;
create policy "staff upload images" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (public.has_perm('menu.create') or public.has_perm('menu.edit')
                                          or public.has_perm('collections.edit')
                                          or (public.has_perm('settings.edit') and (storage.foldername(name))[1] in ('banners', 'brand'))
                                          or (public.has_perm('inventory.create') and (storage.foldername(name))[1] in ('bills', 'stock'))));
