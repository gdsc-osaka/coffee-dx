import { parseJstString } from "../../lib/datetime";

/**
 * 次枠キュー（次に 3 台のドリッパーへセットすべきバッチ群）の計算。
 * 設計: docs/design/drip-suggestion.md
 *
 * OrderDO から次の順で呼び出す想定。brewUnits は各イベント反映後の状態を渡すこと。
 * - 抽出開始: consumeQueue → refillQueue
 * - 新しい注文・抽出の取消: refillQueue
 * - 注文の取消: trimQueueAfterOrderCancel → refillQueue
 *
 * DB や OrderDO に依存しない純粋関数のみを置く（workerd のテストからも読めるよう相対 import のみ）。
 */

/** 1 バッチ（1 台のドリッパー）の最大杯数 */
export const MAX_CUPS_PER_BATCH = 3;
/** キューの最大エントリー数（物理ドリッパー数） */
export const MAX_QUEUE_LENGTH = 3;
/** 通常時の決め方で見る古い注文の件数 */
export const OLD_ORDER_COUNT = 3;
/** 平均抽出時間（3 分弱）の約 2 倍。最も古い注文がこれ以上待っていれば優先する */
export const PRIORITY_WAIT_MS = 5 * 60 * 1000;

/** A = 1 種類目、B = 2 種類目のメニュー ID */
export type QueueMenus = { a: string; b: string | null };

export type QueueEntry = { id: string; menuItemId: string; count: number };

export type QueueOrder = {
  id: string;
  orderNumber: number;
  status: string;
  /** JST の "YYYY-MM-DD HH:MM:SS" */
  createdAt: string;
  items: Array<{ id: string; menuItemId: string; quantity: number }>;
};

export type QueueBrewUnit = {
  menuItemId: string;
  orderItemId: string | null;
  status: "brewing" | "ready";
};

/** 未対応杯数が 1 杯以上残っている注文と、そのメニュー別の未対応杯数 */
export type PendingOrder = { order: QueueOrder; pending: Map<string, number> };

function compareOrders(a: QueueOrder, b: QueueOrder): number {
  return a.createdAt.localeCompare(b.createdAt) || a.orderNumber - b.orderNumber;
}

function pendingOf(p: PendingOrder, menuItemId: string | null): number {
  return menuItemId === null ? 0 : (p.pending.get(menuItemId) ?? 0);
}

function totalPending(pendingOrders: PendingOrder[], menuItemId: string | null): number {
  return pendingOrders.reduce((sum, p) => sum + pendingOf(p, menuItemId), 0);
}

/**
 * 未対応杯数を計算する（古い注文順、未対応杯数が残っている注文のみ）。
 * 1. 紐付き済みの完成品を差し引く
 * 2. 抽出中（と未紐付きの完成品）を、メニューごとに古い注文から順に割り当てて差し引く
 * 3. 対応予定（キューの杯）を、メニューごとに古い注文から順に割り当てて差し引く
 * A・B 以外のメニューは対象外。
 */
export function computePendingOrders(
  orders: QueueOrder[],
  brewUnits: QueueBrewUnit[],
  queue: QueueEntry[],
  menus: QueueMenus,
): PendingOrder[] {
  const menuIds = new Set([menus.a, menus.b].filter((m): m is string => m !== null));

  const linkedReady = new Map<string, number>();
  const unlinked = new Map<string, number>();
  for (const u of brewUnits) {
    if (u.orderItemId !== null) {
      if (u.status === "ready") {
        linkedReady.set(u.orderItemId, (linkedReady.get(u.orderItemId) ?? 0) + 1);
      }
    } else {
      unlinked.set(u.menuItemId, (unlinked.get(u.menuItemId) ?? 0) + 1);
    }
  }

  const reserved = new Map<string, number>();
  for (const e of queue) reserved.set(e.menuItemId, (reserved.get(e.menuItemId) ?? 0) + e.count);

  const rows = orders
    .filter((o) => o.status !== "completed" && o.status !== "cancelled")
    .sort(compareOrders)
    .map((order) => ({
      order,
      items: order.items
        .filter((item) => menuIds.has(item.menuItemId))
        .map((item) => ({
          menuItemId: item.menuItemId,
          remaining: Math.max(0, item.quantity - (linkedReady.get(item.id) ?? 0)),
        })),
    }));

  // 抽出中 → 対応予定 の順に、それぞれ全注文を古い順にたどって割り当てる
  for (const pool of [unlinked, reserved]) {
    for (const row of rows) {
      for (const item of row.items) {
        const avail = pool.get(item.menuItemId) ?? 0;
        const take = Math.min(item.remaining, avail);
        item.remaining -= take;
        pool.set(item.menuItemId, avail - take);
      }
    }
  }

  const result: PendingOrder[] = [];
  for (const row of rows) {
    const pending = new Map<string, number>();
    for (const item of row.items) {
      if (item.remaining > 0) {
        pending.set(item.menuItemId, (pending.get(item.menuItemId) ?? 0) + item.remaining);
      }
    }
    if (pending.size > 0) result.push({ order: row.order, pending });
  }
  return result;
}

/** 長時間待ちの優先: 最も古い注文の種類を選ぶ */
function choosePriorityMenu(pendingOrders: PendingOrder[], menus: QueueMenus): string {
  if (menus.b === null) return menus.a;
  const [oldest, ...others] = pendingOrders;
  const a = pendingOf(oldest, menus.a);
  const b = pendingOf(oldest, menus.b);
  if (a !== b) return a > b ? menus.a : menus.b;
  // 最も古い注文の中で同数 → 他の注文の未対応杯数が多い方 → それも同数なら A
  return totalPending(others, menus.b) > totalPending(others, menus.a) ? menus.b : menus.a;
}

/** 通常時の決め方: 古い 3 注文の中の未対応杯数が多い種類を選ぶ */
function chooseNormalMenu(pendingOrders: PendingOrder[], menus: QueueMenus): string {
  if (menus.b === null) return menus.a;
  const old = pendingOrders.slice(0, OLD_ORDER_COUNT);
  const a = totalPending(old, menus.a);
  const b = totalPending(old, menus.b);
  if (a !== b) return a > b ? menus.a : menus.b;
  // 同数 → 最も古い注文に含まれる種類。両方含まれるならその注文の中で多い方、それも同数なら A
  const oldest = old[0];
  return pendingOf(oldest, menus.b) > pendingOf(oldest, menus.a) ? menus.b : menus.a;
}

/**
 * 補充。既存エントリーの種類と並びは変えず、3 杯未満のエントリーへの追加と、
 * 空き枠への新しいエントリーの追加のみを行う。
 */
export function refillQueue({
  queue,
  orders,
  brewUnits,
  menus,
  now,
  newId = () => crypto.randomUUID(),
}: {
  queue: QueueEntry[];
  orders: QueueOrder[];
  brewUnits: QueueBrewUnit[];
  menus: QueueMenus;
  /** 判定に使う現在時刻（ミリ秒）。サーバーの時刻を渡す */
  now: number;
  newId?: () => string;
}): QueueEntry[] {
  const current = queue.map((e) => ({ ...e }));

  // 3 杯未満の既存エントリーに、同じ種類の未対応の杯を前のエントリーから加える
  for (const entry of current) {
    if (entry.count >= MAX_CUPS_PER_BATCH) continue;
    const pendingOrders = computePendingOrders(orders, brewUnits, current, menus);
    entry.count += Math.min(
      MAX_CUPS_PER_BATCH - entry.count,
      totalPending(pendingOrders, entry.menuItemId),
    );
  }

  const emptySlots = MAX_QUEUE_LENGTH - current.length;
  if (emptySlots <= 0) return current;

  const added: Array<{ entry: QueueEntry; representative: QueueOrder }> = [];
  const addBatch = (menuItemId: string, pendingOrders: PendingOrder[]) => {
    const representative = pendingOrders.find((p) => pendingOf(p, menuItemId) > 0)!.order;
    const count = Math.min(MAX_CUPS_PER_BATCH, totalPending(pendingOrders, menuItemId));
    added.push({ entry: { id: newId(), menuItemId, count }, representative });
  };
  const pendingWithAdded = () =>
    computePendingOrders(orders, brewUnits, [...current, ...added.map((a) => a.entry)], menus);

  // 長時間待ちの優先（最も古い注文の 1 件のみ）
  const first = pendingWithAdded();
  if (
    first.length > 0 &&
    now - parseJstString(first[0].order.createdAt).getTime() >= PRIORITY_WAIT_MS
  ) {
    addBatch(choosePriorityMenu(first, menus), first);
  }

  // 残りの空き枠は通常時の決め方で 1 枠ずつ決める
  while (added.length < emptySlots) {
    const pendingOrders = pendingWithAdded();
    if (pendingOrders.length === 0) break;
    addBatch(chooseNormalMenu(pendingOrders, menus), pendingOrders);
  }

  // 今回追加する分のみを代表注文の古い順に並べ、末尾に追加する
  added.sort((x, y) => compareOrders(x.representative, y.representative));
  return [...current, ...added.map((a) => a.entry)];
}

/**
 * 抽出開始時の消費。一致（種類・杯数とも同じ）するもの → 同じ種類のもの の順に、
 * 前のエントリーから 1 件だけ取り除く。同じ種類がなければ消費しない。
 */
export function consumeQueue(
  queue: QueueEntry[],
  started: { menuItemId: string; count: number },
): QueueEntry[] {
  let index = queue.findIndex(
    (e) => e.menuItemId === started.menuItemId && e.count === started.count,
  );
  if (index === -1) index = queue.findIndex((e) => e.menuItemId === started.menuItemId);
  return index === -1 ? [...queue] : queue.filter((_, i) => i !== index);
}

/**
 * 注文取消後の削減。メニューごとに「キューの杯数の合計」が
 * 「未対応杯数（注文数 − 完成 − 抽出中）」を上回る分だけ、そのメニューの末尾のエントリーから減らす。
 * orders・brewUnits は取消を反映した後の状態を渡すこと。
 */
export function trimQueueAfterOrderCancel(
  queue: QueueEntry[],
  orders: QueueOrder[],
  brewUnits: QueueBrewUnit[],
  menus: QueueMenus,
): QueueEntry[] {
  const pendingOrders = computePendingOrders(orders, brewUnits, [], menus);
  const result = queue.map((e) => ({ ...e }));

  for (const menuItemId of new Set(result.map((e) => e.menuItemId))) {
    const queued = result
      .filter((e) => e.menuItemId === menuItemId)
      .reduce((sum, e) => sum + e.count, 0);
    let excess = queued - totalPending(pendingOrders, menuItemId);
    for (let i = result.length - 1; i >= 0 && excess > 0; i--) {
      if (result[i].menuItemId !== menuItemId) continue;
      const take = Math.min(excess, result[i].count);
      result[i].count -= take;
      excess -= take;
    }
  }
  return result.filter((e) => e.count > 0);
}
