import { describe, expect, it } from "vitest";
import { parseJstString } from "../../lib/datetime";
import {
  computePendingOrders,
  consumeQueue,
  refillQueue,
  trimQueueAfterOrderCancel,
  type QueueBrewUnit,
  type QueueEntry,
  type QueueOrder,
} from "./queue";

const A = "menu-a";
const B = "menu-b";
const menus = { a: A, b: B };
const NOW = parseJstString("2026-09-27 10:30:00").getTime();

let seq = 0;
/** time は "HH:MM:SS"。cups は [A の杯数, B の杯数] */
function order(time: string, [a, b]: [number, number]): QueueOrder {
  seq += 1;
  const items = [];
  if (a > 0) items.push({ id: `item-${seq}-a`, menuItemId: A, quantity: a });
  if (b > 0) items.push({ id: `item-${seq}-b`, menuItemId: B, quantity: b });
  return {
    id: `order-${seq}`,
    orderNumber: seq,
    status: "pending",
    createdAt: `2026-09-27 ${time}`,
    items,
  };
}

function brewing(menuItemId: string, n: number): QueueBrewUnit[] {
  return Array.from({ length: n }, () => ({
    menuItemId,
    orderItemId: null,
    status: "brewing" as const,
  }));
}

function entry(id: string, menuItemId: string, count: number): QueueEntry {
  return { id, menuItemId, count };
}

/** キューを "A3 B1" のような文字列にする */
function show(queue: QueueEntry[]): string {
  return queue.map((e) => `${e.menuItemId === A ? "A" : "B"}${e.count}`).join(" ");
}

function refill(orders: QueueOrder[], queue: QueueEntry[] = [], brewUnits: QueueBrewUnit[] = []) {
  let n = 0;
  return refillQueue({ queue, orders, brewUnits, menus, now: NOW, newId: () => `new-${++n}` });
}

/**
 * 空き枠を 1 つだけにするための状態。10:00 の注文 2 件（A 3 杯ずつ）を
 * 既存エントリー [A3, A3] が対応予定としてまかなう。
 */
function withOneEmptySlot(orders: QueueOrder[]) {
  const fillers = [order("10:00:00", [3, 0]), order("10:00:01", [3, 0])];
  const queue = [entry("x", A, 3), entry("y", A, 3)];
  return refill([...fillers, ...orders], queue).slice(2);
}

describe("computePendingOrders", () => {
  it("抽出中を割り当ててから、対応予定を古い注文から順に割り当てる", () => {
    const o1 = order("10:20:00", [2, 0]);
    const o2 = order("10:21:00", [2, 0]);
    const result = computePendingOrders([o2, o1], brewing(A, 1), [entry("q", A, 2)], menus);
    expect(result.map((p) => [p.order.id, p.pending.get(A)])).toEqual([[o2.id, 1]]);
  });

  it("紐付き済みの完成品を差し引き、完了・取消済みの注文と A・B 以外のメニューは数えない", () => {
    const o1 = order("10:20:00", [2, 0]);
    const done = { ...order("10:21:00", [1, 0]), status: "completed" };
    const other = {
      ...order("10:22:00", [0, 0]),
      items: [{ id: "x", menuItemId: "menu-c", quantity: 2 }],
    };
    const units: QueueBrewUnit[] = [
      { menuItemId: A, orderItemId: o1.items[0].id, status: "ready" },
    ];
    const result = computePendingOrders([o1, done, other], units, [], menus);
    expect(result.map((p) => [p.order.id, p.pending.get(A)])).toEqual([[o1.id, 1]]);
  });
});

describe("refillQueue: 通常時の決め方", () => {
  it("古い 3 注文の中で杯数が多い種類を選ぶ（B1, A2, A1 → A3）", () => {
    expect(
      show(
        withOneEmptySlot([
          order("10:26:00", [0, 1]),
          order("10:27:00", [2, 0]),
          order("10:28:00", [1, 0]),
        ]),
      ),
    ).toBe("A3");
  });

  it("同数なら最も古い注文に含まれる種類を選ぶ", () => {
    expect(show(withOneEmptySlot([order("10:26:00", [0, 2]), order("10:27:00", [2, 0])]))).toBe(
      "B2",
    );
  });

  it("同数で最も古い注文に両方あるなら、その注文の中で多い方を選ぶ", () => {
    expect(show(withOneEmptySlot([order("10:26:00", [1, 2]), order("10:27:00", [1, 0])]))).toBe(
      "B2",
    );
  });

  it("それも同数なら A を選ぶ", () => {
    expect(show(withOneEmptySlot([order("10:26:00", [1, 1])]))).toBe("A1");
  });

  it("バッチには古い 3 注文以外の同じ種類の杯も 3 杯まで入れる", () => {
    const orders = [
      order("10:26:00", [1, 0]),
      order("10:26:30", [0, 1]),
      order("10:27:00", [1, 0]),
      order("10:28:00", [2, 0]),
    ];
    expect(show(withOneEmptySlot(orders))).toBe("A3");
  });

  it("追加分は代表注文の古い順に並べる", () => {
    const orders = [
      order("10:26:00", [0, 1]),
      order("10:27:00", [2, 0]),
      order("10:28:00", [1, 0]),
    ];
    expect(show(refill(orders))).toBe("B1 A3");
  });

  it("3 バッチを超える分は次の補充に回す", () => {
    expect(show(refill([order("10:28:00", [9, 1])]))).toBe("A3 A3 A3");
  });

  it("未対応の杯がなければ追加しない", () => {
    expect(refill([])).toEqual([]);
  });
});

describe("refillQueue: 長時間待ちの優先", () => {
  it("最も古い注文が 5 分以上待っていれば、その注文の種類を優先する", () => {
    const orders = [
      order("10:24:00", [0, 1]),
      order("10:27:00", [2, 0]),
      order("10:28:00", [1, 0]),
    ];
    expect(show(withOneEmptySlot(orders))).toBe("B1");
  });

  it("5 分ちょうどで優先し、5 分未満なら優先しない", () => {
    expect(show(withOneEmptySlot([order("10:25:00", [0, 1]), order("10:27:00", [2, 0])]))).toBe(
      "B1",
    );
    expect(show(withOneEmptySlot([order("10:25:01", [0, 1]), order("10:27:00", [2, 0])]))).toBe(
      "A2",
    );
  });

  it("最も古い注文に 2 種類あるときは、その注文の中で多い方", () => {
    expect(show(withOneEmptySlot([order("10:20:00", [2, 1])]))).toBe("A2");
  });

  it("同数なら他の注文の未対応杯数が多い方（同じ種類で 3 杯まで補充）", () => {
    expect(show(withOneEmptySlot([order("10:20:00", [1, 1]), order("10:28:00", [0, 2])]))).toBe(
      "B3",
    );
  });

  it("それも同数なら A", () => {
    expect(show(withOneEmptySlot([order("10:20:00", [1, 1])]))).toBe("A1");
  });
});

describe("refillQueue: 既存エントリー", () => {
  it("種類と並びを変えず、3 杯未満のエントリーに同じ種類の杯を加える", () => {
    const orders = [
      order("10:26:00", [0, 1]),
      order("10:27:00", [0, 2]),
      order("10:28:00", [3, 0]),
    ];
    const result = refill(orders, [entry("x", B, 1)]);
    expect(result[0]).toEqual(entry("x", B, 3));
    expect(show(result)).toBe("B3 A3");
  });

  it("新しいエントリーは既存エントリーの後ろに追加する", () => {
    const orders = [order("10:20:00", [3, 3]), order("10:28:00", [3, 0])];
    const result = refill(orders, [entry("x", B, 3)]);
    expect(result.map((e) => e.id)).toEqual(["x", "new-1", "new-2"]);
    expect(show(result)).toBe("B3 A3 A3");
  });
});

describe("consumeQueue", () => {
  it("一致するエントリーのうち前のものを消費する", () => {
    const queue = [entry("1", A, 3), entry("2", B, 3), entry("3", A, 3)];
    expect(consumeQueue(queue, { menuItemId: A, count: 3 }).map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("杯数まで一致するものを、種類だけ一致するものより優先する", () => {
    const queue = [entry("1", A, 3), entry("2", A, 2)];
    expect(consumeQueue(queue, { menuItemId: A, count: 2 }).map((e) => e.id)).toEqual(["1"]);
  });

  it("一致がなければ同じ種類のうち前のものを消費する", () => {
    const queue = [entry("1", B, 3), entry("2", A, 3), entry("3", A, 2)];
    expect(consumeQueue(queue, { menuItemId: A, count: 1 }).map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("同じ種類がなければ消費しない", () => {
    const queue = [entry("1", A, 3)];
    expect(consumeQueue(queue, { menuItemId: B, count: 2 })).toEqual(queue);
  });
});

describe("trimQueueAfterOrderCancel", () => {
  it("キューが未対応杯数を上回る分だけ、そのメニューの末尾から減らし、0 杯は削除する", () => {
    const orders = [order("10:20:00", [2, 0])];
    const queue = [entry("1", A, 3), entry("2", B, 3), entry("3", A, 2)];
    const result = trimQueueAfterOrderCancel(queue, orders, brewing(A, 1), menus);
    expect(result).toEqual([entry("1", A, 1)]);
  });

  it("キューが未対応杯数以下なら変更しない", () => {
    const orders = [order("10:20:00", [4, 0])];
    const queue = [entry("1", A, 3)];
    expect(trimQueueAfterOrderCancel(queue, orders, [], menus)).toEqual(queue);
  });
});
