# coffee-dx

## 開発環境のセットアップ

### 前提条件

- [Node.js](https://nodejs.org/) (LTS 推奨)
- [pnpm](https://pnpm.io/) v10.13.1 以上

```bash
npm install -g pnpm
```

### 手順

#### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd coffee-dx
```

#### 2. 依存関係のインストール

`apps/web` ディレクトリで依存関係をインストールする。

```bash
cd apps/web
pnpm install
```

#### 3. ローカル DB マイグレーション

Cloudflare D1 のローカル環境にマイグレーションを適用する。

```bash
pnpm migrate:local
```

#### 4. 型定義の生成

React Router のルート型を生成する。

```bash
pnpm cd:typegen
```

#### 5. 開発サーバーの起動

```bash
pnpm dev
```

ブラウザで `http://localhost:5173` を開く。

---

## Linearを用いた開発フロー

### 手順

#### 1. Issue起票（PdM）

PdMがLinearにIssueを起票する。
Issueを見つけた場合は自分で起票しても構いません。

#### 2. アサイン

- **担当者が決まっている場合**: PdMがそのメンバーをアサインする
- **自分でタスクを取る場合**: 担当者が自分自身をアサインする

#### 3. ステータスをIn-Progressに変更

担当者がIssueのステータスを **In-Progress** に変更してから開発を開始する。

#### 4. ブランチ名のコピー

Linear上でIssueを開き、Issue画面右上のメニューから **Copy branch name** を選択するか、`Cmd + Shift + .` のショートカットでブランチ名をクリップボードにコピーする。

#### 5. コピーしたブランチ名で開発

コピーしたブランチ名でブランチを作成し、開発を行う。

```bash
git checkout -b <コピーしたブランチ名>
```

> このブランチ名を使うことで、GitHubとLinearが自動的に連携される。

#### 6. Pull Requestの作成（GitHub）

開発完了後、GitHubでPRを作成する。

- レビュアーには **coffee-dx-swe** を指定する
- PRを作成すると、LinearのIssueステータスが自動的に **In-Review** に変わる

#### 7. レビュー（SWEグループ）

SWEグループのメンバーがコードレビューを行い、承認後にマージする。

- マージが完了すると、LinearのIssueステータスが自動的に **Done** に変わる