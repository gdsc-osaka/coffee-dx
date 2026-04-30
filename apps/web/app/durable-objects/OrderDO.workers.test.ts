/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference path="../../worker-configuration.d.ts" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, afterEach } from "vitest";
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
    // クリーンアップ
    await db.delete(brewUnits);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(menuItems);

    // 一意のイベントID相当のDO IDを生成
    const id = testEnv.ORDER_DO.idFromName(eventId);
    stub = testEnv.ORDER_DO.get(id);
  });

  afterEach(() => {
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }
  });

  const getNextMessage = (ws: any): Promise<any> => {
    return new Promise((resolve) => {
      ws.addEventListener(
        "message",
        (event: MessageEvent) => {
          resolve(JSON.parse(event.data as string));
        },
        { once: true },
      );
    });
  };

  const connectWebSocket = async () => {
    const response = await stub.fetch(
      new Request(`http://localhost/ws?eventId=${eventId}`, { headers: { Upgrade: "websocket" } }),
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();

    wsClient = response.webSocket!;
    // 呼び出し元でリスナーをアタッチしてから accept() する
    return wsClient;
  };

  it("初回接続時にSNAPSHOTを受信する（既存データあり）", async () => {
    await db.insert(menuItems).values([{ id: "m1", name: "coffee", price: 100, isAvailable: 1 }]);
    await db.insert(orders).values([
      {
        id: "o1",
        orderNumber: 101,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    await db.insert(orderItems).values([
      {
        id: "i1",
        orderId: "o1",
        menuItemId: "m1",
        quantity: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    await db.insert(brewUnits).values([
      {
        id: "u1",
        batchId: "b1",
        menuItemId: "m1",
        status: "brewing",
        businessDate: eventId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const ws = await connectWebSocket();
    const msgPromise = getNextMessage(ws!);
    ws!.accept();
    const msg = await msgPromise;

    expect(msg.type).toBe("SNAPSHOT");
    expect(msg.orders).toHaveLength(1);
    expect(msg.orders[0].id).toBe("o1");
    expect(msg.orders[0].items).toHaveLength(1);
    expect(msg.brewUnits).toHaveLength(1);
    expect(msg.brewUnits[0].id).toBe("u1");
  });

  it("BrewUnitを生成すると BREW_UNITS_CREATED がブロードキャストされる", async () => {
    await db.insert(menuItems).values([{ id: "m1", name: "coffee", price: 100, isAvailable: 1 }]);

    const ws = await connectWebSocket();
    let msgPromise = getNextMessage(ws!);
    ws!.accept();
    let msg = await msgPromise; // snapshot (empty)
    expect(msg.type).toBe("SNAPSHOT");

    let createdPromise = getNextMessage(ws);
    const res = await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuItemId: "m1", count: 2, businessDate: eventId }),
      }),
    );
    expect(res.status).toBe(204);

    msg = await createdPromise;
    expect(msg.type).toBe("BREW_UNITS_CREATED");
    expect(msg.brewUnits).toHaveLength(2);
    expect(msg.brewUnits[0].status).toBe("brewing");

    // DB確認
    const units = await db.select().from(brewUnits);
    expect(units).toHaveLength(2);
  });

  it("BrewUnitを完了すると、待機中の注文に紐付けられ、ORDER_UPDATED がブロードキャストされる", async () => {
    await db.insert(menuItems).values([{ id: "m1", name: "coffee", price: 100, isAvailable: 1 }]);
    await db.insert(orders).values([
      {
        id: "o1",
        orderNumber: 101,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    await db.insert(orderItems).values([
      {
        id: "i1",
        orderId: "o1",
        menuItemId: "m1",
        quantity: 1, // 1杯だけ必要
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const ws = await connectWebSocket();
    let msgPromise = getNextMessage(ws!);
    ws!.accept();
    await msgPromise;

    // バッチ生成 (2杯)
    await stub.fetch(
      new Request("http://localhost/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuItemId: "m1", count: 2, businessDate: eventId }),
      }),
    );

    const units = await db.select().from(brewUnits);
    const batchId = units[0].batchId;

    // バッチ完了
    const res = await stub.fetch(
      new Request(`http://localhost/do/brew-units/batch/${batchId}/complete`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);

    // DB確認
    const completedUnits = await db.select().from(brewUnits);
    expect(completedUnits).toHaveLength(2);
    expect(completedUnits[0].status).toBe("ready");
    expect(completedUnits[1].status).toBe("ready");

    // 1杯は o1 に紐づき、もう1杯は NULL のまま
    const linked = completedUnits.filter((u) => u.orderItemId === "i1");
    const unlinked = completedUnits.filter((u) => u.orderItemId === null);
    expect(linked).toHaveLength(1);
    expect(unlinked).toHaveLength(1);

    // オーダーも ready になっているはず
    const updatedOrder = await db.select().from(orders).where(eq(orders.id, "o1"));
    expect(updatedOrder[0].status).toBe("ready");
  });
});
