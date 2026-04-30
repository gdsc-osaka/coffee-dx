import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "~/lib/order-do";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type OrderItemData = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

type OrderData = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItemData[];
};

type BrewUnitData = {
  id: string;
  batchId: string;
  menuItemId: string;
  menuItemName: string;
  orderItemId: string | null;
  status: "brewing" | "ready";
  businessDate: string;
  createdAt: string;
  updatedAt: string;
};

type ServerMessage =
  | { type: "SNAPSHOT"; orders: OrderData[]; brewUnits: BrewUnitData[] }
  | { type: "ORDER_CREATED"; order: OrderData }
  | { type: "ORDER_UPDATED"; orderId: string; status: OrderStatus }
  | { type: "BREW_UNITS_CREATED"; brewUnits: BrewUnitData[] }
  | { type: "BREW_UNIT_UPDATED"; brewUnit: BrewUnitData }
  | { type: "BREW_UNIT_DELETED"; brewUnitId: string };

type BrewBatchSummary = {
  batchId: string;
  count: number;
  /** order_item_id IS NOT NULL な杯数（遅延バインディングでは ready 後に設定される） */
  linkedCount: number;
  status: "brewing" | "ready";
  createdAt: string;
};

type MenuBrewSummary = {
  menuItemId: string;
  menuItemName: string;
  ordered: number;
  brewing: number;
  ready: number;
  /** ready かつ未紐付き（余剰削除可能）な杯数 */
  surplus: number;
  batches: BrewBatchSummary[];
};

// ---------------------------------------------------------------------------
// loader / action
// ---------------------------------------------------------------------------

import { createDb } from "~/lib/db";
import { menuItems } from "~/../db/schema";
import { eq } from "drizzle-orm";

export async function loader({ context }: Route.LoaderArgs) {
  const db = createDb(context.cloudflare.env.DB);
  const menus = await db
    .select({ id: menuItems.id, name: menuItems.name })
    .from(menuItems)
    .where(eq(menuItems.isAvailable, 1));

  return { eventId: getBusinessDate(), menus };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const eventId = formData.get("eventId");

  if (typeof eventId !== "string" || eventId.length === 0) {
    return { ok: false, error: "eventId が不正です" };
  }

  const stub = getOrderDOStub(context.cloudflare.env, eventId);

  try {
    switch (intent) {
      case "brew-start": {
        const menuItemId = formData.get("menuItemId");
        const count = Number(formData.get("count"));
        if (typeof menuItemId !== "string" || !menuItemId || count < 1) {
          return { ok: false, error: "入力値が不正です" };
        }
        await callOrderDO(stub, eventId, "/do/brew-units", {
          body: { menuItemId, count },
        });
        return { ok: true, intent };
      }
      case "brew-complete": {
        const batchId = formData.get("batchId");
        if (typeof batchId !== "string" || !batchId) {
          return { ok: false, error: "batchId が不正です" };
        }
        await callOrderDO(
          stub,
          eventId,
          `/do/brew-units/batch/${encodeURIComponent(batchId)}/complete`,
        );
        return { ok: true, intent };
      }
      case "brew-cancel": {
        const batchId = formData.get("batchId");
        if (typeof batchId !== "string" || !batchId) {
          return { ok: false, error: "batchId が不正です" };
        }
        await callOrderDO(
          stub,
          eventId,
          `/do/brew-units/batch/${encodeURIComponent(batchId)}/cancel`,
        );
        return { ok: true, intent };
      }
      case "menu-surplus-decrease": {
        const menuItemId = formData.get("menuItemId");
        if (typeof menuItemId !== "string" || !menuItemId) {
          return { ok: false, error: "menuItemId が不正です" };
        }
        await callOrderDO(
          stub,
          eventId,
          `/do/brew-units/menu/${encodeURIComponent(menuItemId)}/surplus`,
          { method: "DELETE" },
        );
        return { ok: true, intent };
      }
      default:
        return { ok: false, error: "intent が不正です" };
    }
  } catch {
    return {
      ok: false,
      error: "操作に失敗しました。少し待って再度お試しください。",
    };
  }
}

// ---------------------------------------------------------------------------
// コンポーネント
// ---------------------------------------------------------------------------

export default function DripHome({
  loaderData,
}: {
  loaderData: { eventId: string; menus: Array<{ id: string; name: string }> };
}) {
  const { eventId, menus } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [ordersById, setOrdersById] = useState<Record<string, OrderData>>({});
  const [brewUnitsById, setBrewUnitsById] = useState<Record<string, BrewUnitData>>({});
  /** メニューごとの開始杯数入力 */
  const [countByMenu, setCountByMenu] = useState<Record<string, number>>({});

  const [isSnapshotLoaded, setIsSnapshotLoaded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const reconnectTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  // WebSocket 接続
  useEffect(() => {
    let socket: WebSocket | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws?eventId=${eventId}`);

      socket.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
        setConnectionError(null);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;

          if (msg.type === "SNAPSHOT") {
            const nextOrders: Record<string, OrderData> = {};
            for (const o of msg.orders) nextOrders[o.id] = o;
            setOrdersById(nextOrders);

            const nextUnits: Record<string, BrewUnitData> = {};
            for (const u of msg.brewUnits) nextUnits[u.id] = u;
            setBrewUnitsById(nextUnits);

            setIsSnapshotLoaded(true);
            return;
          }

          if (msg.type === "ORDER_CREATED") {
            setOrdersById((prev) => ({ ...prev, [msg.order.id]: msg.order }));
            return;
          }

          if (msg.type === "ORDER_UPDATED") {
            setOrdersById((prev) => {
              const existing = prev[msg.orderId];
              if (!existing) return prev;
              if (msg.status === "completed" || msg.status === "cancelled") {
                const { [msg.orderId]: _removed, ...rest } = prev;
                return rest;
              }
              return {
                ...prev,
                [msg.orderId]: { ...existing, status: msg.status },
              };
            });
            return;
          }

          if (msg.type === "BREW_UNITS_CREATED") {
            setBrewUnitsById((prev) => {
              const next = { ...prev };
              for (const u of msg.brewUnits) next[u.id] = u;
              return next;
            });
            return;
          }

          if (msg.type === "BREW_UNIT_UPDATED") {
            setBrewUnitsById((prev) => ({
              ...prev,
              [msg.brewUnit.id]: msg.brewUnit,
            }));
            return;
          }

          if (msg.type === "BREW_UNIT_DELETED") {
            setBrewUnitsById((prev) => {
              const { [msg.brewUnitId]: _removed, ...rest } = prev;
              return rest;
            });
            return;
          }
        } catch {
          setConnectionError("メッセージ受信時にエラーが発生しました");
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
        retryCountRef.current += 1;
        reconnectTimeoutRef.current = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        setConnectionError("接続エラー。自動で再接続します。");
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      if (socket) socket.close();
    };
  }, [eventId]);

  // ブリューユニット / 注文からメニュー別サマリーを計算
  const menuSummaries = useMemo((): MenuBrewSummary[] => {
    const allUnits = Object.values(brewUnitsById);
    const allOrders = Object.values(ordersById);

    // アクティブな注文（pending / brewing / ready）
    const activeOrders = allOrders.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    );

    // 常に DB から取得した全メニューを表示対象とする
    const menuIdSet = new Set<string>();
    for (const m of menus) menuIdSet.add(m.id);
    for (const u of allUnits) menuIdSet.add(u.menuItemId);
    for (const o of activeOrders) {
      for (const item of o.items) menuIdSet.add(item.menuItemId);
    }

    return [...menuIdSet]
      .map((menuItemId): MenuBrewSummary => {
        const units = allUnits.filter((u) => u.menuItemId === menuItemId);

        // メニュー名: menus から取得、なければ BrewUnit から取得、なければ注文アイテムから
        const menuItemName =
          menus.find((m) => m.id === menuItemId)?.name ??
          units[0]?.menuItemName ??
          allOrders.flatMap((o) => o.items).find((i) => i.menuItemId === menuItemId)?.name ??
          menuItemId;

        // 注文杯数: アクティブ注文の合計
        const ordered = activeOrders
          .flatMap((o) => o.items)
          .filter((i) => i.menuItemId === menuItemId)
          .reduce((sum, i) => sum + i.quantity, 0);

        const brewing = units.filter((u) => u.status === "brewing").length;
        const ready = units.filter((u) => u.status === "ready").length;
        // 余剰 = ready かつ未紐付き
        const surplus = units.filter((u) => u.status === "ready" && u.orderItemId === null).length;

        // バッチ単位で集計
        const batchMap = new Map<string, BrewUnitData[]>();
        for (const u of units) {
          if (!batchMap.has(u.batchId)) batchMap.set(u.batchId, []);
          batchMap.get(u.batchId)!.push(u);
        }

        const batches: BrewBatchSummary[] = [...batchMap.entries()]
          .map(([batchId, batchUnits]) => ({
            batchId,
            count: batchUnits.length,
            linkedCount: batchUnits.filter((u) => u.orderItemId !== null).length,
            status: batchUnits.every((u) => u.status === "ready")
              ? ("ready" as const)
              : ("brewing" as const),
            createdAt: batchUnits[0].createdAt,
          }))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        return {
          menuItemId,
          menuItemName,
          ordered,
          brewing,
          ready,
          surplus,
          batches,
        };
      })
      .sort((a, b) => a.menuItemName.localeCompare(b.menuItemName));
  }, [ordersById, brewUnitsById]);

  const isEmpty = isSnapshotLoaded && menuSummaries.length === 0;

  const isSubmitting = navigation.state === "submitting";
  const submittingBatchId = isSubmitting ? navigation.formData?.get("batchId") : null;
  const submittingIntent = isSubmitting ? navigation.formData?.get("intent") : null;
  const submittingMenuId = isSubmitting ? navigation.formData?.get("menuItemId") : null;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 shrink-0">
        <div className="px-6 py-3.5 flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-stone-800 leading-tight">ドリップ係</h1>
            <p className="text-xs text-stone-400 mt-0.5">抽出管理</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-stone-400">
              <span
                className={
                  isConnected
                    ? "w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
                    : "w-1.5 h-1.5 rounded-full bg-stone-300"
                }
              />
              {isConnected ? "接続中" : "再接続中"}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 py-10 space-y-24">
        {!isSnapshotLoaded ? (
          <p className="px-6 text-sm text-stone-400 animate-pulse">読み込み中...</p>
        ) : isEmpty ? (
          <p className="px-6 text-sm text-stone-400">進行中の注文・抽出はありません</p>
        ) : (
          menuSummaries.map((menu) => (
            <MenuSection
              key={menu.menuItemId}
              menu={menu}
              eventId={eventId}
              count={countByMenu[menu.menuItemId] ?? 1}
              onCountChange={(n) =>
                setCountByMenu((prev) => ({
                  ...prev,
                  [menu.menuItemId]: n,
                }))
              }
              submittingBatchId={submittingBatchId as string | null}
              submittingIntent={submittingIntent as string | null}
              submittingMenuId={submittingMenuId as string | null}
            />
          ))
        )}

        {actionData && !actionData.ok && (
          <p className="px-6 text-xs text-red-500">{actionData.error}</p>
        )}
        {connectionError && <p className="px-6 text-xs text-red-500">{connectionError}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuSection
// ---------------------------------------------------------------------------

function MenuSection({
  menu,
  eventId,
  count,
  onCountChange,
  submittingBatchId,
  submittingIntent,
  submittingMenuId,
}: {
  menu: MenuBrewSummary;
  eventId: string;
  count: number;
  onCountChange: (n: number) => void;
  submittingBatchId: string | null;
  submittingIntent: string | null;
  submittingMenuId: string | null;
}) {
  const brewingBatches = menu.batches.filter((b) => b.status === "brewing");

  const isStartSubmitting =
    submittingIntent === "brew-start" && submittingMenuId === menu.menuItemId;

  return (
    <section className="px-6 space-y-3">
      {/* メニューヘッダー */}
      <div className="flex flex-col gap-2 mb-2">
        <h2 className="text-2xl font-black text-stone-800">{menu.menuItemName}</h2>
        <div className="flex flex-wrap items-center gap-6">
          <span className="text-lg text-stone-500">
            注文 <span className="font-black text-stone-700 text-3xl ml-1">{menu.ordered}</span>
          </span>
          <span className="text-lg text-stone-500">
            抽出中 <span className="font-black text-orange-600 text-3xl ml-1">{menu.brewing}</span>
          </span>
          <div className="flex items-center gap-2 text-lg text-stone-500">
            完成 <span className="font-black text-emerald-600 text-3xl ml-1">{menu.ready}</span>
            {menu.surplus > 0 && (
              <Form method="post" className="inline-flex ml-2">
                <input type="hidden" name="intent" value="menu-surplus-decrease" />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="menuItemId" value={menu.menuItemId} />
                <button
                  type="submit"
                  disabled={
                    submittingIntent === "menu-surplus-decrease" &&
                    submittingMenuId === menu.menuItemId
                  }
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 transition-colors leading-none pb-1 font-black text-2xl shadow-sm"
                  title="余剰を1件減らす"
                >
                  -
                </button>
              </Form>
            )}
          </div>
        </div>
      </div>

      {/* 抽出中バッチカード */}
      {brewingBatches.map((batch) => {
        const isCompleting =
          submittingBatchId === batch.batchId && submittingIntent === "brew-complete";
        const isCancelling =
          submittingBatchId === batch.batchId && submittingIntent === "brew-cancel";

        return (
          <div
            key={batch.batchId}
            className="bg-white border-2 border-orange-200 rounded-2xl p-6 flex items-center gap-6 shadow-sm"
          >
            <span className="w-3 h-3 rounded-full bg-orange-400 animate-pulse shrink-0" />
            <span className="text-xl font-bold text-stone-700 flex items-center">
              抽出中
              <span className="text-orange-600 font-black text-4xl mx-2">{batch.count}</span>杯
            </span>
            <div className="ml-auto flex gap-4">
              {/* 完了ボタン */}
              <Form method="post">
                <input type="hidden" name="intent" value="brew-complete" />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="batchId" value={batch.batchId} />
                <button
                  type="submit"
                  disabled={isCompleting || isCancelling}
                  className="px-8 py-4 text-xl font-bold bg-emerald-500 text-white rounded-xl disabled:opacity-50 active:scale-95 transition-transform shadow-sm"
                >
                  {isCompleting ? "処理中..." : "完了"}
                </button>
              </Form>
              {/* 取り消しボタン */}
              <Form method="post">
                <input type="hidden" name="intent" value="brew-cancel" />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="batchId" value={batch.batchId} />
                <button
                  type="submit"
                  disabled={isCompleting || isCancelling}
                  className="px-8 py-4 text-xl font-bold bg-white border-2 border-stone-300 text-stone-600 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {isCancelling ? "処理中..." : "取消し"}
                </button>
              </Form>
            </div>
          </div>
        );
      })}

      {/* 新規バッチ開始コントロール */}
      <Form method="post" className="flex items-center gap-6 mt-4">
        <input type="hidden" name="intent" value="brew-start" />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="menuItemId" value={menu.menuItemId} />
        <input type="hidden" name="count" value={count} />

        {/* 杯数選択ボタン */}
        <div className="flex items-center gap-4">
          {[1, 2, 3].map((num) => {
            const isActive = count === num;
            return (
              <button
                key={num}
                type="button"
                onClick={() => onCountChange(num)}
                className={`w-20 h-20 text-4xl font-black rounded-2xl transition-colors shadow-sm border-4 ${
                  isActive
                    ? "bg-amber-100 border-amber-500 text-amber-700"
                    : "bg-white border-stone-200 text-stone-500 hover:bg-stone-50 active:bg-stone-100"
                }`}
              >
                {num}
              </button>
            );
          })}
        </div>
        <span className="text-xl font-bold text-stone-500">杯</span>

        <button
          type="submit"
          disabled={isStartSubmitting}
          className="px-10 py-5 text-2xl font-black bg-amber-500 text-white rounded-xl shadow-sm disabled:opacity-50 active:scale-95 transition-transform"
        >
          {isStartSubmitting ? "開始中..." : "開始"}
        </button>
      </Form>
    </section>
  );
}
