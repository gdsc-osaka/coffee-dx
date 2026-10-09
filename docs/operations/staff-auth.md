# スタッフ認証の運用手順

作業ディレクトリは `apps/web`。本番 D1 を変更する作業は、対象 Worker とアカウントを確認してから実行する。

## アプリの設定

1. `0010` と `0011` の D1 マイグレーションを適用する。main への push では `.github/workflows/db-migrate.yml` が実行する。結果を確認する。
2. 通常アプリ `coffee-dx` に `BETTER_AUTH_SECRET`（十分に長いランダム値）と `BETTER_AUTH_URL`（実際の HTTPS の公開オリジン）を設定する。値はリポジトリや CI ログへ書かず、`pnpm exec wrangler secret put BETTER_AUTH_SECRET --config wrangler.toml` と `pnpm exec wrangler secret put BETTER_AUTH_URL --config wrangler.toml` の対話入力を使う。`secret put` は Worker の新バージョンを即時デプロイする。
3. `pnpm exec wrangler secret list --config wrangler.toml` で秘密情報の**名前**が存在することを確認する。値は表示されない。
4. ローカル開発では `.dev.vars.example` を `.dev.vars` にコピーし、ローカル専用のランダムな secret を設定する。`pnpm migrate:local` の後に `pnpm dev` を起動する。

## 初回アカウント発行

`provision-worker.ts` は通常アプリと別の Worker で、公開 `fetch` ハンドラを持たない。`wrangler.provision.toml` は `workers_dev = false`、`preview_urls = false`、既定の cron は空にしている。

1. 発行するユーザー名、表示名、12文字以上の初期パスワードを決める。ユーザー名は英数字・アンダースコア・ピリオドの3〜30文字。
2. `pnpm exec wrangler deploy --config wrangler.provision.toml` でトリガーなしの Worker をデプロイする。
3. 次の秘密情報を `pnpm exec wrangler secret put <名前> --config wrangler.provision.toml` で設定する。`BETTER_AUTH_SECRET` は通常アプリと同じ値、`BETTER_AUTH_URL` は通常アプリと同じオリジン。`STAFF_USERNAME`、`STAFF_PASSWORD`、`STAFF_DISPLAY_NAME` は発行対象の値。初回発行では `RETIRE_USER_ID` を設定しない。
4. `pnpm exec wrangler secret list --config wrangler.provision.toml` で5個の名前を確認する。パスワードをコマンド引数、リポジトリ、ログに残さない。
5. `pnpm exec wrangler deploy --config wrangler.provision.toml --triggers '* * * * *'` で一時的に毎分の cron を有効にする。実行ログのユーザー ID を確認する。同じユーザー名の有効アカウントがあれば再実行しても増やさない。
6. `pnpm exec wrangler d1 execute coffee-dx-db --remote --command "SELECT id, username, role, is_active FROM user WHERE username = '発行したユーザー名'"` で1件、`role=staff`、`is_active=1` を確認する。ログイン画面でユーザー名とパスワードの動作を確認し、`/api/auth/*` に公開ルートがないことを確認する。
7. `pnpm exec wrangler delete coffee-dx-provision --config wrangler.provision.toml` で cron と発行用 Worker・秘密情報を撤去する。通常アプリのサインアップ無効設定は維持する。

Cloudflare の [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) と [Wrangler の cron 設定](https://developers.cloudflare.com/workers/wrangler/configuration/#triggers) に従う。ローカルでは `pnpm exec wrangler dev --config wrangler.provision.toml --test-scheduled` の `/cdn-cgi/local/scheduled` で検証できるが、ローカル D1 とローカル秘密情報のみを使う。

## パスワード紛失時の代替アカウント

事前に定めた連絡先で本人確認を行い、旧ユーザー ID と希望する新ユーザー名を確定する。既存パスワードの直接更新はしない。

1. 上記と同じトリガーなし Worker をデプロイし、5個の秘密情報に加えて `RETIRE_USER_ID` を旧ユーザー ID に設定する。`STAFF_PASSWORD` は新しい初期パスワード。
2. cron を一時的に有効にする。処理は Better Auth で仮ユーザー名の代替アカウントを先に作る。続く D1 の `batch()` で旧 `user.isActive=0`、旧 `session` と `account` の削除、旧ユーザー名の `retired_...` への変更、代替アカウントへのユーザー名の移動を一括で行う。代替アカウントの作成に失敗した場合は旧アカウントを維持する。
3. 旧 ID の `is_active=0`、旧セッション・credential が0件、代替アカウントが `staff` / `is_active=1` であることを D1 で確認する。旧 Cookie と旧パスワードを拒否し、新しいパスワードでログインできることを確認する。
4. 新しい初期パスワードを安全な経路で本人へ渡し、発行用 Worker を削除する。

発行・復旧の D1 と Better Auth の動作は `provision-worker.workers.test.ts` で確認する。WebSocket はセッション削除後の新規接続を即時拒否し、既存接続も最長5分で閉じる。
