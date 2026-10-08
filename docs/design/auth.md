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

`customer` はログインアカウントのロールではなく、公開画面の利用者を表す。`staff` / `manager` は Better Auth の `user.additionalFields.role` で保持し、クライアントから変更できないサーバー管理項目（`input: false`）とする。初期値は `staff`。今回の運用で発行するのは `staff` アカウントのみ。将来 `manager` を実際に使う際は、付与方法と専用権限を別途設計する。**数値レベルによるロール比較は行わない**。

`staff` は `/order`（店頭注文・会計・モバイル注文会計・商品管理）、`/drip`、`/drip2`、`/cashier` にアクセスできる。担当別のロールには分けない。

## ルートとアクセス権

| ルートグループ | 許可ロール | ガードする場所 |
|--------------|-----------|--------------|
| `/mobile/:storeToken`、`/mobile/orders/:publicToken`、`/mobile/orders/:publicToken/status` | 公開。ただし店舗トークン・注文控えトークンをそれぞれ検証 | 各ルートの `loader` / `action` |
| `/order`、`/order/mobile-checkout`、`/order/menu-items` | `staff`（将来は `manager` も許可可能） | `_order` レイアウトと各 `loader` / `action` |
| `/drip`、`/drip2` | 同上 | `_drip` / `_drip2` レイアウトと各 `loader` / `action` |
| `/cashier`、`/cashier/orders-history`、`/cashier/leftover-orders` | 同上 | `_cashier` レイアウトと各 `loader` / `action`。リソースルートは個別にガード |
| `/ws` | `staff`（将来は `manager` も許可可能） | React Router より前の Worker `fetch` で Upgrade 前に認証 |
| `/staff/login` | なし（パブリック） | — |
| `/api/auth/*` | ログイン等の必要な操作のみ公開 | Better Auth ハンドラと公開エンドポイントの制限 |

現行 `routes.ts` では `/order/mobile-checkout` と `/order/menu-items` の実装ファイルが `_cashier` ディレクトリにあるが、認可はファイルの置き場所ではなく実際の URL・ルート定義に従う。`_mobile` の画面は公開対象であり、スタッフ用レイアウトの認証を要求しない。ルート `/` のリダイレクト先 `/order` も保護対象とする。

## 認証フロー

### ログイン

```
1. スタッフが /staff/login にアクセス
2. ユーザー名・パスワードを入力して送信
3. action: betterAuth の signIn.username() を呼び出す
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

スタッフ用 `action` は直接 POST されてもサーバー側で認証・認可する。JSON 等のリソースルートは親レイアウトの `loader` に依存せず各ハンドラで認証し、未認証なら `401`、権限不足なら `403` を返す。`/ws` は `worker.ts` から DO に転送する前に同様に検査する。画面を隠すだけ、またはクライアント側の判定だけでは保護にならない。

## セッション管理

betterAuth はセッションを **D1（サーバーサイド）に保存**する。Cookie にはセッショントークン（ランダム文字列）のみが格納され、セッションデータはサーバー側に留まる。

### Cookie 設定

betterAuth がデフォルトで設定する属性に加え、以下を明示的に設定する。

| 属性 | 値 | 理由 |
|------|----|------|
| `httpOnly` | `true` | JavaScript からのアクセスを防ぐ |
| `secure` | 本番:`true` / 開発:`false` | betterAuth が `baseURL` から自動判定 |
| `sameSite` | `"lax"` | CSRF 対策と通常ナビゲーションの両立 |
| セッション有効期限 | `43200`秒（12時間） | 1日の文化祭開催 + 余裕を持たせた有効期限 |

### 強制無効化

D1 の `session` テーブルから該当行を削除することで、発行済みセッションを即時無効化できる

## データベーススキーマ

betterAuth CLI（`npx @better-auth/cli generate`）でマイグレーション SQL を生成し、プロジェクトの通常の migration フローに組み込む。

### betterAuth が生成するテーブル

**`user`**（username plugin と `user.additionalFields` によるフィールドを含む）

| カラム | 説明 | 使用 |
|--------|------|------|
| `id` | ユーザー ID（UUID） | ○ |
| `name` | 表示名 | ○ |
| `username` | ログインユーザー名（username plugin） | ○ |
| `displayUsername` | 表示用ユーザー名（username plugin） | ○ |
| `role` | サーバー管理の追加フィールド。初期値 `staff` | ○（将来 `manager` も使用可能）|
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
- `.invalid` は配送できない予約ドメインであり、先方の個人メールアドレスや受信箱は要求しない。採用する Better Auth バージョンでこの形式の登録・ユーザー名ログインを事前テストする。形式が拒否された場合のみ、当方が管理するドメインの専用サブドメインへ切り替える。実在する他人のアドレスは使わない。
- メール認証とメール送信によるパスワード再設定は使用しない。パスワード紛失時は当方が本人確認のうえ再発行する運用とし、具体的な手順は実装前に確定する。

### 初期スタッフアカウントの投入

1. 本番アプリでは `emailAndPassword.disableSignUp: true` を常時維持する。公開サインアップを一時的にも有効にしない。
2. 本番 D1 にのみ接続する、公開 HTTP 入口のない一回限りのプロビジョニング処理を別に用意する。Cloudflare Workers の `scheduled()` ハンドラを候補とし、通常アプリとは別の設定・デプロイで実行する。この処理内だけ、同じスキーマ設定で `disableSignUp: false`、`autoSignIn: false` の Better Auth インスタンスを生成する。
3. プロビジョニング処理から `auth.api.signUpEmail()` にユーザー名・内部用メール・初期パスワード・表示名を渡し、Better Auth にパスワードのハッシュ化と `user` / `account` の作成を任せる。手書き SQL や独自ハッシュでパスワードを投入しない。`role` はサーバー管理の既定値 `staff` とする。
4. 実行前に対象ユーザー名・内部用メールの重複を確認し、実行後に件数・ロール・ユーザー名ログインを確認する。パスワードをログやリポジトリに残さない。再実行時に同じスタッフを重複作成しないようにする。
5. 投入が完了したら一回限りの処理・トリガー・投入用の秘密情報を撤去する。本番アプリの公開登録が引き続き拒否されることを確認する。

本番 D1 への `scheduled()` 実行方法と撤去手順は実装時に検証する。通常アプリの `disableSignUp: true` のインスタンスから `signUpEmail()` を呼ぶだけでは投入できない。

## betterAuth セットアップ

### auth インスタンスの生成

D1 バインディングはリクエストごとに `context.cloudflare.env` から取得するため、ファクトリ関数として定義する。

```ts
// app/lib/auth.server.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";

export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
    },
    plugins: [username()],
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "staff",
          input: false,
        },
      },
    },
    session: {
      expiresIn: 43200, // 12時間
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

### betterAuth API ルート

Better Auth の認証エンドポイントを単一のキャッチオールルートで受け付ける。ただしキャッチオールを公開しただけで全操作を許可する設計にはしない。セルフサインアップを無効化し、今回不要なメール再設定・メール変更などの公開範囲を実装時に確認する。

```ts
// app/routes/api.auth.$.ts
import { createAuth } from "~/lib/auth.server";
import type { Route } from "./+types/api.auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
  return createAuth(context.cloudflare.env).handler(request);
}

export async function action({ request, context }: Route.ActionFunctionArgs) {
  return createAuth(context.cloudflare.env).handler(request);
}
```

## React Router 実装パターン

### サーバー側の認証・認可ガード

数値レベルではなく、**許可ロールの明示的な列挙**でガードする。`manager` は将来の拡張余地として型に残すが、今回発行するアカウントは `staff` のみ。以下は概念例であり、実装では画面向け（リダイレクト）と API 向け（`401` / `403`）の応答を分ける。

```ts
// app/lib/auth.server.ts（上記ファイルに追記）
import { redirect } from "react-router";

export type Role = "staff" | "manager";

export async function requireRole(
  request: Request,
  env: Env,
  allowedRoles: Role[]
): Promise<{ userId: string; role: Role }> {
  const session = await createAuth(env).api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw redirect("/staff/login");
  }

  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new Response("Forbidden", { status: 403 });
  }

  return { userId: session.user.id, role: session.user.role as Role };
}
```

### レイアウトと各ハンドラのガード

`_order.tsx`、`_drip.tsx`、`_drip2.tsx`、`_cashier.tsx` のレイアウト `loader` で、スタッフ画面の表示を保護する。ただし親の `loader` だけでは子ルートの `action` やリソースルートへの直接リクエストを守れないため、**各スタッフ用 `loader` / `action` から共通ガードを明示的に呼ぶ方式**を採用する。新規ルートで呼び忘れないよう、スタッフ用ルート一覧を基に未認証 GET・POST の回帰テストを設ける。React Router の認証ミドルウェアは今回は導入しない。

`/cashier/orders-history` と `/cashier/leftover-orders` はリソースルートなので個別の認証が必須。`/order` 配下の商品管理・注文確定・モバイル注文会計も、更新 `action` に認可をかける。`/ws` は React Router の外側にあるため、ミドルウェアだけでは保護できない。Worker 入口でセッションを検証し、失敗時は DO に転送しない。DO への内部リクエストの信頼境界も実装時に確認する。

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

## 実装前の検証・運用手順

- 一回限りの `scheduled()` プロビジョニング処理を本番 D1 へ接続・実行・撤去する操作と、失敗時の安全な再実行を検証する。
- 採用する Better Auth バージョンで `staff-<UUID>@auth.invalid` の登録とユーザー名ログインが通ることを確認する。通らない場合は当方管理ドメインの専用サブドメインを決める。
- 初期パスワードの安全な受け渡し、紛失時の本人確認と再発行、スタッフ退任時のアカウント・既存セッションの無効化手順を整える。
