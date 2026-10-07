/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMenuItem, setMenuItemAvailability, MenuItemValidationError } from "./actions";
import { getAllMenuItems, getAvailableMenuItems } from "./queries";
import { createDb } from "../../lib/db";
import { menuItems } from "../../../db/schema";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("menu item registration", () => {
  // drizzle(env.DB) ではなく createDb を使うのは、getAllMenuItems / getAvailableMenuItems が
  // features/menu/queries.ts と同じ Db 型（ReturnType<typeof createDb>）を前提にしているため。
  const db = createDb(env.DB);

  beforeEach(async () => {
    await db.delete(menuItems);
  });

  it("商品を登録すると、金額と区分(fulfillmentType)が保存され、デフォルトで販売中になる", async () => {
    const created = await createMenuItem(db, {
      name: "ブレンドコーヒー",
      price: 400,
      fulfillmentType: "brew",
    });

    expect(created.isAvailable).toBe(true);

    const all = await getAllMenuItems(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      name: "ブレンドコーヒー",
      price: 400,
      fulfillmentType: "brew",
      isAvailable: 1,
    });
  });

  it("登録した商品は、注文画面が参照する一覧（getAvailableMenuItems）にも反映される", async () => {
    await createMenuItem(db, { name: "焼き菓子", price: 300, fulfillmentType: "direct" });

    const available = await getAvailableMenuItems(db);
    expect(available.map((item) => item.name)).toContain("焼き菓子");
  });

  it("商品名が空なら登録できない", async () => {
    await expect(
      createMenuItem(db, { name: "", price: 300, fulfillmentType: "brew" }),
    ).rejects.toBeInstanceOf(MenuItemValidationError);
  });

  it("金額が0以下なら登録できない", async () => {
    await expect(
      createMenuItem(db, { name: "テスト", price: 0, fulfillmentType: "brew" }),
    ).rejects.toBeInstanceOf(MenuItemValidationError);
  });

  it("区分がbrew/direct以外なら登録できない", async () => {
    await expect(
      createMenuItem(db, {
        name: "テスト",
        price: 300,
        // @ts-expect-error 不正な値を意図的に渡す
        fulfillmentType: "dessert",
      }),
    ).rejects.toBeInstanceOf(MenuItemValidationError);
  });

  it("販売停止に切り替えると、以後は注文画面の一覧から外れる", async () => {
    const created = await createMenuItem(db, {
      name: "季節限定ラテ",
      price: 450,
      fulfillmentType: "brew",
    });

    await setMenuItemAvailability(db, created.id, false);

    const available = await getAvailableMenuItems(db);
    expect(available.map((item) => item.id)).not.toContain(created.id);

    const all = await getAllMenuItems(db);
    expect(all.find((item) => item.id === created.id)?.isAvailable).toBe(0);
  });

  it("存在しない商品の販売状態は変更できない", async () => {
    await expect(setMenuItemAvailability(db, "not-found-id", true)).rejects.toBeInstanceOf(
      MenuItemValidationError,
    );
  });
});
