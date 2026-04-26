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
    // 履歴ダイアログの cursor pagination で createdAt DESC 順にスキャンするため
    index("orders_created_at_idx").on(t.createdAt),
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
