# 認証・認可設計

## 概要

文化祭コーヒー注文管理システムにおける認証（誰であるか）・認可（何ができるか）の設計。

- **認証**: スタッフはユーザー名・パスワードでログインし、betterAuth が管理するサーバーサイドセッションで状態を保持する
- **認可**: スタッフ向けの画面・データ取得・更新・WebSocket 接続をサーバー側で保護する。レイアウトの `loader` だけには依存しない
- **スコープ**: 単一アプリケーション内完結。OAuth / OIDC などの外部委任認可は対象外

## 採用ライブラリ

**[betterAuth](https://www.better-auth.com/)** を使用する。

| プラグイン | 用途 |
|-----------|------|
| `username` | ユーザー名+パスワードによるログイン |

今回 `admin` プラグインは導入しない。スタッフによるアカウント管理機能や `manager` 専用機能を作らないためである。将来必要になった時点で再検討する。

Cloudflare Workers で動作させるため、`wrangler.toml` に `nodejs_compat` フラグを追加する（betterAuth が AsyncLocalStorage を内部使用するため必要）。

```toml
# wrangler.toml
compatibility_date = "2026-04-04"
compatibility_flags = ["nodejs_compat"]
```

> **注意**: `nodejs_compat` は Node.js バイナリをバンドルするものではなく、Workers ランタイム上でNode.js API の JS ポリフィルを提供するものです。V8 isolate 上で動作します。

## ロール定義

| ロール | 説明 | ログイン |
|--------|------|---------|
| `customer` | 一般客 | 不要（パブリック） |
| `staff` | ドリップ係・会計係 | 必要 |
| `manager` | 将来の管理者用に定義のみ残す。今回アカウント・専用機能は作らない | 将来必要 |

`customer` はログインアカウントのロールではなく、公開画面の利用者を表す。`staff` / `manager` は Better Auth の `user.additionalFields.role` で保持し、クライアントから変更できないサーバー管理項目（`input: false`）とする。初期値は `staff`。同様に、アカウントが利用可能かを示す `isActive` もサーバー管理項目として保持する。今回の運用で発行するのは `staff` アカウントのみ。将来 `manager` を実際に使う際は、付与方法と専用権限を別途設計する。**数値レベルによるロール比較は行わない**。

`staff` は `/order`（店頭注文・会計・モバイル注文会計・商品管理）、`/drip`、`/drip2`、`/cashier` にアクセスできる。担当別のロールには分けない。

## ルートとアクセス権

| ルートグループ | 許可ロール | ガードする場所 |
|--------------|-----------|--------------|
| `/mobile/:storeToken`、`/mobile/orders/:publicToken`、`/mobile/orders/:publicToken/status` | 公開。ただし店舗トークン・注文控えトークンをそれぞれ検証 | 各ルートの `loader` / `action` |
| `/order`、`/order/mobile-checkout`、`/order/menu-items` | `staff`（将来は `manager` も許可可能） | Worker の HTTP 入口 |
| `/drip`、`/drip2` | 同上 | Worker の HTTP 入口 |
| `/cashier`、`/cashier/orders-history`、`/cashier/leftover-orders` | 同上 | Worker の HTTP 入口。リソースルートも含む |
| `/ws` | `staff`（将来は `manager` も許可可能） | React Router より前の Worker `fetch` で Upgrade 前に認証し、DO で再認証期限を強制 |
| `/staff/login` | なし（パブリック） | — |
| `/staff/logout` | セッションを削除する POST | Better Auth の `signOut` |
| `/api/auth/*` | 公開しない | Better Auth のサーバー API をスタッフ用 action から直接呼ぶ |

現行 `routes.ts` では `/order/mobile-checkout` と `/order/menu-items` の実装ファイルが `_cashier` ディレクトリにあるが、認可はファイルの置き場所ではなく実際の URL・ルート定義に従う。`_mobile` の画面は公開対象であり、スタッフ用レイアウトの認証を要求しない。ルート `/` のリダイレクト先 `/order` も保護対象とする。

## 認証フロー

### ログイン

```
1. スタッフが /staff/login にアクセス
2. ユーザー名・パスワードを入力して送信
3. action: 共有 D1 試行制限を通した後、Better Auth の signInUsername() を呼び出す
4. betterAuth が D1 の user テーブルを照会し scrypt でパスワード照合
5. 一致 → D1 の session テーブルにセッションを作成し、セッショントークンを Cookie にセット
6. 未認証でスタッフ画面から来た場合は、保存した元の画面へ戻す。それ以外は /order へ遷移する。今回 /admin は作らない
```

### ログアウト

```
/staff/logout への POST リクエスト
→ betterAuth の signOut() を呼び出す
→ D1 の session テーブルからセッションを削除
→ /staff/login にリダイレクト
```

### 未認証アクセス

スタッフ向け画面への未認証 GET（URL 直接入力を含む）は、元のパスとクエリを `returnTo` に保存して `/staff/login` にリダイレクトする。ログイン成功後は元の画面へ戻す。`returnTo` は同一オリジンのスタッフ用パスに限定し、外部 URL・`//` 始まり・ログイン画面自身などを拒否する。値がないか不正な場合は `/order` へ遷移する。権限不足は未認証と区別し、ログイン画面への無限リダイレクトを避ける。

スタッフ用 URL への HTTP リクエストは、GET・POST ともに `worker.ts` で React Router より先に認証・認可する。JSON 等のリソースルートは未認証なら `401`、権限不足または無効化済みアカウントなら `403` を返す。スタッフ画面は未認証ならログイン画面へリダイレクトする。`/ws` も DO に転送する前に同様に検査する。画面を隠すだけ、またはクライアント側の判定だけでは保護にならない。

### WebSocket の再認証

`/ws` は接続中のセッション失効も反映するため、Upgrade 時の一度だけの認証にはしない。

1. Worker は Upgrade 前にセッション、ロール、`isActive` を検証する。
2. Worker は外部リクエストに含まれる認証用内部ヘッダーを検証済みのユーザー ID・セッション ID・再認証期限で上書きして DO へ転送する。再認証期限は「セッションの `expiresAt`」と「接続から5分後」の早い方とする。
3. DO は接続ごとに再認証期限を保持し、接続直後の最初のメッセージとして `{ type: "auth-deadline", authDeadline, serverTime }` をそのソケットだけに送る。`authDeadline` と `serverTime` は Unix 時刻のミリ秒値とする。認証期限メッセージを送った後に通常の注文スナップショットを送る。
4. DO は再認証期限に達したソケットをアプリケーション用 close code `4001` で閉じる。これをセキュリティ上の期限強制とし、クライアントの動作には依存しない。
5. クライアントも `authDeadline - serverTime` から残り時間を計算し、単調時計を使ったタイマーで同じ期限に接続を閉じて再接続する。最初のメッセージが認証期限でない場合、または値が不正な場合は fail closed として接続を閉じる。端末時計のずれを避けるため、端末の絶対時刻との差分では判定しない。
6. `4001` またはクライアント側タイマーで切断した後の再接続は必ず Worker を経由するため、その時点の D1 セッションと `isActive` が再検証される。

これにより、通常の HTTP リクエストと新規 WebSocket 接続はセッション削除後すぐに拒否され、接続済み WebSocket も最長5分で拒否される。セッションの残り時間が5分未満なら、DO とクライアントの双方がその早い期限を使用する。5分間隔は少人数・短期間の運用で D1 負荷を抑えながら失効を反映するための上限であり、実装時の負荷試験で短縮はできるが延長はしない。

## セッション管理

betterAuth はセッションを **D1（サーバーサイド）に保存**する。Cookie にはセッショントークン（ランダム文字列）のみが格納され、セッションデータはサーバー側に留まる。

### Cookie 設定

Better Auth が設定する Cookie 属性と、このアプリのセッション期限は次のとおり。

| 属性 | 値 | 理由 |
|------|----|------|
| `httpOnly` | `true` | JavaScript からのアクセスを防ぐ |
| `secure` | 本番:`true` / 開発:`false` | betterAuth が `baseURL` から自動判定 |
| `sameSite` | `"lax"` | CSRF 対策と通常ナビゲーションの両立 |
| セッション有効期限 | `43200`秒（12時間） | 1日の文化祭開催 + 余裕を持たせた有効期限 |

### 強制無効化

D1 の `session` テーブルから該当行を削除すると、通常の HTTP リクエストと新規 WebSocket 接続は即時に無効化される。接続済み WebSocket は上記の再認証期限により最長5分で切断される。アカウント自体を停止する場合は `user.isActive` も `false` にし、セッションが新たに作られてもスタッフ用画面・API・WebSocket を利用できないようにする。

## データベーススキーマ

Better Auth CLI（`pnpm -F web auth:generate`）で Drizzle スキーマを生成し、`pnpm -F web db:generate` で SQL を生成して通常の migration フローに組み込む。

### betterAuth が生成するテーブル

**`user`**（username plugin と `user.additionalFields` によるフィールドを含む）

| カラム | 説明 | 使用 |
|--------|------|------|
| `id` | ユーザー ID（UUID） | ○ |
| `name` | 表示名 | ○ |
| `username` | ログインユーザー名（username plugin） | ○ |
| `displayUsername` | 表示用ユーザー名（username plugin） | ○ |
| `role` | サーバー管理の追加フィールド。初期値 `staff` | ○（将来 `manager` も使用可能）|
| `isActive` | サーバー管理の利用可否フラグ。初期値 `true` | ○（無効化後は認可しない）|
| `email` | Better Auth のアカウント作成に必要な値 | `staff-<UUID>@auth.invalid` 形式の内部用値を保存。スタッフには提示せず、ログインにも使わない |
| `emailVerified` | メール確認済みフラグ | メール認証は行わない。確認済みと偽装しない |
| `image` | アバター画像 URL | **未使用** |
| `createdAt` / `updatedAt` | 作成・更新日時 | ○ |

**`session`**

| カラム | 説明 |
|--------|------|
| `id` | セッション ID |
| `token` | Cookie に格納されるトークン |
| `userId` | 対応するユーザー ID |
| `expiresAt` | 有効期限 |
| `ipAddress` / `userAgent` | クライアント情報（任意） |

**`account`** はパスワード認証の credential 情報を保持するため使用する。**`verification`** は Better Auth のコアスキーマとして生成されるが、今回メール認証・メール再設定は使用しない。

### アカウント発行と内部用メール

- 当方がスタッフ用のユーザー名・初期パスワードを発行し、安全な経路で先方へ渡す。セルフサインアップは公開しない。
- `username` プラグインは email/password 認証を拡張するため、作成時の `email` は省略・空欄にできない。内部用メールは `staff-<ランダムUUID>@auth.invalid` 形式で生成する。ユーザー名は含めない。Better Auth の登録時検証と D1 の `email` 一意制約の両方で重複を防ぐ。
- `.invalid` は配送できない予約ドメインであり、先方の個人メールアドレスや受信箱は要求しない。採用した Better Auth バージョンでこの形式の登録・ユーザー名ログインを Worker テストで確認した。実在する他人のアドレスは使わない。
- メール認証とメール送信によるパスワード再設定は使用しない。パスワード紛失時は、下記の手順で旧アカウントを無効化して代替アカウントを発行する。同じアカウントのパスワードを直接書き換えない。

### 初期スタッフアカウントの投入

1. 本番アプリでは `emailAndPassword.disableSignUp: true` を常時維持する。公開サインアップを一時的にも有効にしない。
2. 本番 D1 にのみ接続する、公開 HTTP 入口のない一回限りの `provision-worker.ts` を `wrangler.provision.toml` で別途デプロイし、`scheduled()` で実行する。この処理内だけ、同じスキーマ設定で `disableSignUp: false`、`autoSignIn: false` の Better Auth インスタンスを生成する。
3. プロビジョニング処理から `auth.api.signUpEmail()` にユーザー名・内部用メール・初期パスワード・表示名を渡し、Better Auth にパスワードのハッシュ化と `user` / `account` の作成を任せる。手書き SQL や独自ハッシュでパスワードを投入しない。`role` はサーバー管理の既定値 `staff` とする。
4. 実行前に対象ユーザー名の重複を確認し、内部用メールはランダム UUID と D1 の一意制約で重複を防ぐ。実行後に件数・ロール・ユーザー名ログインを確認する。パスワードをログやリポジトリに残さない。再実行時に同じスタッフを重複作成しないようにする。
5. 投入が完了したら一回限りの処理・トリガー・投入用の秘密情報を撤去する。本番アプリの公開登録が引き続き拒否されることを確認する。

本番 D1 への実行・撤去手順は [スタッフ認証の運用手順](../operations/staff-auth.md) に記載する。通常アプリの `disableSignUp: true` のインスタンスから `signUpEmail()` を呼ぶだけでは投入できない。

### パスワード紛失時の代替アカウント発行

パスワードを忘れた本人には既存セッションや現在のパスワードを要求できず、メールによるリセットも行わないため、Better Auth の本人向け `changePassword()` / `setPassword()` は復旧手段に使わない。`admin` プラグインも本番アプリには追加せず、初期投入と同じ非公開のプロビジョニング処理で次の操作を行う。

1. 当方が事前に定めた連絡先で本人確認を行い、対象のユーザー ID とユーザー名を確定する。
2. `disableSignUp: false`、`autoSignIn: false` のプロビジョニング用 Better Auth インスタンスから `auth.api.signUpEmail()` を呼び、仮ユーザー名で代替アカウントと credential を先に作成する。パスワードハッシュを直接生成・更新しない。
3. パラメーター化した D1 の `batch()` で、対象ユーザーの `isActive` を `false` にし、全 `session` と credential の `account` を削除する。同じ batch 内で旧ユーザー名を一意な `retired_<ランダム値>` に変更し、代替アカウントの仮ユーザー名を元のユーザー名または合意した新しいユーザー名に変更する。batch が失敗した場合は仮アカウントを削除し、旧アカウントを維持する。
4. 旧ユーザーのログイン、既存セッション、新規 WebSocket 接続が拒否されることと、代替アカウントのユーザー名ログインが成功することを確認する。
5. 初期パスワードを安全な経路で本人に渡し、処理・トリガー・秘密情報を撤去する。再実行時は旧ユーザーの無効化と代替アカウントの存在を確認し、重複作成しない。

現行の業務データはスタッフのユーザー ID を所有者として参照しないため、代替アカウントへ移行できる。将来、操作履歴などがユーザー ID を参照する場合は旧レコードを削除せず保持し、履歴との対応を保つ。

## Better Auth セットアップ

共通設定は `apps/web/app/lib/auth-options.ts` に置き、CLI 用 `apps/web/auth.ts`、通常アプリ用 `apps/web/app/lib/auth.server.ts`、非公開の発行用 `apps/web/provision-worker.ts` で共有する。D1 には `@better-auth/drizzle-adapter` を使う。通常アプリは常に `disableSignUp: true`、発行用 Worker だけは `disableSignUp: false` と `autoSignIn: false` にする。

認証スキーマは `pnpm -F web auth:generate` で `apps/web/db/auth-schema.ts` に生成した。Drizzle の `db:generate` で作った `0010` マイグレーションを通常の D1 migration フローに含める。ログイン試行制限用テーブルは `0011` で追加した。

公開 `/api/auth/*` 入口は設けない。ログイン・ログアウト・セッション照会はスタッフ用 action とガードから Better Auth のサーバー API を直接呼ぶ。Better Auth 側でもサインアップと `/is-username-available` を無効化する。ログイン action には D1 の原子的なカウンターを使った試行制限（IP とユーザー名ごとに1分5回）を適用する。実装は `apps/web/app/lib/login-rate-limit.server.ts`。

## React Router 実装パターン

`apps/web/app/lib/auth.server.ts` の `authorizeStaff` が D1 セッション、`role === "staff"`、`isActive === true` を検査する。`guardStaffRequest` がスタッフ用パスを判定し、未認証の画面リクエストは安全な `returnTo` 付きで `/staff/login` へリダイレクトする。リソースルートは未認証に `401`、権限不足に `403` を返す。返却先とスタッフ用パスの判定は `apps/web/app/lib/auth-url.ts` に置く。

`worker.ts` が `guardStaffRequest` を React Router の `requestHandler` より前に呼ぶ。`/order`、`/drip`、`/drip2`、`/cashier` 配下は一括して保護し、各 `loader` / `action` にガードを重複して置かない。React Router の画面データ用 `.data` URL も元のパスに戻して判定する。リソースルートも同じ入口を通る。スタッフ用 URL と公開 `/mobile` の判定は `auth.server.workers.test.ts` で確認する。

`/ws` は React Router より前の Worker で `authorizeStaff` を呼び、検証した内部ヘッダーだけを DO に渡す。DO はヘッダーの欠落・不正値を拒否し、セッション期限または接続後5分の早い方で接続を閉じる。

## 今回作らない機能

`/admin`、`manager` 専用画面、スタッフ自身によるアカウント管理画面は作らない。既存の `/order/menu-items` はスタッフ用の商品管理であり、`manager` 専用にはしない。将来 `manager` 専用機能が必要になれば、その時点でルート権限・アカウント付与方法・`admin` プラグインの要否を再検討する。

## 設計判断

### betterAuth を採用する

パスワードハッシュ・セッション管理を自前実装するとセキュリティ上のミスを埋め込むリスクがある。Better Auth の認証機能と Cloudflare D1 + Drizzle アダプタを使う。今回不要な管理者向け API は追加しない。

### `nodejs_compat` を有効にする

betterAuth が AsyncLocalStorage を内部使用するため必要。`nodejs_compat` は Node.js バイナリを Workers に持ち込むものではなく、V8 isolate 上で動作する JS ポリフィルを提供するものであり、CLAUDE.md が禁止していた「V8 isolate で動作しないネイティブモジュール」とは異なる。

### ロールを数値レベルで比較しない

`manager` を将来導入しても、数値の大小で権限を推測しない。必要なルートに許可ロールを明示列挙する方式を採る。

将来さらに複雑な権限（「このロールはメニュー編集のみ可・会計は不可」など）が必要になった場合は、betterAuth の `createAccessControl()` を用いたパーミッションベースの RBAC に移行する。

### スタッフ画面を同一ロールにする

`/order`・`/drip`・`/drip2`・`/cashier` で担当別の認証ロールを分けず、今回のスタッフは共通して `staff` とする。

### メールは内部値としてのみ保持する

スタッフが入力するのはユーザー名とパスワードのみ。Better Auth の標準 `username` プラグインによるアカウント作成にはメール欄が必要なので、当方が一意な内部用メール形式の値を設定する。メール認証・メール通知・メールによるパスワード再設定は今回の対象外とする。

### 外部 IdP を使わない

Google などの外部 IdP を使った OAuth 認証は、文化祭の短期間・少人数運用では設定・管理のオーバーヘッドが大きい。単一アプリ完結でアカウント管理が可能なため、ユーザー名+パスワード認証のみとする。

## 検証・運用手順

- `staff-<UUID>@auth.invalid` の登録とユーザー名ログイン、公開サインアップとユーザー名照会の拒否は Worker テストで確認する。
- 画面・API・WebSocket の未認証ガードと再認証期限は Worker テストで確認する。
- 初期パスワードの受け渡し先と本人確認の連絡先は運用開始前に決める。本番投入、確認、撤去は [運用手順](../operations/staff-auth.md) に従う。
