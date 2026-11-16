begin;

create table public.employee_manual (
  slug text primary key,
  title text not null,
  steps text[] not null,
  note text not null
);

insert into public.employee_manual (slug, title, steps, note)
values (
  'expense-application',
  '経費申請の手順',
  array[
    '支払日、支払先、金額、業務上の用途を確認します。同じ支出の申請が履歴にないか確認してください。',
    '領収書や利用明細を、運営が指定した保存先に保管します。保存先が分からない場合は運営担当者に確認してください。',
    '従業員ポータルの経費申請フォームに入力します。証憑を保存した場合は、ファイル名または管理番号を記入します。',
    '送信後、申請履歴に追加されていることを確認します。内容の訂正や精算状況の確認は運営担当者に連絡してください。'
  ],
  '申請受付後の確認・承認・精算については、運営担当者に確認してください。'
);

alter table public.employee_manual enable row level security;
revoke all on public.employee_manual from public, anon, authenticated;
grant select on public.employee_manual to authenticated;

create policy employee_manual_read_active on public.employee_manual
  for select to authenticated using ((select private.is_active_employee()));

notify pgrst, 'reload schema';
commit;
