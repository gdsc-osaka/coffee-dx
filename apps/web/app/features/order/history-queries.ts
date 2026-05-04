import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
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
  isFree: boolean;
  createdAt: Date;
  items: HistoryOrderItem[];
};

/**
 * 過去日のやり残し注文。businessDate を含む点が HistoryOrder と異なる
 * （UI から過去日 DO のスタブを呼ぶために必要）。
 */
export type LeftoverOrder = HistoryOrder & {
  businessDate: string;
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
  // 表示・印字（receiptGenerator は最初の3件で切る）の順を安定させるため、
  // createdAt → id でソートする。同一注文の items は同秒で並ぶことが多いので id をタイブレークに使う。
  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

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
    // 通常は FK restrict により name は必ず取得できるが、データ不整合や FK 無効化のような
    // 例外時に UI/印字上で「商品名空欄」として識別不能になるのを防ぐためプレースホルダを置く。
    list.push({
      id: it.id,
      menuItemId: it.menuItemId,
      name: menuNameById.get(it.menuItemId) ?? "(削除済み)",
      quantity: it.quantity,
    });
    itemsByOrderId.set(it.orderId, list);
  }

  const result: HistoryOrder[] = pageRows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status as HistoryOrder["status"],
    isFree: o.isFree === 1,
    createdAt: parseJstString(o.createdAt),
    items: itemsByOrderId.get(o.id) ?? [],
  }));

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore ? { createdAt: last.createdAt, id: last.id } : null;

  return { orders: result, nextCursor };
}

/**
 * 過去日 (business_date < today) かつ未完了 (pending/brewing/ready) の注文を返す。
 * 営業終了時に「完了」「キャンセル」の処理をし忘れた注文を翌営業日以降に拾うための導線。
 * 件数は通常 0〜数件想定なのでページングは省く。
 */
export async function getLeftoverOrders(db: Db, today: string): Promise<LeftoverOrder[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(lt(orders.businessDate, today), inArray(orders.status, ["pending", "brewing", "ready"])),
    )
    .orderBy(asc(orders.businessDate), asc(orders.orderNumber));

  if (rows.length === 0) return [];

  const orderIds = rows.map((o) => o.id);
  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

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
    list.push({
      id: it.id,
      menuItemId: it.menuItemId,
      name: menuNameById.get(it.menuItemId) ?? "(削除済み)",
      quantity: it.quantity,
    });
    itemsByOrderId.set(it.orderId, list);
  }

  return rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status as HistoryOrder["status"],
    isFree: o.isFree === 1,
    createdAt: parseJstString(o.createdAt),
    businessDate: o.businessDate,
    items: itemsByOrderId.get(o.id) ?? [],
  }));
}
