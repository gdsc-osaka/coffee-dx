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
  ) => {
    const now = isoNow();
    return db
      .insert(orders)
      .values([{ id, businessDate: eventId, orderNumber, status, createdAt: now, updatedAt: now }]);
  };

  const insertOrderItem = (id: string, orderId: string, menuItemId: string, quantity: number) => {
    const now = isoNow();
    return db
      .insert(orderItems)
      .values([{ id, orderId, menuItemId, quantity, createdAt: now, updatedAt: now }]);
  };

  // ---------------------------------------------------------------------------
  // SNAPSHOT + businessDate フィルタ
  // ---------------------------------------------------------------------------

  it("初回接続時に SNAPSHOT を受信し、別 eventId の brew_units は含まれない", async () => {
    await insertMenu("m1", "coffee");
    await insertOrder("o1", 101, "pending");
    await insertOrderItem("i1", "o1", "m1", 2);

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
        businessDate: `event-${crypto.randomUUID()}`,
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
    // targetDurationSec を渡さなかったので NULL で配信される
    expect(created.brewUnits.every((u: any) => u.targetDurationSec === null)).toBe(true);

    // DB 確認: business_date は body ではなく x-event-id から書き込まれる
    const units = await db.select().from(brewUnits);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.businessDate === eventId)).toBe(true);
    expect(units.every((u) => u.targetDurationSec === null)).toBe(true);
  });

  it("targetDurationSec を指定して BrewUnit を生成すると DO 配信と DB の双方に保存される", async () => {
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

    const units = await db.select().from(brewUnits);
    expect(units).toHaveLength(1);
    expect(units[0].targetDurationSec).toBe(210);
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

  it("バッチ完了で ready 遷移と紐付けが発生し、BREW_UNIT_UPDATED と ORDER_UPDATED がブロードキャストされる", async () => {
    await insertMenu("m1", "coffee");
    await insertOrder("o1", 101, "pending");
    await insertOrderItem("i1", "o1", "m1", 1); // 1 杯だけ必要

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

    // バッチ完了
    const res = await stub.fetch(
      new Request(`http://localhost/do/brew-units/batch/${batchId}/complete`, {
        method: "POST",
        headers: { "x-event-id": eventId },
      }),
    );
    expect(res.status).toBe(200);

    // 期待されるブロードキャスト:
    //   - BREW_UNIT_UPDATED × 2 (バッチ内 2 ユニット brewing→ready, 1 件は紐付き、1 件は余剰)
    //   - ORDER_UPDATED × 1 (pending→ready)
    const messages = await queue.take(3);
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
    const completedUnits = await db.select().from(brewUnits);
    expect(completedUnits).toHaveLength(2);
    expect(completedUnits.every((u) => u.status === "ready")).toBe(true);
    expect(completedUnits.filter((u) => u.orderItemId === "i1")).toHaveLength(1);
    expect(completedUnits.filter((u) => u.orderItemId === null)).toHaveLength(1);

    const updatedOrder = await db.select().from(orders).where(eq(orders.id, "o1"));
    expect(updatedOrder[0].status).toBe("ready");
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
});
