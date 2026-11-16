# VOCALINK-TEAM 従業員ポータル v0.1.6

Ownerによるアカウント追加、経費申請マニュアル、申請フォーム、本人の履歴、社内向けお知らせ、Ownerによるメンバーと担当ロールの管理を含みます。サイトの公開用ファイルは `site/` にあります。

[運用手順](docs/operations.md)に、アカウント発行・停止、更新公開、初回公開後の確認項目をまとめています。

## 専用DBと認証の設定

1. 新規の専用Supabaseプロジェクトでは、`db/bootstrap.sql`、`db/roles.sql`、`db/announcements.sql`、`db/manual.sql` の順に適用します。すでに適用したSQLは再実行しません。
2. Supabase Authで公開サインアップを無効にし、運営が認めた利用者のアカウントを発行します。最初のOwnerにするAuthユーザーのUUIDを確認し、管理者として以下を実行します。UUIDは2か所とも置き換えてください。
3. Ownerでログインし、「メンバーとロールの管理」で発行済みアカウントに利用状態と担当ロールを設定します。複数ロールを割り当てられます。Owner以外のロールで利用できる機能は、マニュアル、経費申請、本人の履歴、公開済みのお知らせです。
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

Ownerは「社内向けお知らせ」で下書きの保存と公開ができます。公開済みの記事を編集して「公開を取り下げる」を選ぶと、下書きに戻ります。

領収書本体は指定の保存先に置きます。フォームには任意で証憑のファイル名または管理番号を入力できます。

マニュアル本文は専用DBに保存し、在籍中の利用者だけが取得できます。

アカウント作成には、専用Supabaseへの Edge Function `employee-create-account` のデプロイが必要です。ソースは `supabase/functions/employee-create-account/` にあります。

## ローカルで開く

`python3 -m http.server 8080 --bind 127.0.0.1 --directory site`
