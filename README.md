# VOCALINK-TEAM 従業員ポータル v0.1.2

経費申請マニュアル、申請フォーム、本人の履歴、Ownerによるメンバーと担当ロールの管理を含みます。サイトの公開用ファイルは `site/` にあります。

## 専用DBと認証の設定

1. 新規の専用Supabaseプロジェクトでは、`db/bootstrap.sql`、`db/roles.sql` の順に適用します。すでに適用したSQLは再実行しません。
2. Supabase Authで公開サインアップを無効にし、運営が認めた利用者のアカウントを発行します。最初のOwnerにするAuthユーザーのUUIDを確認し、管理者として以下を実行します。UUIDは2か所とも置き換えてください。
3. Ownerでログインし、「メンバーとロールの管理」で発行済みアカウントに利用状態と担当ロールを設定します。複数ロールを割り当てられます。Owner以外のロールで使えるのはマニュアル、経費申請、本人の履歴です。
4. `site/portal-config.js` の接続先と公開用キーを確認します。`site/` だけをWebルートとして配信し、AuthのサイトURLを実際のURLに合わせます。
5. 検証用アカウントで本人の申請、別利用者からの非表示、Ownerによるロール変更、利用停止後の拒否を確認します。

```sql
begin;
insert into public.team_members (user_id, status)
values ('<AuthユーザーのUUID>', 'active')
on conflict (user_id) do update set status = excluded.status;
insert into private.employee_member_roles (user_id, role_key)
values ('<AuthユーザーのUUID>', 'owner')
on conflict do nothing;
commit;
```

ロールの付与はポータルで管理します。Discordの変更を反映する場合は、Ownerがポータルで設定を更新してください。

領収書本体は指定の保存先に置きます。フォームには任意で証憑のファイル名または管理番号を入力できます。

## ローカルで開く

`python3 -m http.server 8080 --bind 127.0.0.1 --directory site`
