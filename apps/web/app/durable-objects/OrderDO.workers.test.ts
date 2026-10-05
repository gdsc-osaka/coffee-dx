/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference path="../../worker-configuration.d.ts" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { brewUnits, menuItems, orderItems, orders } from "../../db/schema";

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as unknown as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("OrderDO", () => {
  let db: ReturnType<typeof drizzle>;
  let stub: DurableObjectStub;
  let wsClient: WebSocket | null = null;
  let eventId: string;

  beforeEach(async () => {
    eventId = `event-${crypto.randomUUID()}`;
    db = drizzle(testEnv.DB);
    await db.delete(brewUnits);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(menuItems);

    const id = testEnv.ORDER_DO.idFromName(eventId);
    stub = testEnv.ORDER_DO.get(id);
  });

  afterEach(() => {
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }
  });

  /**
   * accept() 前から listener を張ってメッセージをバッファに蓄積するキュー。
   * 旧来の `{ once: true }` 方式は、handleBatchComplete のように
   * 1 リクエストで複数 broadcast が出る経路で 2 件目以降を取りこぼすため使えない。
   * 想定外に到着しないメッセージは vitest の testTimeout で検出される。
   */
  const createMessageQueue = (ws: WebSocket) => {
    const buffer: any[] = [];
    const waiters: Array<(msg: any) => void> = [];

    ws.addEventListener("message", (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string);
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else buffer.push(msg);
    });

    const next = (): Promise<any> => {
      if (buffer.length > 0) return Promise.resolve(buffer.shift()!);
      return new Promise((resolve) => waiters.push(resolve));
    };

    const take = async (n: number): Promise<any[]> => {
      const out: any[] = [];
      for (let i = 0; i < n; i++) out.push(await next());
      return out;
    };

    return { next, take };
  };

  const connectWebSocket = async () => {
    const response = await stub.fetch(
      new Request(`http://localhost/ws?eventId=${eventId}`, {
        headers: { Upgrade: "websocket", "x-event-id": eventId },
      }),
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    wsClient = response.webSocket!;
    return wsClient;
  };

  const isoNow = () => new Date().toISOString();

  const insertMenu = (id: string, name = id) =>
    db.insert(menuItems).values([{ id, name, price: 100, isAvailable: 1 }]);

  const insertOrder = (
    id: string,
    orderNumber: number,
    status: "pending" | "brewing" | "ready" | "completed" | "cancelled",
    businessDate = eventId,
  ) => {
    const now = isoNow();
    return db
      .insert(orders)
      .values([{ id, businessDate, orderNumber, status, createdAt: now, updatedAt: now }]);
  };

  const insertOrderItem = (
    id: string,
    orderId: string,
    menuItemId: string,
    quantity: number,
    fulfillmentTypeAtOrder: "brew" | "direct" = "brew",
  ) => {
    const now = isoNow();
    return db.insert(orderItems).values([
      {
        id,
        orderId,
        menuItemId,
        unitPriceAtOrder: 100,
        fulfillmentTypeAtOrder,
        quantity,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // SNAPSHOT + businessDate フィルタ
  // ---------------------------------------------------------------------------

  it("初回接続時に SNAPSHOT を受信し、別 eventId の orders と brew_units は含まれない", async () => {
    await insertMenu("m1", "coffee");
    await insertOrder("o1", 101, "pending");
    await insertOrderItem("i1", "o1", "m1", 2);
    const otherEventId = `event-${crypto.randomUUID()}`;
    await insertOrder("o-other", 101, "pending", otherEventId);
    await insertOrderItem("i-other", "o-other", "m1", 2);

    const now = isoNow();
    await db.insert(brewUnits).values([
      // この DO に紐づく event のユニット
      {
        id: "u-mine",
        batchId: "b-mine",
        menuItemId: "m1",
        status: "brewing",
        businessDate: eventId,
        createdAt: now,
        updatedAt: now,
      },
      // 別 event のユニット (D1 は event 横断のため、フィルタが効かないと SNAPSHOT に混入する)
      {
        id: "u-other",
        batchId: "b-other",
        menuItemId: "m1",
        status: "brewing",
        businessDate: otherEventId,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    const snap = await queue.next();

    expect(snap.type).toBe("SNAPSHOT");
    expect(snap.orders).toHaveLength(1);
    expect(snap.orders[0].id).toBe("o1");
    expect(snap.orders[0].items).toHaveLength(1);
    // 別 event のユニットは弾かれる
    expect(snap.brewUnits).toHaveLength(1);
    expect(snap.brewUnits[0].id).toBe("u-mine");
  });

  // ---------------------------------------------------------------------------
  // BREW_UNITS_CREATED
  // ---------------------------------------------------------------------------

  it("BrewUnit を生成すると BREW_UNITS_CREATED がブロードキャストされる", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    const snap = await queue.next();
    expect(snap.type).toBe("SNAPSHOT");

    const res = await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 2 }),
      }),
    );
    expect(res.status).toBe(204);

    const created = await queue.next();
    expect(created.type).toBe("BREW_UNITS_CREATED");
    expect(created.brewUnits).toHaveLength(2);
    expect(created.brewUnits.every((u: any) => u.status === "brewing")).toBe(true);
    // targetDurationSec / timerStartedAt を渡さなかったのでいずれも NULL で配信される
    expect(created.brewUnits.every((u: any) => u.targetDurationSec === null)).toBe(true);
    expect(created.brewUnits.every((u: any) => u.timerStartedAt === null)).toBe(true);

    // DB 確認: business_date は body ではなく x-event-id から書き込まれる
    const units = await db.select().from(brewUnits);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.businessDate === eventId)).toBe(true);
    expect(units.every((u) => u.targetDurationSec === null)).toBe(true);
    expect(units.every((u) => u.timerStartedAt === null)).toBe(true);
  });

  it("laneIndex を指定して BrewUnit を生成すると DO 配信と DB の双方に保存される（全端末で同レーン表示用）", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    await queue.next(); // SNAPSHOT

    const res = await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 2, laneIndex: 2 }),
      }),
    );
    expect(res.status).toBe(204);

    const created = await queue.next();
    expect(created.brewUnits).toHaveLength(2);
    expect(created.brewUnits.every((u: any) => u.laneIndex === 2)).toBe(true);

    const units = await db.select().from(brewUnits);
    expect(units.every((u) => u.laneIndex === 2)).toBe(true);
  });

  it("laneIndex 未指定や不正値のときは 0 として保存される", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    await queue.next(); // SNAPSHOT

    await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 1 }),
      }),
    );
    await queue.next();

    const units = await db.select().from(brewUnits);
    expect(units[0].laneIndex).toBe(0);
  });

  it("targetDurationSec を指定して BrewUnit を生成すると targetDurationSec と timerStartedAt の両方が保存される", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    await queue.next(); // SNAPSHOT

    const res = await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 1, targetDurationSec: 210 }),
      }),
    );
    expect(res.status).toBe(204);

    const created = await queue.next();
    expect(created.type).toBe("BREW_UNITS_CREATED");
    expect(created.brewUnits).toHaveLength(1);
    expect(created.brewUnits[0].targetDurationSec).toBe(210);
    // 抽出開始時に timer も同時に開始する（後付け再設定は別エンドポイント）
    expect(created.brewUnits[0].timerStartedAt).not.toBeNull();

    const units = await db.select().from(brewUnits);
    expect(units).toHaveLength(1);
    expect(units[0].targetDurationSec).toBe(210);
    expect(units[0].timerStartedAt).not.toBeNull();
  });

  it("brew-units/batch/:id/timer エンドポイントでタイマーを後付け / 再設定できる", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    await queue.next(); // SNAPSHOT

    // タイマーなしでバッチ作成
    await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 1 }),
      }),
    );
    const created = await queue.next();
    expect(created.brewUnits[0].timerStartedAt).toBeNull();
    const batchId = created.brewUnits[0].batchId;

    // /timer エンドポイントで後付け設定
    const setRes = await stub.fetch(
      new Request(`http://localhost/do/brew-units/batch/${batchId}/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ targetDurationSec: 120 }),
      }),
    );
    expect(setRes.status).toBe(204);

    const updated = await queue.next();
    expect(updated.type).toBe("BREW_UNIT_UPDATED");
    expect(updated.brewUnit.targetDurationSec).toBe(120);
    expect(updated.brewUnit.timerStartedAt).not.toBeNull();

    const units1 = await db.select().from(brewUnits);
    expect(units1[0].targetDurationSec).toBe(120);
    const firstStartedAt = units1[0].timerStartedAt;
    expect(firstStartedAt).not.toBeNull();

    // 再設定でタイマーがリスタート (timerStartedAt が更新される)
    await new Promise((r) => setTimeout(r, 10));
    const resetRes = await stub.fetch(
      new Request(`http://localhost/do/brew-units/batch/${batchId}/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ targetDurationSec: 60 }),
      }),
    );
    expect(resetRes.status).toBe(204);
    await queue.next(); // BREW_UNIT_UPDATED

    const units2 = await db.select().from(brewUnits);
    expect(units2[0].targetDurationSec).toBe(60);
    expect(units2[0].timerStartedAt).not.toBe(firstStartedAt);

    // targetDurationSec=null でタイマー解除
    const clearRes = await stub.fetch(
      new Request(`http://localhost/do/brew-units/batch/${batchId}/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ targetDurationSec: null }),
      }),
    );
    expect(clearRes.status).toBe(204);
    const cleared = await queue.next();
    expect(cleared.brewUnit.targetDurationSec).toBeNull();
    expect(cleared.brewUnit.timerStartedAt).toBeNull();
  });

  it("targetDurationSec が 0 以下や無効値のときは NULL として保存される", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    await queue.next(); // SNAPSHOT

    await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 1, targetDurationSec: 0 }),
      }),
    );
    await queue.next(); // BREW_UNITS_CREATED

    const units = await db.select().from(brewUnits);
    expect(units[0].targetDurationSec).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // handleBatchComplete: BREW_UNIT_UPDATED + ORDER_UPDATED
  // ---------------------------------------------------------------------------

  it("brewとdirectの混在注文はbrewだけを紐付け、バッチ完了でreadyへ遷移する", async () => {
    // CI の 5 秒 timeout より先に失敗させ、待機中の処理をエラー本文に残す。
    const startedAt = Date.now();
    const completedSteps: string[] = [];
    const trace = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
      const stepStartedAt = Date.now();
      console.info(`[OrderDO mixed] START ${label} (+${stepStartedAt - startedAt}ms)`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              reject(
                new Error(
                  `[OrderDO mixed] stopped at "${label}" after ${Date.now() - startedAt}ms; completed: ${completedSteps.join(" -> ") || "none"}`,
                ),
              );
            },
            Math.max(1, 4500 - (stepStartedAt - startedAt)),
          );
        });
        const result = await Promise.race([Promise.resolve().then(run), timeout]);
        completedSteps.push(`${label} (${Date.now() - stepStartedAt}ms)`);
        console.info(`[OrderDO mixed] DONE ${label} (${Date.now() - stepStartedAt}ms)`);
        return result;
      } catch (error) {
        console.error(`[OrderDO mixed] ERROR ${label} (${Date.now() - stepStartedAt}ms)`, error);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };

    await trace("insert brew menu", async () => insertMenu("m1", "coffee"));
    await trace("insert direct menu", async () =>
      db.insert(menuItems).values({
        id: "retail-1",
        name: "biscuit",
        price: 200,
        fulfillmentType: "direct",
        isAvailable: 1,
      }),
    );
    await trace("insert order", async () => insertOrder("o1", 101, "pending"));
    await trace("insert brew item", async () => insertOrderItem("i1", "o1", "m1", 1));
    await trace("insert direct item", async () =>
      insertOrderItem("i-direct", "o1", "retail-1", 1, "direct"),
    );

    const ws = await trace("connect WebSocket", connectWebSocket);
    const queue = createMessageQueue(ws);
    ws.accept();
    const snapshot = await trace("receive SNAPSHOT", queue.next);
    expect(snapshot.type).toBe("SNAPSHOT");

    // バッチ生成 (2 杯)
    const createResponse = await trace("create brew batch", () =>
      stub.fetch(
        new Request("http://localhost/do/brew-units", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-event-id": eventId },
          body: JSON.stringify({ menuItemId: "m1", count: 2 }),
        }),
      ),
    );
    expect(createResponse.status).toBe(204);
    const created = await trace("receive BREW_UNITS_CREATED", queue.next);
    expect(created.type).toBe("BREW_UNITS_CREATED");
    const batchId = created.brewUnits[0].batchId;

    // バッチ完了
    const res = await trace("complete brew batch", () =>
      stub.fetch(
        new Request(`http://localhost/do/brew-units/batch/${batchId}/complete`, {
          method: "POST",
          headers: { "x-event-id": eventId },
        }),
      ),
    );
    expect(res.status).toBe(200);

    // 期待されるブロードキャスト:
    //   - BREW_UNIT_UPDATED × 2 (バッチ内 2 ユニット brewing→ready, 1 件は紐付き、1 件は余剰)
    //   - ORDER_UPDATED × 1 (pending→ready)
    const messages: any[] = [];
    for (let index = 0; index < 3; index++) {
      const message = await trace(`receive batch update ${index + 1}/3`, queue.next);
      console.info(`[OrderDO mixed] MESSAGE ${index + 1}/3 ${message.type}`);
      messages.push(message);
    }
    const unitUpdates = messages.filter((m) => m.type === "BREW_UNIT_UPDATED");
    const orderUpdates = messages.filter((m) => m.type === "ORDER_UPDATED");

    expect(unitUpdates).toHaveLength(2);
    expect(unitUpdates.every((m) => m.brewUnit.status === "ready")).toBe(true);
    expect(unitUpdates.filter((m) => m.brewUnit.orderItemId === "i1")).toHaveLength(1);
    expect(unitUpdates.filter((m) => m.brewUnit.orderItemId === null)).toHaveLength(1);

    expect(orderUpdates).toHaveLength(1);
    expect(orderUpdates[0].orderId).toBe("o1");
    expect(orderUpdates[0].status).toBe("ready");

    // DB 確認
    const completedUnits = await trace("read completed units", async () =>
      db.select().from(brewUnits),
    );
    expect(completedUnits).toHaveLength(2);
    expect(completedUnits.every((u) => u.status === "ready")).toBe(true);
    expect(completedUnits.filter((u) => u.orderItemId === "i1")).toHaveLength(1);
    expect(completedUnits.filter((u) => u.orderItemId === "i-direct")).toHaveLength(0);
    expect(completedUnits.filter((u) => u.orderItemId === null)).toHaveLength(1);

    const updatedOrder = await trace("read ready order", async () =>
      db.select().from(orders).where(eq(orders.id, "o1")),
    );
    expect(updatedOrder[0].status).toBe("ready");

    // 応答喪失などで同じ完了操作が再送されても、404にせず同じ結果を返す。
    const retry = await trace("retry batch completion", () =>
      stub.fetch(
        new Request(`http://localhost/do/brew-units/batch/${batchId}/complete`, {
          method: "POST",
          headers: { "x-event-id": eventId },
        }),
      ),
    );
    expect(retry.status).toBe(200);

    const retriedUnits = await trace("read units after retry", async () =>
      db.select().from(brewUnits),
    );
    expect(retriedUnits).toHaveLength(2);
    expect(retriedUnits.filter((u) => u.orderItemId === "i1")).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // newOrder + autoAssignReadyUnits: ORDER_CREATED + BREW_UNIT_UPDATED + ORDER_UPDATED
  // ---------------------------------------------------------------------------

  it("新規注文が既存の ready 未紐付けユニットを自動で割り当て、BREW_UNIT_UPDATED と ORDER_UPDATED がブロードキャストされる", async () => {
    await insertMenu("m1", "coffee");

    // 既存の ready 未紐付け unit
    const now = isoNow();
    await db.insert(brewUnits).values([
      {
        id: "u-ready",
        batchId: "b-old",
        menuItemId: "m1",
        status: "ready",
        orderItemId: null,
        businessDate: eventId,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // worker 側で /do/new-order の前に order/orderItems を D1 に書く流れを模す
    await insertOrder("o1", 101, "pending");
    await insertOrderItem("i1", "o1", "m1", 1);

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    const snap = await queue.next();
    expect(snap.brewUnits).toHaveLength(1);
    expect(snap.orders).toHaveLength(1);

    const orderPayload = {
      id: "o1",
      orderNumber: 101,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: "i1",
          orderId: "o1",
          menuItemId: "m1",
          quantity: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    const res = await stub.fetch(
      new Request("http://localhost/do/new-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify(orderPayload),
      }),
    );
    expect(res.status).toBe(204);

    // ORDER_CREATED → BREW_UNIT_UPDATED → ORDER_UPDATED の順
    const [m1, m2, m3] = await queue.take(3);

    expect(m1.type).toBe("ORDER_CREATED");
    expect(m1.order.id).toBe("o1");

    expect(m2.type).toBe("BREW_UNIT_UPDATED");
    expect(m2.brewUnit.id).toBe("u-ready");
    expect(m2.brewUnit.orderItemId).toBe("i1");
    expect(m2.brewUnit.status).toBe("ready");

    expect(m3.type).toBe("ORDER_UPDATED");
    expect(m3.orderId).toBe("o1");
    expect(m3.status).toBe("ready");

    // DB 確認
    const dbUnits = await db.select().from(brewUnits);
    expect(dbUnits[0].orderItemId).toBe("i1");

    const dbOrder = await db.select().from(orders).where(eq(orders.id, "o1"));
    expect(dbOrder[0].status).toBe("ready");
  });

  // ---------------------------------------------------------------------------
  // handleBatchCancel: BREW_UNIT_DELETED
  // ---------------------------------------------------------------------------

  it("バッチ取り消しで brewing ユニットが削除され、BREW_UNIT_DELETED がブロードキャストされる", async () => {
    await insertMenu("m1", "coffee");

    const ws = await connectWebSocket();
    const queue = createMessageQueue(ws);
    ws.accept();
    await queue.next(); // SNAPSHOT

    // バッチ生成 (2 杯)
    await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 2 }),
      }),
    );
    const created = await queue.next();
    expect(created.type).toBe("BREW_UNITS_CREATED");
    const batchId = created.brewUnits[0].batchId;
    const createdIds = new Set<string>(created.brewUnits.map((u: any) => u.id));

    // 取り消し
    const res = await stub.fetch(
      new Request(`http://localhost/do/brew-units/batch/${batchId}/cancel`, {
        method: "POST",
        headers: { "x-event-id": eventId },
      }),
    );
    expect(res.status).toBe(200);

    const deleted = await queue.take(2);
    expect(deleted.every((m) => m.type === "BREW_UNIT_DELETED")).toBe(true);
    expect(new Set<string>(deleted.map((m) => m.brewUnitId))).toEqual(createdIds);

    // DB 確認
    const remaining = await db.select().from(brewUnits);
    expect(remaining).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // POST /do/orders/:id/cancel
  // ---------------------------------------------------------------------------

  describe("POST /do/orders/:id/cancel", () => {
    const cancelOrder = (orderId: string) =>
      stub.fetch(
        new Request(`http://localhost/do/orders/${orderId}/cancel`, {
          method: "POST",
          headers: { "x-event-id": eventId },
        }),
      );

    it("pending な注文をキャンセルすると 200 + ORDER_UPDATED(cancelled) + DB が cancelled", async () => {
      await insertMenu("m1");
      await insertOrder("o1", 101, "pending");
      await insertOrderItem("i1", "o1", "m1", 1);

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      const res = await cancelOrder("o1");
      expect(res.status).toBe(200);

      const m = await queue.next();
      expect(m.type).toBe("ORDER_UPDATED");
      expect(m.orderId).toBe("o1");
      expect(m.status).toBe("cancelled");

      const dbOrder = await db.select().from(orders).where(eq(orders.id, "o1"));
      expect(dbOrder[0].status).toBe("cancelled");
    });

    it("brewing な注文をキャンセルできる", async () => {
      await insertMenu("m1");
      await insertOrder("o1", 101, "brewing");
      await insertOrderItem("i1", "o1", "m1", 1);

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      const res = await cancelOrder("o1");
      expect(res.status).toBe(200);

      const m = await queue.next();
      expect(m.type).toBe("ORDER_UPDATED");
      expect(m.status).toBe("cancelled");
    });

    it("ready な注文をキャンセルし、紐付き BrewUnit を画面から除く", async () => {
      await insertMenu("m1");
      await insertOrder("o1", 101, "ready");
      await insertOrderItem("i1", "o1", "m1", 1);

      const now = isoNow();
      await db.insert(brewUnits).values([
        {
          id: "u1",
          batchId: "b1",
          menuItemId: "m1",
          status: "ready",
          orderItemId: "i1",
          businessDate: eventId,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      const res = await cancelOrder("o1");
      expect(res.status).toBe(200);

      const dbOrder = await db.select().from(orders).where(eq(orders.id, "o1"));
      expect(dbOrder[0].status).toBe("cancelled");

      const dbUnit = await db.select().from(brewUnits).where(eq(brewUnits.id, "u1"));
      expect(dbUnit[0].status).toBe("ready");
      expect(dbUnit[0].orderItemId).toBe("i1");

      expect(await queue.take(2)).toEqual([
        expect.objectContaining({ type: "ORDER_UPDATED", orderId: "o1", status: "cancelled" }),
        expect.objectContaining({ type: "BREW_UNIT_DELETED", brewUnitId: "u1" }),
      ]);
    });

    it("既に cancelled な注文を再度キャンセルすると 404 (DO メモリから削除済み)", async () => {
      await insertMenu("m1");
      await insertOrder("o1", 101, "pending");
      await insertOrderItem("i1", "o1", "m1", 1);

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      const first = await cancelOrder("o1");
      expect(first.status).toBe(200);
      await queue.next(); // ORDER_UPDATED(cancelled)

      const second = await cancelOrder("o1");
      expect(second.status).toBe(404);
    });

    it("提供済みの completed 注文はキャンセルできない", async () => {
      await insertMenu("m1");
      await insertOrder("o1", 101, "completed");
      await insertOrderItem("i1", "o1", "m1", 1);

      const ws = await connectWebSocket();
      ws.accept();

      const res = await cancelOrder("o1");
      expect(res.status).toBe(404);

      const dbOrder = await db.select().from(orders).where(eq(orders.id, "o1"));
      expect(dbOrder[0].status).toBe("completed");
    });

    it("存在しない注文のキャンセルは 404", async () => {
      const ws = await connectWebSocket();
      ws.accept();

      const res = await cancelOrder("does-not-exist");
      expect(res.status).toBe(404);
    });

    it("紐付き brew_unit がキャンセル時に削除され BREW_UNIT_DELETED がブロードキャストされる", async () => {
      await insertMenu("m1");
      await insertOrder("o1", 101, "brewing");
      await insertOrderItem("i1", "o1", "m1", 1);

      const now = isoNow();
      await db.insert(brewUnits).values([
        {
          id: "u1",
          batchId: "b1",
          menuItemId: "m1",
          status: "brewing",
          orderItemId: "i1",
          businessDate: eventId,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      const res = await cancelOrder("o1");
      expect(res.status).toBe(200);

      // ORDER_UPDATED(cancelled) と BREW_UNIT_DELETED の 2 件
      const messages = await queue.take(2);
      const orderUpdate = messages.find((m) => m.type === "ORDER_UPDATED");
      const unitDelete = messages.find((m) => m.type === "BREW_UNIT_DELETED");
      expect(orderUpdate?.status).toBe("cancelled");
      expect(unitDelete?.brewUnitId).toBe("u1");
    });
  });

  // ---------------------------------------------------------------------------
  // 次枠キュー（docs/design/drip-suggestion.md）
  // ---------------------------------------------------------------------------

  describe("次枠キュー", () => {
    const postNewOrder = (orderId: string, itemId: string, quantity: number, menuItemId = "m1") => {
      const now = isoNow();
      return stub.fetch(
        new Request("http://localhost/do/new-order", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-event-id": eventId },
          body: JSON.stringify({
            id: orderId,
            orderNumber: 101,
            status: "pending",
            createdAt: now,
            updatedAt: now,
            items: [{ id: itemId, orderId, menuItemId, quantity, createdAt: now, updatedAt: now }],
          }),
        }),
      );
    };

    it("SNAPSHOT にキューを含め、新しい注文で補充し、抽出開始で消費する", async () => {
      await insertMenu("m1", "coffee");

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      const snap = await queue.next();
      expect(snap.queue).toEqual([]);

      expect((await postNewOrder("o1", "i1", 2)).status).toBe(204);
      const [created, refilled] = await queue.take(2);
      expect(created.type).toBe("ORDER_CREATED");
      expect(refilled.type).toBe("QUEUE_UPDATED");
      expect(refilled.queue).toHaveLength(1);
      expect(refilled.queue[0]).toMatchObject({ menuItemId: "m1", count: 2 });

      await stub.fetch(
        new Request("http://localhost/do/brew-units", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-event-id": eventId },
          body: JSON.stringify({ menuItemId: "m1", count: 2 }),
        }),
      );
      const [brewCreated, consumed] = await queue.take(2);
      expect(brewCreated.type).toBe("BREW_UNITS_CREATED");
      expect(consumed.type).toBe("QUEUE_UPDATED");
      expect(consumed.queue).toEqual([]);
    });

    it("提供中のメニューが 3 種類あっても、3 種類目をキューへ補充する", async () => {
      await insertMenu("m1");
      await insertMenu("m2");
      await insertMenu("m3");

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      expect((await postNewOrder("o3", "i3", 2, "m3")).status).toBe(204);
      const [, refilled] = await queue.take(2); // ORDER_CREATED, QUEUE_UPDATED
      expect(refilled.queue).toHaveLength(1);
      expect(refilled.queue[0]).toMatchObject({ menuItemId: "m3", count: 2 });
    });

    it("注文の取消で余った対応予定を減らす", async () => {
      await insertMenu("m1", "coffee");
      await insertOrder("o1", 101, "pending");
      await insertOrderItem("i1", "o1", "m1", 3);

      const ws = await connectWebSocket();
      const queue = createMessageQueue(ws);
      ws.accept();
      await queue.next(); // SNAPSHOT

      await postNewOrder("o1", "i1", 3);
      const [, refilled] = await queue.take(2); // ORDER_CREATED, QUEUE_UPDATED
      expect(refilled.queue[0]).toMatchObject({ menuItemId: "m1", count: 3 });

      const res = await stub.fetch(
        new Request("http://localhost/do/orders/o1/cancel", {
          method: "POST",
          headers: { "x-event-id": eventId },
        }),
      );
      expect(res.status).toBe(200);
      const [orderUpdate, trimmed] = await queue.take(2);
      expect(orderUpdate.type).toBe("ORDER_UPDATED");
      expect(trimmed.type).toBe("QUEUE_UPDATED");
      expect(trimmed.queue).toEqual([]);
    });
  });
});
