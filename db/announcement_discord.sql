begin;

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists supabase_vault;

create table private.announcement_discord_deliveries (
  announcement_id uuid primary key references public.employee_announcements(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  state text not null check (state in ('skipped_existing', 'not_configured', 'pending', 'sent', 'failed', 'withdrawn')),
  http_status integer
);
alter table private.announcement_discord_deliveries enable row level security;
revoke all on table private.announcement_discord_deliveries from public, anon, authenticated;

create function private.queue_announcement_discord_notification()
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
  values (new.id, case when exists (
    select 1 from vault.secrets where name = 'employee_portal_discord_webhook'
  ) then 'pending' else 'not_configured' end)
  on conflict (announcement_id) do nothing;
  return null;
end;
$$;
revoke all on function private.queue_announcement_discord_notification() from public, anon, authenticated;

create trigger queue_announcement_discord_notification
after insert or update of published on public.employee_announcements
for each row execute function private.queue_announcement_discord_notification();

insert into private.announcement_discord_deliveries (announcement_id, state)
select id, 'skipped_existing' from public.employee_announcements where published;

create function private.send_announcement_discord_notification()
returns void
language plpgsql
set search_path = ''
as $$
declare
  announcement uuid;
  is_published boolean;
  webhook_url text;
  response_status integer;
begin
  select d.announcement_id, a.published into announcement, is_published
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

    select status into response_status
    from extensions.http_post(
      webhook_url || '?wait=true',
      jsonb_build_object(
        'content', E'新しいお知らせが公開されました。\nhttps://portal.vocalink-team.com/',
        'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()),
        'flags', 4
      )::text,
      'application/json'
    );
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

select cron.schedule(
  'employee-portal-discord-announcements',
  '15 seconds',
  'select private.send_announcement_discord_notification()'
);

commit;
