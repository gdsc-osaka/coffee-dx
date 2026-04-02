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

## Code Review

CodeRabbitが自動レビューを行う（日本語）。レビューコメントへの返答もCodeRabbitが自動対応する。
