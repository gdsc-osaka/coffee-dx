import { OrderStatusCard } from "~/components/order-status-card";
import type { UnservedOrder } from "../utils/unservedOrders";

/**
 * 「未提供の注文」。抽出中・未着手の杯が残っている注文を、会計係画面と同じカードで全件表示する。
 * 完成・抽出中の杯数は予測（抽出完了時に実際の紐付けが決まる）。見るだけの欄で操作は置かない。
 */
export function UnservedOrders({ orders }: { orders: UnservedOrder[] }) {
  return (
    <section aria-label="未提供の注文" className="px-4 sm:px-8 pb-6 sm:pb-8">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-bold text-stone-700">未提供の注文</h2>
        <span className="text-xs bg-stone-100 text-stone-600 px-2.5 py-0.5 rounded-full font-medium">
          {orders.length}
        </span>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-stone-400">未提供の注文はありません</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {orders.map((order) => (
            <OrderStatusCard
              key={order.id}
              status={order.status}
              orderNumber={order.orderNumber}
              createdAt={order.createdAt}
              itemCount={order.items.reduce((sum, item) => sum + item.quantity, 0)}
              items={order.items}
            />
          ))}
        </div>
      )}
    </section>
  );
}
