-- Fix pack after the full test run (2026-10-05).
-- 1. A new staff login is linked to the employee with the same phone, or gets a basic employee record,
--    so attendance (check-in) works without the owner linking it by hand. Owners are left out.
-- 2. Existing logins without an employee are linked when an employee with the same phone exists.
-- 3. setup_status(): counts for the owner Setup checklist and the Devices card.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

create or replace function public.ensure_staff_employee(p_staff uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_st public.staff_users;
    v_role text;
    v_owner boolean;
    v_emp uuid;
begin
    select * into v_st from public.staff_users where id = p_staff;
    if v_st.id is null then
        return;
    end if;
    select lower(r.name), r.is_owner into v_role, v_owner from public.roles r where r.id = v_st.role_id;
    if coalesce(v_owner, false) then
        return;
    end if;
    if exists (select 1 from public.employees e where e.staff_id = v_st.id) then
        return;
    end if;
    -- Use an existing employee only when exactly one has this phone
    select min(e.id::text)::uuid into v_emp
      from public.employees e
     where e.tenant_id = v_st.tenant_id and e.staff_id is null and e.is_active
       and right(regexp_replace(e.phone, '\D', '', 'g'), 10) = v_st.phone
    having count(*) = 1;
    if v_emp is not null then
        update public.employees set staff_id = v_st.id where id = v_emp;
    else
        insert into public.employees (tenant_id, name, phone, role, staff_id)
        values (v_st.tenant_id, v_st.name, v_st.phone,
                case when v_role in ('chef', 'waiter', 'cashier', 'manager', 'cleaner') then v_role
                     when v_role like '%kitchen%' or v_role like '%cook%' then 'chef'
                     else 'other' end,
                v_st.id);
    end if;
end;
$$;
revoke execute on function public.ensure_staff_employee(uuid) from public, anon, authenticated;

create or replace function public.staff_link_employee() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.ensure_staff_employee(new.id);
    return null;
end;
$$;

-- Setup checklist button: link or create employee records for every active login that has none
create or replace function public.link_all_staff_employees() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_n integer := 0;
    v_s record;
begin
    perform public.require_perm('employees.create');
    for v_s in select s.id from public.staff_users s join public.roles r on r.id = s.role_id
                where s.tenant_id = public.current_tenant_id() and s.is_active and not r.is_owner
                  and not exists (select 1 from public.employees e where e.staff_id = s.id) loop
        perform public.ensure_staff_employee(v_s.id);
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;
grant execute on function public.link_all_staff_employees() to authenticated;

drop trigger if exists staff_link_employee on public.staff_users;
create trigger staff_link_employee after insert on public.staff_users
    for each row execute function public.staff_link_employee();

-- Existing logins: link by phone only, and only when exactly one employee and one login share that phone
with pairs as (
    select s.id as staff_id, e.id as emp_id,
           count(*) over (partition by s.id) as per_staff,
           count(*) over (partition by e.id) as per_emp
      from public.staff_users s
      join public.roles r on r.id = s.role_id and not r.is_owner
      join public.employees e on e.tenant_id = s.tenant_id and e.staff_id is null and e.is_active
                             and right(regexp_replace(e.phone, '\D', '', 'g'), 10) = s.phone
     where s.is_active
       and not exists (select 1 from public.employees x where x.staff_id = s.id)
)
update public.employees e
   set staff_id = p.staff_id
  from pairs p
 where e.id = p.emp_id and p.per_staff = 1 and p.per_emp = 1;

-- Owner Setup checklist and Devices card
create or replace function public.setup_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
begin
    perform public.require_perm('settings.view');
    return jsonb_build_object(
        'menuItems', (select count(*) from public.menu_items where tenant_id = v_tenant),
        'tables', (select count(*) from public.dining_tables where tenant_id = v_tenant and is_active),
        'staff', (select count(*) from public.staff_users s join public.roles r on r.id = s.role_id
                   where s.tenant_id = v_tenant and s.is_active and not r.is_owner),
        'staffUnlinked', (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb)
                            from public.staff_users s join public.roles r on r.id = s.role_id
                           where s.tenant_id = v_tenant and s.is_active and not r.is_owner
                             and not exists (select 1 from public.employees e where e.staff_id = s.id and e.is_active)),
        'kiosksActive', (select count(*) from public.devices where tenant_id = v_tenant and kind = 'kiosk' and is_active),
        'maxKiosks', (select p.max_kiosks from public.tenants t join public.plans p on p.id = t.plan_id where t.id = v_tenant),
        'shiftsEver', (select count(*) from public.shifts where tenant_id = v_tenant)
    );
end;
$$;

grant execute on function public.setup_status() to authenticated;
