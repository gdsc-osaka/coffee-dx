import { useEffect, useMemo, useRef, useState } from "react";
import { useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { OrderStatusCard } from "~/components/order-status-card";
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

export async function loader(_args: Route.LoaderArgs) {
  return { eventId: getBusinessDate() };
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

export default function CashierHome({ loaderData }: { loaderData: { eventId: string } }) {
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
            for (const order of message.orders) next[order.id] = order;
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
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      if (socket) socket.close();
    };
  }, [eventId]);

  const allOrders = useMemo(
    () => Object.values(ordersById).sort((a, b) => a.orderNumber - b.orderNumber),
    [ordersById],
  );
  const brewingOrders = useMemo(
    () => allOrders.filter((order) => order.status === "brewing"),
    [allOrders],
  );
  const readyOrders = useMemo(
    () => allOrders.filter((order) => order.status === "ready"),
    [allOrders],
  );

  const submittingOrderId =
    navigation.state === "submitting" ? navigation.formData?.get("orderId") : null;

  const isEmpty = isSnapshotLoaded && brewingOrders.length === 0 && readyOrders.length === 0;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 shrink-0">
        <div className="px-12 py-3.5 flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-stone-800 leading-tight">会計係</h1>
            <p className="text-xs text-stone-400 mt-0.5">受け渡し管理</p>
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
            {/* 提供待ち */}
            <section className="px-6">
              <div className="flex items-center gap-2 px-6 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-lg font-bold text-stone-700">提供待ち</h2>
                <span className="text-xs bg-emerald-50 text-emerald-600 px-6 py-0.5 rounded-full font-medium">
                  {readyOrders.length}
                </span>
              </div>
              {readyOrders.length === 0 ? (
                <p className="px-6 text-sm text-stone-400">提供待ちの注文はありません</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-pl-6">
                  <div className="w-6 shrink-0" />
                  {readyOrders.map((order) => {
                    const isSubmittingThisOrder = submittingOrderId === order.id;
                    return (
                      <OrderStatusCard
                        key={order.id}
                        status="ready"
                        orderNumber={order.orderNumber}
                        createdAt={order.createdAt}
                        itemCount={order.items.length}
                        items={order.items.map((item) => ({
                          id: item.id,
                          name: item.name,
                          quantity: item.quantity,
                        }))}
                        action={{
                          label: "完了",
                          isSubmitting: isSubmittingThisOrder,
                          fields: [
                            { name: "orderId", value: order.id },
                            { name: "eventId", value: eventId },
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
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
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
                  {brewingOrders.map((order) => (
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
                    />
                  ))}
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
