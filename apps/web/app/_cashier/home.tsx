import { useEffect, useMemo, useRef, useState } from "react";
import { useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { OrderStatusCard } from "~/components/order-status-card";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "~/lib/order-do";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type CashierOrderItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

type CashierOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: CashierOrderItem[];
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
  | { type: "SNAPSHOT"; orders: CashierOrder[]; brewUnits: BrewUnitData[] }
  | { type: "ORDER_CREATED"; order: CashierOrder }
  | { type: "ORDER_UPDATED"; orderId: string; status: OrderStatus }
  | { type: "BREW_UNITS_CREATED"; brewUnits: BrewUnitData[] }
  | { type: "BREW_UNIT_UPDATED"; brewUnit: BrewUnitData }
  | { type: "BREW_UNIT_DELETED"; brewUnitId: string }
  | { type: "pong" };

// Cloudflare の WebSocket アイドルタイムアウト（約 100 秒）に達する前に
// 必ず往復が発生するよう、25 秒ごとに ping を送る。
const PING_INTERVAL_MS = 25_000;
// ping 送信後 10 秒以内に pong が返らなければ「半開き」TCP 接続と判定し、
// クライアント側から能動的に切断 → 再接続を走らせる。
const PONG_TIMEOUT_MS = 10_000;

type VirtualOrderItem = CashierOrderItem & {
  readyCount: number;
  brewingCount: number;
  pendingCount: number;
};

type VirtualOrder = Omit<CashierOrder, "items"> & {
  items: VirtualOrderItem[];
  // status は UI 配置用の仮想ステータス、serverStatus は OrderDO/D1 の実ステータス。
  // 完了アクションは serverStatus === "ready" の注文にのみ許可する（DO の /close は ready 以外で 409）。
  serverStatus: OrderStatus;
};

export async function loader(_args: Route.LoaderArgs) {
  return { eventId: getBusinessDate() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const orderId = formData.get("orderId");
  const eventId = formData.get("eventId");

  if (typeof orderId !== "string" || orderId.length === 0) {
    return { ok: false, error: "orderId が不正です" };
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return { ok: false, error: "eventId が不正です" };
  }

  try {
    const stub = getOrderDOStub(context.cloudflare.env, eventId);
    await callOrderDO(stub, eventId, `/do/orders/${encodeURIComponent(orderId)}/close`, {
      method: "POST",
    });
    return { ok: true, orderId };
  } catch {
    return {
      ok: false,
      error: "提供済みの更新に失敗しました。少し待って再度お試しください。",
    };
  }
}

export default function CashierHome({ loaderData }: { loaderData: { eventId: string } }) {
  const { eventId } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [ordersById, setOrdersById] = useState<Record<string, CashierOrder>>({});
  const [brewUnitsById, setBrewUnitsById] = useState<Record<string, BrewUnitData>>({});
  const [isSnapshotLoaded, setIsSnapshotLoaded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const reconnectTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    // 直近 connect() で作成したソケット・タイマーを一括解放するクロージャ。
    // connect() 呼び出しごとに再代入され、reconnectImmediately() や useEffect の
    // cleanup から呼ぶことで「古いソケットに紐づくハートビートタイマーが
    // 新しいソケットへ ping を送る」リークを防ぐ。
    let teardownConnection = () => {};
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;

      // ハートビート用タイマー。connect() の呼び出しごとに新しいソケットに紐づくため、
      // useEffect 全体ではなく connect() スコープの local 変数として管理する。
      let pingIntervalId: number | null = null;
      let pongTimeoutId: number | null = null;
      const clearHeartbeatTimers = () => {
        if (pingIntervalId !== null) {
          window.clearInterval(pingIntervalId);
          pingIntervalId = null;
        }
        if (pongTimeoutId !== null) {
          window.clearTimeout(pongTimeoutId);
          pongTimeoutId = null;
        }
      };

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // この connect() 内で常に同じソケットを参照するため const に固定する。
      // 外側 socket は次の connect() で上書きされるが、ここのコールバックは
      // currentSocket だけを見るので「古いタイマーが新しいソケットを操作する」事故が起きない。
      const currentSocket = new WebSocket(
        `${protocol}//${window.location.host}/ws?eventId=${eventId}`,
      );
      socket = currentSocket;

      teardownConnection = () => {
        clearHeartbeatTimers();
        currentSocket.onclose = null;
        currentSocket.onerror = null;
        if (currentSocket.readyState !== WebSocket.CLOSED) {
          currentSocket.close();
        }
        if (socket === currentSocket) socket = null;
      };

      currentSocket.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
        setConnectionError(null);

        pingIntervalId = window.setInterval(() => {
          if (currentSocket.readyState !== WebSocket.OPEN) return;
          try {
            currentSocket.send(JSON.stringify({ type: "ping" }));
          } catch {
            // send 自体が失敗するソケットは確実に死んでいる。close 経由で再接続。
            currentSocket.close();
            return;
          }
          if (pongTimeoutId !== null) window.clearTimeout(pongTimeoutId);
          pongTimeoutId = window.setTimeout(() => {
            // pong が返ってこない = 半開き接続。能動的に閉じて onclose の再接続経路に乗せる。
            currentSocket.close();
          }, PONG_TIMEOUT_MS);
        }, PING_INTERVAL_MS);
      };

      currentSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "pong") {
            if (pongTimeoutId !== null) {
              window.clearTimeout(pongTimeoutId);
              pongTimeoutId = null;
            }
            return;
          }

          if (message.type === "SNAPSHOT") {
            const nextOrders: Record<string, CashierOrder> = {};
            for (const order of message.orders) nextOrders[order.id] = order;
            setOrdersById(nextOrders);

            const nextUnits: Record<string, BrewUnitData> = {};
            for (const unit of message.brewUnits) nextUnits[unit.id] = unit;
            setBrewUnitsById(nextUnits);

            setIsSnapshotLoaded(true);
            return;
          }

          if (message.type === "ORDER_CREATED") {
            setOrdersById((prev) => ({ ...prev, [message.order.id]: message.order }));
            return;
          }

          if (message.type === "ORDER_UPDATED") {
            setOrdersById((prev) => {
              const existing = prev[message.orderId];
              if (!existing) return prev;

              if (message.status === "completed" || message.status === "cancelled") {
                const { [message.orderId]: _removed, ...rest } = prev;
                return rest;
              }

              return {
                ...prev,
                [message.orderId]: {
                  ...existing,
                  status: message.status,
                },
              };
            });
            return;
          }

          if (message.type === "BREW_UNITS_CREATED") {
            setBrewUnitsById((prev) => {
              const next = { ...prev };
              for (const u of message.brewUnits) next[u.id] = u;
              return next;
            });
            return;
          }

          if (message.type === "BREW_UNIT_UPDATED") {
            setBrewUnitsById((prev) => ({
              ...prev,
              [message.brewUnit.id]: message.brewUnit,
            }));
            return;
          }

          if (message.type === "BREW_UNIT_DELETED") {
            setBrewUnitsById((prev) => {
              const { [message.brewUnitId]: _removed, ...rest } = prev;
              return rest;
            });
            return;
          }
        } catch {
          setConnectionError("メッセージ受信時にエラーが発生しました");
        }
      };

      currentSocket.onclose = () => {
        clearHeartbeatTimers();
        setIsConnected(false);
        const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
        retryCountRef.current += 1;
        reconnectTimeoutRef.current = window.setTimeout(connect, delay);
      };

      currentSocket.onerror = () => {
        setConnectionError("接続エラー。自動で再接続します。");
        // onerror の後に onclose が必ず続くとは限らない（特定の Service Worker 経由や
        // モバイルキャリアの中継機器で起こり得る）。onclose に依存せず、ここでも
        // ハートビートタイマーを明示的に停止してから close() を呼ぶ。
        // clearHeartbeatTimers() は冪等なので onclose 側で再度呼ばれても問題ない。
        clearHeartbeatTimers();
        if (currentSocket.readyState !== WebSocket.CLOSED) {
          currentSocket.close();
        }
      };
    };

    // 端末スリープからの復帰、別アプリからの戻り、bfcache 復元時に呼ばれる。
    // 待機中のバックオフ再接続をキャンセルし、即時に新しい接続を張る。
    const reconnectImmediately = () => {
      if (unmounted) return;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      retryCountRef.current = 0;
      // teardownConnection() は onclose を無効化してから close() するため、
      // onclose 内の setIsConnected(false) は走らない。ヘッダーが「接続中」表示の
      // まま再接続が進むのを避けるため、ここで明示的に状態を更新する。
      setIsConnected(false);
      // 旧ソケットのハンドラ・ハートビートタイマーを teardown でまとめて解放する。
      // 直接 socket.onclose = null してから close() するとタイマーが残り、
      // 新しいソケットへ ping を送ったり close() してしまう。
      teardownConnection();
      connect();
    };

    const checkAndReconnect = () => {
      // CONNECTING 中に reconnectImmediately() を走らせるとタイマー多重化や二重接続を
      // 招くため、再接続が必要なのは「ソケットが消えた / すでに CLOSED」状態のときだけ。
      // OPEN の場合はハートビート (PING_INTERVAL_MS + PONG_TIMEOUT_MS) で死活を検出する。
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        reconnectImmediately();
      }
    };

    const handleVisibilityCheck = () => {
      if (document.visibilityState !== "visible") return;
      checkAndReconnect();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      // pageshow は初回ロード時にも発火する。そのタイミングで socket がまだ
      // CONNECTING の最中だと不要な reconnect を引き起こすため、bfcache から
      // 復元された (event.persisted === true) ときだけ判定する。
      if (!event.persisted) return;
      checkAndReconnect();
    };

    document.addEventListener("visibilitychange", handleVisibilityCheck);
    // bfcache から復元された場合は visibilitychange が発火しないため pageshow も拾う
    window.addEventListener("pageshow", handlePageShow);

    connect();

    return () => {
      unmounted = true;
      document.removeEventListener("visibilitychange", handleVisibilityCheck);
      window.removeEventListener("pageshow", handlePageShow);
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      teardownConnection();
    };
  }, [eventId]);

  const virtualOrders = useMemo(() => {
    const units = Object.values(brewUnitsById);

    // 1. メニューごとの brewing 数を集計
    const brewingCounts = new Map<string, number>();
    for (const u of units) {
      if (u.status === "brewing") {
        brewingCounts.set(u.menuItemId, (brewingCounts.get(u.menuItemId) || 0) + 1);
      }
    }

    // 2. 注文を古い順にソートして描画ステータスを決定
    const sortedOrders = Object.values(ordersById).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.orderNumber - b.orderNumber,
    );

    const result: VirtualOrder[] = [];

    for (const order of sortedOrders) {
      if (order.status === "completed" || order.status === "cancelled") continue;

      const virtualItems: VirtualOrderItem[] = [];
      let isAllReady = true;
      let hasBrewing = false;

      for (const item of order.items) {
        // 実際に紐付いている ready な杯数
        const readyCount = units.filter(
          (u) => u.orderItemId === item.id && u.status === "ready",
        ).length;
        // まだ必要な杯数
        const neededCount = item.quantity - readyCount;

        // 仮想的に割り当て可能な brewing 杯数
        const availableBrewing = brewingCounts.get(item.menuItemId) || 0;
        const virtualBrewingCount = Math.min(neededCount, availableBrewing);

        // 残りの brewing 数を減らす
        brewingCounts.set(item.menuItemId, availableBrewing - virtualBrewingCount);

        const pendingCount = neededCount - virtualBrewingCount;

        if (pendingCount > 0 || virtualBrewingCount > 0) {
          isAllReady = false;
        }
        if (virtualBrewingCount > 0) {
          hasBrewing = true;
        }

        virtualItems.push({
          ...item,
          readyCount,
          brewingCount: virtualBrewingCount,
          pendingCount,
        });
      }

      // 仮想ステータスを決定（実際のDB上はpendingのままでも、UI上はbrewingとして扱う）
      let displayStatus = order.status;
      if (displayStatus !== "ready") {
        if (isAllReady) {
          displayStatus = "ready";
        } else if (hasBrewing) {
          displayStatus = "brewing";
        } else {
          displayStatus = "pending";
        }
      }

      result.push({
        ...order,
        status: displayStatus,
        serverStatus: order.status,
        items: virtualItems,
      });
    }

    return result;
  }, [ordersById, brewUnitsById]);

  // OrderNumber順でのソート（あるいはcreatedAt順。Cashierは通常OrderNumber順が見やすい）
  const allOrdersSorted = useMemo(
    () => [...virtualOrders].sort((a, b) => a.orderNumber - b.orderNumber),
    [virtualOrders],
  );

  const pendingOrders = useMemo(
    () => allOrdersSorted.filter((order) => order.status === "pending"),
    [allOrdersSorted],
  );
  const brewingOrders = useMemo(
    () => allOrdersSorted.filter((order) => order.status === "brewing"),
    [allOrdersSorted],
  );
  const readyOrders = useMemo(
    () => allOrdersSorted.filter((order) => order.status === "ready"),
    [allOrdersSorted],
  );

  const submittingOrderId =
    navigation.state === "submitting" ? navigation.formData?.get("orderId") : null;

  const isEmpty = isSnapshotLoaded && allOrdersSorted.length === 0;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 shrink-0">
        <div className="px-12 py-3.5 flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-stone-800 leading-tight">会計係</h1>
            <p className="text-xs text-stone-400 mt-0.5">受け渡し管理</p>
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
      <div className="flex-1 py-5 space-y-6">
        {!isSnapshotLoaded ? (
          <p className="px-6 text-sm text-stone-400 animate-pulse">読み込み中...</p>
        ) : isEmpty ? (
          <p className="px-6 text-sm text-stone-400">進行中の注文はありません</p>
        ) : (
          <>
            {/* 提供待ち */}
            <section className="px-6">
              <div className="flex items-center gap-2 px-6 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-lg font-bold text-stone-700">提供待ち</h2>
                <span className="text-xs bg-emerald-50 text-emerald-600 px-6 py-0.5 rounded-full font-medium">
                  {readyOrders.length}
                </span>
              </div>
              {readyOrders.length === 0 ? (
                <p className="px-6 text-sm text-stone-400">提供待ちの注文はありません</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-pl-6">
                  <div className="w-6 shrink-0" />
                  {readyOrders.map((order) => {
                    const isSubmittingThisOrder = submittingOrderId === order.id;
                    // 仮想 ready のみで実 status が pending/brewing の場合、サーバ側 /close は 409 になる。
                    // ボタンは出さず、ドリップ完了の確定を待つプレースホルダを表示する。
                    const canClose = order.serverStatus === "ready";
                    return (
                      <OrderStatusCard
                        key={order.id}
                        status="ready"
                        orderNumber={order.orderNumber}
                        createdAt={order.createdAt}
                        itemCount={order.items.reduce((sum, item) => sum + item.quantity, 0)}
                        items={order.items.map((item) => ({
                          id: item.id,
                          name: item.name,
                          quantity: item.quantity,
                          readyCount: item.readyCount,
                          brewingCount: item.brewingCount,
                          pendingCount: item.pendingCount,
                        }))}
                        action={
                          canClose
                            ? {
                                label: "完了",
                                isSubmitting: isSubmittingThisOrder,
                                fields: [
                                  { name: "orderId", value: order.id },
                                  { name: "eventId", value: eventId },
                                ],
                              }
                            : undefined
                        }
                        actionPlaceholder={canClose ? undefined : "ドリップ完了後に提供できます"}
                      />
                    );
                  })}
                  <div className="w-6 shrink-0" />
                </div>
              )}
            </section>

            {/* ドリップ中 */}
            <section className="px-6">
              <div className="flex items-center gap-2 px-6 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                <h2 className="text-lg font-bold text-stone-700">ドリップ中</h2>
                <span className="text-xs bg-orange-50 text-orange-600 px-6 py-0.5 rounded-full font-medium">
                  {brewingOrders.length}
                </span>
              </div>
              {brewingOrders.length === 0 ? (
                <p className="px-6 text-sm text-stone-400">ドリップ中の注文はありません</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-pl-6">
                  <div className="w-6 shrink-0" />
                  {brewingOrders.map((order) => (
                    <OrderStatusCard
                      key={order.id}
                      status="brewing"
                      orderNumber={order.orderNumber}
                      createdAt={order.createdAt}
                      itemCount={order.items.reduce((sum, item) => sum + item.quantity, 0)}
                      items={order.items.map((item) => ({
                        id: item.id,
                        name: item.name,
                        quantity: item.quantity,
                        readyCount: item.readyCount,
                        brewingCount: item.brewingCount,
                        pendingCount: item.pendingCount,
                      }))}
                    />
                  ))}
                  <div className="w-6 shrink-0" />
                </div>
              )}
            </section>

            {/* 待機中 (pending) */}
            <section className="px-6">
              <div className="flex items-center gap-2 px-6 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <h2 className="text-lg font-bold text-stone-700">待機中</h2>
                <span className="text-xs bg-amber-50 text-amber-600 px-6 py-0.5 rounded-full font-medium">
                  {pendingOrders.length}
                </span>
              </div>
              {pendingOrders.length === 0 ? (
                <p className="px-6 text-sm text-stone-400">待機中の注文はありません</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-pl-6">
                  <div className="w-6 shrink-0" />
                  {pendingOrders.map((order) => (
                    <OrderStatusCard
                      key={order.id}
                      status="pending"
                      orderNumber={order.orderNumber}
                      createdAt={order.createdAt}
                      itemCount={order.items.reduce((sum, item) => sum + item.quantity, 0)}
                      items={order.items.map((item) => ({
                        id: item.id,
                        name: item.name,
                        quantity: item.quantity,
                        readyCount: item.readyCount,
                        brewingCount: item.brewingCount,
                        pendingCount: item.pendingCount,
                      }))}
                    />
                  ))}
                  <div className="w-6 shrink-0" />
                </div>
              )}
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
