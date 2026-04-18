import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "~/lib/order-do";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type CashierOrderItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

type CashierOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: CashierOrderItem[];
};

type ServerMessage =
  | { type: "SNAPSHOT"; orders: CashierOrder[] }
  | { type: "ORDER_CREATED"; order: CashierOrder }
  | { type: "ORDER_UPDATED"; orderId: string; status: OrderStatus };

export async function loader() {
  return {
    eventId: getBusinessDate(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const orderId = formData.get("orderId");
  const eventId = formData.get("eventId");

  if (typeof orderId !== "string" || orderId.length === 0) {
    return { ok: false, error: "orderId が不正です" };
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return { ok: false, error: "eventId が不正です" };
  }

  try {
    const stub = getOrderDOStub(context.cloudflare.env, eventId);
    await callOrderDO(stub, `/do/orders/${encodeURIComponent(orderId)}/close`);
    return { ok: true, orderId };
  } catch {
    return {
      ok: false,
      error: "提供済みの更新に失敗しました。少し待って再度お試しください。",
    };
  }
}

export default function CashierHome({ loaderData }: Route.ComponentProps) {
  const { eventId } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [ordersById, setOrdersById] = useState<Record<string, CashierOrder>>({});
  const [isSnapshotLoaded, setIsSnapshotLoaded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const reconnectTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws?eventId=${eventId}`);

      socket.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
        setConnectionError(null);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "SNAPSHOT") {
            const next: Record<string, CashierOrder> = {};
            for (const order of message.orders) {
              next[order.id] = order;
            }
            setOrdersById(next);
            setIsSnapshotLoaded(true);
            return;
          }

          if (message.type === "ORDER_CREATED") {
            setOrdersById((prev) => ({ ...prev, [message.order.id]: message.order }));
            return;
          }

          if (message.type === "ORDER_UPDATED") {
            setOrdersById((prev) => {
              const existing = prev[message.orderId];
              if (!existing) return prev;

              if (message.status === "completed" || message.status === "cancelled") {
                const { [message.orderId]: _removed, ...rest } = prev;
                return rest;
              }

              return {
                ...prev,
                [message.orderId]: {
                  ...existing,
                  status: message.status,
                },
              };
            });
          }
        } catch {
          setConnectionError("メッセージ受信時にエラーが発生しました");
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
        retryCountRef.current += 1;
        reconnectTimeoutRef.current = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        setConnectionError("接続エラー。自動で再接続します。");
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [eventId]);

  const allOrders = useMemo(
    () => Object.values(ordersById).sort((a, b) => a.orderNumber - b.orderNumber),
    [ordersById],
  );
  const activeOrders = useMemo(
    () =>
      allOrders.filter(
        (order) =>
          order.status === "pending" || order.status === "brewing" || order.status === "ready",
      ),
    [allOrders],
  );
  const readyOrders = useMemo(
    () => allOrders.filter((order) => order.status === "ready"),
    [allOrders],
  );

  const submittingOrderId =
    navigation.state === "submitting" ? navigation.formData?.get("orderId") : null;

  return (
    <div className="container mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">会計係 - 商品受け渡し</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>接続:</span>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? "オンライン" : "再接続中"}
          </Badge>
          <span>受け渡し待ち:</span>
          <Badge variant="secondary">{readyOrders.length}</Badge>
        </div>
      </header>

      {!isSnapshotLoaded ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            注文スナップショットを取得中...
          </CardContent>
        </Card>
      ) : activeOrders.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            進行中の注文はありません
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeOrders.map((order) => {
            const isSubmittingThisOrder = submittingOrderId === order.id;
            const canComplete = order.status === "ready";
            const statusLabel =
              order.status === "pending"
                ? "作成待ち"
                : order.status === "brewing"
                  ? "ドリップ中"
                  : "提供待ち";

            return (
              <Card key={order.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-xl">#{order.orderNumber}</span>
                    <Badge variant={canComplete ? "default" : "secondary"}>{statusLabel}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{order.createdAt}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between text-sm">
                        <span>{item.name ?? item.menuItemId}</span>
                        <span className="text-muted-foreground">×{item.quantity}</span>
                      </li>
                    ))}
                  </ul>

                  <Form method="post" className="space-y-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isSubmittingThisOrder || !canComplete}
                    >
                      {isSubmittingThisOrder ? "更新中..." : "商品を渡して提供済みにする"}
                    </Button>
                    {!canComplete && (
                      <p className="text-xs text-muted-foreground text-center">
                        ドリップ完了後に提供できます
                      </p>
                    )}
                  </Form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {actionData && !actionData.ok && <p className="text-sm text-red-600">{actionData.error}</p>}

      {connectionError && <p className="text-sm text-red-600">{connectionError}</p>}
    </div>
  );
}
