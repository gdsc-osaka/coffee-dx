# Drip 画面リデザイン 設計書

## 概要

### 変更動機

現状の drip 画面は注文単位でステータスを管理する。これにより以下の問題が生じている。

- コーヒーを淹れる担当が注文番号を意識する必要がある
- 注文が入る前に仕込んでおく（事前仕込み）を管理できない
- 複数杯注文の進捗を cashier 側で 1 杯単位で確認できない

### 変更方針

- **抽出の管理単位を注文からメニュー種別ごとの杯（cup）に変更する**
- 1 レコード = 1 cup を表す `brew_units` テーブルを新設する
- 同時に開始した N 杯を `batch_id` でグループ化し、drip 画面のカード表示に対応する
- 注文ステータスの遷移は brew_units の状態から自動導出し、drip 画面が orders を直接操作しない構造にする

---

## DB スキーマ変更

### 新規テーブル：`brew_units`

```sql
CREATE TABLE brew_units (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL,
  menu_item_id  TEXT NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,  -- NULL = 事前仕込み（未紐付き）
  status        TEXT NOT NULL DEFAULT 'brewing'
                CHECK(status IN ('brewing', 'ready')),
  business_date TEXT NOT NULL,  -- 業務日 YYYY-MM-DD（order_number_counters.business_date と同じ命名）
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX idx_brew_units_menu_date   ON brew_units(menu_item_id, business_date);
CREATE INDEX idx_brew_units_order_item  ON brew_units(order_item_id);
CREATE INDEX idx_brew_units_batch       ON brew_units(batch_id);
```

**カラム説明**

| カラム | 説明 |
|--------|------|
| `id` | UUID、杯ごとの一意識別子 |
| `batch_id` | UUID、同一の「開始」操作でまとめて生成した杯のグループ ID |
| `menu_item_id` | どのメニューの杯か。`ON DELETE RESTRICT`：brew_units が残っている間はメニュー削除不可 |
| `order_item_id` | どの order_item に割り当てられたか。NULL = 未紐付き（事前仕込み）。`ON DELETE SET NULL`：order_item 削除時に紐付きを解除し brew_unit は余剰として残す |
| `status` | `brewing`（抽出中） / `ready`（完成） |
| `business_date` | 業務日（YYYY-MM-DD）。`order_number_counters.business_date` と同じ命名。DO 層では `eventId` と呼ぶ |

### 既存テーブルの変更

| テーブル | 変更内容 |
|---------|---------|
| `orders` | `status` の遷移を自動化（drip が直接変更しなくなる）。カラム定義は変えない |
| `order_items` | 変更なし |
| `menu_items` | 変更なし |
| `order_number_counters` | 変更なし |

### `orders.status` の遷移

drip 画面が orders を直接操作していた従来の遷移をすべて自動化する。

```
注文作成         → pending
最初の brew_unit が order_item に紐付く → brewing  （OrderDO が自動遷移）
全 order_item の必要数を ready な brew_unit が満たす → ready  （OrderDO が自動遷移）
バッチ取り消しで紐付き brew_unit が全て消える → pending  （OrderDO が自動遷移）
cashier が完了   → completed
キャンセル       → cancelled
```

---

## OrderDO 変更

### インメモリ状態

```ts
// 既存
orders: Map<string, OrderData>

// 追加
brewUnits: Map<string, BrewUnitData>  // event 全体の brew_units（完成済みを含む）
```

```ts
type BrewUnitData = {
  id: string;
  batchId: string;
  menuItemId: string;
  menuItemName: string;   // JOIN して保持
  orderItemId: string | null;
  status: 'brewing' | 'ready';
  businessDate: string;  // DB の business_date。DO 層では eventId と同値
  createdAt: string;
  updatedAt: string;
};
```

### 追加エンドポイント

| Method | Path | 処理 |
|--------|------|------|
| `POST` | `/do/brew-units` | N 杯分の BrewUnit を一括生成。同一 `batch_id` を付与する |
| `POST` | `/do/brew-units/batch/:batchId/complete` | batch_id が一致する `brewing` な BrewUnit を全て `ready` に遷移 |
| `POST` | `/do/brew-units/batch/:batchId/cancel` | バッチを取り消す。紐付き済みユニットのリンクを解除してから全削除し、影響注文を再評価する |
| `DELETE` | `/do/brew-units/batch/:batchId` | batch_id が一致する BrewUnit のうち `order_item_id IS NULL` なものを削除（余剰削除）。紐付き済みは削除不可 |

**`POST /do/brew-units/batch/:batchId/cancel` の処理手順**

```
1. batch_id が一致する全 BrewUnit を取得
2. 紐付き済みユニット（order_item_id IS NOT NULL）の order_item_id を記録し、NULL に更新（DB・インメモリ両方）
3. バッチ内の全 BrewUnit を削除（DB・インメモリ両方）
4. 手順 2 で記録した order_item_id が属する注文ごとに evaluateOrderStatus を呼び出す
```

`POST /do/brew-units` のリクエストボディ：

```ts
{
  menuItemId: string;
  count: number;      // 開始する杯数
  // eventId は DO が idFromName で保持しているためリクエストボディへの明示は不要
}
```

### 既存エンドポイントの変更

**`POST /do/new-order`**

注文受付時に未紐付きの BrewUnit を自動割り当てする処理を追加する。

```
for each order_item in 新規注文:
  1. event_id が一致し order_item_id IS NULL の BrewUnit を取得
     （priority: status='ready' → status='brewing'、createdAt 昇順）
  2. min(order_item.quantity, 取得件数) 件だけ order_item_id を紐付け
  3. 紐付けた件数から orders.status の自動遷移判定を行う
```

### 注文ステータス自動遷移ロジック

BrewUnit の生成・更新・リンク変更が発生するたびに対象注文を評価する。

```ts
function evaluateOrderStatus(orderId: string): void {
  const order = this.orders.get(orderId);

  // 終端ステータスは自動遷移の対象外
  if (!order || order.status === 'cancelled' || order.status === 'completed') return;

  const orderItems = order.items;

  // 全 order_item について紐付き BrewUnit の数を集計
  const linkedUnits = getBrewUnitsForOrder(orderId);

  const allReady = orderItems.every(item =>
    linkedUnits.filter(u => u.orderItemId === item.id && u.status === 'ready').length >= item.quantity
  );
  const anyLinked = linkedUnits.length > 0;

  if (allReady && order.status !== 'ready') {
    transitionOrderStatus(orderId, 'ready');
  } else if (anyLinked && order.status === 'pending') {
    transitionOrderStatus(orderId, 'brewing');
  } else if (!anyLinked && order.status === 'brewing') {
    // バッチ取り消しで紐付き BrewUnit が全て消えた場合に pending へ巻き戻す
    transitionOrderStatus(orderId, 'pending');
  }
}
```

---

## WebSocket プロトコル変更

### ServerMessage 型

```ts
type ServerMessage =
  | { type: 'SNAPSHOT'; orders: OrderData[]; brewUnits: BrewUnitData[] }  // brewUnits を追加
  | { type: 'ORDER_CREATED'; order: OrderData }
  | { type: 'ORDER_UPDATED'; orderId: string; status: OrderStatus }
  | { type: 'BREW_UNITS_CREATED'; brewUnits: BrewUnitData[] }             // バッチ生成
  | { type: 'BREW_UNIT_UPDATED'; brewUnit: BrewUnitData }                 // status 変更・紐付け変更
  | { type: 'BREW_UNIT_DELETED'; brewUnitId: string }                     // 余剰削除
```

SNAPSHOT は接続直後に全件送信する。BrewUnit は当日の `event_id` に一致する `status IN ('brewing', 'ready')` の全レコードを含む（`order_item_id` の有無を問わない）。これにより drip の抽出中カード・余剰表示と cashier の per-order 進捗表示の両方が初期描画から正しく機能する。

---

## 画面仕様

### Drip 画面（`_drip/home.tsx`）

#### 表示ロジック

WebSocket から受け取った `orders` と `brewUnits` を使い、メニュー種別ごとに集計する。

```ts
type MenuBrewSummary = {
  menuItemId: string;
  menuItemName: string;
  // 集計値
  ordered: number;    // active orders の order_items.quantity 合計
  brewing: number;    // status='brewing' の BrewUnit 数（紐付き・未紐付き合計）
  ready: number;      // status='ready' の BrewUnit 数（紐付き・未紐付き合計）
  surplus: number;    // order_item_id IS NULL な BrewUnit 数（余剰、削除可能）
  // バッチ一覧（カード表示用）
  batches: BrewBatchSummary[];
};

type BrewBatchSummary = {
  batchId: string;
  count: number;
  linkedCount: number;  // order_item_id IS NOT NULL な杯数（取り消し時の影響確認用）
  status: 'brewing' | 'ready';  // バッチ内が全て ready になったら ready
  createdAt: string;
};
```

#### カード挙動

1. ドリッパーが杯数を選んで「開始」→ `POST /do/brew-units { eventId,menuItemId, count }` → BrewUnit N 件生成 → `BREW_UNITS_CREATED` broadcast → 全画面に新しいバッチカードが出現
2. 「完了」ボタン → `POST /do/brew-units/batch/:batchId/complete` → `BREW_UNIT_UPDATED` × N broadcast → バッチ内の全 brewing を一括で ready に遷移しカードが消滅、完成数がインクリメントされる
3. 「取り消し」ボタン → `POST /do/brew-units/batch/:batchId/cancel` → 紐付き済みユニットを解除してから全削除 → `BREW_UNIT_DELETED` × N broadcast＋影響注文への `ORDER_UPDATED` broadcast → カードが消滅。紐付き解除された注文は `brewing → pending` に巻き戻る。`linkedCount > 0` の場合は確認ダイアログを表示する
4. 「余剰削除」ボタン（`order_item_id IS NULL` な杯を含むバッチのみ表示）→ `DELETE /do/brew-units/batch/:batchId` → `BREW_UNIT_DELETED` × N broadcast → 未紐付き杯のみ削除。紐付き済みの杯は残る

#### ステータス表示レイアウト（1 メニュー種別あたり）

```
[メニュー名]  注文: 5  抽出中: 3  完成: 2
  ┌────────────────────────────────┐
  │ 抽出中  3杯  [完了]  [取り消し]│  ← batch カード
  └────────────────────────────────┘
  ┌────────────────────────────────────────┐
  │ 完成済み（未紐付き） 1杯  [余剰削除]  │  ← 余剰カード（未紐付きのみ削除可）
  └────────────────────────────────────────┘
[_個] [開始]
```

### Cashier 画面（`_cashier/home.tsx`）

#### 表示ロジック

注文カード内の各 order_item に紐付いた BrewUnit を表示する。

```ts
// order_item ごとに紐付き BrewUnit を集計
const linkedUnits = brewUnits.filter(u => u.orderItemId === orderItem.id);
const readyCount  = linkedUnits.filter(u => u.status === 'ready').length;
const brewingCount = linkedUnits.filter(u => u.status === 'brewing').length;
```

#### 表示例

```
注文 #5
  ブレンドコーヒー × 3    [■ 完成][■ 完成][□ 抽出中]
  アイスコーヒー   × 1    [□ 未着手]
```

- `■` ready、`□ 抽出中` brewing、`□ 未着手` 未紐付き
- 全 BrewUnit が ready になると注文カードが「提供待ち」に自動遷移（OrderDO 側で ORDER_UPDATED を broadcast）

---

## 実装ステップ

1. **DB マイグレーション** — `brew_units` テーブル追加 (`pnpm db:generate` → `pnpm migrate:local`)
2. **OrderDO 拡張** — BrewUnit のインメモリ管理・エンドポイント追加・自動紐付けロジック・注文ステータス自動遷移
3. **Drip 画面書き換え** — 注文カードビュー → メニュー種別集計ビュー
4. **Cashier 画面更新** — order_item ごとの BrewUnit 進捗表示追加
5. **WebSocket SNAPSHOT 更新** — brewUnits フィールド追加
6. **テスト更新** — `OrderDO.workers.test.ts` に BrewUnit 関連ケース追加

---

## 確定事項まとめ

| # | 項目 | 決定 |
|---|------|------|
| 1 | バッチ内の部分完了 | **不可**。バッチ単位で一括完了のみ |
| 2 | `orders.status = 'brewing'` | **残す**。cashier が「抽出中」と「未着手」を区別できるようにする |
| 3 | 余剰削除の対象 | **未紐付きのみ**。`order_item_id IS NULL` な杯だけ削除可能 |
| 4 | バッチ取り消し | **可**。紐付き済みユニットも強制解除して全削除。解除された注文は `brewing → pending` に巻き戻る。`linkedCount > 0` の場合は確認ダイアログで警告する |
