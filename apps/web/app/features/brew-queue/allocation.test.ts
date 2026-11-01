import { describe, expect, it } from "vitest";
import { allocateOrderNumbers, type AllocationBrewUnit, type AllocationOrder } from "./allocation";
import type { QueueEntry } from "./queue";

const A = "menu-a";
const B = "menu-b";

let seq = 0;
/** time は "HH:MM:SS"。cups は [A の杯数, B の杯数] */
function order(
  time: string,
  [a, b]: [number, number],
  opts: { status?: string; directB?: boolean } = {},
): AllocationOrder {
  seq += 1;
  const items: AllocationOrder["items"] = [];
  if (a > 0) items.push({ id: `item-${seq}-a`, menuItemId: A, quantity: a });
  if (b > 0)
    items.push({
      id: `item-${seq}-b`,
      menuItemId: B,
      quantity: b,
      fulfillmentTypeAtOrder: opts.directB ? "direct" : "brew",
    });
  return {
    id: `order-${seq}`,
    orderNumber: seq,
    status: opts.status ?? "pending",
    createdAt: `2026-09-27 ${time}`,
    items,
  };
}

function batch(
  batchId: string,
  menuItemId: string,
  n: number,
  createdAt: string,
  status: "brewing" | "ready" = "brewing",
  orderItemId: string | null = null,
): AllocationBrewUnit[] {
  return Array.from({ length: n }, () => ({
    batchId,
    menuItemId,
    orderItemId,
    status,
    createdAt: `2026-09-27T${createdAt}Z`,
  }));
}

function entry(id: string, menuItemId: string, count: number): QueueEntry {
  return { id, menuItemId, count };
}

describe("allocateOrderNumbers", () => {
  it("抽出中バッチを古い注文から順に割り当て、注文ごとの杯数をまとめる", () => {
    seq = 0;
    const orders = [order("10:00:00", [2, 0]), order("10:01:00", [2, 0])];
    const result = allocateOrderNumbers({
      orders,
      brewUnits: batch("b1", A, 3, "01:00:00"),
      queue: [],
    });
    expect(result.byBatchId.b1).toEqual({
      orders: [
        { orderNumber: 1, count: 2 },
        { orderNumber: 2, count: 1 },
      ],
      surplus: 0,
    });
  });

  it("どの注文にも当たらない杯は余りになる", () => {
    seq = 0;
    const orders = [order("10:00:00", [1, 0])];
    const result = allocateOrderNumbers({
      orders,
      brewUnits: [...batch("b1", A, 3, "01:00:00"), ...batch("b2", A, 2, "01:01:00")],
      queue: [],
    });
    expect(result.byBatchId.b1).toEqual({ orders: [{ orderNumber: 1, count: 1 }], surplus: 2 });
    expect(result.byBatchId.b2).toEqual({ orders: [], surplus: 2 });
  });

  it("抽出中バッチは開始が早い順に割り当て、その後に提案を割り当てる", () => {
    seq = 0;
    const orders = [order("10:00:00", [2, 1]), order("10:01:00", [3, 0])];
    const result = allocateOrderNumbers({
      orders,
      // 後から始めたバッチを先に並べても開始順で割り当てる
      brewUnits: [...batch("late", A, 2, "01:05:00"), ...batch("early", A, 1, "01:00:00")],
      queue: [entry("q1", A, 2), entry("q2", B, 1)],
    });
    expect(result.byBatchId.early.orders).toEqual([{ orderNumber: 1, count: 1 }]);
    expect(result.byBatchId.late.orders).toEqual([
      { orderNumber: 1, count: 1 },
      { orderNumber: 2, count: 1 },
    ]);
    expect(result.byQueueEntryId.q1).toEqual({
      orders: [{ orderNumber: 2, count: 2 }],
      surplus: 0,
    });
    expect(result.byQueueEntryId.q2).toEqual({
      orders: [{ orderNumber: 1, count: 1 }],
      surplus: 0,
    });
  });

  it("紐付き済みの完成品と未紐付きの完成品を先に差し引く", () => {
    seq = 0;
    const orders = [
      order("10:00:00", [2, 0]),
      order("10:01:00", [1, 0]),
      order("10:02:00", [1, 0]),
    ];
    const result = allocateOrderNumbers({
      orders,
      brewUnits: [
        // 注文1 に 1 杯紐付き済み
        ...batch("done", A, 1, "00:50:00", "ready", "item-1-a"),
        // 未紐付きの完成品 1 杯 → 注文1 の残り 1 杯に充てられる
        ...batch("surplus", A, 1, "00:55:00", "ready"),
        ...batch("b1", A, 2, "01:00:00"),
      ],
      queue: [],
    });
    expect(result.byBatchId.b1.orders).toEqual([
      { orderNumber: 2, count: 1 },
      { orderNumber: 3, count: 1 },
    ]);
    expect(result.byBatchId.done).toBeUndefined();
    expect(result.byBatchId.surplus).toBeUndefined();
  });

  it("pending / brewing 以外の注文と direct 品目は対象外", () => {
    seq = 0;
    const orders = [
      order("10:00:00", [1, 0], { status: "completed" }),
      order("10:01:00", [1, 0], { status: "cancelled" }),
      order("10:01:30", [1, 0], { status: "ready" }),
      order("10:02:00", [0, 1], { directB: true }),
      order("10:03:00", [1, 1], { status: "brewing" }),
    ];
    const result = allocateOrderNumbers({
      orders,
      brewUnits: [...batch("a", A, 1, "01:00:00"), ...batch("b", B, 1, "01:00:00")],
      queue: [],
    });
    expect(result.byBatchId.a.orders).toEqual([{ orderNumber: 5, count: 1 }]);
    expect(result.byBatchId.b.orders).toEqual([{ orderNumber: 5, count: 1 }]);
  });

  it("同じ時刻の注文は注文番号の小さい順に割り当てる", () => {
    seq = 0;
    const orders = [order("10:00:00", [1, 0]), order("10:00:00", [1, 0])].reverse();
    const result = allocateOrderNumbers({
      orders,
      brewUnits: batch("b1", A, 1, "01:00:00"),
      queue: [],
    });
    expect(result.byBatchId.b1.orders).toEqual([{ orderNumber: 1, count: 1 }]);
  });
});
