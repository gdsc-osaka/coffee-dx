/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference path="../../worker-configuration.d.ts" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, afterEach } from "vitest";
import { menuItems, orderItems, orders } from "../../db/schema";

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as unknown as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("OrderDO", () => {
  let db: ReturnType<typeof drizzle>;
  let stub: DurableObjectStub;
  let wsClient: WebSocket | null = null;

  beforeEach(async () => {
    db = drizzle(testEnv.DB);
    // クリーンアップ
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(menuItems);

    // 一意のイベントID相当のDO IDを生成
    const id = testEnv.ORDER_DO.newUniqueId();
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
      new Request("http://localhost/ws", { headers: { Upgrade: "websocket" } }),
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();

    wsClient = response.webSocket!;
    // 呼び出し元でリスナーをアタッチしてから accept() する
    return wsClient;
  };

  it("初回接続時にSNAPSHOTを受信する（既存データあり）", async () => {
    // 事前に DB に pending イベントを1つ入れておく
    await db.insert(menuItems).values([{ id: "m1", name: "coffee", price: 100, isAvailable: 1 }]);
    await db.insert(orders).values([
      {
        id: "o1",
        businessDate: "2026-05-01",
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

    const ws = await connectWebSocket();
    const msgPromise = getNextMessage(ws!);
    ws!.accept();
    const msg = await msgPromise;

    expect(msg.type).toBe("SNAPSHOT");
    expect(msg.orders).toHaveLength(1);
    expect(msg.orders[0].id).toBe("o1");
    expect(msg.orders[0].items).toHaveLength(1);
  });

  it("新しい注文が追加されると ORDER_CREATED がブロードキャストされる", async () => {
    const ws = await connectWebSocket();
    let msgPromise = getNextMessage(ws!);
    ws!.accept();
    let msg = await msgPromise; // snapshot (empty)
    expect(msg.type).toBe("SNAPSHOT");

    const newOrder = {
      id: "o2",
      orderNumber: 102,
      status: "pending",
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 別の fetch リクエストでDO宛てに注文作成
    let createdPromise = getNextMessage(ws);
    await stub.fetch(
      new Request("http://localhost/do/new-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOrder),
      }),
    );
    msg = await createdPromise;
    expect(msg.type).toBe("ORDER_CREATED");
    expect(msg.order.id).toBe("o2");
  });

  it("ステータスが遷移されると更新がDBに反映され ORDER_UPDATED がブロードキャストされる", async () => {
    // DBに事前に注文を作成しておく（本来のWorker APIの挙動を模倣）
    await db.insert(orders).values([
      {
        id: "o3",
        businessDate: "2026-05-01",
        orderNumber: 103,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const ws = await connectWebSocket();
    let msgPromise = getNextMessage(ws);
    (ws as any).accept();
    let msg = await msgPromise; // snapshot
    expect(msg.type).toBe("SNAPSHOT");
    expect(msg.orders).toHaveLength(1);

    // start action
    let updatedPromise = getNextMessage(ws);
    const startRes = await stub.fetch(
      new Request("http://localhost/do/orders/o3/start", { method: "POST" }),
    );
    expect(startRes.status).toBe(200);

    msg = await updatedPromise;
    expect(msg.type).toBe("ORDER_UPDATED");
    expect(msg.orderId).toBe("o3");
    expect(msg.status).toBe("brewing");

    // 確認用にD1の更新を確認
    const updatedOrder = await db.select().from(orders).where(eq(orders.id, "o3"));
    expect(updatedOrder).toHaveLength(1);
    expect(updatedOrder[0].status).toBe("brewing");
  });
});
