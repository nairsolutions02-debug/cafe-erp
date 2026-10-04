-- Collect-your-order screen: a big screen in the cafe shows which orders are being prepared and which are
-- ready to collect at the serving counter. Each screen opens a private link (/display/<key>), so the TV
-- needs no staff login and nobody outside can read the board without the link.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

-- ---------------------------------------------------------------------------
-- Screens (one row per TV)
-- ---------------------------------------------------------------------------
create table public.pickup_screens (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade default public.current_tenant_id(),
    name text not null default 'Pickup screen',
    key text not null unique,
    last_seen_at timestamptz,
    created_at timestamptz not null default now()
);
create index pickup_screens_tenant_idx on public.pickup_screens (tenant_id);
alter table public.pickup_screens enable row level security;
create policy "staff read" on public.pickup_screens for select
    using (tenant_id = (select public.current_tenant_id()) and (select public.has_perm('orders.view')));

create function public.create_pickup_screen(p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_s public.pickup_screens;
begin
    perform public.require_perm('settings.edit');
    if (select count(*) from public.pickup_screens where tenant_id = public.current_tenant_id()) >= 5 then
        raise exception 'Up to 5 screens per cafe';
    end if;
    insert into public.pickup_screens (tenant_id, name, key)
    values (public.current_tenant_id(), coalesce(nullif(left(trim(p_name), 40), ''), 'Pickup screen'),
            replace(gen_random_uuid()::text, '-', ''))
    returning * into v_s;
    return jsonb_build_object('id', v_s.id, 'name', v_s.name, 'key', v_s.key);
end;
$$;

create function public.delete_pickup_screen(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.require_perm('settings.edit');
    delete from public.pickup_screens where id = p_id and tenant_id = public.current_tenant_id();
end;
$$;

-- ---------------------------------------------------------------------------
-- Pickup numbers: counter and kiosk orders already carry a token; QR orders get Q1, Q2, Q3 for the day
-- ---------------------------------------------------------------------------
create function public.orders_qr_token() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone(new.tenant_id);
    v_day timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
    v_n integer;
begin
    if new.channel = 'qr' and coalesce(new.token_number, '') = '' then
        perform pg_advisory_xact_lock(hashtext('qr-token:' || new.tenant_id::text));
        select coalesce(max(nullif(substr(token_number, 2), '')::integer), 0) + 1 into v_n
          from public.orders
         where tenant_id = new.tenant_id and channel = 'qr' and created_at >= v_day and token_number ~ '^Q[0-9]+$';
        new.token_number := 'Q' || v_n;
    end if;
    return new;
end;
$$;
create trigger orders_qr_token before insert on public.orders
    for each row execute function public.orders_qr_token();

-- Ready time for every order, also ones paid up front (their status stays paid while the kitchen cooks)
create function public.order_items_ready_at() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.kitchen_status = 'ready' and old.kitchen_status is distinct from 'ready'
       and not exists (select 1 from public.order_items
                        where order_id = new.order_id and kitchen_status in ('queued', 'preparing')) then
        update public.orders set ready_at = coalesce(ready_at, now()) where id = new.order_id;
    end if;
    return null;
end;
$$;
create trigger order_items_ready_at after update of kitchen_status on public.order_items
    for each row execute function public.order_items_ready_at();

-- ---------------------------------------------------------------------------
-- Settings (public.settings, per cafe)
--   pickup_show_names: first name under the number (default on)
--   pickup_include_tables: also show orders served at tables (default off, those go to the table)
--   pickup_ready_minutes: a ready order leaves the screen after this many minutes even if not marked collected (default 10)
--   pickup_message: line under the Ready heading
-- ---------------------------------------------------------------------------
create function public.pickup_settings(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'showNames', coalesce((public.get_setting('pickup_show_names', 'true', p_tenant) #>> '{}')::boolean, true),
        'includeTables', coalesce((public.get_setting('pickup_include_tables', 'false', p_tenant) #>> '{}')::boolean, false),
        'readyMinutes', greatest(1, least(120, coalesce((public.get_setting('pickup_ready_minutes', '10', p_tenant) #>> '{}')::integer, 10))),
        'message', coalesce(nullif(public.get_setting('pickup_message', '""', p_tenant) #>> '{}', ''),
                            'Please collect your order from the serving counter'));
$$;

-- The label a customer looks for on the screen
create function public.pickup_label(o public.orders) returns text
language sql immutable set search_path = public, pg_temp as $$
    select coalesce(nullif(o.token_number, ''), nullif('T' || o.table_number, 'T'), right(o.order_number, 4));
$$;

-- ---------------------------------------------------------------------------
-- The board itself: public, but only with a screen key
-- ---------------------------------------------------------------------------
-- Orders on the board follow the kitchen: cooking while any dish is queued or being made,
-- ready when every dish is ready (or already handed over) and at least one is still waiting
create function public.pickup_rows(p_tenant uuid, p_names boolean, p_tables boolean)
returns table (id uuid, label text, name text, table_number text, created_at timestamptz, started boolean,
               open integer, ready integer, ready_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
    select o.id, public.pickup_label(o),
           case when p_names then split_part(trim(coalesce(c.name, '')), ' ', 1) else '' end,
           o.table_number, o.created_at,
           k.started > 0 or o.status = 'preparing',
           k.open, k.ready,
           coalesce(o.ready_at, o.updated_at)
      from public.orders o
      left join public.customers c on c.id = o.customer_id
      cross join lateral (
          select count(*) filter (where oi.kitchen_status in ('queued', 'preparing'))::integer as open,
                 count(*) filter (where oi.kitchen_status = 'ready')::integer as ready,
                 count(*) filter (where oi.kitchen_status <> 'queued')::integer as started
            from public.order_items oi where oi.order_id = o.id) k
     where o.tenant_id = p_tenant and o.channel <> 'kiosk' and not o.held and o.status <> 'cancelled'
       and (p_tables or o.table_id is null)
       and o.created_at > now() - interval '2 hours';
$$;
revoke execute on function public.pickup_rows(uuid, boolean, boolean) from public, anon, authenticated;

-- p_preview: the small preview on the admin page, which should not mark the TV as on
create function public.pickup_board(p_key text, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
    v_s public.pickup_screens;
    v_cfg jsonb;
    v_names boolean;
    v_tables boolean;
    v_mins integer;
begin
    select * into v_s from public.pickup_screens where key = trim(coalesce(p_key, ''));
    if v_s.id is null then
        return jsonb_build_object('ok', false);
    end if;
    if not p_preview then
        update public.pickup_screens set last_seen_at = now() where id = v_s.id;
    end if;
    v_cfg := public.pickup_settings(v_s.tenant_id);
    v_names := (v_cfg ->> 'showNames')::boolean;
    v_tables := (v_cfg ->> 'includeTables')::boolean;
    v_mins := (v_cfg ->> 'readyMinutes')::integer;

    return (with board as (select * from public.pickup_rows(v_s.tenant_id, v_names, v_tables))
    select jsonb_build_object(
        'ok', true,
        'screen', v_s.name,
        'cafe', coalesce(public.get_setting('restaurant_name', '""', v_s.tenant_id) #>> '{}', ''),
        'settings', v_cfg,
        'announcement', coalesce(public.get_setting('portal_announcement', '{}', v_s.tenant_id), '{}'),
        'theme', coalesce(public.get_setting('portal_theme', '""', v_s.tenant_id) #>> '{}', ''),
        'now', now(),
        'preparing', coalesce((
            select jsonb_agg(jsonb_build_object('id', b.id, 'label', b.label, 'name', b.name, 'table', b.table_number,
                                                'since', b.created_at, 'started', b.started) order by b.created_at)
              from board b where b.open > 0), '[]'::jsonb),
        'ready', coalesce((
            select jsonb_agg(jsonb_build_object('id', b.id, 'label', b.label, 'name', b.name, 'table', b.table_number,
                                                'readyAt', b.ready_at) order by b.ready_at desc)
              from board b where b.open = 0 and b.ready > 0 and b.ready_at > now() - make_interval(mins => v_mins)), '[]'::jsonb)));
end;
$$;

-- Staff view of the same board (admin page preview and the Collected buttons)
create function public.pickup_staff_board() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_cfg jsonb := public.pickup_settings(public.current_tenant_id());
begin
    perform public.require_perm('orders.view');
    return (with board as (select * from public.pickup_rows(v_tenant, true, (v_cfg ->> 'includeTables')::boolean))
    select jsonb_build_object(
        'settings', v_cfg,
        'preparing', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'label', b.label, 'name', b.name, 'table', b.table_number,
                                                                  'since', b.created_at, 'started', b.started) order by b.created_at)
                                 from board b where b.open > 0), '[]'::jsonb),
        'ready', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'label', b.label, 'name', b.name, 'table', b.table_number,
                                                              'readyAt', b.ready_at) order by b.ready_at desc)
                             from board b where b.open = 0 and b.ready > 0
                              and b.ready_at > now() - make_interval(mins => (v_cfg ->> 'readyMinutes')::integer)), '[]'::jsonb)));
end;
$$;
