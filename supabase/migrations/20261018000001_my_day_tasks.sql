-- My day (phone redesign part 3): the cafe daily task list and the staff member own numbers for today.
-- The owner (or anyone who can manage staff) sets the list; anyone on shift ticks a task, and everyone sees who did it.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

create table public.daily_tasks (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    title text not null,
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);
create index daily_tasks_tenant on public.daily_tasks (tenant_id, sort_order);
alter table public.daily_tasks enable row level security;
create policy "tenant staff read tasks" on public.daily_tasks for select to authenticated
    using (tenant_id = public.current_tenant_id());

create table public.daily_task_ticks (
    task_id uuid not null references public.daily_tasks (id) on delete cascade,
    day date not null,
    staff_id uuid references public.staff_users (id) on delete set null,
    staff_name text not null default '',
    done_at timestamptz not null default now(),
    primary key (task_id, day)
);
alter table public.daily_task_ticks enable row level security;

create function public.daily_task_list(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title,
               'done', k.task_id is not null, 'by', k.staff_name, 'at', k.done_at) order by t.sort_order, t.created_at), '[]'::jsonb)
      from public.daily_tasks t
      left join public.daily_task_ticks k on k.task_id = t.id and k.day = public.cafe_today(p_tenant)
     where t.tenant_id = p_tenant and t.is_active;
$$;
revoke execute on function public.daily_task_list(uuid) from public, anon, authenticated;

-- Tasks for today, my orders and paid sales today, and whether I may edit the list
create function public.my_day_extras() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    v_staff uuid := public.my_staff_id();
    v_day date;
begin
    if v_tenant is null or not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'staff')) then
        raise exception 'Please log in to the admin app first';
    end if;
    v_day := public.cafe_today(v_tenant);
    return jsonb_build_object(
        'tasks', public.daily_task_list(v_tenant),
        'canEditTasks', public.has_perm('staff.view'),
        'today', case when v_staff is null then null else (
            select jsonb_build_object('orders', count(*), 'sales', coalesce(sum(total) filter (where status = 'paid'), 0))
              from public.orders
             where tenant_id = v_tenant and created_by_staff = v_staff and status <> 'cancelled'
               and (created_at at time zone public.cafe_timezone(v_tenant))::date = v_day) end);
end;
$$;

create function public.tick_daily_task(p_id uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
begin
    if not exists (select 1 from public.daily_tasks where id = p_id and tenant_id = v_tenant and is_active) then
        raise exception 'Task not found';
    end if;
    if p_done then
        insert into public.daily_task_ticks (task_id, day, staff_id, staff_name)
        values (p_id, public.cafe_today(v_tenant), public.my_staff_id(), public.actor_name())
        on conflict (task_id, day) do nothing;
    else
        delete from public.daily_task_ticks where task_id = p_id and day = public.cafe_today(v_tenant);
    end if;
    return public.daily_task_list(v_tenant);
end;
$$;

-- Replace the list: [{ id?, title }] in order. Tasks left out are switched off (their history stays).
create function public.save_daily_tasks(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tenant uuid := public.current_tenant_id();
    r record;
    v_keep uuid[] := '{}';
    v_id uuid;
begin
    if not public.has_perm('staff.view') then raise exception 'Only the owner or a manager can change the task list'; end if;
    if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then raise exception 'Up to 30 tasks'; end if;
    for r in select value as t, ordinality as n from jsonb_array_elements(p) with ordinality loop
        if length(trim(coalesce(r.t ->> 'title', ''))) = 0 then continue; end if;
        v_id := null;
        if coalesce(r.t ->> 'id', '') <> '' then
            update public.daily_tasks set title = left(trim(r.t ->> 'title'), 120), sort_order = r.n, is_active = true
             where id = (r.t ->> 'id')::uuid and tenant_id = v_tenant
            returning id into v_id;
        end if;
        if v_id is null then
            insert into public.daily_tasks (tenant_id, title, sort_order) values (v_tenant, left(trim(r.t ->> 'title'), 120), r.n)
            returning id into v_id;
        end if;
        v_keep := v_keep || v_id;
    end loop;
    update public.daily_tasks set is_active = false where tenant_id = v_tenant and is_active and not (id = any (v_keep));
    return public.daily_task_list(v_tenant);
end;
$$;
