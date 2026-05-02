import { data } from "react-router";
import type { Route } from "./+types/orders-history";
import { createDb } from "~/lib/db";
import { getRecentOrders } from "~/features/order/history-queries";

const PAGE_SIZE = 10;

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const cursorCreatedAt = url.searchParams.get("cursorCreatedAt");
  const cursorId = url.searchParams.get("cursorId");

  // (createdAt, id) は cursor pagination の境界条件にペアで使うため、片方だけ来た場合は
  // ページがスキップされ得るバグ呼び込みになる。境界が曖昧なリクエストは 400 で弾く。
  const hasCreatedAt = cursorCreatedAt !== null;
  const hasId = cursorId !== null;
  if (hasCreatedAt !== hasId) {
    throw data(
      { error: "cursorCreatedAt と cursorId はセットで指定してください" },
      { status: 400 },
    );
  }

  const cursor = hasCreatedAt && hasId ? { createdAt: cursorCreatedAt!, id: cursorId! } : null;

  const db = createDb(context.cloudflare.env.DB);
  const page = await getRecentOrders(db, { limit: PAGE_SIZE, cursor });

  return {
    orders: page.orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      isFree: o.isFree,
      // Date は JSON.stringify されると ISO 文字列になるため、ハイドレーション後に new Date() で復元する
      createdAt: o.createdAt.toISOString(),
      items: o.items,
    })),
    nextCursor: page.nextCursor,
  };
}
