import type { QueueEntry, QueueOrder } from "./queue";

/**
 * 抽出中バッチ・抽出の提案が「どの注文の分か」の予測。
 *
 * brew_units は抽出完了時に初めて注文へ紐付く（遅延バインディング）。完了時は
 * 同じメニューの未紐付き完成品を createdAt 順に、古い注文から割り当てる（OrderDO の complete 処理）。
 * ここでは同じ規則で、
 *   1. 紐付き済みの完成品を差し引き
 *   2. 未紐付きの完成品（余り）
 *   3. 抽出中バッチ（開始が早い順）
 *   4. 抽出の提案（キューの並び順）
 * の順に古い注文から割り当てて表示用の番号を出す。完了順が前後したり注文が取り消されたりすると
 * 実際の紐付けとはずれることがある（あくまで予測表示）。
 *
 * DB や OrderDO に依存しない純粋関数（workerd のテストからも読めるよう相対 import のみ）。
 */

export type AllocationOrder = QueueOrder;

export type AllocationBrewUnit = {
  batchId: string;
  menuItemId: string;
  orderItemId: string | null;
  status: "brewing" | "ready";
  createdAt: string;
};

export type OrderAllocation = { orderNumber: number; count: number };

/** 1 バッチ（または提案 1 枠）分の割り当て。orders は古い注文順 */
export type BatchAllocation = { orders: OrderAllocation[]; surplus: number };

export type OrderNumberAllocations = {
  /** 抽出中バッチ ID → 割り当て */
  byBatchId: Record<string, BatchAllocation>;
  /** 提案（キューエントリー）ID → 割り当て */
  byQueueEntryId: Record<string, BatchAllocation>;
};

type Row = { orderNumber: number; menuItemId: string; remaining: number };

function compareOrders(a: AllocationOrder, b: AllocationOrder): number {
  return a.createdAt.localeCompare(b.createdAt) || a.orderNumber - b.orderNumber;
}

/** rows を古い順にたどって menuItemId の杯を count 杯まで割り当てる */
function take(rows: Row[], menuItemId: string, count: number): BatchAllocation {
  const orders: OrderAllocation[] = [];
  let left = count;
  for (const row of rows) {
    if (left <= 0) break;
    if (row.menuItemId !== menuItemId || row.remaining <= 0) continue;
    const n = Math.min(left, row.remaining);
    row.remaining -= n;
    left -= n;
    const last = orders[orders.length - 1];
    if (last && last.orderNumber === row.orderNumber) last.count += n;
    else orders.push({ orderNumber: row.orderNumber, count: n });
  }
  return { orders, surplus: left };
}

export function allocateOrderNumbers({
  orders,
  brewUnits,
  queue,
}: {
  orders: AllocationOrder[];
  brewUnits: AllocationBrewUnit[];
  queue: QueueEntry[];
}): OrderNumberAllocations {
  const linkedReady = new Map<string, number>();
  for (const u of brewUnits) {
    if (u.orderItemId !== null && u.status === "ready") {
      linkedReady.set(u.orderItemId, (linkedReady.get(u.orderItemId) ?? 0) + 1);
    }
  }

  // OrderDO の完了処理と同じく、pending / brewing の注文だけを割り当て対象にする
  const rows: Row[] = orders
    .filter((o) => o.status === "pending" || o.status === "brewing")
    .sort(compareOrders)
    .flatMap((o) =>
      o.items
        .filter((item) => item.fulfillmentTypeAtOrder !== "direct")
        .map((item) => ({
          orderNumber: o.orderNumber,
          menuItemId: item.menuItemId,
          remaining: Math.max(0, item.quantity - (linkedReady.get(item.id) ?? 0)),
        })),
    );

  // 未紐付きの完成品は次の完了時に先に割り当てられるので、先に差し引く（表示はしない）
  const readyUnlinked = new Map<string, number>();
  for (const u of brewUnits) {
    if (u.orderItemId === null && u.status === "ready") {
      readyUnlinked.set(u.menuItemId, (readyUnlinked.get(u.menuItemId) ?? 0) + 1);
    }
  }
  for (const [menuItemId, n] of readyUnlinked) take(rows, menuItemId, n);

  // 抽出中バッチを開始が早い順に
  const batches = new Map<string, { menuItemId: string; createdAt: string; count: number }>();
  for (const u of brewUnits) {
    if (u.status !== "brewing") continue;
    const b = batches.get(u.batchId);
    if (b) b.count += 1;
    else batches.set(u.batchId, { menuItemId: u.menuItemId, createdAt: u.createdAt, count: 1 });
  }
  const byBatchId: Record<string, BatchAllocation> = {};
  const sortedBatches = [...batches.entries()].sort(
    ([idA, a], [idB, b]) => a.createdAt.localeCompare(b.createdAt) || idA.localeCompare(idB),
  );
  for (const [batchId, b] of sortedBatches) {
    byBatchId[batchId] = take(rows, b.menuItemId, b.count);
  }

  const byQueueEntryId: Record<string, BatchAllocation> = {};
  for (const e of queue) {
    byQueueEntryId[e.id] = take(rows, e.menuItemId, e.count);
  }

  return { byBatchId, byQueueEntryId };
}
