/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMobileOrderRequest,
  getMobileOrderByPublicToken,
  getMobileOrderAcceptance,
  getConfiguredMobileStoreToken,
  setMobileOrderAcceptance,
  MobileOrderClosedError,
  MobileOrderConflictError,
} from "./actions";
import {
  menuItems,
  mobileOrderAcceptance,
  mobileOrderRequestItems,
  mobileOrderRequests,
  orderNumberCounters,
  orders,
} from "../../../db/schema";
import { getBusinessDate } from "../../lib/order-do";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;
let appEnv: Env;
let storeToken: string;

beforeAll(async () => {
  appEnv = env as unknown as Env;
  storeToken = getConfiguredMobileStoreToken(appEnv);
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("mobile order request", () => {
  const db = drizzle(env.DB);
  const businessDate = getBusinessDate();

  beforeEach(async () => {
    await db.delete(mobileOrderRequestItems);
    await db.delete(mobileOrderRequests);
    await db.delete(mobileOrderAcceptance);
    await db.delete(orders);
    await db.delete(orderNumberCounters);
    await db.delete(menuItems);
    await db.insert(menuItems).values([
      { id: "menu-1", name: "ブレンドコーヒー", price: 400, isAvailable: 1 },
      { id: "menu-2", name: "アメリカーノ", price: 350, isAvailable: 1 },
      { id: "menu-sold-out", name: "売切れ", price: 500, isAvailable: 0 },
    ]);
  });

  it("受付停止中は注文を保存せず、番号も消費しない", async () => {
    await expect(
      createMobileOrderRequest(
        env.DB,
        appEnv,
        storeToken,
        [{ menuItemId: "menu-1", quantity: 1 }],
        "closed-key-123456",
      ),
    ).rejects.toBeInstanceOf(MobileOrderClosedError);

    const requests = await db.select().from(mobileOrderRequests);
    const counters = await db.select().from(orderNumberCounters);
    expect(requests).toHaveLength(0);
    expect(counters).toHaveLength(0);
  });

  it("受付中ならスナップショット付きの会計待ち注文を作る", async () => {
    await setMobileOrderAcceptance(env.DB, storeToken, true, businessDate);
    const result = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      [
        { menuItemId: "menu-1", quantity: 2 },
        { menuItemId: "menu-2", quantity: 1 },
      ],
      "open-key-1234567",
      businessDate,
    );

    expect(result.orderNumber).toBe(1);
    expect(result.status).toBe("awaiting_payment");
    expect(result.items.map((item) => [item.name, item.price, item.quantity])).toEqual([
      ["ブレンドコーヒー", 400, 2],
      ["アメリカーノ", 350, 1],
    ]);
    const receipt = await getMobileOrderByPublicToken(env.DB, result.publicToken);
    expect(receipt?.id).toBe(result.id);
    expect(receipt?.items).toHaveLength(result.items.length);
    expect(receipt?.items).toEqual(expect.arrayContaining(result.items));
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await getMobileOrderAcceptance(env.DB, storeToken, businessDate)).toBe(true);
  });

  it("同じ冪等キーの再送は同じ注文を返し、内容違いは拒否する", async () => {
    await setMobileOrderAcceptance(env.DB, storeToken, true, businessDate);
    const first = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      [{ menuItemId: "menu-1", quantity: 1 }],
      "retry-key-123456",
      businessDate,
    );
    const retry = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      [{ menuItemId: "menu-1", quantity: 1 }],
      "retry-key-123456",
      businessDate,
    );

    expect(retry.id).toBe(first.id);
    expect(retry.publicToken).toBe(first.publicToken);
    await expect(
      createMobileOrderRequest(
        env.DB,
        appEnv,
        storeToken,
        [{ menuItemId: "menu-2", quantity: 1 }],
        "retry-key-123456",
        businessDate,
      ),
    ).rejects.toBeInstanceOf(MobileOrderConflictError);
    expect(await db.select().from(mobileOrderRequests)).toHaveLength(1);
  });

  it("同じ商品を複数行で送っても、同一キーの再送は同じ注文を返す", async () => {
    await setMobileOrderAcceptance(env.DB, storeToken, true, businessDate);
    const duplicateLines = [
      { menuItemId: "menu-1", quantity: 1 },
      { menuItemId: "menu-1", quantity: 1 },
    ];
    const first = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      duplicateLines,
      "duplicate-lines-123456",
      businessDate,
    );
    const retry = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      duplicateLines,
      "duplicate-lines-123456",
      businessDate,
    );
    const aggregatedRetry = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      [{ menuItemId: "menu-1", quantity: 2 }],
      "duplicate-lines-123456",
      businessDate,
    );

    expect(first.items).toMatchObject([{ menuItemId: "menu-1", quantity: 2 }]);
    expect(retry.id).toBe(first.id);
    expect(retry.orderNumber).toBe(first.orderNumber);
    expect(aggregatedRetry.id).toBe(first.id);
    expect(await db.select().from(mobileOrderRequests)).toHaveLength(1);
  });

  it("受付停止後も既存の同一キー再送だけは同じ結果を返し、新規注文は拒否する", async () => {
    await setMobileOrderAcceptance(env.DB, storeToken, true, businessDate);
    const first = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      [{ menuItemId: "menu-1", quantity: 1 }],
      "stop-retry-123456",
      businessDate,
    );
    await setMobileOrderAcceptance(env.DB, storeToken, false, businessDate);

    const retry = await createMobileOrderRequest(
      env.DB,
      appEnv,
      storeToken,
      [{ menuItemId: "menu-1", quantity: 1 }],
      "stop-retry-123456",
      businessDate,
    );
    expect(retry.id).toBe(first.id);

    await expect(
      createMobileOrderRequest(
        env.DB,
        appEnv,
        storeToken,
        [{ menuItemId: "menu-2", quantity: 1 }],
        "new-after-stop-123456",
        businessDate,
      ),
    ).rejects.toBeInstanceOf(MobileOrderClosedError);
  });
});
