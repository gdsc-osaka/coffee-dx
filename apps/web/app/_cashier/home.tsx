import { eq, inArray } from "drizzle-orm";
import { CheckCircle, Coffee } from "lucide-react";
import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { createDb } from "../../db/client";
import { menuItems, orderItems, orders } from "../../db/schema";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "~/lib/order-do";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.cloudflare as { env: { DB: D1Database } };
  const db = createDb(env.DB);

  const readyOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      createdAt: orders.createdAt,
      itemId: orderItems.id,
      menuItemId: orderItems.menuItemId,
      menuItemName: menuItems.name,
      menuItemPrice: menuItems.price,
      quantity: orderItems.quantity,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .where(inArray(orders.status, ["ready"]))
    .orderBy(orders.createdAt);

  const map = new Map<
    string,
    {
      id: string;
      orderNumber: number;
      status: string;
      createdAt: string;
      items: { menuItemId: string; name: string; price: number; quantity: number }[];
    }
  >();

  for (const row of readyOrders) {
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
    order.items.push({
      menuItemId: row.menuItemId,
      name: row.menuItemName,
      price: row.menuItemPrice,
      quantity: row.quantity,
    });
  }

  return { orders: [...map.values()] };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare as { env: Env };
  const formData = await request.formData();
  const orderId = formData.get("orderId");
  if (!orderId || typeof orderId !== "string") {
    return { error: "注文IDが不正です" };
  }

  const eventId = getBusinessDate();
  const stub = getOrderDOStub(env, eventId);

  try {
    await callOrderDO(stub, `/do/orders/${orderId}/close`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "エラーが発生しました";
    return { error: message };
  }

  return { success: true, orderId };
}

export default function CashierHome({ loaderData }: Route.ComponentProps) {
  const { orders: readyOrders } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-stone-900 px-4 py-8">
        <div className="flex items-center gap-3">
          <Coffee className="size-6 text-white" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">会計係</h1>
            <p className="text-stone-400 text-xs mt-0.5 tracking-widest uppercase">Cashier</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-stone-700">確定待ち</h2>
          <Badge variant="default">{readyOrders.length}</Badge>
        </div>

        {actionData && "error" in actionData && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {actionData.error}
          </div>
        )}

        {readyOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-stone-400">
            <CheckCircle className="size-8" />
            <p className="text-sm">確定待ちの注文はありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {readyOrders.map((order) => {
              const total = order.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
              const isConfirming =
                navigation.state === "submitting" &&
                navigation.formData?.get("orderId") === order.id;

              return (
                <Card key={order.id} className="border-0 rounded-xl shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between">
                      <span className="text-2xl font-black text-stone-900">
                        #{order.orderNumber}
                      </span>
                      <Badge variant="secondary">受取待ち</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="space-y-1">
                      {order.items.map((item) => (
                        <li
                          key={item.menuItemId}
                          className="flex justify-between text-sm text-stone-700"
                        >
                          <span>
                            {item.name} × {item.quantity}
                          </span>
                          <span>¥{(item.price * item.quantity).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-stone-100 pt-2 flex justify-between items-center">
                      <span className="text-sm font-semibold text-stone-700">合計</span>
                      <span className="text-lg font-black text-stone-900">
                        ¥{total.toLocaleString()}
                      </span>
                    </div>
                    <Form method="post">
                      <input type="hidden" name="orderId" value={order.id} />
                      <Button
                        type="submit"
                        className="w-full bg-stone-900 hover:bg-stone-800 text-white rounded-xl"
                        disabled={isConfirming}
                      >
                        {isConfirming ? "処理中..." : "会計確定"}
                      </Button>
                    </Form>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
