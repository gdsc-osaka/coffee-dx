/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
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
const eventId = "2024-01-02";

describe("OrderDO mobile order payment", () => {
  const db = drizzle(testEnv.DB);

  beforeAll(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await db.delete(brewUnits);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(mobileOrderRequestItems);
    await db.delete(mobileOrderRequests);
    await db.delete(menuItems);
  });

  const createRequest = async (status: "awaiting_payment" | "cancelled" = "awaiting_payment") => {
    const now = "2024-01-02 10:00:00";
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

  const post = (requestId: string, action: "pay" | "cancel") => {
    const id = testEnv.ORDER_DO.idFromName(`event-${eventId}`);
    const stub = testEnv.ORDER_DO.get(id);
    return stub.fetch(
      new Request(`https://do/do/mobile-orders/${requestId}/${action}`, {
        method: "POST",
        headers: { "x-event-id": eventId },
      }),
    );
  };

  it("前営業日の注文も手動で会計でき、再送を冪等に処理する", async () => {
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
});
