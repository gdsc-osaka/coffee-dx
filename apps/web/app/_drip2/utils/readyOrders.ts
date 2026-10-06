type ReadyOrderSourceOrder = {
  id: string;
  orderNumber: number;
  status: string;
  createdAt: string;
  items: Array<{ id: string; menuItemId: string; quantity: number; name?: string }>;
};

type ReadyOrderSourceUnit = {
  orderItemId: string | null;
  status: "brewing" | "ready";
};

export type ReadyOrder = {
  id: string;
  orderNumber: number;
  createdAt: string;
  /** OrderDO/D1 上の実ステータス。/close は "ready" のときだけ成功する */
  serverStatus: string;
  items: Array<{ id: string; name?: string; quantity: number; readyCount: number }>;
};

/**
 * 会計係画面の「提供待ち」と同じ基準で注文を抽出する（注文番号順）。
 * - サーバー上で ready の注文
 * - または全品目に、紐付き済みの完成品が必要杯数そろっている注文
 */
export function getReadyOrders(
  orders: ReadyOrderSourceOrder[],
  brewUnits: ReadyOrderSourceUnit[],
): ReadyOrder[] {
  const readyByItem = new Map<string, number>();
  for (const u of brewUnits) {
    if (u.status === "ready" && u.orderItemId !== null) {
      readyByItem.set(u.orderItemId, (readyByItem.get(u.orderItemId) ?? 0) + 1);
    }
  }

  return orders
    .filter((o) => o.status !== "completed" && o.status !== "cancelled")
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      serverStatus: o.status,
      items: o.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        readyCount: Math.min(item.quantity, readyByItem.get(item.id) ?? 0),
      })),
    }))
    .filter(
      (o) =>
        o.serverStatus === "ready" || o.items.every((item) => item.readyCount >= item.quantity),
    )
    .sort((a, b) => a.orderNumber - b.orderNumber);
}
