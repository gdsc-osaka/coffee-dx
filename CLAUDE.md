# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

コーヒー同好会の注文管理アプリ。客向け注文・メニュー閲覧・注文番号確認、ドリップ係向け注文確認、会計係向け注文状況確認の画面を持つ。

## Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolate)
- **Framework**: Remix (単一アプリ)
- **DB**: Cloudflare D1
- **Real-time**: Cloudflare Durable Objects + WebSocket
- **IaC**: Terraform
- **Package Manager**: pnpm (workspaces)
- **Language**: TypeScript

## Monorepo Structure

```
apps/
  web/          # 単一Remixアプリ（全画面）
    app/
      routes/
        _customer/    # 客向け：メニュー閲覧・注文・注文番号確認
        _drip/        # ドリップ係：注文内容確認
        _cashier/     # 会計係：注文状況確認
packages/
  ui/           # 共有UIコンポーネント
  db/           # D1スキーマ・クエリ
  types/        # 共有型定義
terraform/      # Cloudflareリソース定義
```

## Architecture

### Single Remix App

全画面を `apps/web/` の1つのRemixアプリで管理し、1つのCloudflare Workerとしてデプロイする。

### Route Protection

スタッフ画面（`_drip/`・`_cashier/`）はレイアウトルートの `loader` でアクセス制御する。レイアウトルートの `loader` が認証を通過しない限り配下の全ルートにアクセスできない。

```ts
// app/routes/_drip.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const isStaff = await verifyStaffSession(request);
  if (!isStaff) throw redirect("/");
  return null;
}
```

### Real-time Updates

会計係・ドリップ係画面はDurable Objects + WebSocketでリアルタイム更新する。

- Durable Object が注文状態の真実源（source of truth）を管理
- 注文が更新されるたびに接続中のスタッフ画面へ WebSocket でプッシュ
- D1 は永続化（注文履歴・メニューマスタ）、Durable Object は揮発的な接続状態管理

### Cloudflare Workers の制約

**Node.js ネイティブモジュール（`fs`, `path`, `node:crypto` など）は使用禁止。** V8 isolate 環境のため動作しない。暗号処理は Web Crypto API（`crypto.subtle`）を使うこと。

Remix の loader 関数でデータを返す際は、Cloudflare CDN を意識して適切な `Cache-Control` ヘッダーをセットすること。

## Development Commands

```bash
# 依存関係インストール
pnpm install

# ローカル開発（Wrangler経由）
pnpm dev

# 型チェック
pnpm typecheck

# ビルド
pnpm build

# デプロイ
pnpm deploy

# Terraform
cd terraform
terraform plan
terraform apply
```

## Development Workflow (Linear + GitHub)

1. LinearのIssueをアサインしてステータスを **In-Progress** に変更
2. Linear上で `Cmd + Shift + .` でブランチ名をコピーして `git checkout -b <branch>`（このブランチ名でGitHub-Linear自動連携が動く）
3. PRを作成し、レビュアーに **coffee-dx-swe** を指定
4. PR作成でLinearが **In-Review** に、マージで **Done** に自動遷移

## Database Migrations

### ローカル開発

```bash
# スキーマ変更時、migration SQL を生成
pnpm db:generate

# ローカル D1 に適用
pnpm migrate:local

# リモート環境に適用（本番環境でのみ使用）
pnpm migrate:remote
```

### ファイル構成と git 管理

```
apps/web/drizzle/
  migrations/          # SQL migration ファイル（全て git 管理）
    0001_init.sql
    0002_add_table.sql
    ...
  meta/
    _journal.json      # ✅ git 管理（必須）- migration 実行履歴
    *_snapshot.json    # ✅ git 管理（必須）- スキーマスナップショット
```

**重要**: `migrations/meta/` 配下の `.gitignore` に記載しない。チーム全体でマイグレーション履歴を同期するために必須。

### CI/CD パイプライン

- **`db-migrate.yml`**: `apps/web/drizzle/migrations/` に変更があれば、自動的に本番 D1 へ migration を実行
- migration コマンドは `pnpm migrate:remote -- --yes` で実行（`--yes` フラグで確認なしで進行）

### スキーマ変更の流れ

1. `apps/web/db/schema.ts` を編集
2. `pnpm db:generate` で migration SQL を自動生成 → `apps/web/drizzle/migrations/NNNN_*.sql` が作成
3. `pnpm migrate:local` でローカルテスト
4. `git add apps/web/drizzle/` でコミット（`migrations/` と `migrations/meta/` 両方）
5. `git push` & PR 作成 → マージ時に自動で本番環境に migration 実行

## UI Components

UIコンポーネントには **shadcn/ui** を使用する。

- コンポーネントは `apps/web/app/components/ui/` に配置済み
- 新しいコンポーネントが必要な場合は `pnpm dlx shadcn@latest add <component>` で追加
- スタイルは Tailwind CSS v4 + shadcn/ui のデザイントークン（CSS変数）を使う
- アイコンは `lucide-react` を使用

## Testing

### テストの種類と使い分け

| コマンド | 環境 | 対象ファイル | 用途 |
|---|---|---|---|
| `pnpm test` | jsdom | `*.test.ts(x)` | コンポーネント・ユーティリティ |
| `pnpm test:workers` | workerd (本物のD1) | `*.workers.test.ts` | DBクエリ（`features/*/queries.ts`）|

### DBクエリのテスト（`*.workers.test.ts`）

`@cloudflare/vitest-pool-workers` を使い、本物の D1（Miniflare）で動作する。モックは使わない。

**テストファイルの雛形:**

```ts
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { someTable } from "../../../db/schema";
import { someQuery } from "./queries";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("someQuery", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    db = drizzle(testEnv.DB);
    await db.delete(someTable); // テストごとにクリア
  });

  it("期待する動作の説明", async () => {
    // Arrange: テストデータ投入
    // Act: クエリ実行
    // Assert: 結果検証
  });
});
```

**注意点:**
- インポートは `~/` エイリアス不可、相対パスを使うこと（workerd 環境でエイリアスが解決されないため）
- `*.workers.test.ts` は本番 `tsconfig.json` の exclude に含まれているので `tsc` の対象外。型チェックは `pnpm typecheck` の中で `tsconfig.workers.json` 経由で実行される

### コンポーネントのテスト（`*.test.tsx`）

UIロジックがあるものだけ書く。表示だけのコンポーネントはスキップで十分。

```tsx
import { render, screen } from "@testing-library/react";
import { SomeComponent } from "./SomeComponent";

it("説明", () => {
  render(<SomeComponent prop="value" />);
  expect(screen.getByText("期待するテキスト")).toBeInTheDocument();
});
```

## Code Review

CodeRabbitが自動レビューを行う（日本語）。レビューコメントへの返答もCodeRabbitが自動対応する。
