/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { menuItems } from "../../../db/schema";
import { getAvailableMenuItems } from "./queries";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("getAvailableMenuItems", () => {
  let db: ReturnType<typeof drizzle<Record<string, never>>>;

  beforeEach(async () => {
    db = drizzle(env.DB);
    await db.delete(menuItems);
  });

  it("提供中のメニューだけ返す", async () => {
    await db.insert(menuItems).values([
      { id: "1", name: "ブレンドコーヒー", price: 400, isAvailable: 1 },
      { id: "2", name: "アメリカーノ", price: 350, isAvailable: 0 },
    ]);

    const result = await getAvailableMenuItems(db);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ブレンドコーヒー");
  });

  it("提供中のメニューが0件のとき空配列を返す", async () => {
    await db
      .insert(menuItems)
      .values([{ id: "1", name: "準備中コーヒー", price: 400, isAvailable: 0 }]);

    const result = await getAvailableMenuItems(db);

    expect(result).toHaveLength(0);
  });

  it("メニューが1件もないとき空配列を返す", async () => {
    const result = await getAvailableMenuItems(db);

    expect(result).toHaveLength(0);
  });
});
