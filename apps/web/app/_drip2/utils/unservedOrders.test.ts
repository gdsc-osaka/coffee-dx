import { describe, expect, it } from "vitest";
import { getReadyOrders } from "./readyOrders";
import { getUnservedOrders } from "./unservedOrders";

const nameOf = (id: string) => `name-${id}`;
const none = new Set<string>();

function order(
  n: number,
  time: string,
  items: Array<{ id: string; quantity: number; direct?: boolean; name?: string }>,
  status = "pending",
) {
  return {
    id: `order-${n}`,
    orderNumber: n,
    status,
    createdAt: `2026-11-03 ${time}`,
    items: items.map((i) => ({
      id: i.id,
      menuItemId: `menu-${i.id}`,
      quantity: i.quantity,
      name: i.name,
      fulfillmentTypeAtOrder: i.direct ? ("direct" as const) : ("brew" as const),
    })),
  };
}

describe("getUnservedOrders", () => {
  it("品目ごとに完成・抽出中・未着手の杯数を出し、1 杯でも抽出中なら brewing にする", () => {
    const result = getUnservedOrders(
      [
        order(1, "10:00:00", [
          { id: "a", quantity: 3, name: "ラテ" },
          { id: "b", quantity: 1 },
        ]),
      ],
      none,
      { a: { ready: 1, brewing: 1 }, b: { ready: 0, brewing: 0 } },
      nameOf,
    );
    expect(result).toEqual([
      {
        id: "order-1",
        orderNumber: 1,
        createdAt: "2026-11-03 10:00:00",
        status: "brewing",
        items: [
          {
            id: "a",
            name: "ラテ",
            quantity: 3,
            fulfillmentTypeAtOrder: "brew",
            readyCount: 1,
            brewingCount: 1,
            pendingCount: 1,
          },
          {
            id: "b",
            name: "name-menu-b",
            quantity: 1,
            fulfillmentTypeAtOrder: "brew",
            readyCount: 0,
            brewingCount: 0,
            pendingCount: 1,
          },
        ],
      },
    ]);
  });

  it("抽出中の杯がなければ pending", () => {
    const result = getUnservedOrders(
      [order(1, "10:00:00", [{ id: "a", quantity: 1 }])],
      none,
      { a: { ready: 0, brewing: 0 } },
      nameOf,
    );
    expect(result[0].status).toBe("pending");
  });

  it("提供待ちの注文と、完了・キャンセル済みの注文は含めない", () => {
    const result = getUnservedOrders(
      [
        order(1, "10:00:00", [{ id: "a", quantity: 1 }]),
        order(2, "10:01:00", [{ id: "b", quantity: 1 }], "ready"),
        order(3, "10:02:00", [{ id: "c", quantity: 1 }], "completed"),
        order(4, "10:03:00", [{ id: "d", quantity: 1 }], "cancelled"),
        order(5, "10:04:00", [{ id: "e", quantity: 1 }]),
      ],
      new Set(["order-1", "order-2"]),
      {},
      nameOf,
    );
    expect(result.map((o) => o.orderNumber)).toEqual([5]);
  });

  it("direct 品目は受渡済として扱う", () => {
    const result = getUnservedOrders(
      [
        order(1, "10:00:00", [
          { id: "a", quantity: 1 },
          { id: "x", quantity: 2, direct: true },
        ]),
      ],
      none,
      { a: { ready: 0, brewing: 0 } },
      nameOf,
    );
    expect(result[0].items[1]).toMatchObject({
      fulfillmentTypeAtOrder: "direct",
      readyCount: 2,
      brewingCount: 0,
      pendingCount: 0,
    });
  });

  it("どの注文も提供待ちと未提供のどちらか一方にだけ入る", () => {
    const orders = [
      // brew は紐付き済みで完成、direct が混ざり、サーバー上はまだ pending
      order(1, "10:00:00", [
        { id: "a", quantity: 1 },
        { id: "x", quantity: 1, direct: true },
      ]),
      // 紐付き済みの完成品で全杯そろっている（サーバー上はまだ pending）
      order(2, "10:01:00", [{ id: "b", quantity: 1 }]),
      // サーバー上 ready
      order(3, "10:02:00", [{ id: "c", quantity: 1 }], "ready"),
      // 未着手
      order(4, "10:03:00", [{ id: "d", quantity: 2 }]),
    ];
    const brewUnits = [
      { orderItemId: "a", status: "ready" as const },
      { orderItemId: "b", status: "ready" as const },
      { orderItemId: "c", status: "ready" as const },
      // 紐付けに失敗して残った未紐付きの完成品
      { orderItemId: null, status: "ready" as const },
    ];
    const ready = getReadyOrders(orders, brewUnits);
    const readyIds = new Set(ready.map((o) => o.id));
    const unserved = getUnservedOrders(
      orders,
      readyIds,
      { a: { ready: 1, brewing: 0 }, b: { ready: 1, brewing: 0 }, d: { ready: 0, brewing: 0 } },
      nameOf,
    );
    const all = [...ready.map((o) => o.orderNumber), ...unserved.map((o) => o.orderNumber)];
    expect(all.sort()).toEqual([1, 2, 3, 4]);
  });

  it("古い注文順（同時刻は注文番号順）に並べる", () => {
    const result = getUnservedOrders(
      [
        order(3, "10:05:00", [{ id: "c", quantity: 1 }]),
        order(2, "10:00:00", [{ id: "b", quantity: 1 }]),
        order(1, "10:00:00", [{ id: "a", quantity: 1 }]),
      ],
      none,
      {},
      nameOf,
    );
    expect(result.map((o) => o.orderNumber)).toEqual([1, 2, 3]);
  });
});
