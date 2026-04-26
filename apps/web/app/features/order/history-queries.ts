import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { menuItems, orderItems, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
import { parseJstString } from "../../lib/datetime";

type Db = ReturnType<typeof createDb>;

export type HistoryOrderItem = {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
};

export type HistoryOrder = {
  id: string;
  orderNumber: number;
  status: "pending" | "brewing" | "ready" | "completed" | "cancelled";
  createdAt: Date;
  items: HistoryOrderItem[];
};

export type RecentOrdersPage = {
  orders: HistoryOrder[];
  /** 次ページがあれば、その次ページ取得に使う cursor。なければ null。 */
  nextCursor: { createdAt: string; id: string } | null;
};

/**
 * 履歴ダイアログ向けに、createdAt DESC で注文を limit 件取得する。
 * cursor は前ページ末尾の `{createdAt, id}` を渡し、(createdAt, id) の辞書順より小さい行のみ返す。
 * createdAt は同秒粒度で衝突しうるため、id をタイブレークに使う。
 */
export async function getRecentOrders(
  db: Db,
  options: { limit: number; cursor?: { createdAt: string; id: string } | null },
): Promise<RecentOrdersPage> {
  const limit = Math.max(1, Math.min(50, options.limit));

  const whereCursor = options.cursor
    ? or(
        lt(orders.createdAt, options.cursor.createdAt),
        and(eq(orders.createdAt, options.cursor.createdAt), lt(orders.id, options.cursor.id)),
      )
    : undefined;

  // 次ページの有無を 1 クエリで判定するため limit+1 件取得する
  const fetched = await db
    .select()
    .from(orders)
    .where(whereCursor)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit + 1);

  const hasMore = fetched.length > limit;
  const pageRows = hasMore ? fetched.slice(0, limit) : fetched;

  if (pageRows.length === 0) {
    return { orders: [], nextCursor: null };
  }

  const orderIds = pageRows.map((o) => o.id);
  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));

  const menuIds = [...new Set(items.map((i) => i.menuItemId))];
  const menus =
    menuIds.length > 0
      ? await db
          .select({ id: menuItems.id, name: menuItems.name })
          .from(menuItems)
          .where(inArray(menuItems.id, menuIds))
      : [];
  const menuNameById = new Map(menus.map((m) => [m.id, m.name]));

  const itemsByOrderId = new Map<string, HistoryOrderItem[]>();
  for (const it of items) {
    const list = itemsByOrderId.get(it.orderId) ?? [];
    // menu_items への FK は restrict のため、items 参照中のメニューは削除できない → name は必ず存在する
    list.push({
      id: it.id,
      menuItemId: it.menuItemId,
      name: menuNameById.get(it.menuItemId) ?? "",
      quantity: it.quantity,
    });
    itemsByOrderId.set(it.orderId, list);
  }

  const result: HistoryOrder[] = pageRows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status as HistoryOrder["status"],
    createdAt: parseJstString(o.createdAt),
    items: itemsByOrderId.get(o.id) ?? [],
  }));

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore ? { createdAt: last.createdAt, id: last.id } : null;

  return { orders: result, nextCursor };
}
