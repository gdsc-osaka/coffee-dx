import type { ItemProgress } from "../../features/brew-queue/allocation";

type UnservedSourceOrder = {
  id: string;
  orderNumber: number;
  status: string;
  createdAt: string;
  items: Array<{
    id: string;
    menuItemId: string;
    quantity: number;
    name?: string;
    fulfillmentTypeAtOrder?: "brew" | "direct";
  }>;
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
 * 「未提供の注文」。pending / brewing の注文のうち、完成していない brew 品目が 1 杯でもあるものを
 * 古い順に返す（全杯完成した注文は「提供待ち」に出るので含めない）。
 * 完成・抽出中の杯数は allocateOrderNumbers の予測を使う（レーンの注文番号表示と一致させるため）。
 */
export function getUnservedOrders(
  orders: UnservedSourceOrder[],
  progressByItemId: Record<string, ItemProgress>,
  nameOf: (menuItemId: string) => string,
): UnservedOrder[] {
  return orders
    .filter((o) => o.status === "pending" || o.status === "brewing")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.orderNumber - b.orderNumber)
    .map((o): UnservedOrder => {
      const items = o.items.map((item) => {
        const isDirect = item.fulfillmentTypeAtOrder === "direct";
        const progress = isDirect ? undefined : progressByItemId[item.id];
        const readyCount = Math.min(item.quantity, progress?.ready ?? 0);
        const brewingCount = Math.min(item.quantity - readyCount, progress?.brewing ?? 0);
        return {
          id: item.id,
          name: item.name ?? nameOf(item.menuItemId),
          quantity: item.quantity,
          fulfillmentTypeAtOrder: isDirect ? ("direct" as const) : ("brew" as const),
          readyCount: isDirect ? item.quantity : readyCount,
          brewingCount: isDirect ? 0 : brewingCount,
          pendingCount: isDirect ? 0 : item.quantity - readyCount - brewingCount,
        };
      });
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: items.some((i) => i.brewingCount > 0) ? "brewing" : "pending",
        items,
      };
    })
    .filter((o) =>
      o.items.some((i) => i.fulfillmentTypeAtOrder === "brew" && i.readyCount < i.quantity),
    );
}
