/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { brewUnits, menuItems, orderItems } from "../db/schema";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

beforeAll(async () => {
  const migration0008Index = 8;
  const legacyMigrations = testEnv.TEST_MIGRATIONS.slice(0, migration0008Index);
  const migration0008 = testEnv.TEST_MIGRATIONS.at(migration0008Index);
  if (!migration0008) throw new Error("0008 migration is missing");

  await applyD1Migrations(testEnv.DB, legacyMigrations);

  const now = "2026-10-05 10:00:00";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO menu_items (id, name, price, is_available, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind("legacy-menu", "既存コーヒー", 400, now, now),
    testEnv.DB.prepare(
      "INSERT INTO orders (id, business_date, order_number, status, is_free, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)",
    ).bind("legacy-order", "2026-10-05", 1, now, now),
    testEnv.DB.prepare(
      "INSERT INTO order_items (id, order_id, menu_item_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind("legacy-item", "legacy-order", "legacy-menu", 2, now, now),
    testEnv.DB.prepare(
      "INSERT INTO brew_units (id, batch_id, menu_item_id, order_item_id, status, business_date, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)",
    ).bind(
      "legacy-brew-unit",
      "legacy-batch",
      "legacy-menu",
      "legacy-item",
      "2026-10-05",
      now,
      now,
    ),
  ]);

  await applyD1Migrations(testEnv.DB, [migration0008]);
});

describe("migration 0008", () => {
  const db = drizzle(testEnv.DB);

  it("既存明細へ当時の定価とbrew区分を補完する", async () => {
    const [menu] = await db.select().from(menuItems).where(eq(menuItems.id, "legacy-menu"));
    const [item] = await db.select().from(orderItems).where(eq(orderItems.id, "legacy-item"));

    expect(menu.fulfillmentType).toBe("brew");
    expect(item.unitPriceAtOrder).toBe(400);
    expect(item.fulfillmentTypeAtOrder).toBe("brew");
    expect(item.quantity).toBe(2);
  });

  it("brew_unitsの注文明細との紐付けを維持する", async () => {
    const [unit] = await db.select().from(brewUnits).where(eq(brewUnits.id, "legacy-brew-unit"));

    expect(unit.orderItemId).toBe("legacy-item");
  });

  it("注文時単価に暗黙の0円デフォルトを残さない", async () => {
    const tableInfo = await testEnv.DB.prepare("PRAGMA table_info('order_items')").all<{
      name: string;
      dflt_value: string | null;
    }>();
    const unitPriceColumn = tableInfo.results.find(
      (column) => column.name === "unit_price_at_order",
    );

    expect(unitPriceColumn?.dflt_value).toBeNull();
  });

  it("負の単価と不正な提供区分をDB制約で拒否する", async () => {
    const now = "2026-10-05 10:01:00";
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO order_items (id, order_id, menu_item_id, unit_price_at_order, fulfillment_type_at_order, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      )
        .bind("negative-price", "legacy-order", "legacy-menu", -1, "brew", now, now)
        .run(),
    ).rejects.toThrow();

    await expect(
      testEnv.DB.prepare(
        "INSERT INTO order_items (id, order_id, menu_item_id, unit_price_at_order, fulfillment_type_at_order, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      )
        .bind("invalid-type", "legacy-order", "legacy-menu", 0, "shipping", now, now)
        .run(),
    ).rejects.toThrow();
  });
});
