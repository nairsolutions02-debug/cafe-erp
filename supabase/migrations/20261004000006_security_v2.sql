-- Phase 0 · 6/6: row level security per cafe and per permission.
-- Public pages read the cafe in the x-tenant-slug header; staff read only their own cafe,
-- and only what their role allows.

-- Drop every existing policy on public tables
do $$
declare
    r record;
begin
    for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
        execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    end loop;
end $$;

alter table public.plans enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_payments enable row level security;
alter table public.platform_admins enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_users enable row level security;
alter table public.staff_overrides enable row level security;
alter table public.terms_versions enable row level security;
alter table public.acceptances enable row level security;
alter table public.audit_log enable row level security;
alter table public.brands enable row level security;
alter table public.tax_groups enable row level security;
alter table public.item_units enable row level security;

-- ---------------------------------------------------------------------------
-- Standard policies: staff of the cafe, by module permission
-- ---------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in select * from (values
        ('inventory', 'inventory'), ('employees', 'employees'), ('holidays', 'employees'),
        ('attendance', 'employees'), ('roles', 'staff')) v(tbl, module) loop
        execute format($p$create policy "staff view" on public.%I for select
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.view');
        execute format($p$create policy "staff create" on public.%I for insert
            with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.create');
        execute format($p$create policy "staff edit" on public.%I for update
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))
            with check (tenant_id = (select public.current_tenant_id()))$p$, r.tbl, r.module || '.edit');
        execute format($p$create policy "staff delete" on public.%I for delete
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.delete');
    end loop;
end $$;

-- Attendance upsert (mark attendance) counts as an edit, so allow insert with edit too
create policy "staff mark" on public.attendance for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('employees.edit')));

-- ---------------------------------------------------------------------------
-- Public catalogue: readable for the cafe being viewed; written by staff with permission
-- ---------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in select * from (values
        ('menu_items', 'menu', 'true'),
        ('brands', 'menu', 'true'),
        ('tax_groups', 'menu', 'true'),
        ('item_units', 'menu', 'true'),
        ('categories', 'menu', 'is_active'),
        ('collections', 'collections', 'true'),
        ('dining_tables', 'tables', 'true'),
        ('loyalty_settings', 'rewards', 'true'),
        ('loyalty_offers', 'rewards', 'is_active'),
        ('coupons', 'coupons', 'is_active and valid_from <= now() and valid_until >= now()')) v(tbl, module, public_filter) loop
        execute format($p$create policy "public read" on public.%I for select
            using (tenant_id = (select public.view_tenant_id())
                   and ((%s) or (select public.has_perm(%L))))$p$, r.tbl, r.public_filter, r.module || '.view');
        execute format($p$create policy "staff create" on public.%I for insert
            with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.create');
        execute format($p$create policy "staff edit" on public.%I for update
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))
            with check (tenant_id = (select public.current_tenant_id()))$p$, r.tbl, r.module || '.edit');
        execute format($p$create policy "staff delete" on public.%I for delete
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm(%L)))$p$, r.tbl, r.module || '.delete');
    end loop;
end $$;

-- Settings: public read (bill details, GST); one permission for writing
create policy "public read" on public.settings for select
    using (tenant_id = (select public.view_tenant_id()));
create policy "staff write" on public.settings for insert
    with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('settings.edit')));
create policy "staff edit" on public.settings for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('settings.edit')))
    with check (tenant_id = (select public.current_tenant_id()));

-- Collection items follow their collection
create policy "public read" on public.collection_items for select
    using (exists (select 1 from public.collections c where c.id = collection_id));
create policy "staff write" on public.collection_items for all
    using (exists (select 1 from public.collections c where c.id = collection_id
                    and c.tenant_id = (select public.current_tenant_id()))
           and (select public.has_perm('collections.edit')))
    with check (exists (select 1 from public.collections c where c.id = collection_id
                         and c.tenant_id = (select public.current_tenant_id()))
                and (select public.has_perm('collections.edit')));

-- ---------------------------------------------------------------------------
-- Customers and orders
-- ---------------------------------------------------------------------------
create policy "own or staff" on public.customers for select
    using (id = (select public.current_customer_id())
           or (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('customers.view'))));
create policy "staff edit" on public.customers for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('customers.edit')))
    with check (tenant_id = (select public.current_tenant_id()));

create policy "own" on public.profiles for select using (id = auth.uid());

create policy "own or staff" on public.orders for select
    using (customer_id = (select public.current_customer_id())
           or (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.view'))));
create policy "staff edit" on public.orders for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
create policy "staff delete" on public.orders for delete
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.delete')));

create policy "via order" on public.order_items for select
    using (exists (select 1 from public.orders o where o.id = order_id));

-- ---------------------------------------------------------------------------
-- Staff, roles, permissions
-- ---------------------------------------------------------------------------
create policy "staff view" on public.staff_users for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.view')));
create policy "staff edit" on public.staff_users for update
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.edit')))
    with check (tenant_id = (select public.current_tenant_id()));
-- Creating staff goes through create_staff() (hashes the PIN)

create policy "staff view" on public.role_permissions for select
    using (exists (select 1 from public.roles r where r.id = role_id));
create policy "staff write" on public.role_permissions for all
    using (exists (select 1 from public.roles r where r.id = role_id
                    and r.tenant_id = (select public.current_tenant_id()) and not r.is_owner)
           and (select public.has_perm('staff.edit')))
    with check (exists (select 1 from public.roles r where r.id = role_id
                         and r.tenant_id = (select public.current_tenant_id()) and not r.is_owner)
                and (select public.has_perm('staff.edit')));

create policy "staff view" on public.staff_overrides for select
    using (exists (select 1 from public.staff_users s where s.id = staff_id));
create policy "staff write" on public.staff_overrides for all
    using (exists (select 1 from public.staff_users s where s.id = staff_id
                    and s.tenant_id = (select public.current_tenant_id()))
           and (select public.has_perm('staff.edit')))
    with check (exists (select 1 from public.staff_users s where s.id = staff_id
                         and s.tenant_id = (select public.current_tenant_id()))
                and (select public.has_perm('staff.edit')));

-- The Owner role can't be edited or deleted (it always has everything)
create or replace function public.protect_owner_role() returns trigger
language plpgsql as $$
begin
    -- Deleting a whole cafe cascades here after the cafe row is gone
    if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
        return old;
    end if;
    if old.is_owner then
        raise exception 'The Owner role cannot be changed or deleted';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger protect_owner_role before update or delete on public.roles
    for each row execute function public.protect_owner_role();

-- ---------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------
create policy "read" on public.plans for select using (true);
create policy "platform write" on public.plans for all
    using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "own cafe or platform" on public.tenants for select
    using (id = (select public.current_tenant_id()) or (select public.is_platform_admin()));

create policy "read" on public.terms_versions for select using (true);
create policy "platform write" on public.terms_versions for insert with check ((select public.is_platform_admin()));

create policy "own or staff" on public.acceptances for select
    using (user_id = auth.uid()
           or (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('staff.view')))
           or (select public.is_platform_admin()));

create policy "audit view" on public.audit_log for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('audit.view')));

-- ---------------------------------------------------------------------------
-- Images bucket: staff who can edit the menu or homepage sections
-- ---------------------------------------------------------------------------
drop policy if exists "admin upload images" on storage.objects;
drop policy if exists "admin update images" on storage.objects;
drop policy if exists "admin delete images" on storage.objects;

create policy "staff upload images" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (public.has_perm('menu.create') or public.has_perm('menu.edit')
                                          or public.has_perm('collections.edit')));
create policy "staff update images" on storage.objects for update to authenticated
    using (bucket_id = 'images' and (public.has_perm('menu.edit') or public.has_perm('collections.edit')));
create policy "staff delete images" on storage.objects for delete to authenticated
    using (bucket_id = 'images' and public.has_perm('menu.delete'));

