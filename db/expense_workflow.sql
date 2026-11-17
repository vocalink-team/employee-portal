begin;

alter table public.employee_expense_requests
  add column status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'returned', 'settled')),
  add column return_reason text,
  add column status_version integer not null default 0 check (status_version >= 0),
  add constraint employee_expense_return_reason_check check (
    (status = 'returned' and return_reason is not null and char_length(btrim(return_reason, E' \t\r\n')) between 1 and 500)
    or (status <> 'returned' and return_reason is null)
  );

grant select (status, return_reason, status_version)
  on public.employee_expense_requests to authenticated;

create or replace function private.employee_owner_expenses(before_submitted_at timestamptz, before_expense_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;

  if (before_submitted_at is null) <> (before_expense_id is null) then
    raise exception 'Invalid expense page cursor' using errcode = '22023';
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(page) order by page.submitted_at desc, page.id desc), '[]'::jsonb)
    from (
      select request.id, request.submitted_at, request.spent_on, request.category,
        request.amount_yen, request.payee, request.purpose, request.evidence_reference,
        request.status, request.return_reason, request.status_version,
        account.email as applicant_email
      from public.employee_expense_requests request
      join auth.users account on account.id = request.applicant_id
      where before_submitted_at is null
        or (request.submitted_at, request.id) < (before_submitted_at, before_expense_id)
      order by request.submitted_at desc, request.id desc
      limit 21
    ) page
  );
end;
$$;

create function private.employee_owner_change_expense_status(
  expense_id uuid, expected_version integer, next_status text, reason text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cleaned_reason text;
  result jsonb;
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;

  if next_status = 'returned' then
    cleaned_reason := nullif(btrim(reason, E' \t\r\n'), '');
    if cleaned_reason is null or char_length(cleaned_reason) > 500 then
      raise exception 'A return reason of 1 to 500 characters is required' using errcode = '22023';
    end if;
  elsif next_status is null or next_status not in ('approved', 'settled') then
    raise exception 'Invalid expense status' using errcode = '22023';
  end if;

  update public.employee_expense_requests request
  set status = next_status, return_reason = cleaned_reason,
      status_version = request.status_version + 1
  where request.id = expense_id and request.status_version = expected_version
    and ((request.status = 'submitted' and next_status in ('approved', 'returned'))
      or (request.status = 'approved' and next_status = 'settled'))
  returning jsonb_build_object(
    'status', request.status, 'return_reason', request.return_reason, 'status_version', request.status_version
  ) into result;
  if not found then
    raise exception 'Expense status changed or transition unavailable' using errcode = '40001';
  end if;

  return result;
end;
$$;

create function public.employee_owner_change_expense_status(
  expense_id uuid, expected_version integer, next_status text, reason text default null
)
returns jsonb
language sql security invoker set search_path = ''
as $$
  select private.employee_owner_change_expense_status(expense_id, expected_version, next_status, reason);
$$;

create function private.employee_resubmit_expense(
  expense_id uuid, expected_version integer, expense_data jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_active_employee() then
    raise exception 'Active employee required' using errcode = '42501';
  end if;

  update public.employee_expense_requests request
  set spent_on = revised.spent_on, category = revised.category, amount_yen = revised.amount_yen,
      payee = btrim(revised.payee), purpose = btrim(revised.purpose),
      evidence_reference = nullif(btrim(revised.evidence_reference), ''),
      status = 'submitted', return_reason = null, status_version = request.status_version + 1
  from jsonb_to_record(expense_data) as revised(
    spent_on date, category text, amount_yen integer, payee text, purpose text, evidence_reference text
  )
  where request.id = expense_id and request.applicant_id = (select auth.uid())
    and request.status = 'returned' and request.status_version = expected_version;
  if not found then
    raise exception 'Expense cannot be resubmitted' using errcode = '40001';
  end if;
end;
$$;

create function public.employee_resubmit_expense(
  expense_id uuid, expected_version integer, expense_data jsonb
)
returns void
language sql security invoker set search_path = ''
as $$
  select private.employee_resubmit_expense(expense_id, expected_version, expense_data);
$$;

revoke all on function private.employee_owner_change_expense_status(uuid, integer, text, text),
  public.employee_owner_change_expense_status(uuid, integer, text, text),
  private.employee_resubmit_expense(uuid, integer, jsonb),
  public.employee_resubmit_expense(uuid, integer, jsonb) from public, anon;
grant execute on function private.employee_owner_change_expense_status(uuid, integer, text, text),
  public.employee_owner_change_expense_status(uuid, integer, text, text),
  private.employee_resubmit_expense(uuid, integer, jsonb),
  public.employee_resubmit_expense(uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
