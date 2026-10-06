-- Cafe ERP · Customer app redesign: sizes, choices, combos, favourites, looks upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261030000001_cx_redesign.sql ====
-- Customer app redesign: dish sizes, choice groups (milk, sugar, flavours), goes well with, dish details,
-- combos, favourites, the usual order, banner art and words in three languages, and the look settings.
-- Prices are always worked out here on the server from what the customer picked.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

-- ---------------------------------------------------------------------------
-- Menu: sizes, choice groups, pairs, details
--   sizes:   [{id, name, nameHi, amount, price, isDefault}]  price is the full price of that size
--   details: {calories, caffeine, allergens, ingredients, served, art, show: {rating, prep, calories, caffeine,
--             allergens, ingredients, pairs, combo, veg, points}}
-- ---------------------------------------------------------------------------
alter table public.menu_items add column if not exists sizes jsonb not null default '[]'::jsonb;
alter table public.menu_items add column if not exists option_groups uuid[] not null default '{}';
alter table public.menu_items add column if not exists pairs uuid[] not null default '{}';
alter table public.menu_items add column if not exists details jsonb not null default '{}'::jsonb;

-- A choice group is shared by many dishes (Milk, Sugar, Ice, Flavour, Extra shot)
--   pick one:  exactly one choice (the default when the customer picks nothing)
--   pick many: from min_pick to max_pick choices, each choice may cost extra
--   choices:   [{id, name, nameHi, price, color, isDefault, available}]
create table if not exists public.option_groups (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    name_hi text not null default '',
    pick text not null default 'one' check (pick in ('one', 'many')),
    min_pick integer not null default 0 check (min_pick >= 0),
    max_pick integer not null default 1 check (max_pick >= 1),
    choices jsonb not null default '[]'::jsonb,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);
create index if not exists option_groups_tenant_idx on public.option_groups (tenant_id);

-- A combo has slots (pick a drink, pick a bite); each slot lists dishes and what each one costs on top
--   slots: [{name, nameHi, items: [{menuItem, extra}]}]
create table if not exists public.combos (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
    name text not null,
    name_hi text not null default '',
    description text not null default '',
    image text not null default '',
    art text not null default '',
    bg text not null default '',
    price numeric(10, 2) not null check (price >= 0),
    slots jsonb not null default '[]'::jsonb,
    days integer[] not null default '{}',
    time_from time,
    time_to time,
    is_active boolean not null default true,
    double_points boolean not null default false,
    suggest boolean not null default true,
    tax_group_id uuid references public.tax_groups (id) on delete set null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);
create index if not exists combos_tenant_idx on public.combos (tenant_id);

alter table public.order_items add column if not exists options jsonb not null default '{}'::jsonb;
alter table public.order_items add column if not exists combo_id uuid references public.combos (id) on delete set null;

create table if not exists public.customer_favourites (
    customer_id uuid not null references public.customers (id) on delete cascade,
    menu_item_id uuid not null references public.menu_items (id) on delete cascade,
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (customer_id, menu_item_id)
);

alter table public.option_groups enable row level security;
alter table public.combos enable row level security;
alter table public.customer_favourites enable row level security;

do $$
declare
    r record;
begin
    for r in select * from (values ('option_groups', 'true'), ('combos', 'is_active')) v(tbl, public_filter) loop
        execute format('drop policy if exists "public read" on public.%I', r.tbl);
        execute format('drop policy if exists "staff create" on public.%I', r.tbl);
        execute format('drop policy if exists "staff edit" on public.%I', r.tbl);
        execute format('drop policy if exists "staff delete" on public.%I', r.tbl);
        execute format($p$create policy "public read" on public.%I for select
            using (tenant_id = (select public.view_tenant_id()) and ((%s) or (select public.has_perm('menu.view'))))$p$, r.tbl, r.public_filter);
        execute format($p$create policy "staff create" on public.%I for insert
            with check (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('menu.create')))$p$, r.tbl);
        execute format($p$create policy "staff edit" on public.%I for update
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('menu.edit')))
            with check (tenant_id = (select public.current_tenant_id()))$p$, r.tbl);
        execute format($p$create policy "staff delete" on public.%I for delete
            using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('menu.delete')))$p$, r.tbl);
    end loop;
end $$;

drop policy if exists "own favourites" on public.customer_favourites;
create policy "own favourites" on public.customer_favourites for select
    using (customer_id = (select public.current_customer_id()));
grant select, insert, update, delete on public.option_groups, public.combos to authenticated;
grant select on public.option_groups, public.combos to anon;
grant select on public.customer_favourites to authenticated;

-- ---------------------------------------------------------------------------
-- Owner saves: checked here so a bad price or an unknown dish never reaches checkout
-- ---------------------------------------------------------------------------
create or replace function public.check_menu_extras() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
    v_s jsonb;
    v_defaults integer;
begin
    if jsonb_typeof(new.sizes) <> 'array' then
        raise exception 'Sizes must be a list';
    end if;
    if jsonb_array_length(new.sizes) > 6 then
        raise exception 'Up to 6 sizes';
    end if;
    for v_s in select * from jsonb_array_elements(new.sizes) loop
        if trim(coalesce(v_s ->> 'name', '')) = '' or coalesce(v_s ->> 'id', '') = '' then
            raise exception 'Each size needs a name';
        end if;
        if coalesce((v_s ->> 'price')::numeric, -1) < 0 then
            raise exception 'Size "%" needs a price', v_s ->> 'name';
        end if;
    end loop;
    select count(*) into v_defaults from jsonb_array_elements(new.sizes) s where coalesce((s ->> 'isDefault')::boolean, false);
    if jsonb_array_length(new.sizes) > 0 and v_defaults <> 1 then
        raise exception 'Mark exactly one size as the default';
    end if;
    if cardinality(new.pairs) > 8 then
        raise exception 'Up to 8 dishes in Goes well with';
    end if;
    if cardinality(new.option_groups) > 8 then
        raise exception 'Up to 8 choice groups on one dish';
    end if;
    if jsonb_typeof(new.details) <> 'object' then
        new.details := '{}'::jsonb;
    end if;
    return new;
end;
$$;
drop trigger if exists menu_items_check_extras on public.menu_items;
create trigger menu_items_check_extras before insert or update of sizes, pairs, option_groups, details on public.menu_items
    for each row execute function public.check_menu_extras();

create or replace function public.check_option_group() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
    c jsonb;
begin
    if trim(new.name) = '' then
        raise exception 'The group needs a name';
    end if;
    if jsonb_typeof(new.choices) <> 'array' or jsonb_array_length(new.choices) = 0 then
        raise exception 'Add at least one choice to "%"', new.name;
    end if;
    if jsonb_array_length(new.choices) > 20 then
        raise exception 'Up to 20 choices in one group';
    end if;
    for c in select * from jsonb_array_elements(new.choices) loop
        if trim(coalesce(c ->> 'name', '')) = '' or coalesce(c ->> 'id', '') = '' then
            raise exception 'Each choice in "%" needs a name', new.name;
        end if;
        if coalesce((c ->> 'price')::numeric, 0) < 0 then
            raise exception 'A choice cannot cost less than zero';
        end if;
    end loop;
    if new.pick = 'one' then
        new.min_pick := 1;
        new.max_pick := 1;
    elsif new.min_pick > new.max_pick then
        raise exception 'In "%" the least is more than the most', new.name;
    end if;
    return new;
end;
$$;
drop trigger if exists option_groups_check on public.option_groups;
create trigger option_groups_check before insert or update on public.option_groups
    for each row execute function public.check_option_group();

create or replace function public.check_combo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
    s jsonb;
    i jsonb;
begin
    if trim(new.name) = '' then
        raise exception 'The combo needs a name';
    end if;
    if jsonb_typeof(new.slots) <> 'array' or jsonb_array_length(new.slots) = 0 then
        raise exception 'Add at least one slot to "%"', new.name;
    end if;
    if jsonb_array_length(new.slots) > 5 then
        raise exception 'Up to 5 slots in one combo';
    end if;
    for s in select * from jsonb_array_elements(new.slots) loop
        if jsonb_typeof(s -> 'items') <> 'array' or jsonb_array_length(s -> 'items') = 0 then
            raise exception 'Each slot of "%" needs at least one dish', new.name;
        end if;
        for i in select * from jsonb_array_elements(s -> 'items') loop
            if not exists (select 1 from public.menu_items m where m.id::text = i ->> 'menuItem' and m.tenant_id = new.tenant_id) then
                raise exception 'A dish in "%" is not on the menu', new.name;
            end if;
            if coalesce((i ->> 'extra')::numeric, 0) < 0 then
                raise exception 'An upgrade in "%" cannot cost less than zero', new.name;
            end if;
        end loop;
    end loop;
    return new;
end;
$$;
drop trigger if exists combos_check on public.combos;
create trigger combos_check before insert or update on public.combos
    for each row execute function public.check_combo();

-- ---------------------------------------------------------------------------
-- Pricing one dish with its size and choices
--   input:  {menuItem, quantity, unitId, note, size: sizeId, choices: [choiceId]}
--   output: {price, name, note, options: {size, sizeName, choices: [{group, id, name, price}]}}
-- Missing picks fall back to the defaults, so the counter and the kiosk keep working without a picker
-- ---------------------------------------------------------------------------
create or replace function public.price_dish(p_menu public.menu_items, p_item jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_size jsonb;
    v_price numeric := p_menu.price;
    v_size_name text := '';
    v_g public.option_groups;
    v_picked text[] := array(select jsonb_array_elements_text(coalesce(nullif(p_item -> 'choices', 'null'::jsonb), '[]'::jsonb)));
    v_in_group jsonb;
    v_n integer;
    v_out jsonb := '[]'::jsonb;
    v_words text[] := '{}';
    c jsonb;
begin
    if jsonb_array_length(p_menu.sizes) > 0 then
        select s into v_size from jsonb_array_elements(p_menu.sizes) s where s ->> 'id' = p_item ->> 'size';
        if v_size is null then
            select s into v_size from jsonb_array_elements(p_menu.sizes) s where coalesce((s ->> 'isDefault')::boolean, false) limit 1;
        end if;
        if v_size is null then
            v_size := p_menu.sizes -> 0;
        end if;
        v_price := (v_size ->> 'price')::numeric;
        v_size_name := v_size ->> 'name';
    end if;

    for v_g in select g.* from public.option_groups g
                where g.id = any (p_menu.option_groups) and g.tenant_id = p_menu.tenant_id
                order by array_position(p_menu.option_groups, g.id) loop
        select coalesce(jsonb_agg(c2), '[]'::jsonb) into v_in_group
          from jsonb_array_elements(v_g.choices) c2
         where c2 ->> 'id' = any (v_picked) and coalesce((c2 ->> 'available')::boolean, true);
        v_n := jsonb_array_length(v_in_group);
        if v_n = 0 and v_g.min_pick > 0 then
            -- nothing picked: take the defaults (or the first choice for pick one)
            select coalesce(jsonb_agg(c2), '[]'::jsonb) into v_in_group
              from jsonb_array_elements(v_g.choices) c2
             where coalesce((c2 ->> 'isDefault')::boolean, false) and coalesce((c2 ->> 'available')::boolean, true);
            if jsonb_array_length(v_in_group) = 0 then
                v_in_group := jsonb_build_array(v_g.choices -> 0);
            end if;
            if v_g.pick = 'one' then
                v_in_group := jsonb_build_array(v_in_group -> 0);
            end if;
            v_n := jsonb_array_length(v_in_group);
        end if;
        if v_n > v_g.max_pick then
            raise exception 'Pick up to % in %', v_g.max_pick, v_g.name;
        end if;
        if v_n < v_g.min_pick then
            raise exception 'Pick at least % in %', v_g.min_pick, v_g.name;
        end if;
        for c in select * from jsonb_array_elements(v_in_group) loop
            v_price := v_price + coalesce((c ->> 'price')::numeric, 0);
            v_out := v_out || jsonb_build_object('group', v_g.name, 'groupId', v_g.id, 'id', c ->> 'id',
                                                 'name', c ->> 'name', 'price', coalesce((c ->> 'price')::numeric, 0),
                                                 'isDefault', coalesce((c ->> 'isDefault')::boolean, false));
            -- the kitchen only needs to hear about what differs from the usual
            if not coalesce((c ->> 'isDefault')::boolean, false) or v_g.pick = 'many' then
                v_words := v_words || (c ->> 'name');
            end if;
        end loop;
    end loop;

    return jsonb_build_object(
        'price', v_price,
        'name', p_menu.name || case when v_size_name <> '' then ' (' || v_size_name || ')' else '' end,
        'words', array_to_string(v_words, ', '),
        'options', jsonb_build_object('size', coalesce(v_size ->> 'id', ''), 'sizeName', v_size_name, 'choices', v_out));
end;
$$;
revoke execute on function public.price_dish(public.menu_items, jsonb) from public, anon, authenticated;

-- Is the combo on sale right now (days and times in the cafe time zone)
create or replace function public.combo_open(p_combo public.combos) returns boolean
language sql stable set search_path = public, pg_temp as $$
    select p_combo.is_active
       and (cardinality(p_combo.days) = 0
            or extract(dow from now() at time zone public.cafe_timezone(p_combo.tenant_id))::integer = any (p_combo.days))
       and (p_combo.time_from is null or p_combo.time_to is null
            or (now() at time zone public.cafe_timezone(p_combo.tenant_id))::time between p_combo.time_from and p_combo.time_to);
$$;

-- ---------------------------------------------------------------------------
-- Checkout pricing: the same as before, plus sizes, choices and combos
--   combo input: {combo: comboId, quantity, note, picks: [{menuItem, size, choices}]}  one pick per slot, in order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.price_order(p_tenant uuid, p_customer uuid, p_items jsonb, p_coupon_code text, p_loyalty_offer_id uuid, p_manual_discount numeric DEFAULT 0, p_points_cash boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_item jsonb;
    v_menu public.menu_items;
    v_unit public.item_units;
    v_unit_price numeric;
    v_qty integer;
    v_lines jsonb := '[]'::jsonb;
    v_subtotal numeric := 0;
    v_eligible numeric := 0;
    v_coupon_base numeric := 0;
    v_code text := upper(trim(coalesce(p_coupon_code, '')));
    v_coupon public.coupons;
    v_coupon_disc numeric := 0;
    v_offer public.loyalty_offers;
    v_offer_disc numeric := 0;
    v_manual numeric := 0;
    v_elig_disc numeric := 0;
    v_points integer;
    v_ls public.loyalty_settings;
    v_cash_points integer := 0;
    v_default jsonb;
    v_comps jsonb;
    v_coupon_ok boolean;
    v_calc jsonb;
    v_club jsonb;
    v_club_disc numeric := 0;
    v_cap_left numeric;
    v_dish jsonb;
    v_name text;
    v_note text;
    v_options jsonb;
    v_combo public.combos;
    v_slot jsonb;
    v_pick jsonb;
    v_slot_item jsonb;
    v_pick_menu public.menu_items;
    v_picks jsonb;
    v_words text[];
    v_cost numeric;
    v_restricted boolean;
    v_incl boolean;
    v_slot_no integer;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'No items in order';
    end if;
    if jsonb_array_length(p_items) > 50 then
        raise exception 'Too many items in one order';
    end if;

    if v_code <> '' then
        select * into v_coupon from public.coupons
         where tenant_id = p_tenant and code = v_code and is_active
           and valid_from <= now() and valid_until >= now();
        if v_coupon.id is null then
            raise exception 'Invalid coupon code';
        end if;
    end if;

    v_default := public.get_setting('tax_config', null, p_tenant);
    if v_default is null or jsonb_typeof(v_default) <> 'array' then
        v_default := jsonb_build_array(jsonb_build_object('name', 'GST',
            'rate', coalesce((public.get_setting('gst_rate', '5', p_tenant) #>> '{}')::numeric, 5)));
    end if;

    for v_item in select * from jsonb_array_elements(p_items) loop
        v_qty := (v_item ->> 'quantity')::integer;
        if v_qty is null or v_qty < 1 or v_qty > 99 then
            raise exception 'Invalid quantity';
        end if;

        if nullif(v_item ->> 'combo', '') is not null then
            -- A combo: its price, plus the upgrade on each pick and the choices on each pick
            select * into v_combo from public.combos where id = (v_item ->> 'combo')::uuid and tenant_id = p_tenant;
            if v_combo.id is null then
                raise exception 'Combo not found';
            end if;
            if not public.combo_open(v_combo) then
                raise exception '% is not on right now', v_combo.name;
            end if;
            if jsonb_typeof(v_item -> 'picks') <> 'array' or jsonb_array_length(v_item -> 'picks') <> jsonb_array_length(v_combo.slots) then
                raise exception 'Pick one dish for each part of %', v_combo.name;
            end if;
            v_unit_price := v_combo.price;
            v_picks := '[]'::jsonb;
            v_words := '{}';
            v_cost := 0;
            v_restricted := false;
            v_incl := null;
            v_menu := null;
            v_slot_no := 0;
            for v_slot in select * from jsonb_array_elements(v_combo.slots) loop
                v_pick := v_item -> 'picks' -> v_slot_no;
                v_slot_no := v_slot_no + 1;
                select si into v_slot_item from jsonb_array_elements(v_slot -> 'items') si where si ->> 'menuItem' = v_pick ->> 'menuItem';
                if v_slot_item is null then
                    raise exception 'That dish is not part of %', v_combo.name;
                end if;
                select * into v_pick_menu from public.menu_items where id = (v_pick ->> 'menuItem')::uuid and tenant_id = p_tenant;
                if v_pick_menu.id is null or not v_pick_menu.is_available then
                    raise exception '% is not available', coalesce(v_pick_menu.name, 'A dish');
                end if;
                v_dish := public.price_dish(v_pick_menu, v_pick);
                -- the combo price covers the default size and default choices; anything above that is added
                v_unit_price := v_unit_price + coalesce((v_slot_item ->> 'extra')::numeric, 0)
                              + greatest((v_dish ->> 'price')::numeric - (public.price_dish(v_pick_menu, '{}'::jsonb) ->> 'price')::numeric, 0);
                v_picks := v_picks || jsonb_build_object('menuItem', v_pick_menu.id, 'name', v_dish ->> 'name',
                                                         'options', v_dish -> 'options');
                v_words := v_words || ((v_dish ->> 'name') || case when v_dish ->> 'words' <> '' then ' [' || (v_dish ->> 'words') || ']' else '' end);
                v_cost := v_cost + coalesce(public.recipe_cost(v_pick_menu.id), v_pick_menu.cost_price);
                v_restricted := v_restricted or v_pick_menu.is_restricted;
                v_incl := coalesce(v_incl, v_pick_menu.price_includes_tax);
                if v_menu.id is null then
                    v_menu := v_pick_menu;
                end if;
            end loop;
            if v_restricted then
                raise exception '% cannot be sold as a combo', v_combo.name;
            end if;
            select components into v_comps from public.tax_groups where id = coalesce(v_combo.tax_group_id, v_menu.tax_group_id);
            v_comps := coalesce(v_comps, v_default);
            v_coupon_ok := v_coupon.id is not null
                and cardinality(v_coupon.applicable_items) = 0 and cardinality(v_coupon.applicable_categories) = 0;
            v_subtotal := v_subtotal + v_unit_price * v_qty;
            v_eligible := v_eligible + v_unit_price * v_qty;
            if v_coupon_ok then
                v_coupon_base := v_coupon_base + v_unit_price * v_qty;
            end if;
            v_note := array_to_string(v_words, ' + ');
            if trim(coalesce(v_item ->> 'note', '')) <> '' then
                v_note := v_note || ' · ' || trim(v_item ->> 'note');
            end if;
            v_lines := v_lines || jsonb_build_object(
                'menu_item_id', null, 'combo_id', v_combo.id,
                'name', v_combo.name,
                'price', v_unit_price, 'quantity', v_qty,
                'total', v_unit_price * v_qty, 'is_restricted', false,
                'price_includes_tax', coalesce(v_incl, true),
                'unit_cost', round(v_cost, 2),
                'unit_name', '', 'unit_factor', 1,
                'note', left(v_note, 300),
                'options', jsonb_build_object('combo', v_combo.id, 'picks', v_picks, 'doublePoints', v_combo.double_points),
                'coupon_ok', v_coupon_ok, 'comps', v_comps,
                'tax_rate', (select coalesce(sum((c ->> 'rate')::numeric), 0) from jsonb_array_elements(v_comps) c));
            continue;
        end if;

        select * into v_menu from public.menu_items
         where id = (v_item ->> 'menuItem')::uuid and tenant_id = p_tenant;
        if v_menu.id is null then
            raise exception 'Menu item not found';
        end if;
        if not v_menu.is_available then
            raise exception '% is not available', v_menu.name;
        end if;
        v_unit := null;
        v_dish := public.price_dish(v_menu, v_item);
        v_unit_price := (v_dish ->> 'price')::numeric;
        v_name := v_dish ->> 'name';
        v_options := v_dish -> 'options';
        if nullif(v_item ->> 'unitId', '') is not null then
            select * into v_unit from public.item_units where id = (v_item ->> 'unitId')::uuid and menu_item_id = v_menu.id;
            if v_unit.id is null then
                raise exception 'Pack unit not found for %', v_menu.name;
            end if;
            v_unit_price := coalesce(v_unit.sale_price, round(v_menu.price * v_unit.factor, 2));
            v_name := v_menu.name || ' (' || v_unit.name || ')';
            v_options := '{}'::jsonb;
        end if;
        select components into v_comps from public.tax_groups where id = v_menu.tax_group_id;
        v_comps := coalesce(v_comps, v_default);
        v_coupon_ok := v_coupon.id is not null and not v_menu.is_restricted and (
            (cardinality(v_coupon.applicable_items) = 0 and cardinality(v_coupon.applicable_categories) = 0)
            or v_menu.id = any (v_coupon.applicable_items)
            or v_menu.category_id = any (v_coupon.applicable_categories));
        v_subtotal := v_subtotal + v_unit_price * v_qty;
        if not v_menu.is_restricted then
            v_eligible := v_eligible + v_unit_price * v_qty;
        end if;
        if v_coupon_ok then
            v_coupon_base := v_coupon_base + v_unit_price * v_qty;
        end if;
        v_note := case when v_unit.id is null then coalesce(v_dish ->> 'words', '') else '' end;
        if trim(coalesce(v_item ->> 'note', '')) <> '' then
            v_note := concat_ws(' · ', nullif(v_note, ''), trim(v_item ->> 'note'));
        end if;
        v_lines := v_lines || jsonb_build_object(
            'menu_item_id', v_menu.id, 'combo_id', null,
            'name', v_name,
            'price', v_unit_price, 'quantity', v_qty,
            'total', v_unit_price * v_qty, 'is_restricted', v_menu.is_restricted,
            'price_includes_tax', v_menu.price_includes_tax,
            'unit_cost', v_menu.cost_price * coalesce(v_unit.factor, 1),
            'unit_name', coalesce(v_unit.name, ''), 'unit_factor', coalesce(v_unit.factor, 1),
            'note', left(v_note, 300),
            'options', v_options,
            'coupon_ok', v_coupon_ok, 'comps', v_comps,
            'tax_rate', (select coalesce(sum((c ->> 'rate')::numeric), 0) from jsonb_array_elements(v_comps) c));
    end loop;

    if v_coupon.id is not null then
        if v_coupon_base = 0 then
            raise exception 'This coupon does not apply to the items in your cart';
        end if;
        v_coupon_disc := public.coupon_discount(v_coupon, v_eligible, v_coupon_base);
    end if;

    select * into v_ls from public.loyalty_settings where tenant_id = p_tenant;
    if p_loyalty_offer_id is not null and not coalesce(v_ls.deals_on, true) then
        raise exception 'Rewards for points are switched off at the moment';
    end if;
    -- Points as cash: the redemption rules (points for one rupee, minimum points, most of the bill) turn points into money off
    if coalesce(p_points_cash, false) and p_loyalty_offer_id is null and p_customer is not null then
        if not coalesce(v_ls.is_active, false) or not coalesce(v_ls.points_as_cash, false) then
            raise exception 'Using points as cash is switched off at the moment';
        end if;
        select loyalty_points into v_points from public.customers where id = p_customer;
        if coalesce(v_points, 0) < v_ls.min_points_to_redeem then
            raise exception 'You need at least % points to use them', v_ls.min_points_to_redeem;
        end if;
        v_offer_disc := floor(least(v_points / greatest(v_ls.points_to_rupee_ratio, 0.0001),
                                    v_eligible * v_ls.max_redemption_percent / 100,
                                    greatest(v_eligible - v_coupon_disc, 0)));
        v_cash_points := ceil(v_offer_disc * v_ls.points_to_rupee_ratio);
        if v_offer_disc <= 0 then
            v_cash_points := 0;
        end if;
    end if;

    if p_loyalty_offer_id is not null then
        select * into v_offer from public.loyalty_offers
         where id = p_loyalty_offer_id and tenant_id = p_tenant and is_active;
        if v_offer.id is null then
            raise exception 'This reward is no longer available';
        end if;
        if not coalesce((select is_active from public.loyalty_settings where tenant_id = p_tenant), false) then
            raise exception 'Loyalty program is currently disabled';
        end if;
        select loyalty_points into v_points from public.customers where id = p_customer;
        if coalesce(v_points, 0) < v_offer.points_required then
            raise exception 'Not enough loyalty points for this reward';
        end if;
        if v_eligible < v_offer.min_order_value then
            raise exception 'Minimum order for this reward is ₹%', v_offer.min_order_value;
        end if;
        v_offer_disc := round(least(v_offer.discount_value, v_eligible - v_coupon_disc), 2);
    end if;

    -- Club: tier % and member %, after coupon and points; coupon, points and club together stay within the cap
    v_club := public.club_discount_for(p_tenant, p_customer, greatest(v_eligible - v_coupon_disc - v_offer_disc, 0));
    v_club_disc := coalesce((v_club ->> 'amount')::numeric, 0);
    if v_club_disc > 0 then
        v_cap_left := greatest(round(v_eligible * coalesce((v_club ->> 'cap')::numeric, 100) / 100, 2) - v_coupon_disc - v_offer_disc, 0);
        if v_club_disc > v_cap_left then
            -- keep the split between tier and member in proportion
            v_club := v_club || jsonb_build_object(
                'tierAmount', round((v_club ->> 'tierAmount')::numeric * v_cap_left / v_club_disc, 2),
                'memberAmount', v_cap_left - round((v_club ->> 'tierAmount')::numeric * v_cap_left / v_club_disc, 2),
                'capped', true);
            v_club_disc := v_cap_left;
        end if;
        v_club := v_club || jsonb_build_object('amount', v_club_disc);
    end if;
    perform set_config('club.pricing', (v_club || jsonb_build_object('customer', p_customer))::text, true);

    -- Counter discount: on items that may be discounted (restricted items never are)
    v_manual := round(least(greatest(coalesce(p_manual_discount, 0), 0), greatest(v_eligible - v_coupon_disc - v_offer_disc - v_club_disc, 0)), 2);
    v_elig_disc := v_offer_disc + v_club_disc + v_manual;

    with l as (
        select ord, x,
               (x ->> 'total')::numeric as t,
               (x ->> 'coupon_ok')::boolean as cok,
               not (x ->> 'is_restricted')::boolean as eok,
               (x ->> 'price_includes_tax')::boolean as incl,
               (x ->> 'tax_rate')::numeric as rate
          from jsonb_array_elements(v_lines) with ordinality as e(x, ord)),
    w as (
        select *, sum(case when cok then t else 0 end) over (order by ord) as ccum,
                  sum(case when eok then t else 0 end) over (order by ord) as ecum
          from l),
    d as (
        select *,
               (case when cok and v_coupon_base > 0
                     then round(v_coupon_disc * ccum / v_coupon_base, 2) - round(v_coupon_disc * (ccum - t) / v_coupon_base, 2)
                     else 0 end)
             + (case when eok and v_eligible > 0
                     then round(v_elig_disc * ecum / v_eligible, 2) - round(v_elig_disc * (ecum - t) / v_eligible, 2)
                     else 0 end) as disc
          from w),
    n as (
        select *, t - disc as gross,
               case when incl then round((t - disc) / (1 + rate / 100), 2) else t - disc end as net
          from d),
    comp as (
        select n.incl, n.gross, n.net, n.rate as line_rate, c
          from n, jsonb_array_elements(n.x -> 'comps') c),
    buckets as (
        select c ->> 'name' as name, (c ->> 'rate')::numeric as rate,
               sum(case when incl then case when line_rate > 0 then (gross - net) * (c ->> 'rate')::numeric / line_rate else 0 end
                        else net * (c ->> 'rate')::numeric / 100 end) as amt,
               sum(case when incl then 0 else net * (c ->> 'rate')::numeric / 100 end) as excl_amt
          from comp group by 1, 2)
    select jsonb_build_object(
        'lines', (select jsonb_agg((x - 'comps' - 'coupon_ok') || jsonb_build_object(
                         'discount', disc, 'net_amount', net,
                         'tax_amount', case when incl then gross - net else round(net * rate / 100, 2) end) order by ord) from n),
        'gross', (select sum(case when incl then gross else net end) from n),
        'tax_details', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'rate', rate, 'amount', round(amt, 2))
                                                  order by name, rate), '[]'::jsonb) from buckets where amt <> 0),
        'tax', (select coalesce(sum(round(amt, 2)), 0) from buckets),
        'excl_tax', (select coalesce(sum(round(excl_amt, 2)), 0) from buckets))
      into v_calc;

    return jsonb_build_object(
        'lines', v_calc -> 'lines',
        'subtotal', v_subtotal,
        'eligibleSubtotal', v_eligible,
        'couponDiscount', v_coupon_disc,
        'offerDiscount', v_offer_disc,
        'clubDiscount', v_club_disc,
        'club', v_club - 'customer',
        'manualDiscount', v_manual,
        'discount', v_coupon_disc + v_offer_disc + v_club_disc + v_manual,
        'couponId', v_coupon.id,
        'couponCode', coalesce(v_coupon.code, ''),
        'offerId', v_offer.id,
        'pointsUsed', coalesce(v_offer.points_required, v_cash_points, 0),
        'pointsCash', v_cash_points > 0,
        'tax', (v_calc ->> 'tax')::numeric,
        'taxDetails', v_calc -> 'tax_details',
        'total', (v_calc ->> 'gross')::numeric + (v_calc ->> 'excl_tax')::numeric);
end;
$function$;

-- The cart asks for prices line by line, so it can show the price of each dish with its choices
create or replace function public.quote_lines(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_customer uuid := public.current_customer_id();
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = v_customer),
                              public.current_tenant_id(), public.header_tenant_id());
    v_q jsonb;
begin
    v_q := public.price_order(v_tenant, null, p_items, '', null, 0, false);
    return (select coalesce(jsonb_agg(jsonb_build_object('name', l ->> 'name', 'price', (l ->> 'price')::numeric,
                                                         'note', l ->> 'note', 'options', l -> 'options') order by ord), '[]'::jsonb)
              from jsonb_array_elements(v_q -> 'lines') with ordinality e(l, ord));
end;
$$;
grant execute on function public.quote_lines(jsonb) to anon, authenticated;

-- Stock for combos (each pick takes its recipe) is in 20261030000002_staff_choices.sql

-- ---------------------------------------------------------------------------
-- Dish details page: the dish, its sizes and choice groups, pairs, combos it is part of, rating,
-- whether it is a favourite and how this customer had it last time
-- ---------------------------------------------------------------------------
create or replace function public.dish_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                              public.current_tenant_id(), public.view_tenant_id());
    v_customer uuid := public.current_customer_id();
    v_m public.menu_items;
begin
    select * into v_m from public.menu_items where id = p_id and tenant_id = v_tenant and sold_in_shop and not is_restricted;
    if v_m.id is null then
        return null;
    end if;
    return jsonb_build_object(
        'id', v_m.id,
        'sizes', v_m.sizes,
        'details', v_m.details,
        'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'nameHi', g.name_hi, 'pick', g.pick,
                                                               'min', g.min_pick, 'max', g.max_pick,
                                                               'choices', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                                                             from jsonb_array_elements(g.choices) c
                                                                            where coalesce((c ->> 'available')::boolean, true)))
                                            order by array_position(v_m.option_groups, g.id)), '[]'::jsonb)
                     from public.option_groups g where g.id = any (v_m.option_groups) and g.tenant_id = v_tenant),
        'pairs', (select coalesce(jsonb_agg(jsonb_build_object('_id', m.id, 'name', m.name, 'nameHi', m.name_hi, 'price', m.price,
                                                              'image', m.image, 'isVeg', m.is_veg, 'art', m.details ->> 'art',
                                                              'hasChoices', jsonb_array_length(m.sizes) > 0 or cardinality(m.option_groups) > 0)
                                           order by array_position(v_m.pairs, m.id)), '[]'::jsonb)
                    from public.menu_items m
                   where m.id = any (v_m.pairs) and m.tenant_id = v_tenant and m.is_available and m.sold_in_shop and not m.is_restricted),
        'combos', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'nameHi', c.name_hi, 'price', c.price,
                                                               'image', c.image, 'art', c.art, 'bg', c.bg,
                                                               'save', public.combo_saving(c))), '[]'::jsonb)
                     from public.combos c
                    where c.tenant_id = v_tenant and c.suggest and public.combo_open(c)
                      and exists (select 1 from jsonb_array_elements(c.slots) s, jsonb_array_elements(s -> 'items') i
                                   where i ->> 'menuItem' = v_m.id::text)),
        'rating', (select jsonb_build_object('avg', round(avg(rating)::numeric, 1), 'count', count(*))
                     from public.dish_feedback where menu_item_id = v_m.id and not is_hidden),
        'favourite', v_customer is not null and exists (select 1 from public.customer_favourites f
                                                         where f.customer_id = v_customer and f.menu_item_id = v_m.id),
        'last', (select oi.options from public.order_items oi join public.orders o on o.id = oi.order_id
                  where o.customer_id = v_customer and v_customer is not null and oi.menu_item_id = v_m.id
                    and o.status <> 'cancelled' and oi.options <> '{}'::jsonb
                  order by o.created_at desc limit 1));
end;
$$;
grant execute on function public.dish_detail(uuid) to anon, authenticated;

-- What a customer saves with a combo: the cheapest dish of each slot at its usual price, less the combo price
create or replace function public.combo_saving(p_combo public.combos) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select greatest(coalesce(sum(cheapest), 0) - p_combo.price, 0)
      from (select min((public.price_dish(m, '{}'::jsonb) ->> 'price')::numeric) as cheapest
              from jsonb_array_elements(p_combo.slots) with ordinality s(slot, n),
                   jsonb_array_elements(slot -> 'items') i
              join public.menu_items m on m.id::text = i ->> 'menuItem'
             group by n) x;
$$;

-- Combos on sale now, for the customer app and the counter
create or replace function public.combos_on_sale() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with t as (select coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                               public.current_tenant_id(), public.view_tenant_id()) as id)
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'nameHi', c.name_hi, 'description', c.description, 'image', c.image,
               'art', c.art, 'bg', c.bg, 'price', c.price, 'save', public.combo_saving(c), 'doublePoints', c.double_points,
               'timeFrom', to_char(c.time_from, 'HH24:MI'), 'timeTo', to_char(c.time_to, 'HH24:MI'),
               'slots', (select jsonb_agg(jsonb_build_object(
                             'name', s ->> 'name', 'nameHi', coalesce(s ->> 'nameHi', ''),
                             'items', (select coalesce(jsonb_agg(jsonb_build_object(
                                           'menuItem', m.id, 'name', m.name, 'nameHi', m.name_hi, 'image', m.image,
                                           'art', m.details ->> 'art', 'isVeg', m.is_veg,
                                           'extra', coalesce((i ->> 'extra')::numeric, 0),
                                           'hasChoices', jsonb_array_length(m.sizes) > 0 or cardinality(m.option_groups) > 0)
                                           order by n2), '[]'::jsonb)
                                         from jsonb_array_elements(s -> 'items') with ordinality i2(i, n2)
                                         join public.menu_items m on m.id::text = i ->> 'menuItem'
                                        where m.is_available)) order by n)
                           from jsonb_array_elements(c.slots) with ordinality s1(s, n)))
               order by c.sort_order, c.name), '[]'::jsonb)
      from public.combos c, t
     where c.tenant_id = t.id and public.combo_open(c);
$$;
grant execute on function public.combos_on_sale() to anon, authenticated;

-- Which dishes have sizes or choices (the menu shows a Customise button for them)
create or replace function public.dishes_with_choices() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with t as (select coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                               public.current_tenant_id(), public.view_tenant_id()) as id)
    select coalesce(jsonb_object_agg(m.id, jsonb_build_object(
               'from', least(m.price, coalesce((select min((s ->> 'price')::numeric) from jsonb_array_elements(m.sizes) s), m.price)),
               'art', m.details ->> 'art')), '{}'::jsonb)
      from public.menu_items m, t
     where m.tenant_id = t.id and (jsonb_array_length(m.sizes) > 0 or cardinality(m.option_groups) > 0 or m.details ? 'art');
$$;
grant execute on function public.dishes_with_choices() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Favourites, the usual, order again
-- ---------------------------------------------------------------------------
create or replace function public.toggle_favourite(p_menu_item uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_customer uuid := public.current_customer_id();
    v_tenant uuid;
begin
    if v_customer is null then
        raise exception 'Please sign in first';
    end if;
    select tenant_id into v_tenant from public.customers where id = v_customer;
    if not exists (select 1 from public.menu_items where id = p_menu_item and tenant_id = v_tenant) then
        raise exception 'Menu item not found';
    end if;
    if exists (select 1 from public.customer_favourites where customer_id = v_customer and menu_item_id = p_menu_item) then
        delete from public.customer_favourites where customer_id = v_customer and menu_item_id = p_menu_item;
        return false;
    end if;
    if (select count(*) from public.customer_favourites where customer_id = v_customer) >= 100 then
        raise exception 'Up to 100 favourites';
    end if;
    insert into public.customer_favourites (customer_id, menu_item_id, tenant_id) values (v_customer, p_menu_item, v_tenant);
    return true;
end;
$$;
grant execute on function public.toggle_favourite(uuid) to authenticated;

-- Favourites with the way this customer had each one last time
create or replace function public.my_favourites() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               '_id', m.id, 'name', m.name, 'nameHi', m.name_hi, 'price', m.price, 'image', m.image, 'isVeg', m.is_veg,
               'isAvailable', m.is_available, 'art', m.details ->> 'art',
               'hasChoices', jsonb_array_length(m.sizes) > 0 or cardinality(m.option_groups) > 0,
               'last', (select jsonb_build_object('options', oi.options, 'note', oi.note, 'price', oi.price)
                          from public.order_items oi join public.orders o on o.id = oi.order_id
                         where o.customer_id = f.customer_id and oi.menu_item_id = m.id and o.status <> 'cancelled'
                         order by o.created_at desc limit 1))
               order by f.created_at desc), '[]'::jsonb)
      from public.customer_favourites f
      join public.menu_items m on m.id = f.menu_item_id and m.sold_in_shop and not m.is_restricted
     where f.customer_id = public.current_customer_id();
$$;
grant execute on function public.my_favourites() to authenticated;

-- Welcome back: the dish this customer orders most (with their usual choices) and the last order to repeat
create or replace function public.my_usual() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with mine as (
        select oi.*, o.created_at as at, o.id as oid
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.customer_id = public.current_customer_id() and o.status <> 'cancelled'),
    top as (
        select menu_item_id, count(*) n, max(at) last_at from mine where menu_item_id is not null
         group by 1 order by 2 desc, 3 desc limit 1),
    last_order as (select oid, at from mine order by at desc limit 1)
    select jsonb_build_object(
        'usual', (select jsonb_build_object('_id', m.id, 'name', m.name, 'nameHi', m.name_hi, 'image', m.image,
                                            'art', m.details ->> 'art', 'isVeg', m.is_veg, 'times', top.n,
                                            'isAvailable', m.is_available and m.sold_in_shop,
                                            'options', (select x.options from mine x where x.menu_item_id = m.id order by x.at desc limit 1),
                                            'note', (select x.note from mine x where x.menu_item_id = m.id order by x.at desc limit 1))
                    from top join public.menu_items m on m.id = top.menu_item_id),
        'lastVisit', (select at from last_order),
        'lastOrder', (select jsonb_agg(jsonb_build_object('menuItem', x.menu_item_id, 'combo', x.combo_id, 'name', x.name,
                                                          'quantity', x.quantity, 'price', x.price, 'options', x.options,
                                                          'note', x.note))
                        from mine x, last_order lo where x.oid = lo.oid));
$$;
grant execute on function public.my_usual() to authenticated;

-- ---------------------------------------------------------------------------
-- Look: what the customer app shows (themes the owner switched on, the first theme, the bottom bar)
--   cx_look: {enabled: [keys], first: key, customerPick, modePick, glass: 0..100, corners, headingFont, bodyFont,
--             nav: floating|classic, custom: {name, main, accent, bg, dark}}
-- ---------------------------------------------------------------------------
create or replace function public.customer_screen() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    with t as (select coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                               public.current_tenant_id(), public.view_tenant_id()) as id)
    select jsonb_build_object(
        'pay', public.pay_options(t.id),
        'pickupColors', coalesce(public.get_setting('pickup_colors', '{}', t.id), '{}'::jsonb),
        'points', (select jsonb_build_object('on', s.is_active, 'deals', s.deals_on, 'cash', s.points_as_cash,
                                             'ratio', s.points_to_rupee_ratio, 'minPoints', s.min_points_to_redeem,
                                             'maxPercent', s.max_redemption_percent)
                     from public.loyalty_settings s where s.tenant_id = t.id),
        'look', coalesce(public.get_setting('cx_look', '{}', t.id), '{}'::jsonb),
        'hasCombos', exists (select 1 from public.combos c where c.tenant_id = t.id and public.combo_open(c)))
      from t;
$$;
grant execute on function public.customer_screen() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Banners: drawn art and a background instead of emojis, words in Hindi and Hinglish, a combo link,
-- and a time of day (happy hour banners switch themselves on and off)
-- ---------------------------------------------------------------------------
create or replace function public.save_portal_banners(p_banners jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    b jsonb;
    v_out jsonb := '[]';
    v_m public.menu_items;
begin
    perform public.require_perm('settings.edit');
    if jsonb_typeof(p_banners) <> 'array' then
        raise exception 'Banners must be a list';
    end if;
    if jsonb_array_length(p_banners) > 12 then
        raise exception 'Up to 12 banners';
    end if;
    for b in select * from jsonb_array_elements(p_banners) loop
        if trim(coalesce(b ->> 'title', '')) = '' and coalesce(b ->> 'image', '') = '' then
            raise exception 'Each banner needs a headline or a picture';
        end if;
        if coalesce(b ->> 'linkType', 'none') not in ('none', 'menu', 'category', 'item', 'rewards', 'url', 'combo') then
            raise exception 'Unknown banner link';
        end if;
        if b ->> 'linkType' = 'item' then
            select * into v_m from public.menu_items where id::text = b ->> 'linkTo' and tenant_id = v_tenant;
            if v_m.id is null then
                raise exception 'Banner "%": pick an item', b ->> 'title';
            end if;
            if v_m.is_restricted or not v_m.sold_in_shop then
                raise exception 'Banner "%": % can''t be promoted (restricted or not sold in the shop)', b ->> 'title', v_m.name;
            end if;
        end if;
        if b ->> 'linkType' = 'combo' and not exists (select 1 from public.combos where id::text = b ->> 'linkTo' and tenant_id = v_tenant) then
            raise exception 'Banner "%": pick a combo', b ->> 'title';
        end if;
        if b ->> 'linkType' = 'url' and coalesce(b ->> 'linkTo', '') !~ '^https://' then
            raise exception 'Banner "%": web links must start with https://', b ->> 'title';
        end if;
        if nullif(b ->> 'from', '') is not null and nullif(b ->> 'to', '') is not null and (b ->> 'from')::date > (b ->> 'to')::date then
            raise exception 'Banner "%": the end date is before the start date', b ->> 'title';
        end if;
        if coalesce(b ->> 'timeFrom', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^$' or coalesce(b ->> 'timeTo', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^$' then
            raise exception 'Banner "%": times look like 15:00', b ->> 'title';
        end if;
        v_out := v_out || jsonb_build_object(
            'id', coalesce(nullif(b ->> 'id', ''), gen_random_uuid()::text),
            'title', left(trim(coalesce(b ->> 'title', '')), 60),
            'titleHi', left(trim(coalesce(b ->> 'titleHi', '')), 60),
            'titleHg', left(trim(coalesce(b ->> 'titleHg', '')), 60),
            'text', left(trim(coalesce(b ->> 'text', '')), 120),
            'textHi', left(trim(coalesce(b ->> 'textHi', '')), 120),
            'textHg', left(trim(coalesce(b ->> 'textHg', '')), 120),
            'tag', left(trim(coalesce(b ->> 'tag', '')), 24),
            'tagHi', left(trim(coalesce(b ->> 'tagHi', '')), 24),
            'tagHg', left(trim(coalesce(b ->> 'tagHg', '')), 24),
            'cta', left(trim(coalesce(b ->> 'cta', '')), 24),
            'ctaHi', left(trim(coalesce(b ->> 'ctaHi', '')), 24),
            'ctaHg', left(trim(coalesce(b ->> 'ctaHg', '')), 24),
            'linkType', coalesce(b ->> 'linkType', 'none'),
            'linkTo', coalesce(b ->> 'linkTo', ''),
            'style', left(coalesce(nullif(b ->> 'style', ''), 'saffron'), 20),
            'art', left(coalesce(b ->> 'art', ''), 20),
            'image', coalesce(b ->> 'image', ''),
            'from', coalesce(b ->> 'from', ''),
            'to', coalesce(b ->> 'to', ''),
            'timeFrom', coalesce(b ->> 'timeFrom', ''),
            'timeTo', coalesce(b ->> 'timeTo', ''),
            'active', coalesce((b ->> 'active')::boolean, true));
    end loop;
    insert into public.settings (tenant_id, key, value) values (v_tenant, 'portal_banners', v_out)
    on conflict (tenant_id, key) do update set value = excluded.value;
    return v_out;
end;
$$;

create or replace function public.portal_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := coalesce((select tenant_id from public.customers where id = public.current_customer_id()),
                              public.current_tenant_id(), public.view_tenant_id());
    v_d jsonb := public.portal_defaults();
    v_today date := public.cafe_today(v_tenant);
    v_now time := (now() at time zone public.cafe_timezone(v_tenant))::time;
    v_banners jsonb;
begin
    -- Only switched-on banners inside their dates and times; item links only to items on sale in the shop
    select coalesce(jsonb_agg(b || jsonb_build_object('item', (
               select jsonb_build_object('_id', m.id, 'name', m.name, 'price', m.price, 'image', m.image)
                 from public.menu_items m
                where b ->> 'linkType' = 'item' and m.id::text = b ->> 'linkTo' and m.tenant_id = v_tenant)) order by ord), '[]'::jsonb)
      into v_banners
      from jsonb_array_elements(coalesce(public.get_setting('portal_banners', '[]', v_tenant), '[]')) with ordinality as e(b, ord)
     where coalesce((b ->> 'active')::boolean, true)
       and (nullif(b ->> 'from', '') is null or (b ->> 'from')::date <= v_today)
       and (nullif(b ->> 'to', '') is null or (b ->> 'to')::date >= v_today)
       and (nullif(b ->> 'timeFrom', '') is null or nullif(b ->> 'timeTo', '') is null
            or v_now between (b ->> 'timeFrom')::time and (b ->> 'timeTo')::time)
       and (b ->> 'linkType' is distinct from 'item' or exists (
             select 1 from public.menu_items m where m.id::text = b ->> 'linkTo' and m.tenant_id = v_tenant
                and m.sold_in_shop and not m.is_restricted and m.is_available))
       and (b ->> 'linkType' is distinct from 'combo' or exists (
             select 1 from public.combos c where c.id::text = b ->> 'linkTo' and c.tenant_id = v_tenant and public.combo_open(c)));
    return jsonb_build_object(
        'texts', (v_d -> 'texts') || coalesce(public.get_setting('portal_texts', '{}', v_tenant), '{}'),
        'show', (v_d -> 'show') || coalesce(public.get_setting('portal_show', '{}', v_tenant), '{}'),
        'googleReviewUrl', coalesce(public.get_setting('google_review_url', '""', v_tenant) #>> '{}', ''),
        'instagramHandle', coalesce(public.get_setting('instagram_handle', '""', v_tenant) #>> '{}', ''),
        'banners', v_banners,
        'announcement', coalesce(public.get_setting('portal_announcement', '{"on": false, "text": ""}', v_tenant), '{}'),
        'theme', coalesce(public.get_setting('portal_theme', '""', v_tenant) #>> '{}', ''),
        'tables', public.table_settings(v_tenant));
end;
$$;

-- ---------------------------------------------------------------------------
-- Order lines keep the choices (size, milk, flavours, combo picks) so Order again and favourites can repeat them
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_coupon_code text DEFAULT ''::text, p_table_id uuid DEFAULT NULL::uuid, p_special_instructions text DEFAULT ''::text, p_loyalty_offer_id uuid DEFAULT NULL::uuid, p_table_code text DEFAULT NULL::text, p_client_id text DEFAULT NULL::text, p_points_cash boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_customer_id uuid := public.current_customer_id();
    v_customer public.customers;
    v_tenant uuid;
    v_table public.dining_tables;
    v_calc jsonb;
    v_order_id uuid;
    v_tz text;
    v_client text := nullif(left(trim(coalesce(p_client_id, '')), 64), '');
    v_held boolean := false;
begin
    if v_customer_id is null then
        raise exception 'Please sign in first';
    end if;
    select * into v_customer from public.customers where id = v_customer_id for update;
    v_tenant := v_customer.tenant_id;
    if not public.tenant_active(v_tenant) then
        raise exception 'Ordering is paused at the moment. Please ask the staff.';
    end if;
    v_tz := public.cafe_timezone(v_tenant);

    -- A double tap or a retry on a slow network returns the first order instead of placing two
    if v_client is not null then
        select id into v_order_id from public.orders
         where tenant_id = v_tenant and client_id = v_client and customer_id = v_customer_id;
        if v_order_id is not null then
            return v_order_id;
        end if;
    end if;

    v_table := public.order_table_for(v_tenant, v_customer_id, p_table_id, p_table_code);
    if v_table.id is not null then
        perform 1 from public.dining_tables where id = v_table.id for update;
        -- A table nobody has been confirmed at yet: hold the order for staff when the owner asks for it
        v_held := (public.table_settings(v_tenant) ->> 'confirmFirst')::boolean
                  and not exists (select 1 from public.orders
                                   where table_id = v_table.id and status not in ('paid', 'cancelled') and not held);
    end if;

    -- Lock the coupon so its usage limit holds under concurrent orders
    if trim(coalesce(p_coupon_code, '')) <> '' then
        perform 1 from public.coupons
         where tenant_id = v_tenant and code = upper(trim(p_coupon_code)) for update;
    end if;

    v_calc := public.price_order(v_tenant, v_customer_id, p_items, p_coupon_code, p_loyalty_offer_id, 0, p_points_cash);

    if v_calc ->> 'couponId' is not null then
        update public.coupons set used_count = used_count + 1 where id = (v_calc ->> 'couponId')::uuid;
    end if;
    if (v_calc ->> 'pointsUsed')::integer > 0 then
        update public.customers set loyalty_points = loyalty_points - (v_calc ->> 'pointsUsed')::integer
         where id = v_customer_id;
    end if;

    insert into public.orders (
        tenant_id, order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate,
        tax_details, restaurant_info, total, table_id, table_number,
        special_instructions, loyalty_offer_id, points_redeemed, client_id, held)
    values (
        v_tenant,
        'ORD-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-'
            || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
        v_customer_id,
        (v_calc ->> 'subtotal')::numeric,
        (v_calc ->> 'discount')::numeric,
        v_calc ->> 'couponCode',
        (v_calc ->> 'tax')::numeric,
        coalesce((public.get_setting('gst_rate', '5', v_tenant) #>> '{}')::numeric, 5),
        v_calc -> 'taxDetails',
        jsonb_build_object(
            'name', public.get_setting('restaurant_name', '""', v_tenant) #>> '{}',
            'address', public.get_setting('restaurant_address', '""', v_tenant) #>> '{}',
            'phone', public.get_setting('restaurant_phone', '""', v_tenant) #>> '{}',
            'gstNumber', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
            'fssaiNumber', public.get_setting('fssai_number', '""', v_tenant) #>> '{}'),
        (v_calc ->> 'total')::numeric,
        v_table.id, coalesce(v_table.table_number, ''),
        left(coalesce(p_special_instructions, ''), 500),
        (v_calc ->> 'offerId')::uuid,
        (v_calc ->> 'pointsUsed')::integer,
        v_client, v_held)
    returning id into v_order_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost,
                                    note, options, combo_id)
    select v_order_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0),
           coalesce(l ->> 'note', ''), coalesce(l -> 'options', '{}'::jsonb), (l ->> 'combo_id')::uuid
      from jsonb_array_elements(v_calc -> 'lines') l;

    -- Busy/free is for staff only; customers never see it
    if v_table.id is not null then
        update public.dining_tables
           set status = 'occupied', is_occupied = true, current_order_id = v_order_id
         where id = v_table.id;
    end if;

    return v_order_id;
end;
$function$;

create or replace function public.create_staff_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_client text := nullif(trim(coalesce(p ->> 'clientId', '')), '');
    v_existing public.orders;
    v_channel text := coalesce(nullif(p ->> 'channel', ''), 'dine_in');
    v_customer uuid;
    v_table public.dining_tables;
    v_calc jsonb;
    v_manual numeric := round(coalesce(nullif(p ->> 'manualDiscount', '')::numeric, 0), 2);
    v_pct numeric;
    v_by text := '';
    v_number text := nullif(trim(coalesce(p ->> 'orderNumber', '')), '');
    v_id uuid;
    v_tz text := public.cafe_timezone(v_tenant);
    v_res jsonb;
    v_o public.orders;
begin
    perform public.require_perm('orders.create');
    if not public.tenant_active(v_tenant) then
        raise exception 'This cafe''s account is locked';
    end if;
    if v_client is not null then
        select * into v_existing from public.orders where tenant_id = v_tenant and client_id = v_client;
        if v_existing.id is not null then
            return public.order_json(v_existing) || jsonb_build_object('duplicate', true);
        end if;
    end if;
    if v_channel not in ('dine_in', 'takeaway', 'kiosk') then
        raise exception 'Unknown order type';
    end if;
    if v_number is not null and v_number !~ '^[A-Z0-9]{1,8}-[0-9]{6}-[0-9]{1,6}$' then
        raise exception 'Invalid order number';
    end if;

    v_customer := public.counter_customer(v_tenant, nullif(p ->> 'customerId', '')::uuid, p ->> 'customerPhone', p ->> 'customerName');

    if nullif(p ->> 'tableId', '') is not null then
        select * into v_table from public.dining_tables where id = (p ->> 'tableId')::uuid and tenant_id = v_tenant for update;
        if v_table.id is null then
            raise exception 'Table not found';
        end if;
    end if;

    if v_manual > 0 then
        if trim(coalesce(p ->> 'discountReason', '')) = '' then
            raise exception 'Give a reason for the discount';
        end if;
    end if;
    v_calc := public.price_order(v_tenant, v_customer, p -> 'items', p ->> 'couponCode', null, v_manual);
    if v_manual > 0 then
        v_pct := round((v_calc ->> 'manualDiscount')::numeric * 100 / nullif((v_calc ->> 'subtotal')::numeric, 0), 2);
        if v_pct > public.my_discount_limit() then
            if nullif(p ->> 'approverPhone', '') is null then
                raise exception 'Discount of % percent is above your limit of % percent. A manager must approve.', v_pct, public.my_discount_limit();
            end if;
            v_by := public.verify_approver(v_tenant, p ->> 'approverPhone', p ->> 'approverPin', 'sensitive.give_discount', v_pct);
        end if;
    end if;

    if v_calc ->> 'couponId' is not null then
        update public.coupons set used_count = used_count + 1 where id = (v_calc ->> 'couponId')::uuid;
    end if;

    insert into public.orders (
        tenant_id, order_number, customer_id, subtotal, discount, coupon_code, tax, gst_rate, tax_details, restaurant_info,
        total, table_id, table_number, special_instructions, status, channel, token_number, client_id, device_code,
        created_by_staff, staff_name, manual_discount, discount_reason, discount_approved_by)
    values (
        v_tenant,
        coalesce(v_number, 'ORD-' || to_char(now() at time zone v_tz, 'YYMMDD') || '-'
                           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
        v_customer, (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'discount')::numeric, v_calc ->> 'couponCode',
        (v_calc ->> 'tax')::numeric, coalesce((public.get_setting('gst_rate', '5', v_tenant) #>> '{}')::numeric, 5),
        v_calc -> 'taxDetails',
        jsonb_build_object(
            'name', public.get_setting('restaurant_name', '""', v_tenant) #>> '{}',
            'address', public.get_setting('restaurant_address', '""', v_tenant) #>> '{}',
            'phone', public.get_setting('restaurant_phone', '""', v_tenant) #>> '{}',
            'gstNumber', public.get_setting('gst_number', '""', v_tenant) #>> '{}',
            'fssaiNumber', public.get_setting('fssai_number', '""', v_tenant) #>> '{}',
            'footer', public.get_setting('bill_footer', '""', v_tenant) #>> '{}'),
        (v_calc ->> 'total')::numeric, v_table.id, coalesce(v_table.table_number, ''),
        left(coalesce(p ->> 'specialInstructions', ''), 500), 'confirmed', v_channel,
        left(coalesce(p ->> 'tokenNumber', ''), 12), v_client, left(coalesce(p ->> 'deviceCode', ''), 8),
        public.my_staff_id(), public.actor_name(), (v_calc ->> 'manualDiscount')::numeric,
        trim(coalesce(p ->> 'discountReason', '')), v_by)
    returning id into v_id;

    insert into public.order_items (order_id, menu_item_id, name, price, quantity, total, is_restricted,
                                    price_includes_tax, tax_rate, discount, net_amount, tax_amount, unit_cost,
                                    unit_name, unit_factor, note, options, combo_id)
    select v_id, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::numeric,
           (l ->> 'quantity')::integer, (l ->> 'total')::numeric, (l ->> 'is_restricted')::boolean,
           (l ->> 'price_includes_tax')::boolean, (l ->> 'tax_rate')::numeric, (l ->> 'discount')::numeric,
           (l ->> 'net_amount')::numeric, (l ->> 'tax_amount')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0),
           l ->> 'unit_name', (l ->> 'unit_factor')::numeric, coalesce(l ->> 'note', ''),
           coalesce(l -> 'options', '{}'::jsonb), (l ->> 'combo_id')::uuid
      from jsonb_array_elements(v_calc -> 'lines') l;

    if v_table.id is not null then
        update public.dining_tables set status = 'occupied', is_occupied = true, current_order_id = v_id where id = v_table.id;
    end if;
    -- Kiosk sales are handed over at once; they never go to the kitchen
    if v_channel = 'kiosk' then
        update public.order_items set kitchen_status = 'served' where order_id = v_id;
    end if;

    -- payFullBy: pay exactly what the bill comes to (used by offline devices, which cannot price the bill)
    if nullif(p ->> 'payFullBy', '') is not null then
        select * into v_o from public.orders where id = v_id;
        return public.settle_order(v_id, jsonb_build_array(jsonb_build_object('method', p ->> 'payFullBy', 'amount', v_o.total)),
                                   coalesce(nullif(p ->> 'drawer', ''), 'cash_counter'), coalesce(v_client, v_id::text) || ':pay',
                                   p ->> 'approverPhone', p ->> 'approverPin');
    end if;
    if jsonb_typeof(p -> 'payments') = 'array' and jsonb_array_length(p -> 'payments') > 0 then
        return public.settle_order(v_id, p -> 'payments', coalesce(nullif(p ->> 'drawer', ''), 'cash_counter'),
                                   coalesce(v_client, v_id::text) || ':pay',
                                   p ->> 'approverPhone', p ->> 'approverPin');
    end if;
    select * into v_o from public.orders where id = v_id;
    return public.order_json(v_o);
end;
$$;

-- ---------------------------------------------------------------------------
-- Combos marked double points: when the order is paid, the combo lines earn their points a second time
-- (runs after orders_status_change, which awards the normal points; same-timing triggers run in name order)
-- ---------------------------------------------------------------------------
create or replace function public.orders_combo_points() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_settings public.loyalty_settings;
    v_base numeric;
    v_extra integer;
begin
    if new.status = 'paid' and old.status <> 'paid' and new.customer_id is not null and new.points_awarded > 0 then
        select * into v_settings from public.loyalty_settings where tenant_id = new.tenant_id;
        select coalesce(sum(oi.total - oi.discount), 0) into v_base
          from public.order_items oi
         where oi.order_id = new.id and oi.combo_id is not null and coalesce((oi.options ->> 'doublePoints')::boolean, false);
        v_extra := floor(v_base * coalesce(v_settings.points_per_rupee, 0));
        if v_extra > 0 then
            update public.customers
               set loyalty_points = loyalty_points + v_extra,
                   total_points_earned = total_points_earned + v_extra
             where id = new.customer_id;
            new.points_awarded := new.points_awarded + v_extra;
        end if;
    end if;
    return new;
end;
$$;
drop trigger if exists orders_status_combo_points on public.orders;
create trigger orders_status_combo_points before update of status on public.orders
    for each row execute function public.orders_combo_points();

-- ==== 20261030000002_staff_choices.sql ====
-- Staff screens: sizes, choices and combos
--   kitchen_orders: each line also says whether it is a combo, and for a combo the stations of its picks,
--                   so the coffee bar sees a combo that holds a drink
--   order_json:     each line also carries comboId and options (size, choices, combo picks)
--   deduct_order_line: kiosk sales take stock from the kiosk again and packs count their pieces (lost in the redesign file)

create or replace function public.kitchen_orders()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
                                                                 'combo', oi.combo_id is not null,
                                                                 'station', public.item_station(oi.menu_item_id),
                                                                 'stations', case when oi.combo_id is null then null else
                                                                     (select coalesce(jsonb_agg(distinct public.item_station((pk ->> 'menuItem')::uuid)), '[]'::jsonb)
                                                                        from jsonb_array_elements(coalesce(oi.options -> 'picks', '[]'::jsonb)) pk
                                                                       where nullif(pk ->> 'menuItem', '') is not null) end)
                                       order by oi.name)
                               from public.order_items oi where oi.order_id = o.id))
                   order by o.created_at), '[]'::jsonb)
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where o.tenant_id = public.current_tenant_id()
           and o.status <> 'cancelled' and o.channel <> 'kiosk' and not o.held
           and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.kitchen_status <> 'served')
           and o.created_at > now() - interval '24 hours');
end;
$function$;

create or replace function public.order_json(o orders)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
        '_id', o.id, 'id', o.id,
        'orderNumber', o.order_number,
        'user', case when c.id is null then public.order_customer_brief(o.customer_id, o.tenant_id) else
            jsonb_build_object('_id', c.id, 'name', c.name,
                'phone', case when public.can_see_phone(c.id) then c.phone else public.mask_phone(c.phone) end,
                'email', c.email) end,
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                '_id', oi.id,
                'menuItem', case when mi.id is null then null else
                    jsonb_build_object('_id', mi.id, 'name', mi.name, 'image', mi.image, 'price', mi.price) end,
                'name', oi.name, 'price', oi.price, 'quantity', oi.quantity, 'total', oi.total,
                'discount', oi.discount, 'taxRate', oi.tax_rate, 'isRestricted', oi.is_restricted,
                'kitchenStatus', oi.kitchen_status, 'unitName', oi.unit_name, 'note', oi.note,
                'comboId', oi.combo_id, 'options', oi.options)
                order by oi.name)
              from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = o.id), '[]'::jsonb),
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by method)
              from (select le.method, sum(le.amount) as amt from public.ledger_entries le
                     where le.order_id = o.id and le.kind in ('sale', 'refund', 'khata_sale')
                     group by le.method having sum(le.amount) <> 0) p), '[]'::jsonb),
        'subtotal', o.subtotal, 'discount', o.discount, 'couponCode', o.coupon_code,
        'manualDiscount', o.manual_discount, 'discountReason', o.discount_reason,
        'tax', o.tax, 'gstRate', o.gst_rate, 'taxDetails', o.tax_details,
        'serviceCharge', o.service_charge, 'serviceChargeTax', o.service_charge_tax,
        'serviceChargeRemoved', o.service_charge_removed, 'roundOff', o.round_off,
        'restaurantInfo', o.restaurant_info, 'total', o.total, 'status', o.status,
        'paymentMethod', o.payment_method, 'amountPaid', o.amount_paid,
        'paymentRequest', o.payment_request, 'paymentRequestedAt', o.payment_requested_at,
        'tableNumber', o.table_number, 'table', o.table_id, 'held', o.held, 'holdReason', o.hold_reason,
        'channel', o.channel, 'tokenNumber', o.token_number, 'staffName', o.staff_name, 'deviceCode', o.device_code,
        'cancelReason', o.cancel_reason, 'cancelledAfterKitchen', o.cancelled_after_kitchen,
        'specialInstructions', o.special_instructions,
        'loyaltyOffer', o.loyalty_offer_id, 'pointsRedeemed', o.points_redeemed,
        'pointsAwarded', o.points_awarded,
        'paidAt', o.paid_at, 'readyAt', o.ready_at,
        'createdAt', o.created_at, 'updatedAt', o.updated_at)
      from (select 1) x
      left join public.customers c on c.id = o.customer_id;
$function$;

-- Stock for a sale line: kiosk sales take stock from the kiosk location, packs count their pieces,
-- and a combo takes the recipe of each dish picked (the combo line has no dish of its own)
create or replace function public.deduct_order_line(p_line public.order_items) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_o public.orders;
    v_kiosk uuid;
    v_loc uuid;
    v_mi uuid;
    v_mult numeric := p_line.quantity * coalesce(p_line.unit_factor, 1);
begin
    select * into v_o from public.orders where id = p_line.order_id;
    if v_o.channel = 'kiosk' then
        v_kiosk := (select id from public.stock_locations where tenant_id = v_o.tenant_id and default_for_kiosk and is_active);
    end if;
    for v_mi in
        select p_line.menu_item_id where p_line.menu_item_id is not null
        union all
        select (pk ->> 'menuItem')::uuid from jsonb_array_elements(coalesce(p_line.options -> 'picks', '[]'::jsonb)) pk
         where p_line.menu_item_id is null and nullif(pk ->> 'menuItem', '') is not null
    loop
        v_loc := coalesce(v_kiosk, public.sale_location(v_mi));
        if v_loc is null then
            continue;
        end if;
        insert into public.stock_moves (tenant_id, item_id, location_id, quantity, unit_cost, kind, order_id, menu_item_id, note, actor_name)
        select v_o.tenant_id, r.item_id, v_loc, -round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3), i.cost_per_unit,
               'sale', p_line.order_id, v_mi, p_line.name || ' × ' || p_line.quantity, 'Sale'
          from public.recipe_lines r join public.inventory i on i.id = r.item_id
         where r.menu_item_id = v_mi and i.track_stock
           and round(r.quantity * (1 + r.waste_pct / 100) * v_mult, 3) <> 0;
    end loop;
end;
$$;
revoke execute on function public.deduct_order_line(public.order_items) from public, anon, authenticated;

commit;
