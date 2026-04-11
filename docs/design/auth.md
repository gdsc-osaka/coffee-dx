# 認証・認可設計

## 概要

文化祭コーヒー注文管理システムにおける認証（誰であるか）・認可（何ができるか）の設計。

- **認証**: スタッフはユーザー名・パスワードでログインし、署名済み Cookie セッションで状態を保持する
- **認可**: ロールベースのアクセス制御（RBAC）を Remix のレイアウトルートの `loader` で実装する
- **スコープ**: 単一アプリケーション内完結。OAuth / OIDC などの外部委任認可は対象外

## ロール定義

| ロール | 説明 | ログイン | 数値レベル |
|--------|------|---------|-----------|
| `customer` | 一般客 | 不要（パブリック） | — |
| `staff` | ドリップ係・会計係 | 必要 | 1 |
| `manager` | 管理者（マネージャー） | 必要 | 2 |

数値レベルは「staff 以上」のような**階層比較**に使う（後述の `requireRole` 参照）。

`staff` ロールは `_drip`（ドリップ係）と `_cashier`（会計係）の両画面にアクセスできる。両画面への同時アクセスを制限する実用的な理由がないため、別ロールには分けない。

## ルートとアクセス権

| ルートグループ | 最低必要ロール | ガードする場所 |
|--------------|--------------|--------------|
| `_customer/*` | なし（パブリック） | — |
| `_drip/*` | `staff` | `_drip.tsx` の `loader` |
| `_cashier/*` | `staff` | `_cashier.tsx` の `loader` |
| `_admin/*` | `manager` | `_admin.tsx` の `loader` |
| `/staff/login` | なし（パブリック） | — |

## 認証フロー

### ログイン

```
1. スタッフが /staff/login にアクセス
2. ユーザー名・パスワードを入力して送信
3. action: D1 の staff_users を照会
4. PBKDF2 でパスワード照合
5. 一致 → セッションに { userId, role } を保存し Cookie にセット
6. ロールに応じてリダイレクト:
   - staff   → /_drip/home（または /_cashier/home）
   - manager → /_admin/home
```

### ログアウト

```
/staff/logout への POST リクエスト
→ セッションを破棄（Cookie を削除）
→ /staff/login にリダイレクト
```

### 未認証アクセス

`requireRole` がセッション不正・ロール不足を検出した場合、`redirect("/staff/login")` を throw する。Remix の `loader` は `Response` を throw できるため、以降の処理は行われない。

## セッション管理

Remix の `createCookieSessionStorage` を使用する。セッションデータは**暗号署名済み Cookie** として保存され、サーバーサイドのストアを必要としない。

### Cookie 設定

| 属性 | 値 | 理由 |
|------|----|------|
| `httpOnly` | `true` | JavaScript からのアクセスを防ぐ |
| `secure` | `true` | HTTPS のみ（Cloudflare Workers 環境） |
| `sameSite` | `"lax"` | CSRF 対策と通常ナビゲーションの両立 |
| `maxAge` | `43200`（12時間） | 1日の文化祭開催 + 余裕を持たせた有効期限 |
| `secrets` | Workers の環境変数から取得 | 署名・検証用シークレット |

### セッションデータ構造

```ts
type SessionData = {
  userId: string; // UUID
  role: "staff" | "manager";
};
```

### 強制無効化について

`createCookieSessionStorage` はサーバー側に状態を持たないため、**発行済みセッションの強制無効化はできない**。文化祭の規模（1日・少人数のスタッフ）では、ログアウトによる Cookie 削除で十分と判断した。

将来的に強制無効化が必要になった場合は、Cloudflare KV にセッション ID を保存するサーバーサイドセッションに移行する。

## スタッフユーザーテーブル

D1 に `staff_users` テーブルを追加する。

### テーブル定義

| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| `id` | TEXT | PRIMARY KEY | スタッフ ID（UUID） |
| `username` | TEXT | NOT NULL UNIQUE | ログインユーザー名 |
| `password_hash` | TEXT | NOT NULL | PBKDF2 ハッシュ（フォーマットは後述） |
| `role` | TEXT | NOT NULL CHECK(role IN ('staff','manager')) | ロール |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now', '+9 hours')) | 作成日時 |
| `updated_at` | TEXT | NOT NULL DEFAULT (datetime('now', '+9 hours')) | 最終更新日時 |

```sql
CREATE TABLE staff_users (
  id            TEXT NOT NULL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('staff', 'manager')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
```

## パスワードハッシュ

Cloudflare Workers は V8 isolate 環境のため `node:crypto` が使用できない（CLAUDE.md 参照）。**Web Crypto API（`crypto.subtle`）** を使って PBKDF2 でハッシュ化する。

### アルゴリズム

| パラメータ | 値 |
|------------|-----|
| アルゴリズム | PBKDF2 |
| ハッシュ | SHA-256 |
| iterations | 100,000 |
| salt | 16バイト（`crypto.getRandomValues` で生成） |

### 保存フォーマット

```
{base64(salt)}:{base64(hash)}
```

照合時は保存値から salt を取り出し、同じパラメータで再計算して比較する。

## Remix 実装パターン

### `requireRole` ユーティリティ

```ts
// app/session.server.ts

export type Role = "staff" | "manager";

const ROLE_LEVEL: Record<Role, number> = {
  staff: 1,
  manager: 2,
};

export async function requireRole(request: Request, minRole: Role): Promise<Role> {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const role = session.get("role") as Role | undefined;

  if (!role || ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
    throw redirect("/staff/login");
  }
  return role;
}
```

### レイアウトルートのガード

```ts
// app/routes/_drip.tsx  /  _cashier.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, "staff");
  return null;
}

// app/routes/_admin.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, "manager");
  return null;
}
```

レイアウトルートの `loader` を通過しない限り、配下の全ルート（`_drip/*`・`_cashier/*`・`_admin/*`）はレンダリングされない。子ルートに個別のガードを書く必要はない。

## 管理画面（`_admin`）の機能範囲

`manager` ロールのみアクセスできる管理画面に含める機能。

| 機能 | 概要 |
|------|------|
| メニュー管理 | 商品の追加・編集・販売停止 |
| アカウント管理 | スタッフの追加・ロール変更・削除 |
| 売上集計 | イベント単位の売上・注文数集計 |
| イベント設定 | 開催日（`eventId`）の作成・管理 |

### イベントと Durable Object の関係

リアルタイム同期は Durable Object（OrderDO）が担う。OrderDO のインスタンスは `event-{YYYY-MM-DD}` をキーに `idFromName` で取得される（`worker.ts:29`）。

管理画面でイベント（開催日）を登録することで、その日付に対応する OrderDO インスタンスが初回 WebSocket 接続時に自動生成される。詳細は [リアルタイム同期設計](./realtime-sync.md) を参照。

## 設計判断

### ロールを数値レベルで比較する

`if (role === 'manager' || role === 'staff')` のような列挙チェックではなく、`ROLE_LEVEL[role] >= ROLE_LEVEL[minRole]` の比較を用いる。ロールを追加する際に `ROLE_LEVEL` マップへの追加だけで対応でき、`requireRole` の呼び出し側は変更不要になる。

### `_drip` と `_cashier` を同一ロールにする

文化祭規模では同じ人が両方の画面を担当することが多く、「ドリップ係だけキャッシャー画面を見せない」という実用的な理由がない。ロールを分けると、スタッフ追加時のオペレーションコストが増えるだけになるため統合した。

### bcrypt を使わない

Workers 環境では `node:crypto` が動作しないため、`bcrypt` ライブラリは利用できない。Web Crypto API の PBKDF2（iterations=100,000）は文化祭規模のログイン頻度では十分な強度を持つ。

### 外部 IdP を使わない

Google などの外部 IdP を使った OAuth 認証は、文化祭の短期間・少人数運用では設定・管理のオーバーヘッドが大きい。単一アプリ完結でアカウント管理が可能なため、自前セッション管理を選択した。
