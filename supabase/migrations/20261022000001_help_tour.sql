-- Help layer: the guided tour starts once at a person first login, then is remembered for that person
-- (not per phone, so a new phone does not start it again). Help and support can run it again any time.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

alter table public.person_settings add column if not exists tour_done_at timestamptz;

-- true when the signed-in person has finished or skipped the tour
create or replace function public.my_tour_done() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select s.tour_done_at is not null
                       from public.person_settings s
                      where s.tenant_id = public.current_tenant_id() and s.person = public.my_person()), false);
$$;

create or replace function public.mark_tour_done() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_person text := public.my_person();
    v_tenant uuid := public.current_tenant_id();
begin
    if v_person is null or v_tenant is null then
        raise exception 'Not signed in';
    end if;
    insert into public.person_settings (tenant_id, person, tour_done_at)
    values (v_tenant, v_person, now())
    on conflict (tenant_id, person) do update set tour_done_at = coalesce(public.person_settings.tour_done_at, excluded.tour_done_at);
end;
$$;

grant execute on function public.my_tour_done() to authenticated;
grant execute on function public.mark_tour_done() to authenticated;
