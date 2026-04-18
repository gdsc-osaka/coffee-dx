# 認証・認可設計

## 概要

文化祭コーヒー注文管理システムにおける認証（誰であるか）・認可（何ができるか）の設計。

- **認証**: スタッフはユーザー名・パスワードでログインし、betterAuth が管理するサーバーサイドセッションで状態を保持する
- **認可**: ロールベースのアクセス制御（RBAC）を Remix のレイアウトルートの `loader` で実装する
- **スコープ**: 単一アプリケーション内完結。OAuth / OIDC などの外部委任認可は対象外

## 採用ライブラリ

**[betterAuth](https://www.better-auth.com/)** を使用する。

| プラグイン | 用途 |
|-----------|------|
| `username` | ユーザー名+パスワードによるログイン |
| `admin` | ロール管理（`role` フィールド付与・ロール変更 API） |

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
| `manager` | 管理者 | 必要 |

ロールは betterAuth の admin plugin が `user` テーブルに追加する `role` フィールドで管理する。現時点では `staff` と `manager` は単純な包含関係（`staff ⊂ manager`）だが、**数値レベルによる比較は行わない**。ルートごとに許可するロールを明示的に列挙する方式を採る（後述）。

`staff` ロールは `_drip`（ドリップ係）と `_cashier`（会計係）の両画面にアクセスできる。両画面への同時アクセスを制限する実用的な理由がないため、別ロールには分けない。

## ルートとアクセス権

| ルートグループ | 許可ロール | ガードする場所 |
|--------------|-----------|--------------|
| `_customer/*` | なし（パブリック） | — |
| `_drip/*` | `staff`, `manager` | `_drip.tsx` の `loader` |
| `_cashier/*` | `staff`, `manager` | `_cashier.tsx` の `loader` |
| `_admin/*` | `manager` | `_admin.tsx` の `loader` |
| `/staff/login` | なし（パブリック） | — |
| `/api/auth/*` | なし（betterAuth ハンドラ） | — |

## 認証フロー

### ログイン

```
1. スタッフが /staff/login にアクセス
2. ユーザー名・パスワードを入力して送信
3. action: betterAuth の signIn.username() を呼び出す
4. betterAuth が D1 の user テーブルを照会し scrypt でパスワード照合
5. 一致 → D1 の session テーブルにセッションを作成し、セッショントークンを Cookie にセット
6. ロールに応じてリダイレクト:
   - staff   → /drip
   - manager → /admin
```

### ログアウト

```
/staff/logout への POST リクエスト
→ betterAuth の signOut() を呼び出す
→ D1 の session テーブルからセッションを削除
→ /staff/login にリダイレクト
```

### 未認証アクセス

`requireRole` がセッション不正・ロール不足を検出した場合、`redirect("/staff/login")` を throw する。

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

**`user`**（username plugin + admin plugin によるフィールドを含む）

| カラム | 説明 | 使用 |
|--------|------|------|
| `id` | ユーザー ID（UUID） | ○ |
| `name` | 表示名 | ○ |
| `username` | ログインユーザー名（username plugin） | ○ |
| `displayUsername` | 表示用ユーザー名（username plugin） | ○ |
| `role` | ロール（admin plugin）デフォルト `"user"` | ○（`staff` / `manager` を使用）|
| `email` | メールアドレス | **未使用**（スキーマには存在するが、このシステムではアカウント作成時に空または省略） |
| `emailVerified` | メール確認済みフラグ | **未使用** |
| `image` | アバター画像 URL | **未使用** |
| `banned` / `banReason` / `banExpires` | BAN 管理（admin plugin） | 必要に応じて使用 |
| `createdAt` / `updatedAt` | 作成・更新日時 | ○ |

**`session`**

| カラム | 説明 |
|--------|------|
| `id` | セッション ID |
| `token` | Cookie に格納されるトークン |
| `userId` | 対応するユーザー ID |
| `expiresAt` | 有効期限 |
| `ipAddress` / `userAgent` | クライアント情報（任意） |
| `impersonatedBy` | 管理者代理ログイン用（admin plugin） |

**`account`** / **`verification`**: betterAuth のコアスキーマとして生成されるが、このシステムでは未使用（OAuth 未使用のため）。

## betterAuth セットアップ

### auth インスタンスの生成

D1 バインディングはリクエストごとに `context.cloudflare.env` から取得するため、ファクトリ関数として定義する。

```ts
// app/lib/auth.server.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";

export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
    }),
    plugins: [
      username(),
      admin(),
    ],
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

betterAuth のすべての認証エンドポイント（ログイン・ログアウト・セッション取得など）を単一のキャッチオールルートで受け付ける。

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

### `requireRole` ユーティリティ

数値レベルではなく、**許可ロールの明示的な列挙**でガードする。

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

  if (!session || !allowedRoles.includes(session.user.role as Role)) {
    throw redirect("/staff/login");
  }

  return { userId: session.user.id, role: session.user.role as Role };
}
```

### レイアウトルートのガード

```ts
// app/routes/_drip.tsx  /  app/routes/_cashier.tsx
import { requireRole } from "~/lib/auth.server";
import type { Route } from "./+types/_drip";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireRole(request, context.cloudflare.env, ["staff", "manager"]);
  return null;
}

// app/routes/_admin.tsx
export async function loader({ request, context }: Route.LoaderArgs) {
  await requireRole(request, context.cloudflare.env, ["manager"]);
  return null;
}
```

レイアウトルートの `loader` を通過しない限り、配下の全ルート（`_drip/*`・`_cashier/*`・`_admin/*`）はレンダリングされない。子ルートに個別のガードを書く必要はない。

## 管理画面（`_admin`）の機能範囲

`manager` ロールのみアクセスできる管理画面に含める機能。

| 機能 | 概要 |
|------|------|
| メニュー管理 | 商品の追加・編集・販売停止 |
| アカウント管理 | スタッフの追加・ロール変更・削除（betterAuth admin plugin の API を使用） |
| 売上集計 | イベント単位の売上・注文数集計 |
| イベント設定 | 開催日（`eventId`）の作成・管理 |

アカウント管理は betterAuth の admin plugin が提供するサーバー API（`auth.api.setRole()`・`auth.api.removeUser()` 等）を使って実装する。

### イベントと Durable Object の関係

リアルタイム同期は Durable Object（OrderDO）が担う。OrderDO のインスタンスは `event-{YYYY-MM-DD}` をキーに `idFromName` で取得される（`worker.ts:29`）。

管理画面でイベント（開催日）を登録することで、その日付に対応する OrderDO インスタンスが初回 WebSocket 接続時に自動生成される。詳細は [リアルタイム同期設計](./realtime-sync.md) を参照。

## 設計判断

### betterAuth を採用する

パスワードハッシュ（scrypt）・セッション管理・アカウント管理 API を自前実装するのは、実装量は少ないが定数時間比較の実装ミスなどセキュリティバグを埋め込むリスクがある。betterAuth はこれらをテスト済みのコードとして提供し、Cloudflare D1 + Drizzle アダプタをサポートしている。

### `nodejs_compat` を有効にする

betterAuth が AsyncLocalStorage を内部使用するため必要。`nodejs_compat` は Node.js バイナリを Workers に持ち込むものではなく、V8 isolate 上で動作する JS ポリフィルを提供するものであり、CLAUDE.md が禁止していた「V8 isolate で動作しないネイティブモジュール」とは異なる。

### ロールを数値レベルで比較しない

現時点では `staff ⊂ manager` の単純な包含関係が成立するが、将来「現場編集権限あり」のような非包含関係のロールが生じた場合に数値モデルが破綻する。そのため最初から許可ロールを明示列挙する方式を採る。

将来さらに複雑な権限（「このロールはメニュー編集のみ可・会計は不可」など）が必要になった場合は、betterAuth の `createAccessControl()` を用いたパーミッションベースの RBAC に移行する。

### `_drip` と `_cashier` を同一ロールにする

文化祭規模では同じ人が両方の画面を担当することが多く、「ドリップ係だけキャッシャー画面を見せない」という実用的な理由がない。ロールを分けると、スタッフ追加時のオペレーションコストが増えるだけになるため統合した。

### 外部 IdP を使わない

Google などの外部 IdP を使った OAuth 認証は、文化祭の短期間・少人数運用では設定・管理のオーバーヘッドが大きい。単一アプリ完結でアカウント管理が可能なため、ユーザー名+パスワード認証のみとする。
