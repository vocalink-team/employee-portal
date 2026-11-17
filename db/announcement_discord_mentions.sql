begin;

alter table public.employee_announcements
  add column discord_user_ids text[] not null default '{}'
    check (cardinality(discord_user_ids) <= 10 and coalesce(array_ndims(discord_user_ids), 1) = 1
      and array_position(discord_user_ids, null) is null
      and array_to_string(discord_user_ids, ',') ~ '^([1-9][0-9]{16,19}(,[1-9][0-9]{16,19})*)?$'),
  add column discord_role_ids text[] not null default '{}'
    check (cardinality(discord_role_ids) <= 10 and coalesce(array_ndims(discord_role_ids), 1) = 1
      and array_position(discord_role_ids, null) is null
      and array_to_string(discord_role_ids, ',') ~ '^([1-9][0-9]{16,19}(,[1-9][0-9]{16,19})*)?$');

alter table public.employee_announcements
  add constraint employee_announcements_discord_user_id_elements
    check (regexp_count(array_to_string(discord_user_ids, ','), ',') = greatest(cardinality(discord_user_ids) - 1, 0)),
  add constraint employee_announcements_discord_role_id_elements
    check (regexp_count(array_to_string(discord_role_ids, ','), ',') = greatest(cardinality(discord_role_ids) - 1, 0));

grant select (discord_user_ids, discord_role_ids),
  insert (discord_user_ids, discord_role_ids), update (discord_user_ids, discord_role_ids)
  on public.employee_announcements to authenticated;

create function private.add_announcement_discord_mentions(payload jsonb, users text[], roles text[])
returns jsonb
language sql immutable strict set search_path = ''
as $$
  with mentions as (
    select distinct id, '<@' || id || '>' as token, false as is_role from unnest(users) as ids(id)
    union all
    select distinct id, '<@&' || id || '>' as token, true as is_role from unnest(roles) as ids(id)
  )
  select case when count(*) = 0 then payload else payload || jsonb_build_object(
    'content', (payload->>'content') || E'\n' || string_agg(token, ' ' order by is_role, id),
    'allowed_mentions', jsonb_build_object(
      'users', coalesce(jsonb_agg(id order by id) filter (where not is_role), '[]'::jsonb),
      'roles', coalesce(jsonb_agg(id order by id) filter (where is_role), '[]'::jsonb)
    )
  ) end
  from mentions;
$$;
revoke all on function private.add_announcement_discord_mentions(jsonb, text[], text[]) from public, anon, authenticated;

create or replace function private.send_announcement_discord_notification()
returns void
language plpgsql
set search_path = ''
as $$
declare
  announcement uuid;
  is_published boolean;
  announcement_title text;
  announcement_body text;
  message jsonb;
  notified_users text[];
  notified_roles text[];
  webhook_url text;
  response_status integer;
begin
  select d.announcement_id, a.published, a.title, a.body, a.discord_user_ids, a.discord_role_ids
  into announcement, is_published, announcement_title, announcement_body, notified_users, notified_roles
  from private.announcement_discord_deliveries d
  join public.employee_announcements a on a.id = d.announcement_id
  where d.state = 'pending'
  order by d.recorded_at, d.announcement_id
  limit 1
  for update of d skip locked;
  if not found then
    return;
  end if;

  if not is_published then
    update private.announcement_discord_deliveries set state = 'withdrawn'
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
      select case when part = 1 then private.add_announcement_discord_mentions(payload, notified_users, notified_roles)
        else payload end
      from private.announcement_discord_messages(announcement_title, announcement_body)
        with ordinality as messages(payload, part)
      order by part
    loop
      select status into response_status
      from extensions.http_post(webhook_url || '?wait=true', message::text, 'application/json');

      exit when response_status is null or response_status not between 200 and 299;
    end loop;
  exception when others then
    -- Store the outcome without logging the URL or the response payload.
    response_status := null;
  end;

  update private.announcement_discord_deliveries
  set state = case when response_status between 200 and 299 then 'sent' else 'failed' end,
      http_status = response_status
  where announcement_id = announcement;
end;
$$;
revoke all on function private.send_announcement_discord_notification() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
