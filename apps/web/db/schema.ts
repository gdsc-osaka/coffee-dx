import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** JST 相当（SQLite の datetime 式）。設計どおり `datetime('now', '+9 hours')` */
const jstNow = sql`(datetime('now', '+9 hours'))`;

export const menuItems = sqliteTable("menu_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  description: text("description"),
  isAvailable: integer("is_available").notNull().default(1),
  createdAt: text("created_at").notNull().default(jstNow),
  updatedAt: text("updated_at").notNull().default(jstNow),
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    orderNumber: integer("order_number").notNull().unique(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(jstNow),
    updatedAt: text("updated_at").notNull().default(jstNow),
  },
  (t) => [
    check(
      "orders_status_check",
      sql`${t.status} IN ('pending','brewing','ready','completed','cancelled')`,
    ),
    // 履歴ダイアログの cursor pagination は ORDER BY createdAt DESC, id DESC かつ
    // (createdAt, id) の複合境界条件で絞るので、複合 index にしてスキャン範囲を抑える。
    index("orders_created_at_id_idx").on(t.createdAt, t.id),
  ],
);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  menuItemId: text("menu_item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull().default(1),
  createdAt: text("created_at").notNull().default(jstNow),
  updatedAt: text("updated_at").notNull().default(jstNow),
});

export const orderNumberCounters = sqliteTable("order_number_counters", {
  businessDate: text("business_date").primaryKey(),
  nextNumber: integer("next_number").notNull().default(1),
  createdAt: text("created_at").notNull().default(jstNow),
  updatedAt: text("updated_at").notNull().default(jstNow),
});

/**
 * 1 レコード = 1 杯の抽出単位。
 * 抽出中（brewing）は orderItemId = NULL。
 * 完成（ready）になった瞬間に先着順の注文に紐付ける（遅延バインディング）。
 */
export const brewUnits = sqliteTable(
  "brew_units",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    menuItemId: text("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "restrict" }),
    /** NULL = 未紐付き（抽出中 or 余剰）。ready になった瞬間に注文へ紐付ける。 */
    orderItemId: text("order_item_id").references(() => orderItems.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("brewing"),
    /** 業務日 YYYY-MM-DD。order_number_counters.business_date と同じ命名。 */
    businessDate: text("business_date").notNull(),
    createdAt: text("created_at").notNull().default(jstNow),
    updatedAt: text("updated_at").notNull().default(jstNow),
  },
  (t) => [
    check("brew_units_status_check", sql`${t.status} IN ('brewing', 'ready')`),
    index("idx_brew_units_menu_date").on(t.menuItemId, t.businessDate),
    index("idx_brew_units_order_item").on(t.orderItemId),
    index("idx_brew_units_batch").on(t.batchId),
  ],
);

export const schema = {
  menuItems,
  orders,
  orderItems,
  orderNumberCounters,
  brewUnits,
};
