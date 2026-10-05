-- Cafe ERP · Brand and look: audit labels upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261020000001_brand_audit.sql ====
-- Brand & look (part 3): readable Audit log lines for brand changes, e.g. "Brand & look: main colour"
-- instead of the raw setting key. Everything else in the audit trigger is unchanged.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.
create or replace function public.setting_label(p_key text) returns text
language sql immutable set search_path = public, pg_temp as $$
    select case p_key
        when 'restaurant_name' then 'Brand & look: cafe name'
        when 'restaurant_address' then 'Brand & look: address'
        when 'restaurant_phone' then 'Brand & look: phone'
        when 'brand_tagline' then 'Brand & look: short line under the name'
        when 'brand_hero' then 'Brand & look: banner text'
        when 'brand_logo' then 'Brand & look: logo'
        when 'brand_email' then 'Brand & look: email'
        when 'brand_instagram' then 'Brand & look: Instagram link'
        when 'brand_facebook' then 'Brand & look: Facebook link'
        when 'brand_hours_days' then 'Brand & look: open on'
        when 'brand_hours_time' then 'Brand & look: hours'
        when 'brand_main' then 'Brand & look: main colour'
        when 'brand_accent' then 'Brand & look: second colour'
        when 'brand_corners' then 'Brand & look: corners'
        when 'brand_font' then 'Brand & look: font'
        when 'brand_cx_mode' then 'Brand & look: customer app light or dark'
        when 'portal_theme' then 'Customer app: main colour'
        else coalesce(p_key, '') end;
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ignore text[] := array['updated_at', 'failed_attempts', 'last_login_at', 'locked_until',
                             'current_stock', 'last_restocked', 'is_low_stock', 'cost_per_unit', 'paid_amount'];
    v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'pin_hash' - 'salary' end;
    v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'pin_hash' - 'salary' end;
    v_row jsonb := coalesce(v_new, v_old);
    v_summary text;
begin
    if tg_op = 'UPDATE' and (v_old - v_ignore) = (v_new - v_ignore) then
        if tg_table_name = 'purchases' and v_old ->> 'paid_amount' is distinct from v_new ->> 'paid_amount' then
            v_summary := 'Payment: ' || coalesce(v_new ->> 'vendor_name', '') || ' bill ' || coalesce(v_new ->> 'bill_number', '')
                         || ' paid ₹' || (v_new ->> 'paid_amount');
        elsif tg_table_name <> 'staff_users' then
            return null;
        -- (nested: a record field can only be read on the table that has it)
        elsif old.pin_hash is distinct from new.pin_hash then
            v_summary := 'PIN reset';
        else
            return null;
        end if;
    end if;
    if tg_table_name = 'orders' and tg_op = 'INSERT' then
        return null;
    end if;
    if tg_table_name = 'orders' and tg_op = 'UPDATE' then
        if new.status = old.status and new.amount_paid = old.amount_paid and new.payment_method = old.payment_method then
            return null;
        end if;
    end if;
    if tg_table_name = 'purchases' and v_summary is null then
        v_summary := 'Purchase: ' || coalesce(v_row ->> 'vendor_name', '') || ' bill ' || coalesce(v_row ->> 'bill_number', '')
                     || ' ₹' || coalesce(v_row ->> 'total', '0')
                     || case when (v_row ->> 'is_void')::boolean then ' (undone)' else '' end;
    end if;
    if tg_table_name = 'settings' and v_summary is null then
        v_summary := public.setting_label(v_row ->> 'key');
    end if;
    insert into public.audit_log (tenant_id, actor_user, actor_staff, actor_name, action, entity, entity_id, summary, old_data, new_data)
    values (
        (v_row ->> 'tenant_id')::uuid,
        auth.uid(),
        (select staff_id from public.profiles where id = auth.uid()),
        public.actor_name(),
        lower(tg_op), tg_table_name,
        coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'role_id', v_row ->> 'staff_id', ''),
        coalesce(v_summary, v_row ->> 'name', v_row ->> 'order_number', v_row ->> 'code', v_row ->> 'key', v_row ->> 'perm', ''),
        v_old, v_new);
    return null;
end;
$$;

commit;
