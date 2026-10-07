import type { Route } from "./+types/leftover-orders";
import { createDb } from "~/lib/db";
import { getLeftoverOrders } from "~/features/order/history-queries";
import { getBusinessDate } from "~/lib/order-do";

export async function loader({ request: _request, context }: Route.LoaderArgs) {
  // TODO: スタッフ認証を実装する。リソースルートは _cashier レイアウトの loader を経由しないため、
  // ここでも個別に確認する（app/routes.ts のコメント参照）。
  // const isStaff = await verifyStaffSession(request);
  // if (!isStaff) throw data(null, { status: 401 });
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
