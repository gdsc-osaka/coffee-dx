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
const C = "menu-c";
const menus = [A, B];
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
  const labels = new Map([
    [A, "A"],
    [B, "B"],
    [C, "C"],
  ]);
  return queue.map((e) => `${labels.get(e.menuItemId) ?? e.menuItemId}${e.count}`).join(" ");
}

/** maxEntries を省略すると上限なし（本番と同じ）。 */
function refill(
  orders: QueueOrder[],
  queue: QueueEntry[] = [],
  brewUnits: QueueBrewUnit[] = [],
  maxEntries?: number,
) {
  let n = 0;
  return refillQueue({
    queue,
    orders,
    brewUnits,
    menus,
    now: NOW,
    newId: () => `new-${++n}`,
    maxEntries,
  });
}

/**
 * 「どの種類を先に選ぶか」の決め方を確かめるために、枠数を 3 つに絞る。
 * 本番では枠数を絞らない（上限なしの動作は、別の describe で確かめる）。
 */
const SLOTS = 3;
const FILLED_SLOTS = SLOTS - 1;

/**
 * 空き枠を 1 つだけにするためのダミー。10:00 の注文（A 3 杯）を 1 件ずつ、
 * 同じ杯数の既存エントリー（A3）がそれぞれ対応予定としてまかなう。
 */
function filler() {
  const orders = Array.from({ length: FILLED_SLOTS }, (_, i) =>
    order(`10:00:${String(i).padStart(2, "0")}`, [3, 0]),
  );
  const queue = orders.map((_, i) => entry(`filler-${i}`, A, 3));
  return { orders, queue };
}

/** 空き枠が 1 つだけの状態で補充し、新しく追加された分だけを返す */
function withOneEmptySlot(orders: QueueOrder[]) {
  const f = filler();
  return refill([...f.orders, ...orders], f.queue, [], SLOTS).slice(FILLED_SLOTS);
}

describe("computePendingOrders", () => {
  it("direct items are excluded from the brew queue", () => {
    const o = order("10:20:00", [1, 0]);
    o.items.push({
      id: "item-direct",
      menuItemId: C,
      quantity: 2,
      fulfillmentTypeAtOrder: "direct",
    });

    const result = computePendingOrders([o], [], [], [A, B, C]);

    expect(result).toHaveLength(1);
    expect(result[0].pending.get(A)).toBe(1);
    expect(result[0].pending.has(C)).toBe(false);
  });

  it("抽出中を割り当ててから、対応予定を古い注文から順に割り当てる", () => {
    const o1 = order("10:20:00", [2, 0]);
    const o2 = order("10:21:00", [2, 0]);
    const result = computePendingOrders([o2, o1], brewing(A, 1), [entry("q", A, 2)], menus);
    expect(result.map((p) => [p.order.id, p.pending.get(A)])).toEqual([[o2.id, 1]]);
  });

  it("紐付き済みの完成品を差し引き、完了・取消済みの注文と対象外メニューは数えない", () => {
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
  it("1 種類だけの日にも補充できる", () => {
    const result = refillQueue({
      queue: [],
      orders: [order("10:28:00", [2, 0])],
      brewUnits: [],
      menus: [A],
      now: NOW,
      newId: () => "new",
    });
    expect(show(result)).toBe("A2");
  });

  it("3 種類の日は 3 種類すべてを判定対象にする", () => {
    const oldest = order("10:26:00", [0, 0]);
    oldest.items = [{ id: "item-c", menuItemId: C, quantity: 2 }];
    const result = refillQueue({
      queue: [],
      orders: [oldest, order("10:27:00", [2, 0]), order("10:28:00", [0, 2])],
      brewUnits: [],
      menus: [A, B, C],
      now: NOW,
      newId: () => `new-${++seq}`,
    });
    expect(show(result)).toBe("C2 A2 B2");
  });

  it("同率候補を全体の最古注文が含まない場合、候補を含む最古注文を優先する", () => {
    const f = filler();
    const oldest = order("10:26:00", [0, 0]);
    oldest.items = [{ id: "item-c", menuItemId: C, quantity: 1 }];
    const result = refillQueue({
      queue: f.queue,
      orders: [...f.orders, oldest, order("10:27:00", [0, 2]), order("10:28:00", [2, 0])],
      brewUnits: [],
      menus: [A, B, C],
      now: NOW,
      newId: () => `new-${++seq}`,
      maxEntries: SLOTS,
    });
    // A・B が 2 杯で同率。登録順の A ではなく、先に注文された B を選ぶ。
    expect(show(result.slice(FILLED_SLOTS))).toBe("B2");
  });

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

  it("枠数を指定したときは、収まらない分を次の補充に回す", () => {
    expect(show(refill([order("10:28:00", [9, 1])], [], [], SLOTS))).toBe("A3 A3 A3");
  });

  it("未対応の杯がなければ追加しない", () => {
    expect(refill([])).toEqual([]);
  });
});

describe("refillQueue: 上限なし（未対応の杯をすべて割り当てる）", () => {
  it("枠数を指定しなければ、未対応の杯がすべてエントリーに入る", () => {
    expect(show(refill([order("10:28:00", [9, 1])]))).toBe("A3 A3 A3 B1");
  });

  it("3 杯に満たない端数も 1 つのエントリーになる", () => {
    expect(show(refill([order("10:28:00", [10, 0])]))).toBe("A3 A3 A3 A1");
  });

  it("割り当て済みの状態でもう一度補充しても、キューは変わらない", () => {
    const orders = [order("10:28:00", [9, 1])];
    const first = refill(orders);
    expect(refill(orders, first)).toEqual(first);
  });

  it("新しい注文の分は、すでに満杯のエントリーの後ろに追加される", () => {
    const o1 = order("10:20:00", [6, 0]);
    const o2 = order("10:28:00", [0, 2]);
    const result = refill([o1, o2], [entry("x", A, 3), entry("y", A, 3)]);
    expect(show(result)).toBe("A3 A3 B2");
    expect(result.map((e) => e.id)).toEqual(["x", "y", "new-1"]);
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

describe("refillQueue: 未対応に戻った古い注文の杯", () => {
  it("抽出を取り消した最古の注文の分は、後から来た注文のエントリーより前に入る", () => {
    // 最古の注文（A3）を抽出中に、後の注文の B が 3 エントリー並んでいる
    const oldest = order("10:00:00", [3, 0]);
    const later = [order("10:05:00", [0, 3]), order("10:06:00", [0, 3]), order("10:07:00", [0, 3])];
    const queue = refill([oldest, ...later], [], brewing(A, 3));
    expect(show(queue)).toBe("B3 B3 B3");

    // 抽出を取り消すと A3 が未対応に戻る
    const result = refill([oldest, ...later], queue);
    expect(show(result)).toBe("A3 B3 B3 B3");
    expect(result.slice(1)).toEqual(queue);
  });

  it("提案より少ない杯数で抽出を始めた残りは、後から来た注文のエントリーより前に入る", () => {
    const orders = [
      order("10:00:00", [3, 0]),
      order("10:05:00", [0, 3]),
      order("10:06:00", [0, 3]),
      order("10:07:00", [3, 0]),
    ];
    const queue = refill(orders);
    expect(show(queue)).toBe("A3 B3 B3 A3");

    // A を 2 杯だけで抽出開始 → 最古の注文の A が 1 杯残る
    const consumed = consumeQueue(queue, { menuItemId: A, count: 2 });
    const result = refill(orders, consumed, brewing(A, 2));
    expect(show(result)).toBe("A1 B3 B3 A3");
    expect(result.slice(1)).toEqual(consumed);
  });

  it("同じ種類の既存エントリーと同じ注文を担当するなら、その前には入らない", () => {
    // 最古の注文（A1）と後の注文（A3）を、既存の A3 が古い順に担当している
    const orders = [
      order("10:00:00", [1, 0]),
      order("10:05:00", [0, 3]),
      order("10:06:00", [3, 0]),
    ];
    const result = refill(orders, [entry("x", A, 3), entry("y", B, 3)]);
    expect(show(result)).toBe("A3 B3 A1");
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
