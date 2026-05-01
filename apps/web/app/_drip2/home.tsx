import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { callOrderDO, getBusinessDate, getOrderDOStub, isValidEventId } from "~/lib/order-do";
import { ProductionDashboard } from "./components/ProductionDashboard";
import { BrewLane, type LaneActiveDescriptor } from "./components/BrewLane";
import type { LaneIdleState, LanePendingState } from "./components/LaneIdle";
import { SoundToggle } from "./components/SoundToggle";
import { ensureAudioUnlocked, isAudioUnlocked } from "./utils/audioUnlock";

/** 物理ドリッパーの数を想定した固定レーン数。3 個のスロットを常に表示する。 */
const LANE_COUNT = 3;
type LaneSlot = LaneIdleState | LanePendingState | LaneActiveDescriptor;
const buildIdleSlot = (): LaneIdleState => ({
  kind: "idle",
  menuItemId: null,
  count: 1,
});

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
  /** ドリップ係が抽出開始時に指定したタイマー秒数。NULL は未指定。 */
  targetDurationSec: number | null;
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

export type BrewBatchSummary = {
  batchId: string;
  count: number;
  /** order_item_id IS NOT NULL な杯数（遅延バインディングでは ready 後に設定される） */
  linkedCount: number;
  status: "brewing" | "ready";
  createdAt: string;
};

export type MenuBrewSummary = {
  menuItemId: string;
  menuItemName: string;
  ordered: number;
  brewing: number;
  ready: number;
  /** ready かつ未紐付き（余剰削除可能）な杯数 */
  surplus: number;
  batches: BrewBatchSummary[];
};

export type ProductionIndicator = {
  menuItemId: string;
  menuItemName: string;
  /** 今後抽出すべき杯数: max(0, ordered - ready - brewing) */
  shortage: number;
  /** ストック余裕: max(0, ready + brewing - ordered) */
  extra: number;
  /** ready かつ未紐付き（= 余剰削除可能）な杯数 */
  surplus: number;
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

  // フォーマット検証まで action 内で済ませる（getOrderDOStub は try の外なので、
  // 不正フォーマットの eventId が来ると 500 になってしまうため）。
  if (typeof eventId !== "string" || !isValidEventId(eventId)) {
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
        const rawDuration = formData.get("targetDurationSec");
        const parsedDuration = rawDuration == null ? NaN : Number(rawDuration);
        const targetDurationSec =
          Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.floor(parsedDuration) : null;
        await callOrderDO(stub, eventId, "/do/brew-units", {
          body: { menuItemId, count, targetDurationSec },
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

  /**
   * 固定 N 個のレーンスロット。idle / pending / active を独立に持つ。
   * 抽出が完了してもスロット自体は消えず idle に戻る（物理ドリッパーに対応する設計）。
   */
  const [laneSlots, setLaneSlots] = useState<LaneSlot[]>(() =>
    Array.from({ length: LANE_COUNT }, buildIdleSlot),
  );

  const [isSnapshotLoaded, setIsSnapshotLoaded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(() => isAudioUnlocked());

  /** 任意のユーザー操作で AudioContext を unlock する。iOS / Android で必要。 */
  const handleUnlockAudio = useCallback(() => {
    ensureAudioUnlocked().then((ok) => {
      if (ok) setAudioUnlocked(true);
    });
  }, []);

  // 初回の pointerdown で自動アンロックを試みる（明示的なボタンの保険）
  useEffect(() => {
    if (audioUnlocked) return;
    const onAnyPointer = () => {
      handleUnlockAudio();
    };
    window.addEventListener("pointerdown", onAnyPointer, { once: true });
    return () => window.removeEventListener("pointerdown", onAnyPointer);
  }, [audioUnlocked, handleUnlockAudio]);

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
  }, [ordersById, brewUnitsById, menus]);

  const productionIndicators = useMemo((): ProductionIndicator[] => {
    return menuSummaries.map((m) => ({
      menuItemId: m.menuItemId,
      menuItemName: m.menuItemName,
      shortage: Math.max(0, m.ordered - m.ready - m.brewing),
      extra: Math.max(0, m.ready + m.brewing - m.ordered),
      surplus: m.surplus,
    }));
  }, [menuSummaries]);

  const isSubmitting = navigation.state === "submitting";
  const submittingBatchId = isSubmitting ? navigation.formData?.get("batchId") : null;
  const submittingIntent = isSubmitting ? navigation.formData?.get("intent") : null;
  const submittingMenuId = isSubmitting ? navigation.formData?.get("menuItemId") : null;

  // brewing バッチを「レーン候補」として派生（createdAt 昇順）。
  // 自分のレーンスロットへの割当は別途 useEffect で行う。
  const activeBatches = useMemo<LaneActiveDescriptor[]>(() => {
    const allUnits = Object.values(brewUnitsById);
    const byBatch = new Map<string, BrewUnitData[]>();
    for (const u of allUnits) {
      if (u.status !== "brewing") continue;
      if (!byBatch.has(u.batchId)) byBatch.set(u.batchId, []);
      byBatch.get(u.batchId)!.push(u);
    }
    return [...byBatch.entries()]
      .map(([batchId, units]): LaneActiveDescriptor => {
        const first = units[0];
        return {
          kind: "active",
          batchId,
          menuItemName: first.menuItemName,
          count: units.length,
          createdAt: first.createdAt,
          targetDurationSec: first.targetDurationSec,
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [brewUnitsById]);

  // brewing バッチをレーンスロットへ自動割当する。
  // - active スロットの batchId が brewing でなくなったら idle に戻す（完了/取消で消えない）
  // - 未紐付きの brewing バッチを最も若い idle スロットへ詰める
  // - active スロットの最新メタ（count・targetDurationSec 等）も同期する
  useEffect(() => {
    setLaneSlots((prev) => {
      const next = [...prev];
      const batchById = new Map(activeBatches.map((b) => [b.batchId, b]));
      let changed = false;

      for (let i = 0; i < next.length; i++) {
        const slot = next[i];
        if (slot.kind !== "active") continue;
        const batch = batchById.get(slot.batchId);
        if (!batch) {
          next[i] = buildIdleSlot();
          changed = true;
        } else if (batch !== slot) {
          // メタが更新されているケース（targetDurationSec が後から付くなど）に追従
          if (
            batch.count !== slot.count ||
            batch.menuItemName !== slot.menuItemName ||
            batch.createdAt !== slot.createdAt ||
            batch.targetDurationSec !== slot.targetDurationSec
          ) {
            next[i] = batch;
            changed = true;
          }
        }
      }

      const occupied = new Set(
        next.filter((s): s is LaneActiveDescriptor => s.kind === "active").map((s) => s.batchId),
      );
      for (const batch of activeBatches) {
        if (occupied.has(batch.batchId)) continue;
        const idleIdx = next.findIndex((s) => s.kind === "idle");
        if (idleIdx < 0) break; // 空きスロット無し（レーン超過）
        next[idleIdx] = batch;
        occupied.add(batch.batchId);
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [activeBatches]);

  const updateLaneState = useCallback(
    (laneIndex: number, nextState: LaneIdleState | LanePendingState) => {
      setLaneSlots((prev) => {
        const arr = [...prev];
        arr[laneIndex] = nextState;
        return arr;
      });
    },
    [],
  );

  /** Start 押下時：スロットを idle に戻す。BREW_UNITS_CREATED 受信で再度 active に切替わる */
  const handleStart = useCallback((laneIndex: number) => {
    setLaneSlots((prev) => {
      const arr = [...prev];
      arr[laneIndex] = buildIdleSlot();
      return arr;
    });
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 shrink-0">
        <div className="px-6 py-3.5 flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-stone-800 leading-tight">ドリップ係</h1>
            <p className="text-xs text-stone-400 mt-0.5">抽出管理</p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <SoundToggle unlocked={audioUnlocked} onUnlock={handleUnlockAudio} />
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
      <div className="flex-1 flex flex-col pb-10">
        {!isSnapshotLoaded ? (
          <p className="px-6 py-10 text-sm text-stone-400 animate-pulse">読み込み中...</p>
        ) : (
          <>
            <ProductionDashboard
              indicators={productionIndicators}
              eventId={eventId}
              submittingIntent={submittingIntent as string | null}
              submittingMenuId={submittingMenuId as string | null}
            />
            <section aria-label="抽出レーン" className="px-4 sm:px-8 py-6 sm:py-8 overflow-x-auto">
              <div className="flex flex-row gap-4 sm:gap-6">
                {laneSlots.map((slot, idx) => {
                  const laneNumber = idx + 1;
                  const batchId = slot.kind === "active" ? slot.batchId : null;
                  const isCompleting =
                    batchId !== null &&
                    submittingBatchId === batchId &&
                    submittingIntent === "brew-complete";
                  const isCancelling =
                    batchId !== null &&
                    submittingBatchId === batchId &&
                    submittingIntent === "brew-cancel";
                  const isStarting =
                    submittingIntent === "brew-start" &&
                    slot.kind === "pending" &&
                    submittingMenuId === slot.menuItemId;
                  return (
                    <div key={idx} className="w-[22rem] sm:w-[26rem] shrink-0">
                      <BrewLane
                        laneNumber={laneNumber}
                        state={slot}
                        menus={menus}
                        eventId={eventId}
                        onChangeState={(next) => updateLaneState(idx, next)}
                        onStart={() => handleStart(idx)}
                        isStarting={isStarting}
                        isCompleting={isCompleting}
                        isCancelling={isCancelling}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {actionData && !actionData.ok && (
          <p className="px-6 text-xs text-red-500">{actionData.error}</p>
        )}
        {connectionError && <p className="px-6 text-xs text-red-500">{connectionError}</p>}
      </div>
    </div>
  );
}
