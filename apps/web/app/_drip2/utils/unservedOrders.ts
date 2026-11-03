import type { ItemProgress } from "../../features/brew-queue/allocation";
import type { QueueOrder } from "../../features/brew-queue/queue";

type UnservedSourceOrder = Omit<QueueOrder, "items"> & {
  items: Array<QueueOrder["items"][number] & { name?: string }>;
};

export type UnservedOrder = {
  id: string;
  orderNumber: number;
  createdAt: string;
  /** 1 杯でも抽出中なら "brewing"、それ以外は "pending" */
  status: "pending" | "brewing";
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    fulfillmentTypeAtOrder: "brew" | "direct";
    readyCount: number;
    brewingCount: number;
    pendingCount: number;
  }>;
};

/**
 * 「未提供の注文」。完了・キャンセル以外の注文のうち「提供待ち」に入らないものを古い順に返す。
 * 「提供待ち」の補集合として決めるので、どの注文も必ずどちらか一方の欄に出る。
 * 完成は紐付き済みの杯、抽出中は allocateOrderNumbers の予測（レーンの注文番号表示と一致）。
 */
export function getUnservedOrders(
  orders: UnservedSourceOrder[],
  readyOrderIds: ReadonlySet<string>,
  progressByItemId: Record<string, ItemProgress>,
  nameOf: (menuItemId: string) => string,
): UnservedOrder[] {
  return orders
    .filter((o) => o.status !== "completed" && o.status !== "cancelled")
    .filter((o) => !readyOrderIds.has(o.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.orderNumber - b.orderNumber)
    .map((o): UnservedOrder => {
      const items = o.items.map((item) => {
        const base = {
          id: item.id,
          name: item.name ?? nameOf(item.menuItemId),
          quantity: item.quantity,
        };
        if (item.fulfillmentTypeAtOrder === "direct") {
          // direct 品目は会計時に受け渡し済み（カードでは「受渡済」と表示される）
          return {
            ...base,
            fulfillmentTypeAtOrder: "direct" as const,
            readyCount: item.quantity,
            brewingCount: 0,
            pendingCount: 0,
          };
        }
        const progress = progressByItemId[item.id];
        const readyCount = Math.min(item.quantity, progress?.ready ?? 0);
        const brewingCount = Math.min(item.quantity - readyCount, progress?.brewing ?? 0);
        return {
          ...base,
          fulfillmentTypeAtOrder: "brew" as const,
          readyCount,
          brewingCount,
          pendingCount: item.quantity - readyCount - brewingCount,
        };
      });
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: items.some((i) => i.brewingCount > 0) ? "brewing" : "pending",
        items,
      };
    });
}
