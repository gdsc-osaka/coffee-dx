/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, runInDurableObject, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  brewUnits,
  menuItems,
  mobileOrderRequestItems,
  mobileOrderRequests,
  orderItems,
  orders,
} from "../../db/schema";
import {
  getMobileOrderByPublicToken,
  getMobileOrderStatusByPublicToken,
} from "../features/mobile-order/actions";

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as unknown as TestEnv;
let eventId: string;
let nextEventDay = 2;

describe("OrderDO mobile order payment", () => {
  const db = drizzle(testEnv.DB);

  beforeAll(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    // DOのメモリをテスト間で共有せず、コールドスタートを検証できるようにする。
    eventId = `2024-01-${String(nextEventDay++).padStart(2, "0")}`;
    await db.delete(brewUnits);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(mobileOrderRequestItems);
    await db.delete(mobileOrderRequests);
    await db.delete(menuItems);
  });

  const createRequest = async (status: "awaiting_payment" | "cancelled" = "awaiting_payment") => {
    const now = `${eventId} 10:00:00`;
    const requestId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await db.insert(menuItems).values({ id: "m1", name: "Coffee", price: 500, isAvailable: 1 });
    await db.insert(mobileOrderRequests).values({
      id: requestId,
      storeToken: "store-token",
      businessDate: eventId,
      orderNumber: 1,
      status,
      idempotencyKey: crypto.randomUUID(),
      publicToken: crypto.randomUUID().replaceAll("-", ""),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(mobileOrderRequestItems).values({
      id: itemId,
      requestId,
      menuItemId: "m1",
      itemNameAtOrder: "Coffee",
      unitPriceAtOrder: 500,
      quantity: 2,
      createdAt: now,
    });
    return requestId;
  };

  const getStub = () => {
    const id = testEnv.ORDER_DO.idFromName(`event-${eventId}`);
    return testEnv.ORDER_DO.get(id);
  };

  const post = (requestId: string, action: "pay" | "cancel") =>
    getStub().fetch(
      new Request(`https://do/do/mobile-orders/${requestId}/${action}`, {
        method: "POST",
        headers: { "x-event-id": eventId },
      }),
    );

  const seedPaidInD1 = async (requestId: string) => {
    const request = await db
      .select()
      .from(mobileOrderRequests)
      .where(eq(mobileOrderRequests.id, requestId));
    const orderId = crypto.randomUUID();
    const now = `${eventId} 10:05:00`;
    await db.insert(orders).values({
      id: orderId,
      businessDate: eventId,
      orderNumber: request[0].orderNumber,
      status: "pending",
      mobileRequestId: requestId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(orderItems).values({
      id: crypto.randomUUID(),
      orderId,
      menuItemId: "m1",
      unitPriceAtOrder: 500,
      fulfillmentTypeAtOrder: "brew",
      quantity: 2,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(mobileOrderRequests)
      .set({ status: "paid", paidAt: now, acceptedOrderId: orderId, updatedAt: now })
      .where(eq(mobileOrderRequests.id, requestId));
    return orderId;
  };

  const connect = async () => {
    const response = await getStub().fetch(
      new Request("https://do/ws", {
        headers: { Upgrade: "websocket", "x-event-id": eventId },
      }),
    );
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    const buffer: unknown[] = [];
    const waiters: Array<(message: unknown) => void> = [];
    ws.addEventListener("message", (event) => {
      const message: unknown = JSON.parse(event.data as string);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else buffer.push(message);
    });
    ws.accept();
    const next = () => {
      if (buffer.length > 0) return Promise.resolve(buffer.shift()!);
      return new Promise<unknown>((resolve) => waiters.push(resolve));
    };
    return { ws, next };
  };

  it("会計済み注文の状態を公開トークンで取得でき、再送を冪等に処理する", async () => {
    const requestId = await createRequest();

    const first = await post(requestId, "pay");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "paid" });

    const paidRequest = await db
      .select()
      .from(mobileOrderRequests)
      .where(eq(mobileOrderRequests.id, requestId));
    expect(paidRequest[0].status).toBe("paid");
    expect(paidRequest[0].acceptedOrderId).toBeTruthy();
    expect(await db.select().from(orders)).toHaveLength(1);
    expect(await db.select().from(orderItems)).toHaveLength(1);

    const publicToken = paidRequest[0].publicToken;
    const waiting = await getMobileOrderByPublicToken(testEnv.DB, publicToken);
    expect(waiting?.status).toBe("paid");
    expect(waiting?.orderStatus).toBe("pending");
    expect(await getMobileOrderStatusByPublicToken(testEnv.DB, publicToken)).toEqual({
      status: "paid",
      orderStatus: "pending",
      businessDate: eventId,
    });

    await db
      .update(orders)
      .set({ status: "ready" })
      .where(eq(orders.id, paidRequest[0].acceptedOrderId!));
    expect((await getMobileOrderByPublicToken(testEnv.DB, publicToken))?.orderStatus).toBe("ready");
    expect((await getMobileOrderStatusByPublicToken(testEnv.DB, publicToken))?.orderStatus).toBe(
      "ready",
    );

    await db
      .update(orders)
      .set({ status: "completed" })
      .where(eq(orders.id, paidRequest[0].acceptedOrderId!));
    expect((await getMobileOrderByPublicToken(testEnv.DB, publicToken))?.orderStatus).toBe(
      "completed",
    );

    const retry = await post(requestId, "pay");
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "already_paid" });
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it("会計待ちの注文を取消でき、取消後の会計を拒否する", async () => {
    const requestId = await createRequest();

    const cancelled = await post(requestId, "cancel");
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });

    const retry = await post(requestId, "cancel");
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "already_cancelled" });

    const pay = await post(requestId, "pay");
    expect(pay.status).toBe(409);
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("D1確定後にDOへの反映が失敗しても、会計再送で同じ注文を登録する", async () => {
    const requestId = await createRequest();
    const { ws, next } = await connect();
    try {
      expect(await next()).toMatchObject({ type: "SNAPSHOT", orders: [] });

      // D1の会計トランザクションだけ成功し、稼働中のDOには注文が未反映の状態を再現。
      const orderId = await seedPaidInD1(requestId);
      const retry = await post(requestId, "pay");
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: "already_paid", orderId });
      expect(await next()).toMatchObject({ type: "ORDER_CREATED", order: { id: orderId } });
      expect(await next()).toMatchObject({
        type: "QUEUE_UPDATED",
        queue: [{ menuItemId: "m1", count: 2 }],
      });

      expect(await db.select().from(orders)).toHaveLength(1);
      expect(await db.select().from(orderItems)).toHaveLength(1);
    } finally {
      ws.close();
    }
  });

  it("D1確定後に応答だけ失われても、再試行で主キー衝突せず会計を完了する", async () => {
    const requestId = await createRequest();
    let batchCalls = 0;
    await runInDurableObject(getStub(), (instance) => {
      const target = instance as unknown as { env: Env };
      const realDb = target.env.DB;
      // 1回目のbatchはD1へ確定させたうえで、通信断を模して例外にする。
      const flakyDb = new Proxy(realDb, {
        get(db, prop) {
          if (prop === "batch") {
            return async (statements: D1PreparedStatement[]) => {
              batchCalls++;
              const result = await db.batch(statements);
              if (batchCalls === 1) throw new Error("response lost");
              return result;
            };
          }
          const value: unknown = Reflect.get(db, prop);
          return typeof value === "function" ? value.bind(db) : value;
        },
      });
      target.env = { ...target.env, DB: flakyDb };
    });

    const paid = await post(requestId, "pay");
    expect(paid.status).toBe(200);
    const { orderId } = (await paid.json()) as { orderId: string };
    expect(batchCalls).toBe(2);

    const request = await db
      .select()
      .from(mobileOrderRequests)
      .where(eq(mobileOrderRequests.id, requestId));
    expect(request[0]).toMatchObject({ status: "paid", acceptedOrderId: orderId });
    expect(await db.select().from(orders)).toHaveLength(1);
    expect(await db.select().from(orderItems)).toHaveLength(1);
    await runInDurableObject(getStub(), (instance) => {
      const memory = instance as unknown as { orders: Map<string, unknown> };
      expect(memory.orders.has(orderId)).toBe(true);
    });
  });

  it("会計確定後に注文杯数を抽出提案キューへ追加する", async () => {
    const requestId = await createRequest();
    const { ws, next } = await connect();
    try {
      expect(await next()).toMatchObject({ type: "SNAPSHOT", orders: [], queue: [] });
      const paid = await post(requestId, "pay");
      expect(paid.status).toBe(200);
      expect(await next()).toMatchObject({ type: "ORDER_CREATED" });
      expect(await next()).toMatchObject({
        type: "QUEUE_UPDATED",
        queue: [{ menuItemId: "m1", count: 2 }],
      });

      const retry = await post(requestId, "pay");
      expect(retry.status).toBe(200);
      await runInDurableObject(getStub(), (instance) => {
        const queue = (
          instance as unknown as { queue: Array<{ menuItemId: string; count: number }> }
        ).queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({ menuItemId: "m1", count: 2 });
      });
    } finally {
      ws.close();
    }
  });

  it("DO再起動相当のメモリ消失後に会計済み注文をD1から復元する", async () => {
    const requestId = await createRequest();
    const paid = await post(requestId, "pay");
    expect(paid.status).toBe(200);
    const { orderId } = (await paid.json()) as { orderId: string };

    // テスト環境にDOを強制再起動するAPIはないため、永続D1を残してインメモリ状態を初期化する。
    await runInDurableObject(getStub(), (instance) => {
      const memory = instance as unknown as {
        orders: Map<string, unknown>;
        brewUnits: Map<string, unknown>;
        initialized: boolean;
        initPromise?: Promise<void>;
      };
      memory.orders.clear();
      memory.brewUnits.clear();
      memory.initialized = false;
      memory.initPromise = undefined;
    });

    const { ws, next } = await connect();
    try {
      expect(await next()).toMatchObject({
        type: "SNAPSHOT",
        orders: [{ id: orderId, status: "pending" }],
      });
      const retry = await post(requestId, "pay");
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: "already_paid", orderId });
      expect(await db.select().from(orders)).toHaveLength(1);
    } finally {
      ws.close();
    }
  });

  it("会計後に2杯を抽出・紐付けし、提供済みまで状態を更新する", async () => {
    const requestId = await createRequest();
    const paid = await post(requestId, "pay");
    expect(paid.status).toBe(200);
    const { orderId } = (await paid.json()) as { orderId: string };
    const request = await db
      .select()
      .from(mobileOrderRequests)
      .where(eq(mobileOrderRequests.id, requestId));
    expect(request[0].acceptedOrderId).toBe(orderId);
    expect(await getMobileOrderStatusByPublicToken(testEnv.DB, request[0].publicToken)).toEqual({
      status: "paid",
      orderStatus: "pending",
      businessDate: eventId,
    });

    const started = await getStub().fetch(
      new Request("https://do/do/brew-units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-id": eventId },
        body: JSON.stringify({ menuItemId: "m1", count: 2 }),
      }),
    );
    expect(started.status).toBe(204);
    const brewingUnits = await db.select().from(brewUnits);
    expect(brewingUnits).toHaveLength(2);
    expect(
      brewingUnits.every((unit) => unit.status === "brewing" && unit.orderItemId === null),
    ).toBe(true);

    const completed = await getStub().fetch(
      new Request(`https://do/do/brew-units/batch/${brewingUnits[0].batchId}/complete`, {
        method: "POST",
        headers: { "x-event-id": eventId },
      }),
    );
    expect(completed.status).toBe(200);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const readyUnits = await db.select().from(brewUnits);
    expect(readyUnits).toHaveLength(2);
    expect(
      readyUnits.every((unit) => unit.status === "ready" && unit.orderItemId === item.id),
    ).toBe(true);
    expect(await getMobileOrderStatusByPublicToken(testEnv.DB, request[0].publicToken)).toEqual({
      status: "paid",
      orderStatus: "ready",
      businessDate: eventId,
    });

    const served = await getStub().fetch(
      new Request(`https://do/do/orders/${orderId}/close`, {
        method: "POST",
        headers: { "x-event-id": eventId },
      }),
    );
    expect(served.status).toBe(200);
    expect(await getMobileOrderStatusByPublicToken(testEnv.DB, request[0].publicToken)).toEqual({
      status: "paid",
      orderStatus: "completed",
      businessDate: eventId,
    });
  });
});
