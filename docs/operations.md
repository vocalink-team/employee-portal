# 従業員ポータルの運用手順

- [従業員ポータル](https://portal.vocalink-team.com/)
- [ソースと変更履歴](https://github.com/vocalink-team/employee-portal)
- [専用Supabaseのユーザー管理](https://supabase.com/dashboard/project/cmlafkiwveixvrctnnlx/auth/users)

## アカウントを発行・停止する

ポータルでの追加は v0.1.5 以降です。それ以前の公開版では専用Supabaseのユーザー管理でアカウントを発行してください。

1. Ownerが「メンバーとロールの管理」の「アカウントを追加」で、運営が確認したメールアドレスを入力して作成します。
2. 初期設定リンクをコピーして本人に個別共有します。リンクは受け取った本人がパスワードを指定するためのものです。メールの自動送信はありません。
3. 一覧から対象アカウントを選び、状態を「利用可」にして担当ロールを保存します。リンクを発行しただけのアカウントにはポータルの利用権限が付きません。
4. 異動時は担当ロールを更新します。利用停止時は「停止」にして保存します。DBはその後の業務データ取得・申請を拒否します。

問い合わせ先はポータルのOwnerです。ログインできない場合は、普段使っている社内の連絡手段から、発生日時とエラー表示を伝えてください。パスワードや領収書を問い合わせ本文に貼り付けないでください。

## パスワードを再設定する

1. Ownerが「メンバーとロールの管理」で利用可の対象アカウントを選び、「パスワード再設定リンクを発行」を押します。
2. Ownerが本人確認のうえ、発行したリンクを本人に個別共有します。
3. 本人がリンクを開いて新しいパスワードを入力し、再設定後にログインします。期限切れや使用済みの場合はOwnerが再発行します。

ポータルのOwner自身がログインできなくなった場合は、専用Supabaseの管理者に復旧を依頼してください。

## お知らせと経費申請

- Ownerは「社内向けお知らせ」で下書き・公開・取り下げを行います。「全メンバー」または部署・ロールを指定して公開します。限定公開の対象は、現在割り当てられている部署・ロールのいずれかに一致する在籍メンバーです。Ownerはすべて閲覧できます。限定公開はDiscordへ送信しません。公開範囲を後から絞っても、それまでにDiscordで公開された投稿はDiscord側に残ります。
- 申請者は経費を入力し、送信後に「自分の申請履歴」で状態を確認します。差し戻された場合は、理由を確認して「修正して再申請」を選びます。領収書の本体は、運営が指定する保存先に保管します。

Ownerは「経費申請一覧」で全メンバーの申請を新しい順に閲覧できます。各行を開くと、申請日時、支払先、用途、証憑のファイル名・管理番号を確認できます。Ownerは申請を承認するか、理由を入力して差し戻せます。支払いが完了したら承認済みの申請を「精算済み」にします。

「月別集計」は支払日が選択した月に入る申請を集計します。未精算には申請済み・承認済み・差し戻しを含みます。CSVは同じ支払月の精算済み明細を出力します。各申請の「変更履歴」では、この機能の追加以降の承認・差し戻し・再申請・精算済みへの変更を確認できます。

## お知らせをDiscordへ通知する

1. 専用Supabaseに [通知用SQL](../db/announcement_discord.sql) を適用します。続けて [本文配信用SQL](../db/announcement_discord_content.sql) と [メンション用SQL](../db/announcement_discord_mentions.sql) を適用し、最後に [配信状況用SQL](../db/announcement_discord_status.sql) を適用し、[公開範囲用SQL](../db/announcement_audience.sql) を適用します。前提は `db/announcements.sql` の適用です。
2. Discordの社内通知チャンネルで「チャンネルを編集」→「連携サービス」→「ウェブフック」からWebhookを作成し、URLをコピーします。
3. [専用Supabaseの連携設定](https://supabase.com/dashboard/project/cmlafkiwveixvrctnnlx/integrations) →「Vault」→「Secrets」で、名前を `employee_portal_discord_webhook`、値をコピーしたWebhook URLとして保存します。Webhook URLはVaultに直接入力します。
4. Ownerが新しいお知らせを公開し、Discordにタイトル・本文・ポータルのリンクが届くことを確認します。配信処理は15秒間隔です。

同じお知らせは初回公開時に配信対象になります。長い本文は複数のメッセージに分けて送信します。Ownerは作成フォームの「Discordのメンションを指定」に通知したいユーザーIDまたはロールIDを入力できます。最初のDiscord投稿で指定先へ通知します。ロールはDiscord側でメンションできる設定にしてください。配信前に取り下げたお知らせは送信対象から外れます。配信済みの投稿を編集・取り下げる場合は、Discord側でも対応してください。設定前に公開したお知らせの遡及配信や、失敗時の自動再送はありません。Ownerは、お知らせ一覧の「配信状況を更新」で送信結果を確認できます。今回の更新以降の通知には、ログイン後に該当のお知らせを開くリンクが入り、Discordから投稿情報を取得できた場合はポータルからDiscord投稿も開けます。

```sql
select announcement_id, recorded_at, state, http_status
from private.announcement_discord_deliveries
order by recorded_at desc
limit 20;
```

## GitHub Pagesで更新を公開する

1. DBマイグレーションやEdge Functionの変更がある場合は、依存関係を確認して専用Supabaseに反映します。
2. 画面を変更したらバージョンを更新し、GitHubの `main` に反映します。GitHub Pagesは `main` のルートから配信します。ルートの入口はクエリと初期設定リンクを `site/` に引き継ぎます。
3. [GitHub Actions](https://github.com/vocalink-team/employee-portal/actions) の「pages build and deployment」が対象コミットで成功したことを確認します。
4. [公開URL](https://portal.vocalink-team.com/) でHTTPSの接続、ログイン画面と右上のバージョンを確認します。未ログインでマニュアル・お知らせ・経費が取得できないことを確認します。
5. 画面の変更を取り消すときは、DBとの互換性を確認し、対象のコミットを `main` でrevertして再配信します。

独自ドメインは [GitHub Pages設定](https://github.com/vocalink-team/employee-portal/settings/pages) の `portal.vocalink-team.com` を使用します。Cloudflareの同ホストのCNAMEは `vocalink-team.github.io` を指すDNS専用の設定です。

## 初回公開後の確認

- [ ] Ownerで検証用アカウントを追加し、初期設定リンクから本人がパスワードを設定してログインできることを確認する。一般メンバーでアカウント追加が表示されないことも確認する。

- [ ] [専用Supabaseの認証設定](https://supabase.com/dashboard/project/cmlafkiwveixvrctnnlx/auth/providers)で「Allow new users to sign up」をオフにして保存し、発行済みアカウントでログインできることを確認する。
- [ ] PCとスマートフォンで、Ownerの管理画面、一般メンバーのマニュアルと公開済みお知らせ、停止済みアカウントの利用拒否を確認する。
- [ ] 運営が実際に精算対象とした最初の経費について、送信完了と本人の申請履歴への表示を確認する。DBの権限試験に使う検証用の申請データは、試験トランザクションのロールバックで除去する。
