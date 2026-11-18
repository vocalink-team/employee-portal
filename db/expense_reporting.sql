begin;

create table private.employee_expense_status_history (
  expense_id uuid not null references public.employee_expense_requests(id) on delete cascade,
  status_version integer not null,
  previous_status text not null,
  new_status text not null,
  changed_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_email text,
  return_reason text,
  primary key (expense_id, status_version)
);

alter table private.employee_expense_status_history enable row level security;
revoke all on table private.employee_expense_status_history from public, anon, authenticated;

create function private.record_employee_expense_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.employee_expense_status_history (
    expense_id, status_version, previous_status, new_status, actor_id, actor_email, return_reason
  ) values (
    new.id, new.status_version, old.status, new.status, auth.uid(),
    (select email from auth.users where id = auth.uid()), new.return_reason
  );
  return new;
end;
$$;
revoke all on function private.record_employee_expense_status() from public, anon, authenticated;

create trigger record_employee_expense_status
after update of status on public.employee_expense_requests
for each row when (old.status is distinct from new.status)
execute function private.record_employee_expense_status();

create index employee_expense_requests_spent_on_idx on public.employee_expense_requests (spent_on);

create function private.employee_owner_expense_month(month_start date, include_rows boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
  month_end date;
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  if month_start is null or month_start < date '0001-01-01'
    or month_start > date '9999-12-01' or extract(day from month_start) <> 1 then
    raise exception 'Invalid month' using errcode = '22023';
  end if;
  month_end := (month_start + interval '1 month')::date;
  select jsonb_build_object(
    'count', count(*), 'total_yen', coalesce(sum(amount_yen), 0),
    'unsettled_yen', coalesce(sum(amount_yen) filter (where status <> 'settled'), 0),
    'settled_yen', coalesce(sum(amount_yen) filter (where status = 'settled'), 0),
    'settled_count', count(*) filter (where status = 'settled')
  ) into result from public.employee_expense_requests
  where spent_on >= month_start and spent_on < month_end;

  if include_rows then
    result := result || jsonb_build_object('rows', (
      select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.spent_on, row_data.id), '[]'::jsonb)
      from (
        select e.id, e.spent_on, e.category, e.amount_yen, e.payee, e.purpose,
          e.evidence_reference, u.email as applicant_email, h.changed_at as settled_at
        from public.employee_expense_requests e
        left join auth.users u on u.id = e.applicant_id
        left join private.employee_expense_status_history h
          on h.expense_id = e.id and h.status_version = e.status_version and h.new_status = 'settled'
        where e.spent_on >= month_start and e.spent_on < month_end and e.status = 'settled'
      ) row_data
    ));
  end if;
  return result;
end;
$$;

create function public.employee_owner_expense_month(month_start date, include_rows boolean default false)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select private.employee_owner_expense_month(month_start, include_rows);
$$;

create function private.employee_owner_expense_history(target_expense uuid)
returns table (previous_status text, new_status text, changed_at timestamptz, actor_email text, return_reason text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  return query select h.previous_status, h.new_status, h.changed_at, h.actor_email, h.return_reason
  from private.employee_expense_status_history h
  where h.expense_id = target_expense
  order by h.status_version desc;
end;
$$;

create function public.employee_owner_expense_history(target_expense uuid)
returns table (previous_status text, new_status text, changed_at timestamptz, actor_email text, return_reason text)
language sql stable security invoker set search_path = ''
as $$
  select * from private.employee_owner_expense_history(target_expense);
$$;

revoke all on function private.employee_owner_expense_month(date, boolean),
  public.employee_owner_expense_month(date, boolean),
  private.employee_owner_expense_history(uuid), public.employee_owner_expense_history(uuid)
  from public, anon;
grant execute on function private.employee_owner_expense_month(date, boolean),
  public.employee_owner_expense_month(date, boolean),
  private.employee_owner_expense_history(uuid), public.employee_owner_expense_history(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
