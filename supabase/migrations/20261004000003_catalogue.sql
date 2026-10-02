-- Phase 0 · 3/5: catalogue v2 — sub-categories, brands, item types, units and packs,
-- per-item tax groups, MRP / tax-inclusive pricing, restricted items.

alter table public.categories add column parent_id uuid references public.categories (id) on delete set null;
alter table public.categories add constraint categories_not_own_parent check (parent_id is null or parent_id <> id);

create table public.brands (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

-- A tax group = one or more components, e.g. [{"name":"CGST","rate":2.5},{"name":"SGST","rate":2.5}]
create table public.tax_groups (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    components jsonb not null default '[]' check (jsonb_typeof(components) = 'array'),
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

alter table public.menu_items
    add column brand_id uuid references public.brands (id) on delete set null,
    add column item_type text not null default 'dish' check (item_type in ('dish', 'resale', 'combo')),
    add column unit text not null default 'pc',
    add column mrp numeric(10, 2),
    add column price_includes_tax boolean not null default false,
    add column tax_group_id uuid references public.tax_groups (id) on delete set null,
    add column is_restricted boolean not null default false,
    add column sku text not null default '';

alter table public.menu_items add constraint menu_items_price_within_mrp check (mrp is null or price <= mrp);

-- Pack units: 1 Pack = 10 pieces, 1 Crate = 24 bottles
create table public.item_units (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    name text not null,
    factor numeric(12, 3) not null check (factor > 0),
    sale_price numeric(10, 2),
    created_at timestamptz not null default now(),
    unique (menu_item_id, name)
);

-- Order lines remember how they were taxed and whether they were restricted
alter table public.order_items
    add column is_restricted boolean not null default false,
    add column price_includes_tax boolean not null default false,
    add column tax_rate numeric(6, 3) not null default 0,
    add column discount numeric(10, 2) not null default 0,
    add column net_amount numeric(10, 2) not null default 0,
    add column tax_amount numeric(10, 2) not null default 0,
    add column unit_cost numeric(10, 2) not null default 0;

-- Older orders: the line total is the best available net amount
update public.order_items set net_amount = total;

create index menu_items_name_trgm on public.menu_items using gin (name extensions.gin_trgm_ops);
create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);
