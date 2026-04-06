import { eq } from "drizzle-orm";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import { createDb } from "../../db/client";
import { menuItems, orderItems, orders } from "../../db/schema";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

const statusLabel: Record<string, string> = {
  pending: "未着手",
  brewing: "ドリップ中",
};

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.cloudflare as { env: { DB: D1Database } };
  const db = createDb(env.DB);

  const pendingOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      createdAt: orders.createdAt,
      itemId: orderItems.id,
      menuItemName: menuItems.name,
      quantity: orderItems.quantity,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(
      eq(orders.status, "pending"),
    )
    .orderBy(orders.createdAt);

  const brewingOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      createdAt: orders.createdAt,
      itemId: orderItems.id,
      menuItemName: menuItems.name,
      quantity: orderItems.quantity,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(
      eq(orders.status, "brewing"),
    )
    .orderBy(orders.createdAt);

  const groupByOrder = (
    rows: typeof pendingOrders,
  ) => {
    const map = new Map<
      string,
      {
        id: string;
        orderNumber: number;
        status: string;
        createdAt: string;
        items: { name: string; quantity: number }[];
      }
    >();
    for (const row of rows) {
      let order = map.get(row.id);
      if (!order) {
        order = {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
          createdAt: row.createdAt,
          items: [],
        };
        map.set(row.id, order);
      }
      order.items.push({ name: row.menuItemName, quantity: row.quantity });
    }
    return [...map.values()];
  };

  return {
    pending: groupByOrder(pendingOrders),
    brewing: groupByOrder(brewingOrders),
  };
}

export default function DripHome() {
  const { pending, brewing } = useLoaderData<typeof loader>();

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">ドリップ係 - 注文一覧</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          ドリップ中{" "}
          <Badge variant="default">{brewing.length}</Badge>
        </h2>
        {brewing.length === 0 ? (
          <p className="text-muted-foreground">ドリップ中の注文はありません</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brewing.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          未着手{" "}
          <Badge variant="secondary">{pending.length}</Badge>
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground">未着手の注文はありません</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderCard({
  order,
}: {
  order: {
    id: string;
    orderNumber: number;
    status: string;
    createdAt: string;
    items: { name: string; quantity: number }[];
  };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="text-xl">#{order.orderNumber}</span>
          <Badge
            variant={order.status === "brewing" ? "default" : "secondary"}
          >
            {statusLabel[order.status] ?? order.status}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{order.createdAt}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between text-sm">
              <span>{item.name}</span>
              <span className="text-muted-foreground">×{item.quantity}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
