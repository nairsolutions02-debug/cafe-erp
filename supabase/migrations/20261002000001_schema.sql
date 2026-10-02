-- Cafe ERP schema: one Supabase project per cafe.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Settings (key/value, readable by everyone; GST, restaurant info, timezone)
-- ---------------------------------------------------------------------------
create table public.settings (
    key text primary key,
    value jsonb not null,
    description text not null default '',
    updated_at timestamptz not null default now()
);

insert into public.settings (key, value, description) values
    ('gst_rate', '5', 'Default GST rate (%)'),
    ('tax_config', '[{"name":"GST","rate":5}]', 'Taxes applied to new orders'),
    ('restaurant_name', '"Cafe ERP"', 'Name printed on bills'),
    ('restaurant_address', '""', 'Address printed on bills'),
    ('restaurant_phone', '""', 'Phone printed on bills'),
    ('gst_number', '""', 'GSTIN printed on bills'),
    ('profit_margin', '30', 'Estimated profit margin (%) for analytics'),
    ('timezone', '"Asia/Kolkata"', 'Timezone used for daily reports');

-- ---------------------------------------------------------------------------
-- Customers and user profiles
-- ---------------------------------------------------------------------------
create table public.customers (
    id uuid primary key default gen_random_uuid(),
    phone text not null unique check (phone ~ '^[0-9]{10}$'),
    name text not null default '',
    email text not null default '',
    phone_verified boolean not null default false,
    loyalty_points integer not null default 0 check (loyalty_points >= 0),
    total_points_earned integer not null default 0,
    created_at timestamptz not null default now()
);

-- One row per auth user (anonymous customer devices and admin accounts)
create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    role text not null default 'customer' check (role in ('customer', 'admin')),
    customer_id uuid references public.customers (id) on delete set null,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------
create table public.categories (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    image text not null default '',
    description text not null default '',
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table public.menu_items (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text not null default '',
    price numeric(10, 2) not null check (price >= 0),
    image text not null default '',
    category_id uuid references public.categories (id) on delete set null,
    is_veg boolean not null default true,
    is_available boolean not null default true,
    is_best_seller boolean not null default false,
    is_new_item boolean not null default false,
    is_recommended boolean not null default false,
    is_upsell boolean not null default false,
    tags text[] not null default '{}',
    preparation_time integer not null default 15,
    stock_quantity integer not null default -1, -- -1 = unlimited
    bonus_loyalty_points integer not null default 0,
    initial_stock integer not null default 0,
    low_stock_threshold integer not null default 10,
    cost_price numeric(10, 2) not null default 0,
    created_at timestamptz not null default now()
);
create index menu_items_category_idx on public.menu_items (category_id);

create table public.collections (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    icon text not null default '🍽️',
    description text not null default '',
    is_active boolean not null default true,
    show_on_homepage boolean not null default true,
    sort_order integer not null default 0,
    type text not null default 'custom' check (type in ('custom', 'bestseller', 'new', 'recommended')),
    created_at timestamptz not null default now()
);

create table public.collection_items (
    collection_id uuid not null references public.collections (id) on delete cascade,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    position integer not null default 0,
    primary key (collection_id, menu_item_id)
);

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------
create table public.coupons (
    id uuid primary key default gen_random_uuid(),
    code text not null unique check (code = upper(code)),
    description text not null default '',
    discount_type text not null check (discount_type in ('percentage', 'fixed')),
    discount_value numeric(10, 2) not null check (discount_value >= 0),
    min_order_amount numeric(10, 2) not null default 0,
    max_discount numeric(10, 2),
    applicable_items uuid[] not null default '{}',
    applicable_categories uuid[] not null default '{}',
    usage_limit integer not null default -1, -- -1 = unlimited
    used_count integer not null default 0,
    valid_from timestamptz not null,
    valid_until timestamptz not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table public.loyalty_settings (
    id integer primary key default 1 check (id = 1),
    points_per_rupee numeric(10, 4) not null default 1,
    min_order_for_points numeric(10, 2) not null default 100,
    points_to_rupee_ratio numeric(10, 4) not null default 10 check (points_to_rupee_ratio > 0),
    min_points_to_redeem integer not null default 100,
    max_redemption_percent numeric(5, 2) not null default 50,
    is_active boolean not null default true,
    updated_at timestamptz not null default now()
);
insert into public.loyalty_settings (id) values (1);

create table public.loyalty_offers (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text not null default '',
    points_required integer not null check (points_required >= 1),
    discount_value numeric(10, 2) not null check (discount_value >= 0),
    min_order_value numeric(10, 2) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tables and orders
-- ---------------------------------------------------------------------------
create table public.dining_tables (
    id uuid primary key default gen_random_uuid(),
    table_number text not null unique,
    capacity integer not null default 4,
    is_occupied boolean not null default false,
    current_order_id uuid,
    status text not null default 'available' check (status in ('available', 'occupied', 'reserved', 'maintenance')),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.orders (
    id uuid primary key default gen_random_uuid(),
    order_number text not null unique,
    customer_id uuid references public.customers (id) on delete set null,
    subtotal numeric(10, 2) not null,
    discount numeric(10, 2) not null default 0,
    coupon_code text not null default '',
    tax numeric(10, 2) not null default 0,
    gst_rate numeric(5, 2) not null default 5,
    tax_details jsonb not null default '[]',
    restaurant_info jsonb not null default '{}',
    total numeric(10, 2) not null,
    status text not null default 'pending' check (status in (
        'pending', 'confirmed', 'preparing', 'ready', 'served',
        'bill_requested', 'bill_generated', 'paid', 'cancelled')),
    payment_method text not null default 'pending' check (payment_method in ('cash', 'online', 'pending')),
    amount_paid numeric(10, 2) not null default 0,
    table_id uuid references public.dining_tables (id) on delete set null,
    table_number text not null default '',
    special_instructions text not null default '',
    loyalty_offer_id uuid references public.loyalty_offers (id) on delete set null,
    points_redeemed integer not null default 0,
    points_awarded integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_idx on public.orders (status);
create index orders_created_idx on public.orders (created_at desc);

alter table public.dining_tables
    add constraint dining_tables_current_order_fk
    foreign key (current_order_id) references public.orders (id) on delete set null;

create table public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    menu_item_id uuid references public.menu_items (id) on delete set null,
    name text not null,
    price numeric(10, 2) not null,
    quantity integer not null check (quantity >= 1),
    total numeric(10, 2) not null
);
create index order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- Back office
-- ---------------------------------------------------------------------------
create table public.inventory (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    category text not null default 'ingredient' check (category in ('ingredient', 'packaging', 'equipment', 'other')),
    unit text not null,
    current_stock numeric(12, 3) not null default 0,
    minimum_stock numeric(12, 3) not null default 10,
    cost_per_unit numeric(10, 2) not null default 0,
    amount_paid numeric(12, 2) not null default 0,
    payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
    supplier text not null default '',
    last_restocked timestamptz not null default now(),
    is_low_stock boolean generated always as (current_stock <= minimum_stock) stored,
    created_at timestamptz not null default now()
);

create table public.employees (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    phone text not null,
    email text not null default '',
    role text not null default 'waiter' check (role in ('chef', 'waiter', 'cashier', 'manager', 'cleaner', 'other')),
    salary numeric(10, 2) not null default 0,
    joining_date date not null default current_date,
    is_active boolean not null default true,
    address text not null default '',
    emergency_contact text not null default '',
    created_at timestamptz not null default now()
);

create table public.holidays (
    id uuid primary key default gen_random_uuid(),
    date date not null unique,
    name text not null,
    description text not null default '',
    created_at timestamptz not null default now()
);

create table public.attendance (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid not null references public.employees (id) on delete cascade,
    date date not null,
    status text not null default 'present' check (status in ('present', 'absent', 'half-day', 'holiday', 'leave')),
    check_in text not null default '',
    check_out text not null default '',
    notes text not null default '',
    created_at timestamptz not null default now(),
    unique (employee_id, date)
);
