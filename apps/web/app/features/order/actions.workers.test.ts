/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { menuItems, orderItems, orderNumberCounters, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
import { createOrder } from "./actions";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

// DO への通知はスタブに差し替える（D1 書き込みのみ検証対象）
const orderDoFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
const mockEnv = {
  ...env,
  ORDER_DO: {
    idFromName: () => ({ toString: () => "mock-id" }),
    get: () => ({
      fetch: orderDoFetch,
    }),
  },
} as unknown as Env;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("createOrder", () => {
  let db: ReturnType<typeof drizzle<Record<string, never>>>;

  beforeEach(async () => {
    orderDoFetch.mockClear();
    db = drizzle(env.DB);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(orderNumberCounters);
    await db.delete(menuItems);

    await db.insert(menuItems).values([
      { id: "menu-1", name: "ブレンドコーヒー", price: 400, isAvailable: 1 },
      { id: "menu-2", name: "アメリカーノ", price: 350, isAvailable: 1 },
      {
        id: "retail-1",
        name: "ビスケット",
        price: 250,
        fulfillmentType: "direct",
        isAvailable: 1,
      },
    ]);
  });

  it("orders と order_items が D1 に INSERT される", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 2 }];

    const { orderId, orderNumber } = await createOrder(d1Db, mockEnv, cartItems);

    const allOrders = await db.select().from(orders);
    const allItems = await db.select().from(orderItems);

    expect(allOrders).toHaveLength(1);
    expect(allOrders[0].id).toBe(orderId);
    expect(allOrders[0].orderNumber).toBe(orderNumber);
    expect(allOrders[0].status).toBe("pending");

    expect(allItems).toHaveLength(1);
    expect(allItems[0].orderId).toBe(orderId);
    expect(allItems[0].menuItemId).toBe("menu-1");
    expect(allItems[0].unitPriceAtOrder).toBe(400);
    expect(allItems[0].fulfillmentTypeAtOrder).toBe("brew");
    expect(allItems[0].quantity).toBe(2);
  });

  it("同じ商品でも価格ごとに別の order_items 行として保存される", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [
      { menuItemId: "menu-1", unitPriceAtOrder: 300, quantity: 1 },
      { menuItemId: "menu-1", unitPriceAtOrder: 200, quantity: 1 },
      { menuItemId: "menu-1", unitPriceAtOrder: 100, quantity: 1 },
    ];

    const { orderId } = await createOrder(d1Db, mockEnv, cartItems);
    const allItems = await db.select().from(orderItems);

    expect(allItems).toHaveLength(3);
    expect(
      allItems
        .filter((item) => item.orderId === orderId)
        .map((item) => item.unitPriceAtOrder)
        .sort(),
    ).toEqual([100, 200, 300]);
  });

  it("direct商品のみの注文はcompletedで保存され、DOの抽出処理に送られない", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "retail-1", unitPriceAtOrder: 150, quantity: 1 }];

    const { orderId } = await createOrder(d1Db, mockEnv, cartItems);
    const [order] = await db.select().from(orders);
    const [item] = await db.select().from(orderItems);

    expect(order.id).toBe(orderId);
    expect(order.status).toBe("completed");
    expect(item.fulfillmentTypeAtOrder).toBe("direct");
    expect(item.unitPriceAtOrder).toBe(150);
    expect(orderDoFetch).not.toHaveBeenCalled();
  });

  it("存在しない商品が含まれる場合は注文全体を保存せず、注文番号も進めない", async () => {
    const d1Db = createDb(env.DB);

    await expect(
      createOrder(d1Db, mockEnv, [
        { menuItemId: "menu-1", quantity: 1 },
        { menuItemId: "missing", quantity: 1 },
      ]),
    ).rejects.toThrow("Menu item not found");

    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(orderItems)).toHaveLength(0);
    expect(await db.select().from(orderNumberCounters)).toHaveLength(0);
    expect(orderDoFetch).not.toHaveBeenCalled();
  });

  it("販売停止商品が含まれる場合は注文全体を保存しない", async () => {
    const d1Db = createDb(env.DB);
    await db.update(menuItems).set({ isAvailable: 0 }).where(eq(menuItems.id, "menu-2"));

    await expect(
      createOrder(d1Db, mockEnv, [
        { menuItemId: "menu-1", quantity: 1 },
        { menuItemId: "menu-2", quantity: 1 },
      ]),
    ).rejects.toThrow("Menu item is unavailable");

    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(orderItems)).toHaveLength(0);
    expect(await db.select().from(orderNumberCounters)).toHaveLength(0);
  });

  it("複数商品の order_items がそれぞれ INSERT される", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [
      { menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 },
      { menuItemId: "menu-2", name: "アメリカーノ", price: 350, quantity: 3 },
    ];

    const { orderId } = await createOrder(d1Db, mockEnv, cartItems);

    const allItems = await db.select().from(orderItems);
    expect(allItems).toHaveLength(2);
    expect(allItems.map((i) => i.menuItemId).sort()).toEqual(["menu-1", "menu-2"].sort());
    expect(allItems.find((i) => i.menuItemId === "menu-2")?.quantity).toBe(3);
    expect(allItems.every((i) => i.orderId === orderId)).toBe(true);
  });

  it("1日目の最初の注文は order_number が 1 になる", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    const { orderNumber } = await createOrder(d1Db, mockEnv, cartItems);

    expect(orderNumber).toBe(1);
  });

  it("2件目の注文は order_number が 2 になる", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    const first = await createOrder(d1Db, mockEnv, cartItems);
    const second = await createOrder(d1Db, mockEnv, cartItems);

    expect(first.orderNumber).toBe(1);
    expect(second.orderNumber).toBe(2);
  });

  it("orderId は UUID 形式の文字列である", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    const { orderId } = await createOrder(d1Db, mockEnv, cartItems);

    expect(orderId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("orders の created_at・updated_at が JST 形式で保存される", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    await createOrder(d1Db, mockEnv, cartItems);

    const [order] = await db.select().from(orders);
    // JST 相当（UTC+9）の日時文字列: "YYYY-MM-DD HH:MM:SS" 形式
    expect(order.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(order.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("isFree オプション未指定時は is_free = 0 で保存される", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    const result = await createOrder(d1Db, mockEnv, cartItems);

    const [order] = await db.select().from(orders);
    expect(order.isFree).toBe(0);
    expect(result.isFree).toBe(false);
  });

  it("isFree: true を渡すと is_free = 1 で保存される", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    const result = await createOrder(d1Db, mockEnv, cartItems, { isFree: true });

    const [order] = await db.select().from(orders);
    expect(order.isFree).toBe(1);
    expect(result.isFree).toBe(true);
  });

  it("戻り値の createdAt は D1 に保存された JST 文字列と一致する Date を返す", async () => {
    const d1Db = createDb(env.DB);
    const cartItems = [{ menuItemId: "menu-1", name: "ブレンドコーヒー", price: 400, quantity: 1 }];

    const { createdAt } = await createOrder(d1Db, mockEnv, cartItems);

    const [order] = await db.select().from(orders);
    expect(createdAt).toBeInstanceOf(Date);
    // 受付番号票が常に同じ時刻を表示できるよう、D1 の文字列値と Date が秒精度で一致することを保証する
    const expected = new Date(`${order.createdAt.replace(" ", "T")}+09:00`);
    expect(createdAt.getTime()).toBe(expected.getTime());
  });
});
