import type { Route } from "./+types/orders-history";
import { createDb } from "~/lib/db";
import { getRecentOrders } from "~/features/order/history-queries";

const PAGE_SIZE = 10;

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const cursorCreatedAt = url.searchParams.get("cursorCreatedAt");
  const cursorId = url.searchParams.get("cursorId");

  const cursor = cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : null;

  const db = createDb(context.cloudflare.env.DB);
  const page = await getRecentOrders(db, { limit: PAGE_SIZE, cursor });

  return {
    orders: page.orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      // Date は JSON.stringify されると ISO 文字列になるため、ハイドレーション後に new Date() で復元する
      createdAt: o.createdAt.toISOString(),
      items: o.items,
    })),
    nextCursor: page.nextCursor,
  };
}
