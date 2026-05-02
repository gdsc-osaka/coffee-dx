/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { menuItems, orderItems, orderNumberCounters, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
import { getRecentOrders } from "./history-queries";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function seedOrder(
  db: ReturnType<typeof drizzle<Record<string, never>>>,
  options: {
    id: string;
    orderNumber: number;
    createdAt: string;
    status?: "pending" | "brewing" | "ready" | "completed" | "cancelled";
    isFree?: boolean;
    items?: Array<{ id: string; menuItemId: string; quantity: number }>;
  },
) {
  await db.insert(orders).values({
    id: options.id,
    businessDate: options.createdAt.slice(0, 10),
    orderNumber: options.orderNumber,
    status: options.status ?? "completed",
    isFree: options.isFree ? 1 : 0,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  });
  if (options.items?.length) {
    await db.insert(orderItems).values(
      options.items.map((it) => ({
        id: it.id,
        orderId: options.id,
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        createdAt: options.createdAt,
        updatedAt: options.createdAt,
      })),
    );
  }
}

describe("getRecentOrders", () => {
  let db: ReturnType<typeof drizzle<Record<string, never>>>;
  let d1Db: ReturnType<typeof createDb>;

  beforeEach(async () => {
    db = drizzle(env.DB);
    d1Db = createDb(env.DB);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(orderNumberCounters);
    await db.delete(menuItems);

    await db.insert(menuItems).values([
      { id: "menu-1", name: "ブレンドコーヒー", price: 400, isAvailable: 1 },
      { id: "menu-2", name: "アメリカーノ", price: 350, isAvailable: 1 },
    ]);
  });

  it("注文が0件のとき空配列と null cursor を返す", async () => {
    const result = await getRecentOrders(d1Db, { limit: 10 });
    expect(result.orders).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("createdAt DESC で並び、items が name 付きで返る", async () => {
    await seedOrder(db, {
      id: "o-old",
      orderNumber: 1,
      createdAt: "2026-04-25 10:00:00",
      items: [{ id: "i-old", menuItemId: "menu-1", quantity: 2 }],
    });
    await seedOrder(db, {
      id: "o-new",
      orderNumber: 2,
      createdAt: "2026-04-26 09:00:00",
      items: [{ id: "i-new", menuItemId: "menu-2", quantity: 3 }],
    });

    const result = await getRecentOrders(d1Db, { limit: 10 });

    expect(result.orders).toHaveLength(2);
    expect(result.orders[0].id).toBe("o-new");
    expect(result.orders[0].items[0]).toMatchObject({ name: "アメリカーノ", quantity: 3 });
    expect(result.orders[1].id).toBe("o-old");
    expect(result.orders[1].items[0]).toMatchObject({ name: "ブレンドコーヒー", quantity: 2 });
    expect(result.orders[0].createdAt).toBeInstanceOf(Date);
    expect(result.nextCursor).toBeNull();
  });

  it("limit を超える場合は nextCursor を返し、cursor で次ページが続けて取得できる", async () => {
    // limit=2 で 5件投入 → 1ページ目: o-5, o-4 / 2ページ目: o-3, o-2 / 3ページ目: o-1
    for (let i = 1; i <= 5; i++) {
      await seedOrder(db, {
        id: `o-${i}`,
        orderNumber: i,
        // 同じ日付内で時刻だけ変えて並びを安定させる
        createdAt: `2026-04-26 10:00:0${i}`,
      });
    }

    const page1 = await getRecentOrders(d1Db, { limit: 2 });
    expect(page1.orders.map((o) => o.id)).toEqual(["o-5", "o-4"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await getRecentOrders(d1Db, { limit: 2, cursor: page1.nextCursor });
    expect(page2.orders.map((o) => o.id)).toEqual(["o-3", "o-2"]);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await getRecentOrders(d1Db, { limit: 2, cursor: page2.nextCursor });
    expect(page3.orders.map((o) => o.id)).toEqual(["o-1"]);
    // 最終ページ: 残数 < limit なので nextCursor は null
    expect(page3.nextCursor).toBeNull();
  });

  it("createdAt が同一でも id をタイブレークに使ってページ境界で重複・欠落しない", async () => {
    // 全件 createdAt が同一の場合でも id 降順で安定して分割できることを保証
    const ids = ["o-c", "o-b", "o-a"]; // id 降順で「c → b → a」の順に取得される
    for (const id of ids) {
      await seedOrder(db, {
        id,
        orderNumber: ids.indexOf(id) + 1,
        createdAt: "2026-04-26 10:00:00",
      });
    }

    const page1 = await getRecentOrders(d1Db, { limit: 2 });
    expect(page1.orders.map((o) => o.id)).toEqual(["o-c", "o-b"]);

    const page2 = await getRecentOrders(d1Db, { limit: 2, cursor: page1.nextCursor });
    expect(page2.orders.map((o) => o.id)).toEqual(["o-a"]);
  });

  it("同一注文の items は createdAt → id で安定ソートされる", async () => {
    // receiptGenerator が slice(0, 3) で先頭から3件しか印字しないため、
    // 毎回の取得で順が変わると、再印刷時に印字される items が変わってしまう。
    // id を意図的に "i-c" → "i-a" → "i-b" の順で投入し、結果が id 昇順 (a, b, c) になることを検証する。
    await seedOrder(db, {
      id: "o-1",
      orderNumber: 1,
      createdAt: "2026-04-26 10:00:00",
      items: [
        { id: "i-c", menuItemId: "menu-1", quantity: 1 },
        { id: "i-a", menuItemId: "menu-2", quantity: 2 },
        { id: "i-b", menuItemId: "menu-1", quantity: 3 },
      ],
    });

    const result = await getRecentOrders(d1Db, { limit: 10 });
    expect(result.orders[0].items.map((i) => i.id)).toEqual(["i-a", "i-b", "i-c"]);
  });

  it("キャンセル済み・完了済みも含めて返す（ステータスでのフィルタはしない）", async () => {
    await seedOrder(db, {
      id: "o-c",
      orderNumber: 1,
      createdAt: "2026-04-26 09:00:00",
      status: "cancelled",
    });
    await seedOrder(db, {
      id: "o-d",
      orderNumber: 2,
      createdAt: "2026-04-26 10:00:00",
      status: "completed",
    });
    await seedOrder(db, {
      id: "o-p",
      orderNumber: 3,
      createdAt: "2026-04-26 11:00:00",
      status: "pending",
    });

    const result = await getRecentOrders(d1Db, { limit: 10 });
    expect(result.orders.map((o) => o.status)).toEqual(["pending", "completed", "cancelled"]);
  });

  it("is_free 列が boolean として返る", async () => {
    await seedOrder(db, {
      id: "o-paid",
      orderNumber: 1,
      createdAt: "2026-04-26 09:00:00",
      isFree: false,
    });
    await seedOrder(db, {
      id: "o-free",
      orderNumber: 2,
      createdAt: "2026-04-26 10:00:00",
      isFree: true,
    });

    const result = await getRecentOrders(d1Db, { limit: 10 });
    const byId = new Map(result.orders.map((o) => [o.id, o]));
    expect(byId.get("o-free")?.isFree).toBe(true);
    expect(byId.get("o-paid")?.isFree).toBe(false);
  });
});
