# 待ち時間計算アルゴリズムの考察

## 概要

店員があとどれくらいで商品を届けられるかを把握するのを目的とする。
商品ごとに商品到着見込み時間を〇〇分後という形で表示する。
ミスや、イレギュラーを想定して**最悪の待ち時間**を計算している。

---

## 前提モデル

### 割り当てモデル（案1: 受注単位 FIFO）

- ドリップ係は常に**一番古い `pending` 注文を1件まるごと**取り、その注文の全 `order_items` を淹れ終えるまで次に進まない
- 同時に稼働できるドリッパーの数 `D`（定数, 例: `D = 2`）を既知とする
- 空いたドリッパーから順に次の注文を取る（Pull 型）

### 時間パラメータ（定数として設定）

| 記号      | 意味                                                        | 初期値の目安 |
| --------- | ----------------------------------------------------------- | ------------ |
| `T_setup` | 1注文あたりのセットアップ時間（湯沸かし・豆計量・器具準備） | 60 秒        |
| `T_cup`   | 1杯あたりの抽出時間                                         | 180 秒       |
| `T_serve` | `ready` から客へ渡すまでの提供時間                          | 30 秒        |

1 注文の所要時間は以下とする（杯数 = order_items の quantity の合計）。

```text
duration(order) = T_setup + T_cup × Σ quantity
```

### 最悪ケース（ペシミスティック）の扱い

- `brewing` の注文は **まだ開始直後** とみなし、残り時間 = `duration(order)` をそのまま加算する
  （`started_at` を記録していないため、最悪値で置く）
- `ready` の注文は残り時間 = `T_serve`（提供作業が残っていると仮定）
- ドリッパーは途中で中断・失敗しないものとするが、`T_setup`・`T_cup` 自体に余裕を持たせて値を設定しておく

---

## 実装フロー

### 1. レコードの取得

`status` が `pending` / `brewing` / `ready` のいずれかである `orders` と、その `order_items`（`quantity`）を一括で取得する。`orders.createdAt` の昇順で並べる。

```ts
const activeOrders = await db
  .select(...)
  .from(orders)
  .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
  .where(inArray(orders.status, ["pending", "brewing", "ready"]))
  .orderBy(orders.createdAt);
```

取得結果は order 単位に集約して以下の形にする：

```ts
type ActiveOrder = {
  id: string;
  orderNumber: number;
  status: "pending" | "brewing" | "ready";
  createdAt: string;
  totalCups: number; // Σ order_items.quantity
  items: { menuItemId: string; name: string; quantity: number }[];
};
```

### 2. 各注文の所要時間を算出

```ts
function duration(order: ActiveOrder): number {
  if (order.status === "ready") return T_serve;
  return T_setup + T_cup * order.totalCups;
}
```

### 3. ドリッパーの空き時刻をシミュレート

`D` 台のドリッパーを「次に空く時刻（秒）」を持つ min-heap（長さ固定の配列で十分）として扱う。初期値は全て 0（= 今すぐ空いている）。

```ts
// すべて「今からの相対秒」で計算する
const drippers: number[] = new Array(D).fill(0);
```

#### 3-1. brewing 注文を先に積む

`brewing` の注文はすでにどれかのドリッパーで進行中なので、**最も早く空く枠に**占有を積む。`drippers` を昇順ソートし、先頭に `duration(order)` を加算する。これを `brewing` の件数分繰り返す。

実装の先頭で `brewing` の件数と `D` を比較し、超過していれば `console.warn` を出す。`D` は `OrderDurableObject` 側で強制される不変条件ではなく**見積もり用のパラメータ**なので、超過は「データ不整合」ではなく以下のいずれかを意味する：

- `D` の設定値が実態より小さい（増やす必要がある）
- スタッフが想定より多くの注文を並行して `brewing` にしてしまっている（運用ミスの可能性）

検知後はそのまま計算を続行する（`drippers[0] += duration(o)` で「次に空く枠に追加で積む」挙動になり、推定値は過剰に悲観的になるが、致命的ではない）。監視アラートまでは本プロジェクトの規模では不要。

```ts
const finishAt = new Map<string, number>(); // orderId -> 完了予定（相対秒）
const brewingOrders = activeOrders.filter((x) => x.status === "brewing");

if (brewingOrders.length > D) {
  console.warn(
    `[wait-time] brewing count (${brewingOrders.length}) exceeds configured drippers (${D}). ` +
      `Either D is misconfigured or staff started too many orders in parallel.`,
  );
}

for (const o of brewingOrders) {
  drippers.sort((a, b) => a - b);
  drippers[0] += duration(o);
  finishAt.set(o.id, drippers[0] + T_serve); // 提供時間も足して客到着ベース
}
```

#### 3-2. pending 注文を FIFO で積む

`pending` を `createdAt` 昇順で 1 件ずつ、最も早く空く枠に割り当てる。その注文の**完了予定時刻（相対秒）**を記録する。

```ts
for (const o of activeOrders
  .filter((x) => x.status === "pending")
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
  drippers.sort((a, b) => a - b);
  drippers[0] += duration(o);
  finishAt.set(o.id, drippers[0] + T_serve);
}
```

#### 3-3. ready 注文は即時提供扱い

```ts
for (const o of activeOrders.filter((x) => x.status === "ready")) {
  finishAt.set(o.id, T_serve); // 今から T_serve 秒後
}
```

### 4. 待ち時間（分）に換算して返す

```ts
const waitMinutes = new Map<string, number>();
for (const [orderId, sec] of finishAt) {
  waitMinutes.set(orderId, Math.ceil(sec / 60)); // 切り上げで最悪値寄り
}
```

---

## 出力

注文ごと（または order_item ごと）に以下を返す：

```ts
type WaitTimeResult = {
  orderId: string;
  orderNumber: number;
  estimatedMinutes: number; // 今から何分後に届くか（最悪値）
};
```

客向け画面では自分の注文番号のみを、スタッフ画面では全件を表示する想定。

---

## 計算量

- 対象注文数を `N`、ドリッパー数を `D` とすると `O(N × D log D)`（ソートを使った素朴実装）
- `N ≲ 100`、`D ≲ 4` 程度なので十分に軽量。1 リクエストごとに再計算してよい

---

## 再計算トリガー

以下のイベント発生時に再計算を行う：

- 新規注文の `pending` 追加
- 注文キャンセル
- `pending → brewing` の遷移
- `brewing → ready` の遷移
- `ready → completed` の遷移

`OrderDurableObject` がステータス変化をブロードキャストするタイミング（`docs/design/realtime-sync.md` 参照）で、各クライアントが自分で再計算するか、DO 側で計算して `ORDER_UPDATED` メッセージに含めて配信する。**計算量が軽いので DO 側で 1 回計算して全員に配るのが無駄がなく推奨**。
