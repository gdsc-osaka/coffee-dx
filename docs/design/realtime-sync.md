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
                          メモリ更新  D1（非同期書き込み）
                               │
                          ブロードキャスト
```

### Durable Object の責務

- イベントごとに **1インスタンス**（例: `OrderDO:event-{eventId}`）
- **メモリ上で注文一覧を保持**（source of truth）
- 接続中 WebSocket クライアントを管理
- 状態変化時に全接続クライアントへブロードキャスト
- **D1 への非同期書き込み**（Worker は委譲するだけ）

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
       ├─ 対象注文を cancelled に更新（pending / brewing のみ受け付ける）
       ├─ D1 の orders.status を非同期で更新
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
       ├─ 対象注文を brewing に更新
       ├─ D1 の orders.status を非同期で更新
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
       ├─ 対象注文を ready に更新
       ├─ D1 の orders.status を非同期で更新
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
       ├─ 対象注文を completed に更新
       ├─ D1 の orders.status を非同期で更新
       └─ 全スタッフ WS クライアントにブロードキャスト
            { type: "ORDER_UPDATED", orderId: "...", status: "completed" }
```

---

## D1 書き込みの非同期化

ステータス更新は DO がメモリとブロードキャストを先に処理し、D1 への書き込みを非同期で行う。Worker はDOに委譲するだけで D1 を直接書かない。

```ts
// DO メソッド内のイメージ
class OrderDurableObject {
  async startBrewing(orderId: string) {
    // 1. メモリ更新（即時）
    this.orders.get(orderId).status = "brewing";
    // 2. ブロードキャスト（即時）
    this.broadcast({ type: "ORDER_UPDATED", orderId, status: "brewing" });
    // 3. D1 書き込み（非同期・リトライあり）
    this.ctx.waitUntil(
      this.writeWithRetry(() =>
        this.db.update(orders).set({ status: "brewing" }).where(eq(orders.id, orderId))
      )
    );
  }
}
```

**トレードオフ:**

| | DO先・D1後（採用） | DO・D1同期 |
|--|---|---|
| レスポンス速度 | 速い | 遅い |
| リードパス | DO メモリから返すため D1 不要 | D1 クエリが発生 |
| 不整合リスク | D1 書き込み失敗時に乖離（リトライで軽減） | なし |

**D1 書き込み失敗時の対処:**

`ctx.waitUntil` は DO の生存時間を延ばすが、書き込み成功を保証するものではない。また D1 の書き込みクエリは自動リトライされない。そのため DO 内でアプリケーション層の明示的なリトライを実装する。

```ts
// Exponential backoff リトライ（最大3回）＋ 失敗記録
async writeWithRetry(
  fn: () => Promise<unknown>,
  failureKey: string, // DO Storage に記録するキー（例: "fail:order-uuid"）
  attempts = 3
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      // 成功時：以前の失敗記録があれば削除
      await this.ctx.storage.delete(failureKey);
      return;
    } catch (e) {
      if (i === attempts - 1) {
        // 全リトライ失敗 → DO Storage に記録してリカバリ待ち
        console.error("[OrderDO] D1 write failed after retries", e);
        await this.ctx.storage.put(failureKey, {
          failedAt: new Date().toISOString(),
          error: String(e),
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 200 * 2 ** i)); // 200ms, 400ms
    }
  }
}
```

- UPDATE クエリは同じステータスを再度書くだけなので、リトライは冪等（idempotent）
- 全リトライ失敗時は DO Storage（永続 KV）に失敗レコードを記録する。DO のメモリは正常なのでスタッフ画面への影響はない

**手動リカバリ手順:**

全リトライ失敗後は DO Storage の失敗レコードをもとに手動でリカバリする。

1. 管理者が `GET /admin/recovery` にアクセスし、DO Storage の失敗レコード一覧を確認する
2. DO のメモリ（source of truth）と D1 の乖離を特定する
3. `POST /admin/recovery/apply` で DO のメモリ状態を D1 に同期する（DO から全注文を読み取り D1 を上書き）
4. 適用後、DO Storage の失敗レコードを削除する

> 管理画面（`/admin`）はイベント当日の運用補助を目的とし、スタッフ認証が必要。

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
