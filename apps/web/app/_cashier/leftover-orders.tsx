import type { Route } from "./+types/leftover-orders";
import { createDb } from "~/lib/db";
import { getLeftoverOrders } from "~/features/order/history-queries";
import { getBusinessDate } from "~/lib/order-do";
import { requireApiStaff } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireApiStaff(request, context.cloudflare.env);
  const db = createDb(context.cloudflare.env.DB);
  const today = getBusinessDate();
  const orders = await getLeftoverOrders(db, today);

  return {
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      isFree: o.isFree,
      businessDate: o.businessDate,
      // Date は JSON 化で ISO 文字列になるので、クライアントで new Date() 復元する
      createdAt: o.createdAt.toISOString(),
      items: o.items,
    })),
  };
}
