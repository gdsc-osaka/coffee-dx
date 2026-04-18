import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "~/lib/order-do";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type DripOrderItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

type DripOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: DripOrderItem[];
};

type ServerMessage =
  | { type: "SNAPSHOT"; orders: DripOrder[] }
  | { type: "ORDER_CREATED"; order: DripOrder }
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
  const intent = formData.get("intent");

  if (typeof orderId !== "string" || orderId.length === 0) {
    return { ok: false, error: "orderId が不正です" };
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return { ok: false, error: "eventId が不正です" };
  }
  if (intent !== "start" && intent !== "complete-brew") {
    return { ok: false, error: "intent が不正です" };
  }

  try {
    const stub = getOrderDOStub(context.cloudflare.env, eventId);
    await callOrderDO(stub, `/do/orders/${encodeURIComponent(orderId)}/${intent}`);
    return { ok: true, orderId, intent };
  } catch {
    return {
      ok: false,
      error: "注文ステータスの更新に失敗しました。少し待って再度お試しください。",
    };
  }
}

type DripHomeProps = {
  loaderData: {
    eventId: string;
  };
};

const statusLabel: Record<Exclude<OrderStatus, "ready" | "completed" | "cancelled">, string> = {
  pending: "未着手",
  brewing: "ドリップ中",
};

export default function DripHome({ loaderData }: DripHomeProps) {
  const { eventId } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [ordersById, setOrdersById] = useState<Record<string, DripOrder>>({});
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
            const next: Record<string, DripOrder> = {};
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

              if (
                message.status === "ready" ||
                message.status === "completed" ||
                message.status === "cancelled"
              ) {
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
  const pendingOrders = useMemo(
    () => allOrders.filter((order) => order.status === "pending"),
    [allOrders],
  );
  const brewingOrders = useMemo(
    () => allOrders.filter((order) => order.status === "brewing"),
    [allOrders],
  );

  const submittingOrderId = (() => {
    if (navigation.state !== "submitting") return null;
    const value = navigation.formData?.get("orderId");
    return typeof value === "string" ? value : null;
  })();
  const submittingIntent = (() => {
    if (navigation.state !== "submitting") return null;
    const value = navigation.formData?.get("intent");
    return typeof value === "string" ? value : null;
  })();

  return (
    <div className="container mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">ドリップ係 - 注文管理</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>接続:</span>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? "オンライン" : "再接続中"}
          </Badge>
          <span>未着手:</span>
          <Badge variant="secondary">{pendingOrders.length}</Badge>
          <span>ドリップ中:</span>
          <Badge variant="default">{brewingOrders.length}</Badge>
        </div>
      </header>

      {!isSnapshotLoaded ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            注文スナップショットを取得中...
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                未着手 <Badge variant="secondary">{pendingOrders.length}</Badge>
              </h2>
            </div>
            {pendingOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">未着手の注文はありません</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pendingOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    submitLabel="作成開始"
                    submitIntent="start"
                    submittingOrderId={submittingOrderId}
                    submittingIntent={submittingIntent}
                    eventId={eventId}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                ドリップ中 <Badge variant="default">{brewingOrders.length}</Badge>
              </h2>
            </div>
            {brewingOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">ドリップ中の注文はありません</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {brewingOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    submitLabel="完成にする"
                    submitIntent="complete-brew"
                    submittingOrderId={submittingOrderId}
                    submittingIntent={submittingIntent}
                    eventId={eventId}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {actionData && !actionData.ok && <p className="text-sm text-red-600">{actionData.error}</p>}

      {connectionError && <p className="text-sm text-red-600">{connectionError}</p>}
    </div>
  );
}

function OrderCard({
  order,
  submitLabel,
  submitIntent,
  submittingOrderId,
  submittingIntent,
  eventId,
}: {
  order: DripOrder;
  submitLabel: string;
  submitIntent: "start" | "complete-brew";
  submittingOrderId: string | null;
  submittingIntent: string | null;
  eventId: string;
}) {
  const isSubmittingThisOrder = submittingOrderId === order.id && submittingIntent === submitIntent;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="text-xl">#{order.orderNumber}</span>
          <Badge variant={order.status === "brewing" ? "default" : "secondary"}>
            {statusLabel[order.status as keyof typeof statusLabel] ?? order.status}
          </Badge>
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
          <input type="hidden" name="intent" value={submitIntent} />
          <Button type="submit" className="w-full" disabled={isSubmittingThisOrder}>
            {isSubmittingThisOrder ? "更新中..." : submitLabel}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
