begin;

alter table public.employee_announcements
  add column audience_restricted boolean not null default false,
  add column audience_departments text[] not null default '{}',
  add column audience_roles text[] not null default '{}',
  add constraint employee_announcement_audience_check check (
    cardinality(audience_departments) <= 32 and cardinality(audience_roles) <= 64
    and coalesce(array_ndims(audience_departments), 1) = 1
    and coalesce(array_ndims(audience_roles), 1) = 1
    and (audience_restricted = (cardinality(audience_departments) + cardinality(audience_roles) > 0))
  );

grant insert (audience_restricted, audience_departments, audience_roles),
  update (audience_restricted, audience_departments, audience_roles)
  on public.employee_announcements to authenticated;

create function private.validate_employee_announcement_audience()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(new.audience_departments) as selected(department)
    where not exists (select 1 from private.employee_roles r where r.department = selected.department)
  ) or exists (
    select 1 from unnest(new.audience_roles) as selected(role_key)
    where not exists (select 1 from private.employee_roles r where r.key = selected.role_key and r.key <> 'owner')
  ) then
    raise exception 'Unknown announcement audience' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_employee_announcement_audience() from public, anon, authenticated;

create trigger validate_employee_announcement_audience
before insert or update of audience_restricted, audience_departments, audience_roles on public.employee_announcements
for each row execute function private.validate_employee_announcement_audience();

create function private.matches_employee_announcement_audience(departments text[], roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.employee_member_roles assignment
    join private.employee_roles role on role.key = assignment.role_key
    where assignment.user_id = (select auth.uid())
      and (role.key = any(roles) or role.department = any(departments))
  );
$$;

revoke all on function private.matches_employee_announcement_audience(text[], text[]) from public, anon;
grant execute on function private.matches_employee_announcement_audience(text[], text[]) to authenticated;

alter policy employee_announcements_read on public.employee_announcements using (
  (select private.is_employee_portal_owner())
  or (published and (select private.is_active_employee()) and (
    not audience_restricted or private.matches_employee_announcement_audience(audience_departments, audience_roles)
  ))
);

create function private.employee_announcement_audience_options()
returns table (role_key text, department text, label text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  return query select r.key, r.department, r.label from private.employee_roles r
  where r.key <> 'owner' order by r.display_order;
end;
$$;

create function public.employee_announcement_audience_options()
returns table (role_key text, department text, label text)
language sql stable security invoker set search_path = ''
as $$
  select * from private.employee_announcement_audience_options();
$$;

create function private.employee_announcement_audiences(announcement_ids uuid[])
returns table (announcement_id uuid, restricted boolean, departments text[], roles text[])
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  if cardinality(announcement_ids) > 20 then
    raise exception 'Too many announcement IDs' using errcode = '22023';
  end if;
  return query
    select a.id, a.audience_restricted, a.audience_departments, a.audience_roles
    from public.employee_announcements a where a.id = any(announcement_ids);
end;
$$;

create function public.employee_announcement_audiences(announcement_ids uuid[])
returns table (announcement_id uuid, restricted boolean, departments text[], roles text[])
language sql stable security invoker set search_path = ''
as $$
  select * from private.employee_announcement_audiences(announcement_ids);
$$;

revoke all on function private.employee_announcement_audience_options(),
  public.employee_announcement_audience_options(),
  private.employee_announcement_audiences(uuid[]),
  public.employee_announcement_audiences(uuid[]) from public, anon;
grant execute on function private.employee_announcement_audience_options(),
  public.employee_announcement_audience_options(),
  private.employee_announcement_audiences(uuid[]),
  public.employee_announcement_audiences(uuid[]) to authenticated;

alter table private.announcement_discord_deliveries
  drop constraint announcement_discord_deliveries_state_check,
  add constraint announcement_discord_deliveries_state_check check (
    state in ('skipped_existing', 'skipped_restricted', 'not_configured', 'pending', 'sent', 'failed', 'withdrawn')
  );

create or replace function private.queue_announcement_discord_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.published then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.published then
    return null;
  end if;

  insert into private.announcement_discord_deliveries (announcement_id, state)
  values (new.id, case when new.audience_restricted then 'skipped_restricted' when exists (
    select 1 from vault.secrets where name = 'employee_portal_discord_webhook'
  ) then 'pending' else 'not_configured' end)
  on conflict (announcement_id) do nothing;
  return null;
end;
$$;
revoke all on function private.queue_announcement_discord_notification() from public, anon, authenticated;

create or replace function private.send_announcement_discord_notification()
returns void
language plpgsql
set search_path = ''
as $$
declare
  announcement uuid;
  is_published boolean;
  restricted boolean;
  announcement_title text;
  announcement_body text;
  message jsonb;
  notified_users text[];
  notified_roles text[];
  webhook_url text;
  response_status integer;
  response_body text;
  first_response_body text;
  first_response jsonb;
  guild_id text;
  message_url text;
begin
  select d.announcement_id, a.published, a.title, a.body, a.discord_user_ids, a.discord_role_ids, a.audience_restricted
  into announcement, is_published, announcement_title, announcement_body, notified_users, notified_roles, restricted
  from private.announcement_discord_deliveries d
  join public.employee_announcements a on a.id = d.announcement_id
  where d.state = 'pending'
  order by d.recorded_at, d.announcement_id
  limit 1
  for update of a, d skip locked;
  if not found then
    return;
  end if;

  if not is_published then
    update private.announcement_discord_deliveries set state = 'withdrawn'
    where announcement_id = announcement;
    return;
  end if;

  if restricted then
    update private.announcement_discord_deliveries set state = 'skipped_restricted'
    where announcement_id = announcement;
    return;
  end if;

  begin
    select decrypted_secret into webhook_url
    from vault.decrypted_secrets
    where name = 'employee_portal_discord_webhook';

    if webhook_url is null or webhook_url !~ '^https://discord[.]com/api/webhooks/[0-9]+/[a-zA-Z0-9_-]+$' then
      update private.announcement_discord_deliveries set state = 'not_configured'
      where announcement_id = announcement;
      return;
    end if;

    for message in
      select case when part = 1 then private.add_announcement_discord_mentions(
        private.link_announcement_discord_payload(payload, announcement), notified_users, notified_roles)
        else payload end
      from private.announcement_discord_messages(announcement_title, announcement_body)
        with ordinality as messages(payload, part)
      order by part
    loop
      select status, content into response_status, response_body
      from extensions.http_post(webhook_url || '?wait=true', message::text, 'application/json');

      exit when response_status is null or response_status not between 200 and 299;
      if first_response_body is null then
        first_response_body := response_body;
      end if;
    end loop;
  exception when others then
    -- Store the outcome without logging the URL or the response payload.
    response_status := null;
  end;

  if first_response_body is not null then
    begin
      first_response := first_response_body::jsonb;
      guild_id := first_response->>'guild_id';
      if guild_id is null then
        select (content::jsonb)->>'guild_id' into guild_id
        from extensions.http_get(webhook_url) where status = 200;
      end if;
      message_url := private.announcement_discord_message_url(
        guild_id, first_response->>'channel_id', first_response->>'id'
      );
    exception when others then
      -- Link lookup must not change the delivery outcome.
      message_url := null;
    end;
  end if;

  update private.announcement_discord_deliveries
  set state = case when response_status between 200 and 299 then 'sent' else 'failed' end,
      http_status = response_status, discord_message_url = message_url
  where announcement_id = announcement;
end;
$$;
revoke all on function private.send_announcement_discord_notification() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
