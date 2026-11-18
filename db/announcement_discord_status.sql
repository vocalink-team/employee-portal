begin;

alter table private.announcement_discord_deliveries
  add column discord_message_url text;

create function private.link_announcement_discord_payload(payload jsonb, announcement_id uuid)
returns jsonb
language sql immutable strict set search_path = ''
as $$
  select jsonb_set(payload, '{content}', to_jsonb(replace(
    payload->>'content', '<https://portal.vocalink-team.com/>',
    '<https://portal.vocalink-team.com/site/?announcement=' || announcement_id::text || '>'
  )));
$$;

create function private.announcement_discord_message_url(guild_id text, channel_id text, message_id text)
returns text
language sql immutable strict set search_path = ''
as $$
  select 'https://discord.com/channels/' || guild_id || '/' || channel_id || '/' || message_id
  where guild_id ~ '^[0-9]{17,20}$' and channel_id ~ '^[0-9]{17,20}$' and message_id ~ '^[0-9]{17,20}$';
$$;

revoke all on function private.link_announcement_discord_payload(jsonb, uuid),
  private.announcement_discord_message_url(text, text, text) from public, anon, authenticated;

create function private.employee_announcement_delivery_status(announcement_ids uuid[])
returns table (announcement_id uuid, state text, discord_message_url text)
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
    select d.announcement_id, d.state, d.discord_message_url
    from private.announcement_discord_deliveries d
    where d.announcement_id = any(announcement_ids);
end;
$$;

create function public.employee_announcement_delivery_status(announcement_ids uuid[])
returns table (announcement_id uuid, state text, discord_message_url text)
language sql stable security invoker set search_path = ''
as $$
  select * from private.employee_announcement_delivery_status(announcement_ids);
$$;

revoke all on function private.employee_announcement_delivery_status(uuid[]),
  public.employee_announcement_delivery_status(uuid[]) from public, anon;
grant execute on function private.employee_announcement_delivery_status(uuid[]),
  public.employee_announcement_delivery_status(uuid[]) to authenticated;

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
  response_body text;
  first_response_body text;
  first_response jsonb;
  guild_id text;
  message_url text;
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
