/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mobileOrderRequests, orderItems, orders } from "../../db/schema";
import { getConfiguredMobileStoreToken } from "../features/mobile-order/actions";
import { getBusinessDate } from "../lib/order-do";
import { action, loader } from "./mobile-order-checkout";

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as unknown as TestEnv;
const db = drizzle(testEnv.DB);
let storeToken: string;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  storeToken = getConfiguredMobileStoreToken(testEnv);
});

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(mobileOrderRequests);
});

async function createRequest(businessDate: string, status: "awaiting_payment" | "paid") {
  const id = crypto.randomUUID();
  const now = `${businessDate} 10:00:00`;
  await db.insert(mobileOrderRequests).values({
    id,
    storeToken,
    businessDate,
    orderNumber: 1,
    status,
    idempotencyKey: crypto.randomUUID(),
    publicToken: crypto.randomUUID().replaceAll("-", ""),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function submit(intent: "pay" | "cancel" | "sync", requestId: string) {
  const request = new Request("https://example.com/order/mobile-checkout", {
    method: "POST",
    body: new URLSearchParams({ intent, requestId }),
  });
  return action({ request, context: { cloudflare: { env: testEnv } } } as unknown as Parameters<
    typeof action
  >[0]);
}

describe("mobile order checkout action", () => {
  it("前営業日の会計待ちはサーバー側で会計を拒否する", async () => {
    const previousDate = new Date(Date.now() - 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const requestId = await createRequest(previousDate, "awaiting_payment");

    const result = await submit("pay", requestId);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("前営業日") });
    expect(await db.select().from(orders)).toHaveLength(0);

    const cancelled = await submit("cancel", requestId);
    expect(cancelled).toMatchObject({ ok: true, intent: "cancel" });
    expect((await db.select().from(mobileOrderRequests))[0].status).toBe("cancelled");
  });

  it("支払済みでDO反映が失敗しても再請求を促さず、再同期導線を残す", async () => {
    const requestId = await createRequest(getBusinessDate(), "paid");
    // accepted_order_id がない異常を使い、DO が 500 を返す状態を再現する。
    const result = await submit("pay", requestId);
    expect(result).toMatchObject({ ok: false, kind: "sync_pending" });
    if (!result.ok) expect(result.error).toContain("再度お会計せず");

    const loaded = await loader({
      context: { cloudflare: { env: testEnv } },
    } as unknown as Parameters<typeof loader>[0]);
    expect(loaded.paidOrders).toEqual([expect.objectContaining({ id: requestId })]);
  });

  it("未払い注文の再同期操作では会計を確定しない", async () => {
    const requestId = await createRequest(getBusinessDate(), "awaiting_payment");
    const result = await submit("sync", requestId);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("支払済み") });
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});
