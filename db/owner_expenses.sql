begin;

create index employee_expense_requests_submitted_id_idx
  on public.employee_expense_requests (submitted_at desc, id desc);

create function private.employee_owner_expenses(before_submitted_at timestamptz, before_expense_id uuid)
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

create function public.employee_owner_expenses(
  before_submitted_at timestamptz default null, before_expense_id uuid default null
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select private.employee_owner_expenses(before_submitted_at, before_expense_id);
$$;

revoke all on function private.employee_owner_expenses(timestamptz, uuid),
  public.employee_owner_expenses(timestamptz, uuid) from public, anon;
grant execute on function private.employee_owner_expenses(timestamptz, uuid),
  public.employee_owner_expenses(timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
