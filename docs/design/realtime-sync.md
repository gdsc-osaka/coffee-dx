# リアルタイムデータ連携設計

## 概要

注文状況をスタッフ間でリアルタイムに共有する仕組みの設計。客が注文すると即座にドリップ係・会計係の画面に反映される。

**関係者と役割:**

| 役割 | 操作 | 画面 |
|------|------|------|
| 客 | 注文を投稿する・キャンセルする | 静的フォーム（WebSocket不要） |
| ドリップ係 | 作成開始・完成を記録する | `_drip/home` |
| 会計係 | 提供済みを記録する | `_cashier/home` |

---

## 状態遷移

```
                     ┌──────────────────────────────┐
                     │ cancelled（客がキャンセル）    │
                     └──────────────────────────────┘
                       ↑ （pending または brewing から）
pending ──→ brewing ──→ ready ──→ completed
```

| ステータス | 意味 | 遷移トリガー |
|-----------|------|-------------|
| `pending` | 注文受付済み・作成待ち | 客が注文を投稿（自動） |
| `brewing` | 作成中 | ドリップ係が作成開始ボタンを押す |
| `ready` | 完成・提供待ち | ドリップ係が完成ボタンを押す |
| `completed` | 提供済み | 会計係が提供済みボタンを押す |
| `cancelled` | キャンセル済み | 客がキャンセルボタンを押す |

---

## アーキテクチャ

### コンポーネント構成

```
客ブラウザ         スタッフブラウザ（ドリップ係・会計係）
    │                         │
    │ HTTP POST                │ WebSocket
    ▼                         ▼
Cloudflare Worker  ──────→  Durable Object (OrderDO)
                               │        │
                          D1（同期書き込み）  メモリ更新
                               │
                          ブロードキャスト
```

### Durable Object の責務

- イベントごとに **1インスタンス**（例: `OrderDO:event-{eventId}`）
- **メモリ上で注文一覧を保持**（source of truth）
- 接続中 WebSocket クライアントを管理
- 状態変化時に全接続クライアントへブロードキャスト
- **D1 への同期書き込み**（冪等チェック・楽観ロック・Exponential retry）

### D1 の責務

- 注文の**永続化**（障害・再起動後の復元用）
- DO が再起動した際の初期データロード元

---

## データ登録フロー

### 客が注文を投稿する

注文の初回登録のみ Worker が D1 に同期 INSERT する。`order_number` の採番（`order_number_counters` テーブル）が D1 側にあるため、採番と INSERT を同一トランザクションで行う必要があるためである。

```
客ブラウザ
  │
  │ POST /orders（Remix action）
  ▼
Worker
  ├─ D1 に orders / order_items を INSERT（order_number を採番、同期）
  └─ DO.newOrder(order) を呼び出し
       ├─ メモリ上の注文一覧に追加
       └─ 全スタッフ WS クライアントにブロードキャスト
            { type: "ORDER_CREATED", order: {...} }
```

**注文番号の採番:** `order_number_counters` テーブルで `business_date` ごとに採番。イベント終了後にカウンタをリセットすることで次回イベントは1番から再開する。

### 客が注文をキャンセルする

```
客ブラウザ
  │
  │ POST /orders/:id/cancel（Remix action）
  ▼
Worker
  └─ DO.cancelOrder(orderId) を呼び出し
       ├─ 冪等チェック：既に cancelled なら即 200 を返す
       ├─ D1 の orders.status を同期で更新（楽観ロック・リトライあり）
       ├─ メモリ上の注文を cancelled に更新
       └─ 全スタッフ WS クライアントにブロードキャスト
            { type: "ORDER_UPDATED", orderId: "...", status: "cancelled" }
```

### ドリップ係が作成開始を記録する

```
ドリップ係ブラウザ
  │
  │ POST /drip/orders/:id/start（Remix action）
  ▼
Worker
  └─ DO.startBrewing(orderId) を呼び出し
       ├─ 冪等チェック：既に brewing なら即 200 を返す
       ├─ D1 の orders.status を同期で更新（楽観ロック・リトライあり）
       ├─ メモリ上の注文を brewing に更新
       └─ 全スタッフ WS クライアントにブロードキャスト
            { type: "ORDER_UPDATED", orderId: "...", status: "brewing" }
```

### ドリップ係が完成を記録する

```
ドリップ係ブラウザ
  │
  │ POST /drip/orders/:id/complete（Remix action）
  ▼
Worker
  └─ DO.completeBrewing(orderId) を呼び出し
       ├─ 冪等チェック：既に ready なら即 200 を返す
       ├─ D1 の orders.status を同期で更新（楽観ロック・リトライあり）
       ├─ メモリ上の注文を ready に更新
       └─ 全スタッフ WS クライアントにブロードキャスト
            { type: "ORDER_UPDATED", orderId: "...", status: "ready" }
```

### 会計係が提供済みを記録する

```
会計係ブラウザ
  │
  │ POST /cashier/orders/:id/complete（Remix action）
  ▼
Worker
  └─ DO.closeOrder(orderId) を呼び出し
       ├─ 冪等チェック：既に completed なら即 200 を返す
       ├─ D1 の orders.status を同期で更新（楽観ロック・リトライあり）
       ├─ メモリ上の注文を completed に更新
       └─ 全スタッフ WS クライアントにブロードキャスト
            { type: "ORDER_UPDATED", orderId: "...", status: "completed" }
```

---

## D1 書き込みの同期化

ステータス更新は DO が D1 に同期で書き込んでからメモリを更新・ブロードキャストする。このスケール（クライアント数 ~4、高々 10 TPS）では D1 側エラーのリスクが小さいため、同期書き込み＋リトライで十分と判断した。

```ts
// DO メソッド内のイメージ
class OrderDurableObject {
  async startBrewing(orderId: string) {
    // 1. 冪等チェック：既に目標ステータスなら即成功を返す
    if (this.orders.get(orderId)?.status === "brewing") {
      return new Response("Already brewing", { status: 200 });
    }
    // 2. D1 書き込み（楽観ロック・Exponential retry）
    await this.writeWithRetry(() =>
      this.db.update(orders)
        .set({ status: "brewing" })
        .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    );
    // 3. メモリ更新
    this.orders.get(orderId).status = "brewing";
    // 4. ブロードキャスト
    this.broadcast({ type: "ORDER_UPDATED", orderId, status: "brewing" });
    return new Response("Updated to brewing", { status: 200 });
  }

  // Exponential backoff リトライ（最大3回）
  async writeWithRetry(fn: () => Promise<unknown>, attempts = 3): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await fn();
        return;
      } catch (e) {
        if (i === attempts - 1) {
          console.error("[OrderDO] D1 write failed after retries", e);
          throw e; // 全リトライ失敗時は 500 を返す
        }
        await new Promise((r) => setTimeout(r, 200 * 2 ** i)); // 200ms, 400ms
      }
    }
  }
}
```

**冪等性と楽観ロック:**

- **冪等チェック（DO メモリ）**: D1 成功後にネットワークエラーで応答が遮断された場合、クライアントがリトライしても DO メモリの状態を見て即 200 を返す
- **楽観ロック（SQL WHERE 句）**: `WHERE status = '現在のステータス'` を付けることで、stale state からの二重更新を防ぐ。0 rows affected（既に別の状態）の場合は DO メモリのチェックで処理済みと判断する
- UPDATE クエリは同じステータスを再度書くだけなので、リトライは冪等（idempotent）

---

## WebSocket Subscription

### 接続確立

スタッフ画面（ドリップ係・会計係）はページロード時に WebSocket 接続を確立する。

```
GET /ws?eventId=xxx（Upgrade: websocket）
  ↓
Worker が DO にルーティング
  ↓
DO が WebSocket を受け入れ、接続を管理
```

### メッセージフォーマット

**サーバー → クライアント（ブロードキャスト）:**

```ts
type ServerMessage =
  | { type: "SNAPSHOT"; orders: Order[] }
  | { type: "ORDER_CREATED"; order: Order }
  | { type: "ORDER_UPDATED"; orderId: string; status: "brewing" | "ready" | "completed" | "cancelled" }
```

### 接続時の初期データ取得

接続確立後、サーバーは即座に `SNAPSHOT` メッセージを送信する。クライアントは `SNAPSHOT` を受信して画面を初期化し、以降は差分メッセージで更新する。

```
クライアント接続
  └─ DO から SNAPSHOT を送信
       { type: "SNAPSHOT", orders: [completed / cancelled 以外の全注文] }
```

---

## 切断時のハンドリング

### クライアント側の再接続ロジック

```ts
function connectWebSocket(eventId: string) {
  let retryCount = 0;

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws?eventId=${eventId}`);

    ws.onclose = () => {
      // Exponential backoff で再接続（最大 30 秒）
      const delay = Math.min(1000 * 2 ** retryCount, 30_000);
      retryCount++;
      setTimeout(connect, delay);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "SNAPSHOT") {
        // 再接続時も SNAPSHOT で全件上書き（差分管理は不要）
        replaceAllOrders(msg.orders);
      } else {
        applyDiff(msg);
      }
    };

    ws.onopen = () => {
      retryCount = 0; // 接続成功でリセット
    };
  }

  connect();
}
```

**再接続時の状態復元:** 再接続後は DO から `SNAPSHOT` を受け取り全件上書きする。切断中の差分を追跡する必要はない。

### サーバー側の切断検知

DO は WebSocket の `close` / `error` イベントで接続リストから削除する。DO インスタンス自体はイベント継続中は維持されるため、切断したクライアントがいても他のクライアントへのブロードキャストは継続する。

### DO 再起動時の状態復元

Cloudflare Workers の Durable Object は非アクティブ時に終了することがある。再起動時は D1 から進行中の注文をロードしてメモリを復元する。

```ts
// DO の初期化
async initialize() {
  if (this.initialized) return;
  const orders = await db.select().from(ordersTable)
    .where(inArray(ordersTable.status, ["pending", "brewing", "ready"]));
  this.orders = orders;
  this.initialized = true;
}
```

---

## DO インスタンス管理

インスタンス ID はイベント ID をキーとする。

```ts
// Worker からのルーティング
const id = env.ORDER_DO.idFromName(`event-${eventId}`);
const stub = env.ORDER_DO.get(id);
```

イベント終了後にインスタンスを明示的に削除する運用は不要（非アクティブになれば自動終了）。ただし `order_number_counters` のリセットはイベント開始前に手動または管理画面から行う。

---

## wrangler.toml への追記

```toml
[[durable_objects.bindings]]
name = "ORDER_DO"
class_name = "OrderDurableObject"

[[migrations]]
tag = "v1"
new_classes = ["OrderDurableObject"]
```
