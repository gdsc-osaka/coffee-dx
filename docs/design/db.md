# データベース設計

## 概要

Cloudflare D1（SQLite互換）を使用した文化祭コーヒー注文管理システムのデータベース設計。

## ER図

```mermaid
erDiagram
    menu_items ||--o{ order_items : "1:N"
    orders ||--|{ order_items : "1:N"

    menu_items {
        INTEGER id PK
        TEXT name "メニュー名"
        INTEGER price "価格（円）"
        TEXT description "説明"
        TEXT image_url "画像URL"
        INTEGER is_available "販売中フラグ（0/1）"
        INTEGER display_order "表示順"
    }

    orders {
        INTEGER id PK
        INTEGER order_number "注文番号（当日通し番号）"
        TEXT status "注文状態"
        INTEGER total_amount "合計金額（円）"
        TEXT created_at "注文日時"
        TEXT updated_at "更新日時"
    }

    order_items {
        INTEGER id PK
        INTEGER order_id FK "注文ID"
        INTEGER menu_item_id FK "メニューID"
        INTEGER quantity "数量"
        INTEGER unit_price "注文時単価（円）"
    }

```

## テーブル定義

### `menu_items` — メニューマスタ

販売するコーヒーメニューを管理する。

| カラム          | 型      | 制約                      | 説明                                 |
| --------------- | ------- | ------------------------- | ------------------------------------ |
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT | メニューID                           |
| `name`          | TEXT    | NOT NULL                  | メニュー名（例: ブレンドコーヒー）   |
| `price`         | INTEGER | NOT NULL                  | 価格（円）                           |
| `description`   | TEXT    |                           | 説明文                               |
| `image_url`     | TEXT    |                           | メニュー画像のURL                    |
| `is_available`  | INTEGER | NOT NULL DEFAULT 1        | 販売中フラグ（1=販売中, 0=売り切れ） |
| `display_order` | INTEGER | NOT NULL DEFAULT 0        | メニュー表示順                       |

### `orders` — 注文

客の注文を管理する。`order_number` は当日の通し番号で、客に見せる番号として使用する。

| カラム         | 型      | 制約                               | 説明                               |
| -------------- | ------- | ---------------------------------- | ---------------------------------- |
| `id`           | INTEGER | PRIMARY KEY AUTOINCREMENT          | 注文ID（内部用）                   |
| `order_number` | INTEGER | NOT NULL                           | 注文番号（当日通し番号、客に表示） |
| `status`       | TEXT    | NOT NULL DEFAULT 'pending'         | 注文状態                           |
| `total_amount` | INTEGER | NOT NULL                           | 合計金額（円）                     |
| `created_at`   | TEXT    | NOT NULL DEFAULT (datetime('now')) | 注文日時                           |
| `updated_at`   | TEXT    | NOT NULL DEFAULT (datetime('now')) | 更新日時                           |

**注文状態（`status`）の遷移:**

```
pending → brewing → ready → completed
                           → cancelled
```

| status      | 説明                             |
| ----------- | -------------------------------- |
| `pending`   | 注文受付済み・未着手             |
| `brewing`   | ドリップ中                       |
| `ready`     | 提供準備完了（客の受け取り待ち） |
| `completed` | 受け渡し完了                     |
| `cancelled` | キャンセル                       |

### `order_items` — 注文明細

注文に含まれる各メニューの明細。注文時の単価を `unit_price` に記録し、メニュー価格の変更に影響されない。

| カラム         | 型      | 制約                                | 説明               |
| -------------- | ------- | ----------------------------------- | ------------------ |
| `id`           | INTEGER | PRIMARY KEY AUTOINCREMENT           | 明細ID             |
| `order_id`     | INTEGER | NOT NULL, REFERENCES orders(id)     | 注文ID             |
| `menu_item_id` | INTEGER | NOT NULL, REFERENCES menu_items(id) | メニューID         |
| `quantity`     | INTEGER | NOT NULL DEFAULT 1                  | 数量               |
| `unit_price`   | INTEGER | NOT NULL                            | 注文時の単価（円） |

## 設計判断

### 金額をINTEGERで管理

文化祭の価格は全て円単位の整数。浮動小数点の誤差を避けるためINTEGERを使用する。

### `order_number`（通し番号）と`id`の分離

`id` は内部の主キー、`order_number` は客に見せる当日の通し番号。日をまたいで運用する場合でもIDの連続性に依存しない。

### `unit_price` を注文明細に保持

注文後にメニュー価格を変更しても、注文時の価格が保持される。
