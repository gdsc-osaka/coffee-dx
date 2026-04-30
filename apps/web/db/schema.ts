import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    // 注文番号は businessDate 単位でリセットされる "整理券番号" なので、
    // グローバル一意ではなく (businessDate, orderNumber) で一意とする。
    businessDate: text("business_date").notNull(),
    orderNumber: integer("order_number").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(jstNow),
    updatedAt: text("updated_at").notNull().default(jstNow),
  },
  (t) => [
    check(
      "orders_status_check",
      sql`${t.status} IN ('pending','brewing','ready','completed','cancelled')`,
    ),
    uniqueIndex("orders_business_date_order_number_unique").on(t.businessDate, t.orderNumber),
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

export const schema = {
  menuItems,
  orders,
  orderItems,
  orderNumberCounters,
};
