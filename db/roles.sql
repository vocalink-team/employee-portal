begin;

create table private.employee_roles (
  key text primary key,
  department text not null,
  label text not null,
  display_order integer not null unique
);

insert into private.employee_roles (key, department, label, display_order) values
  ('owner', '執行部', '代表・Owner', 1),
  ('executive', '執行部', '経営幹部・Executive', 2),
  ('server_admin', '運営・管理部', 'サーバー管理者・Server Admin', 3),
  ('finance', '運営・管理部', '財務担当者', 4),
  ('operations_manager', '運営・管理部', '運営責任者・Operations Manager', 5),
  ('project_manager', '開発・運営部', 'PJ責任者・Project Manager', 6),
  ('developer', '開発・運営部', '開発者・Developer', 7),
  ('official', '開発・運営部', '公式サイト・official', 8),
  ('talent_management', '開発・運営部', 'タレント管理・talent-management', 9),
  ('vocalink_sign', '開発・運営部', '電子署名・vocalink-sign', 10),
  ('vocalink_find', '開発・運営部', 'サービス検索・vocalink-find', 11),
  ('vocalink_trade', '開発・運営部', '仮想通貨・vocalink-trade', 12),
  ('tournament', '開発・運営部', '大会運営・tournament', 13),
  ('free_casino', '開発・運営部', 'ゲーム・free-casino', 14),
  ('security_officer', '開発・運営部', 'セキュリティー担当者・Security Officer', 15),
  ('designer', '開発・運営部', 'デザイナー・Designer', 16),
  ('debugger', '開発・運営部', 'デバッガー・Debugger', 17),
  ('development_staff', '開発・運営部', 'スタッフ・Staff', 18),
  ('support', 'サポート部門', 'サポート担当・Support', 19),
  ('public_relations', '広報部門', '広報担当・Public Relations', 20),
  ('administration', '事務部門', '事務担当・Administration', 21),
  ('talent_director', 'タレント事業部', 'タレント事業責任者・Talent Director', 22),
  ('management_lead', 'タレント事業部', 'マネジメント責任者・Management Lead', 23),
  ('talent_manager', 'タレント事業部', 'タレントマネージャー・Talent Manager', 24),
  ('talent', 'タレント事業部', 'タレント・Talent', 25),
  ('group_leader', 'タレント事業部', 'グループリーダー・Group Leader', 26),
  ('creative_staff', 'タレント事業部', '製作スタッフ・Creative Staff', 27),
  ('generation_zero', 'タレント事業部', '０期生・Generation 0', 28),
  ('talent_staff', 'タレント事業部', 'スタッフ・Staff', 29);

create table private.employee_member_roles (
  user_id uuid references public.team_members(user_id) on delete cascade,
  role_key text references private.employee_roles(key),
  primary key (user_id, role_key)
);

revoke all on private.employee_roles, private.employee_member_roles from public, anon, authenticated;

create function private.is_employee_portal_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_employee() and exists (
    select 1 from private.employee_member_roles
    where user_id = (select auth.uid()) and role_key = 'owner'
  );
$$;
revoke all on function private.is_employee_portal_owner() from public, anon, authenticated;

create function private.employee_portal_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_active', private.is_active_employee(),
    'is_owner', private.is_employee_portal_owner(),
    'roles', coalesce((
      select jsonb_agg('【' || role.department || '】' || role.label order by role.display_order)
      from private.employee_member_roles assignment
      join private.employee_roles role on role.key = assignment.role_key
      where assignment.user_id = (select auth.uid()) and private.is_active_employee()
    ), '[]'::jsonb)
  );
$$;

create function private.employee_owner_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'department', department, 'label', label) order by display_order)
      from private.employee_roles where key <> 'owner'
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', account.id,
        'email', account.email,
        'status', member.status,
        'role_keys', coalesce(assignment.keys, '[]'::jsonb)
      ) order by account.email, account.id)
      from auth.users account
      left join public.team_members member on member.user_id = account.id
      left join lateral (
        select jsonb_agg(role_key order by role_key) as keys
        from private.employee_member_roles where user_id = account.id
      ) assignment on true
      where not coalesce(assignment.keys ? 'owner', false)
    ), '[]'::jsonb)
  );
end;
$$;

create function private.employee_owner_save_member(target_user uuid, new_status text, role_keys text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_employee_portal_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  if target_user is null or new_status is null or new_status not in ('active', 'suspended') or role_keys is null then
    raise exception 'Invalid member settings' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(role_keys) as requested(key)
    left join private.employee_roles role on role.key = requested.key and role.key <> 'owner'
    where role.key is null
  ) then
    raise exception 'Invalid role' using errcode = '22023';
  end if;

  -- Serialize edits for each target, including first-time enrollment.
  perform 1 from auth.users where id = target_user for update;
  if not found then
    raise exception 'Unknown account' using errcode = '22023';
  end if;
  if exists (
    select 1 from private.employee_member_roles where user_id = target_user and role_key = 'owner'
  ) then
    raise exception 'Owner cannot be edited here' using errcode = '42501';
  end if;

  insert into public.team_members (user_id, status) values (target_user, new_status)
  on conflict (user_id) do update set status = excluded.status;

  delete from private.employee_member_roles where user_id = target_user;
  insert into private.employee_member_roles (user_id, role_key)
  select distinct target_user, key from unnest(role_keys) as requested(key);
end;
$$;

create function public.employee_portal_profile()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.employee_portal_profile();
$$;

create function public.employee_owner_directory()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.employee_owner_directory();
$$;

create function public.employee_owner_save_member(target_user uuid, new_status text, role_keys text[])
returns void language sql security invoker set search_path = '' as $$
  select private.employee_owner_save_member(target_user, new_status, role_keys);
$$;

revoke all on function private.employee_portal_profile(), private.employee_owner_directory(),
  private.employee_owner_save_member(uuid, text, text[]),
  public.employee_portal_profile(), public.employee_owner_directory(),
  public.employee_owner_save_member(uuid, text, text[]) from public, anon;

grant execute on function private.employee_portal_profile(), private.employee_owner_directory(),
  private.employee_owner_save_member(uuid, text, text[]),
  public.employee_portal_profile(), public.employee_owner_directory(),
  public.employee_owner_save_member(uuid, text, text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
