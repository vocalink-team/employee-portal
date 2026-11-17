begin;

create function private.announcement_discord_messages(announcement_title text, announcement_body text)
returns setof jsonb
language plpgsql immutable strict set search_path = ''
as $$
declare
  remaining_body text := announcement_body;
  body_part text;
  next_part boolean := false;
begin
  loop
    body_part := left(remaining_body, 4000);
    -- Leave room for supplementary Unicode characters that can count as two units.
    body_part := left(body_part, greatest(2000, 4000 - regexp_count(body_part, U&'[\+010000-\+10FFFF]')));
    remaining_body := substr(remaining_body, char_length(body_part) + 1);

    if not next_part or btrim(body_part, E' \t\r\n') <> '' then
      return next jsonb_strip_nulls(jsonb_build_object(
        'content', case when not next_part then
          E'新しいお知らせが公開されました。\n<https://portal.vocalink-team.com/>'
        end,
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', case when next_part then announcement_title || '（続き）' else announcement_title end,
          'description', nullif(body_part, '')
        )),
        'allowed_mentions', jsonb_build_object('parse', jsonb_build_array())
      ));
      next_part := true;
    end if;

    exit when remaining_body = '';
  end loop;
end;
$$;
revoke all on function private.announcement_discord_messages(text, text) from public, anon, authenticated;

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
  webhook_url text;
  response_status integer;
begin
  select d.announcement_id, a.published, a.title, a.body
  into announcement, is_published, announcement_title, announcement_body
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
      select * from private.announcement_discord_messages(announcement_title, announcement_body)
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

commit;
