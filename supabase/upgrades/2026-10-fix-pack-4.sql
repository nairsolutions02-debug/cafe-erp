-- Cafe ERP · Fix pack 4: accountant decisions, kiosk home, stale kiosk slots upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261027000001_fix_pack_4.sql ====
-- Fix pack 4, from the accountant and kiosk operator test run.
-- 1. Profit advisor decisions (mark done, remind me, dismiss) need finance.edit: the accountant reads, the owner decides.
-- 2. The standard Kiosk operator role opens on the Kiosk page after login.
-- 3. A kiosk not used for 14 days gives its plan slot back when a new kiosk is set up (a cleared browser
--    or a replaced tablet no longer blocks the cafe). If that old kiosk comes back it is set up again.
-- No apostrophes in comments: the SQL Editor splitter treats them as quotes.

-- 1. Decisions on suggestions
do $do$
declare
    v_def text := pg_get_functiondef('public.decide_suggestion'::regproc);
begin
    if position('require_perm(''finance.view'')' in v_def) > 0 then
        execute replace(v_def, 'require_perm(''finance.view'')', 'require_perm(''finance.edit'')');
    end if;
end;
$do$;

-- 2. Kiosk operator opens on Kiosk
update public.roles set home_path = '/admin/kiosk' where name = 'Kiosk operator' and home_path is null;

create or replace function public.roles_default_home() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if new.home_path is null then
        new.home_path := case new.name when 'Waiter' then '/admin/orders' when 'Chef' then '/admin/kitchen'
                                       when 'Kiosk operator' then '/admin/kiosk' end;
    end if;
    return new;
end;
$$;

-- 3. Kiosk slots: free kiosks not seen for 14 days before refusing a new one
create or replace function public.register_device(p_kind text, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_prefix text := case p_kind when 'counter' then 'C' when 'kiosk' then 'K' when 'kitchen' then 'D' else 'P' end;
    v_max integer;
    v_n integer;
    v_code text;
begin
    perform public.require_perm('orders.view');
    if p_kind not in ('counter', 'kiosk', 'kitchen', 'phone') then
        raise exception 'Unknown device type';
    end if;
    perform pg_advisory_xact_lock(hashtext('devices:' || v_tenant::text));
    if p_kind = 'kiosk' then
        select p.max_kiosks into v_max from public.tenants t join public.plans p on p.id = t.plan_id where t.id = v_tenant;
        if v_max is not null and (select count(*) from public.devices where tenant_id = v_tenant and kind = 'kiosk' and is_active) >= v_max then
            update public.devices set is_active = false
             where tenant_id = v_tenant and kind = 'kiosk' and is_active and last_seen_at < now() - interval '14 days';
        end if;
        if v_max is not null and (select count(*) from public.devices where tenant_id = v_tenant and kind = 'kiosk' and is_active) >= v_max then
            raise exception 'Your plan allows % kiosk%. Upgrade the plan to add more.', v_max, case when v_max = 1 then '' else 's' end;
        end if;
    end if;
    select coalesce(max(substr(code, 2)::integer), 0) + 1 into v_n
      from public.devices where tenant_id = v_tenant and code ~ ('^' || v_prefix || '[0-9]+$');
    v_code := v_prefix || v_n;
    insert into public.devices (tenant_id, code, kind, name, registered_by)
    values (v_tenant, v_code, p_kind, coalesce(nullif(trim(p_name), ''), initcap(p_kind) || ' ' || v_n), public.actor_name());
    return jsonb_build_object('code', v_code, 'kind', p_kind);
end;
$$;

commit;
