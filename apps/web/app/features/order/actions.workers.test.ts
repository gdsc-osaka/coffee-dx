/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { menuItems, orderItems, orderNumberCounters, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
import { createOrder } from "./actions";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

// DO への通知はスタブに差し替える（D1 書き込みのみ検証対象）
const mockEnv = {
  ...env,
  ORDER_DO: {
    idFromName: () => ({ toString: () => "mock-id" }),
    get: () => ({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    }),
  },
} as unknown as Env;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("createOrder", () => {
  let db: ReturnType<typeof drizzle<Record<string, never>>>;

  beforeEach(async () => {
    db = drizzle(env.DB);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(orderNumberCounters);
    await db.delete(menuItems);

    await db.insert(menuItems).values([
      { id: "menu-1", name: "ブレンドコーヒー", price: 400, isAvailable: 1 },
      { id: "menu-2", name: "アメリカーノ", price: 350, isAvailable: 1 },
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
    expect(allItems[0].quantity).toBe(2);
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

    expect(orderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
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
});
