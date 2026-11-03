import { describe, expect, it } from "vitest";
import { getUnservedOrders } from "./unservedOrders";

const nameOf = (id: string) => `name-${id}`;

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
      { a: { ready: 0, brewing: 0 } },
      nameOf,
    );
    expect(result[0].status).toBe("pending");
  });

  it("全杯完成した注文・pending / brewing 以外の注文は含めない", () => {
    const result = getUnservedOrders(
      [
        order(1, "10:00:00", [{ id: "a", quantity: 2 }]),
        order(2, "10:01:00", [{ id: "b", quantity: 1 }], "ready"),
        order(3, "10:02:00", [{ id: "c", quantity: 1 }], "completed"),
        order(4, "10:03:00", [{ id: "d", quantity: 1 }], "cancelled"),
        order(5, "10:04:00", [{ id: "e", quantity: 1 }], "brewing"),
      ],
      { a: { ready: 2, brewing: 0 }, e: { ready: 0, brewing: 1 } },
      nameOf,
    );
    expect(result.map((o) => o.orderNumber)).toEqual([5]);
  });

  it("direct 品目は判定に使わず、それだけ未完成扱いにはしない", () => {
    const result = getUnservedOrders(
      [
        order(1, "10:00:00", [
          { id: "a", quantity: 1 },
          { id: "x", quantity: 2, direct: true },
        ]),
        order(2, "10:01:00", [
          { id: "b", quantity: 1 },
          { id: "y", quantity: 1, direct: true },
        ]),
      ],
      { a: { ready: 1, brewing: 0 }, b: { ready: 0, brewing: 0 } },
      nameOf,
    );
    expect(result.map((o) => o.orderNumber)).toEqual([2]);
    expect(result[0].items[1]).toMatchObject({
      fulfillmentTypeAtOrder: "direct",
      brewingCount: 0,
      pendingCount: 0,
    });
  });

  it("古い注文順（同時刻は注文番号順）に並べる", () => {
    const result = getUnservedOrders(
      [
        order(3, "10:05:00", [{ id: "c", quantity: 1 }]),
        order(2, "10:00:00", [{ id: "b", quantity: 1 }]),
        order(1, "10:00:00", [{ id: "a", quantity: 1 }]),
      ],
      {},
      nameOf,
    );
    expect(result.map((o) => o.orderNumber)).toEqual([1, 2, 3]);
  });
});
