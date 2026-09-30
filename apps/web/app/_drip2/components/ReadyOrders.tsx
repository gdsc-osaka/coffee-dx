import { OrderStatusCard } from "~/components/order-status-card";
import type { ReadyOrder } from "../utils/readyOrders";

/**
 * 「提供待ち」。会計係画面の「提供待ち」と同じカードを横に並べ、
 * 「完了」「注文をキャンセル」をドリップ係からも操作できるようにする。
 */
export function ReadyOrders({
  orders,
  eventId,
  submittingOrderId,
  submittingIntent,
}: {
  orders: ReadyOrder[];
  eventId: string;
  submittingOrderId: string | null;
  submittingIntent: string | null;
}) {
  return (
    <section aria-label="提供待ち" className="px-4 sm:px-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <h2 className="text-lg font-bold text-stone-700">提供待ち</h2>
        <span className="text-xs bg-emerald-50 text-emerald-600 px-2.5 py-0.5 rounded-full font-medium">
          {orders.length}
        </span>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-stone-400">提供待ちの注文はありません</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
          {orders.map((order) => {
            const isThisOrder = submittingOrderId === order.id;
            // サーバー上でまだ ready でない注文は /close が 409 になるため、会計係画面と同じくボタンを出さない
            const canClose = order.serverStatus === "ready";
            return (
              <OrderStatusCard
                key={order.id}
                status="ready"
                orderNumber={order.orderNumber}
                createdAt={order.createdAt}
                itemCount={order.items.reduce((sum, item) => sum + item.quantity, 0)}
                items={order.items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  quantity: item.quantity,
                  readyCount: item.readyCount,
                  brewingCount: 0,
                  pendingCount: Math.max(0, item.quantity - item.readyCount),
                }))}
                action={
                  canClose
                    ? {
                        label: "完了",
                        isSubmitting: isThisOrder && submittingIntent === "order-close",
                        fields: [
                          { name: "intent", value: "order-close" },
                          { name: "orderId", value: order.id },
                          { name: "eventId", value: eventId },
                        ],
                      }
                    : undefined
                }
                actionPlaceholder={canClose ? undefined : "ドリップ完了後に提供できます"}
                cancelAction={{
                  isSubmitting: isThisOrder && submittingIntent === "order-cancel",
                  fields: [
                    { name: "intent", value: "order-cancel" },
                    { name: "orderId", value: order.id },
                    { name: "eventId", value: eventId },
                  ],
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
