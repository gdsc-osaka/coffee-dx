import { useEffect, useMemo, useRef, useState } from "react";
import { useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { OrderStatusCard } from "~/components/order-status-card";
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

export default function DripHome({ loaderData }: { loaderData: { eventId: string } }) {
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
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      if (socket) socket.close();
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

  const submittingOrderId =
    navigation.state === "submitting" ? navigation.formData?.get("orderId") : null;
  const submittingIntent =
    navigation.state === "submitting" ? navigation.formData?.get("intent") : null;

  const isEmpty = isSnapshotLoaded && pendingOrders.length === 0 && brewingOrders.length === 0;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 shrink-0">
        <div className="px-12 py-3.5 flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-stone-800 leading-tight">ドリップ係</h1>
            <p className="text-xs text-stone-400 mt-0.5">注文管理</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-stone-400">
              <span
                className={
                  isConnected
                    ? "w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
                    : "w-1.5 h-1.5 rounded-full bg-stone-300"
                }
              />
              {isConnected ? "接続中" : "再接続中"}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 py-5 space-y-6">
        {!isSnapshotLoaded ? (
          <p className="px-6 text-sm text-stone-400 animate-pulse">読み込み中...</p>
        ) : isEmpty ? (
          <p className="px-6 text-sm text-stone-400">進行中の注文はありません</p>
        ) : (
          <>
            {/* 未着手 */}
            <section className="px-6">
              <div className="flex items-center gap-2 px-6 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <h2 className="text-lg font-bold text-stone-700">未着手</h2>
                <span className="text-xs bg-amber-50 text-amber-600 px-6 py-0.5 rounded-full font-medium">
                  {pendingOrders.length}
                </span>
              </div>
              {pendingOrders.length === 0 ? (
                <p className="px-6 text-sm text-stone-400">未着手の注文はありません</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-pl-6">
                  <div className="w-6 shrink-0" />
                  {pendingOrders.map((order) => {
                    const isSubmittingThisOrder =
                      submittingOrderId === order.id && submittingIntent === "start";
                    return (
                      <OrderStatusCard
                        key={order.id}
                        status="pending"
                        orderNumber={order.orderNumber}
                        createdAt={order.createdAt}
                        itemCount={order.items.length}
                        items={order.items.map((item) => ({
                          id: item.id,
                          name: item.name,
                          quantity: item.quantity,
                        }))}
                        action={{
                          label: "開始",
                          isSubmitting: isSubmittingThisOrder,
                          fields: [
                            { name: "orderId", value: order.id },
                            { name: "eventId", value: eventId },
                            { name: "intent", value: "start" },
                          ],
                        }}
                      />
                    );
                  })}
                  <div className="w-6 shrink-0" />
                </div>
              )}
            </section>

            {/* ドリップ中 */}
            <section className="px-6">
              <div className="flex items-center gap-2 px-6 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                <h2 className="text-lg font-bold text-stone-700">ドリップ中</h2>
                <span className="text-xs bg-orange-50 text-orange-600 px-6 py-0.5 rounded-full font-medium">
                  {brewingOrders.length}
                </span>
              </div>
              {brewingOrders.length === 0 ? (
                <p className="px-6 text-sm text-stone-400">ドリップ中の注文はありません</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-pl-6">
                  <div className="w-6 shrink-0" />
                  {brewingOrders.map((order) => {
                    const isSubmittingThisOrder =
                      submittingOrderId === order.id && submittingIntent === "complete-brew";
                    return (
                      <OrderStatusCard
                        key={order.id}
                        status="brewing"
                        orderNumber={order.orderNumber}
                        createdAt={order.createdAt}
                        itemCount={order.items.length}
                        items={order.items.map((item) => ({
                          id: item.id,
                          name: item.name,
                          quantity: item.quantity,
                        }))}
                        action={{
                          label: "完成",
                          isSubmitting: isSubmittingThisOrder,
                          fields: [
                            { name: "orderId", value: order.id },
                            { name: "eventId", value: eventId },
                            { name: "intent", value: "complete-brew" },
                          ],
                        }}
                      />
                    );
                  })}
                  <div className="w-6 shrink-0" />
                </div>
              )}
            </section>
          </>
        )}

        {actionData && !actionData.ok && (
          <p className="px-6 text-xs text-red-500">{actionData.error}</p>
        )}
        {connectionError && <p className="px-6 text-xs text-red-500">{connectionError}</p>}
      </div>
    </div>
  );
}
