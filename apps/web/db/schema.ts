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

/**
 * モバイルから送信された、会計前の注文。
 * 会計完了までは既存の orders / brew_units には作成しない。
 */
export const mobileOrderRequests = sqliteTable(
  "mobile_order_requests",
  {
    id: text("id").primaryKey(),
    storeToken: text("store_token").notNull(),
    businessDate: text("business_date").notNull(),
    orderNumber: integer("order_number").notNull(),
    status: text("status").notNull().default("awaiting_payment"),
    paidAt: text("paid_at"),
    acceptedOrderId: text("accepted_order_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    publicToken: text("public_token").notNull(),
    createdAt: text("created_at").notNull().default(jstNow),
    updatedAt: text("updated_at").notNull().default(jstNow),
  },
  (t) => [
    check(
      "mobile_order_requests_status_check",
      sql`${t.status} IN ('awaiting_payment','paid','cancelled')`,
    ),
    uniqueIndex("mobile_order_requests_idempotency_unique").on(t.storeToken, t.idempotencyKey),
    uniqueIndex("mobile_order_requests_public_token_unique").on(t.publicToken),
    uniqueIndex("mobile_order_requests_business_date_order_number_unique").on(
      t.businessDate,
      t.orderNumber,
    ),
    index("mobile_order_requests_store_date_status_idx").on(t.storeToken, t.businessDate, t.status),
  ],
);

export const mobileOrderRequestItems = sqliteTable(
  "mobile_order_request_items",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => mobileOrderRequests.id, { onDelete: "cascade" }),
    menuItemId: text("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "restrict" }),
    itemNameAtOrder: text("item_name_at_order").notNull(),
    unitPriceAtOrder: integer("unit_price_at_order").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: text("created_at").notNull().default(jstNow),
  },
  (t) => [
    check("mobile_order_request_items_quantity_positive", sql`${t.quantity} > 0`),
    check("mobile_order_request_items_price_non_negative", sql`${t.unitPriceAtOrder} >= 0`),
    index("mobile_order_request_items_request_idx").on(t.requestId),
  ],
);

/** 店舗・営業日単位のモバイル注文受付状態。行がない日は停止中として扱う。 */
export const mobileOrderAcceptance = sqliteTable(
  "mobile_order_acceptance",
  {
    id: text("id").primaryKey(),
    storeToken: text("store_token").notNull(),
    businessDate: text("business_date").notNull(),
    isAccepting: integer("is_accepting").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(jstNow),
  },
  (t) => [
    check("mobile_order_acceptance_boolean_check", sql`${t.isAccepting} IN (0, 1)`),
    uniqueIndex("mobile_order_acceptance_store_date_unique").on(t.storeToken, t.businessDate),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    // 注文番号は businessDate 単位でリセットされる "整理券番号" なので、
    // グローバル一意ではなく (businessDate, orderNumber) で一意とする。
    businessDate: text("business_date").notNull(),
    orderNumber: integer("order_number").notNull(),
    status: text("status").notNull().default("pending"),
    isFree: integer("is_free").notNull().default(0),
    mobileRequestId: text("mobile_request_id").references(() => mobileOrderRequests.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(jstNow),
    updatedAt: text("updated_at").notNull().default(jstNow),
  },
  (t) => [
    check(
      "orders_status_check",
      sql`${t.status} IN ('pending','brewing','ready','completed','cancelled')`,
    ),
    uniqueIndex("orders_business_date_order_number_unique").on(t.businessDate, t.orderNumber),
    uniqueIndex("orders_mobile_request_id_unique").on(t.mobileRequestId),
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
    /**
     * ドリップ係が指定したタイマー秒数。NULL は未設定（タイマー未使用）。
     * timerStartedAt との差分でクライアント側がカウントダウンを再現する。
     * 抽出開始とは独立して何度でも再設定できる。
     */
    targetDurationSec: integer("target_duration_sec"),
    /**
     * タイマー Start 押下時刻。NULL はタイマー未開始。
     * 抽出開始 (createdAt) とは独立に管理し、再 Start でリセットされる。
     */
    timerStartedAt: text("timer_started_at"),
    /**
     * 物理ドリッパー（レーン枠）の位置。0 はレーン 1、1 はレーン 2 ...
     * 全端末で同じレーン位置に同じバッチを表示するため DB に永続化する。
     * 旧データ互換のため NOT NULL DEFAULT 0。
     */
    laneIndex: integer("lane_index").notNull().default(0),
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
  mobileOrderRequests,
  mobileOrderRequestItems,
  mobileOrderAcceptance,
  orders,
  orderItems,
  orderNumberCounters,
  brewUnits,
};
