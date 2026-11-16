begin;

create table public.employee_announcements (
  id uuid primary key,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 6000),
  published boolean not null default false,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create function private.stamp_employee_announcement()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  if not new.published then
    new.published_at := null;
  elsif tg_op = 'INSERT' then
    new.published_at := new.updated_at;
  elsif not old.published then
    new.published_at := new.updated_at;
  else
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_employee_announcement() from public, anon, authenticated;

create trigger stamp_employee_announcement
  before insert or update on public.employee_announcements
  for each row execute function private.stamp_employee_announcement();

create index employee_announcements_order_idx
  on public.employee_announcements (published_at desc nulls last, updated_at desc, id);

alter table public.employee_announcements enable row level security;
revoke all on public.employee_announcements from public, anon, authenticated;
grant select, insert (id, title, body, published), update (title, body, published)
  on public.employee_announcements to authenticated;
grant execute on function private.is_employee_portal_owner() to authenticated;

create policy employee_announcements_read on public.employee_announcements
  for select to authenticated using (
    (select private.is_employee_portal_owner())
    or (published and (select private.is_active_employee()))
  );

create policy employee_announcements_create on public.employee_announcements
  for insert to authenticated with check ((select private.is_employee_portal_owner()));

create policy employee_announcements_update on public.employee_announcements
  for update to authenticated using ((select private.is_employee_portal_owner()))
  with check ((select private.is_employee_portal_owner()));

notify pgrst, 'reload schema';
commit;
