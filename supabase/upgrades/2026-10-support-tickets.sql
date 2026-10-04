-- Cafe ERP · Help guide and support tickets upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261016000001_support_tickets.sql ====
-- Support tickets: any staff member raises a problem or question from the web app or the phone app;
-- N.A.I.R. Solutions answers from the platform console. Both sides see the conversation and the status.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

create table public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    number integer not null,
    created_by uuid,
    staff_id uuid,
    author_name text not null default '',
    author_phone text not null default '',
    category text not null default 'problem' check (category in ('problem', 'question', 'idea', 'billing', 'other')),
    urgent boolean not null default false,
    subject text not null,
    message text not null,
    page text not null default '',
    device jsonb not null default '{}',
    screenshot text not null default '',
    status text not null default 'open' check (status in ('open', 'working', 'waiting', 'resolved', 'closed')),
    unread_cafe boolean not null default false,
    unread_platform boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, number)
);
create index support_tickets_tenant on public.support_tickets (tenant_id, updated_at desc);
create index support_tickets_status on public.support_tickets (status, updated_at desc);
alter table public.support_tickets enable row level security;

create table public.support_messages (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null references public.support_tickets (id) on delete cascade,
    from_platform boolean not null default false,
    author_name text not null default '',
    body text not null,
    created_at timestamptz not null default now()
);
create index support_messages_ticket on public.support_messages (ticket_id, created_at);
alter table public.support_messages enable row level security;

-- Screenshots: private bucket, folder per cafe; staff upload, platform reads through signed links
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support', 'support', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "staff upload support" on storage.objects for insert to authenticated
    with check (bucket_id = 'support' and public.current_tenant_id() is not null
                and (storage.foldername(name))[1] = public.current_tenant_id()::text);
create policy "staff or platform read support" on storage.objects for select to authenticated
    using (bucket_id = 'support' and ((storage.foldername(name))[1] = public.current_tenant_id()::text or public.is_platform_admin()));

-- Who is raising it (owner email login or staff PIN login), even when the cafe subscription is locked
create function public.support_actor() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'tenant', p.tenant_id, 'staff', p.staff_id,
        'name', coalesce(nullif(public.actor_name(), ''), s.name, 'Owner'),
        'phone', coalesce(s.phone, ''))
      from public.profiles p left join public.staff_users s on s.id = p.staff_id
     where p.id = auth.uid() and p.role in ('admin', 'staff') and p.tenant_id is not null;
$$;
revoke execute on function public.support_actor() from public, anon, authenticated;

create function public.support_ticket_json(t public.support_tickets, p_platform boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'id', t.id, 'number', t.number, 'category', t.category, 'urgent', t.urgent, 'subject', t.subject, 'message', t.message,
        'page', t.page, 'device', t.device, 'screenshot', t.screenshot, 'status', t.status,
        'author', t.author_name, 'authorPhone', case when p_platform then t.author_phone else '' end,
        'unread', case when p_platform then t.unread_platform else t.unread_cafe end,
        'cafe', case when p_platform then (select jsonb_build_object('name', name, 'slug', slug) from public.tenants where id = t.tenant_id) end,
        'createdAt', t.created_at, 'updatedAt', t.updated_at,
        'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fromPlatform', m.from_platform, 'author', m.author_name,
                                                                  'body', m.body, 'at', m.created_at) order by m.created_at)
                                from public.support_messages m where m.ticket_id = t.id), '[]'::jsonb));
$$;
revoke execute on function public.support_ticket_json(public.support_tickets, boolean) from public, anon, authenticated;

create function public.create_support_ticket(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    a jsonb := public.support_actor();
    v_tenant uuid;
    t public.support_tickets;
begin
    if a is null then raise exception 'Please log in to the admin app first'; end if;
    v_tenant := (a ->> 'tenant')::uuid;
    if length(trim(coalesce(p ->> 'subject', ''))) < 3 then raise exception 'Write a short title (what is wrong)'; end if;
    if length(trim(coalesce(p ->> 'message', ''))) < 5 then raise exception 'Tell us a little more about it'; end if;
    if (select count(*) from public.support_tickets where tenant_id = v_tenant and created_at > now() - interval '1 hour') >= 10 then
        raise exception 'Too many tickets in the last hour. Please add to an open ticket instead.';
    end if;
    perform pg_advisory_xact_lock(hashtext('support:' || v_tenant::text));
    insert into public.support_tickets (tenant_id, number, created_by, staff_id, author_name, author_phone, category, urgent, subject, message,
                                        page, device, screenshot)
    values (v_tenant, coalesce((select max(number) from public.support_tickets where tenant_id = v_tenant), 0) + 1,
            auth.uid(), (a ->> 'staff')::uuid, a ->> 'name', a ->> 'phone',
            case when p ->> 'category' in ('problem', 'question', 'idea', 'billing', 'other') then p ->> 'category' else 'problem' end,
            coalesce((p ->> 'urgent')::boolean, false), left(trim(p ->> 'subject'), 120), left(trim(p ->> 'message'), 4000),
            left(coalesce(p ->> 'page', ''), 300), coalesce(p -> 'device', '{}'),
            case when coalesce(p ->> 'screenshot', '') like v_tenant::text || '/%' then p ->> 'screenshot' else '' end)
    returning * into t;
    return public.support_ticket_json(t, false);
end;
$$;

create function public.my_support_tickets() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    a jsonb := public.support_actor();
begin
    if a is null then raise exception 'Please log in to the admin app first'; end if;
    return coalesce((select jsonb_agg(public.support_ticket_json(t, false) order by t.updated_at desc)
                       from public.support_tickets t where t.tenant_id = (a ->> 'tenant')::uuid), '[]'::jsonb);
end;
$$;

-- Reply on a ticket: from the cafe (its own tickets) or from the platform console (any ticket)
create function public.reply_support_ticket(p_id uuid, p_body text, p_status text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    a jsonb := public.support_actor();
    v_platform boolean := public.is_platform_admin();
    t public.support_tickets;
begin
    select * into t from public.support_tickets where id = p_id for update;
    if t.id is null or not (v_platform or (a is not null and t.tenant_id = (a ->> 'tenant')::uuid)) then
        raise exception 'Ticket not found';
    end if;
    if trim(coalesce(p_body, '')) <> '' then
        insert into public.support_messages (ticket_id, from_platform, author_name, body)
        values (t.id, v_platform, case when v_platform then 'N.A.I.R. Solutions' else a ->> 'name' end, left(trim(p_body), 4000));
    end if;
    if p_status is not null then
        if p_status not in ('open', 'working', 'waiting', 'resolved', 'closed') then raise exception 'Unknown status'; end if;
        if not v_platform and p_status not in ('open', 'closed') then raise exception 'Only N.A.I.R. can set that status'; end if;
    end if;
    update public.support_tickets
       set status = coalesce(p_status,
                             case when v_platform and trim(coalesce(p_body, '')) <> '' and status = 'open' then 'working'
                                  when not v_platform and status in ('resolved', 'waiting') and trim(coalesce(p_body, '')) <> '' then 'open'
                                  else status end),
           unread_cafe = case when v_platform then true else false end,
           unread_platform = case when v_platform then false else true end,
           updated_at = now()
     where id = t.id
    returning * into t;
    if v_platform then
        perform public.notify(t.tenant_id, 'subscription', 'Reply from N.A.I.R. on ticket #' || t.number || ': ' || t.subject,
                              left(coalesce(p_body, ''), 140), '/admin/help?tab=tickets', 'reports.view', 'normal',
                              jsonb_build_object('ticketId', t.id));
    end if;
    return public.support_ticket_json(t, v_platform);
end;
$$;

create function public.mark_support_read(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    a jsonb := public.support_actor();
begin
    if public.is_platform_admin() then
        update public.support_tickets set unread_platform = false where id = p_id;
    elsif a is not null then
        update public.support_tickets set unread_cafe = false where id = p_id and tenant_id = (a ->> 'tenant')::uuid;
    end if;
end;
$$;

-- Platform console: every ticket, newest activity first
create function public.sa_support_tickets(p_status text default 'active') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
    return coalesce((select jsonb_agg(public.support_ticket_json(t, true) order by t.urgent and t.status in ('open', 'working') desc, t.updated_at desc)
                       from public.support_tickets t
                      where p_status = 'all' or (p_status = 'active' and t.status in ('open', 'working', 'waiting')) or t.status = p_status), '[]'::jsonb);
end;
$$;

commit;
