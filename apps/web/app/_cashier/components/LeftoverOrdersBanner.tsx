import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type LeftoverItem = {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
};

type LeftoverOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  isFree: boolean;
  businessDate: string;
  createdAt: string;
  items: LeftoverItem[];
};

type LoaderResponse = { orders: LeftoverOrder[] };

const statusLabel: Record<OrderStatus, string> = {
  pending: "待機中",
  brewing: "ドリップ中",
  ready: "提供待ち",
  completed: "完了",
  cancelled: "キャンセル",
};

export function LeftoverOrdersBanner() {
  const [orders, setOrders] = useState<LeftoverOrder[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const fetcher = useFetcher<{ ok: boolean; orderId?: string; error?: string }>();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/cashier/leftover-orders");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LoaderResponse;
      setOrders(data.orders);
    } catch {
      setFetchError("やり残し注文の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // 完了/キャンセル成功後はリストを再取得して件数を更新する。
  // 失敗時 (ok: false) はリストを残したまま fetcher.data.error をダイアログに表示する。
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      refetch();
    }
  }, [fetcher.state, fetcher.data, refetch]);

  const submittingOrderId = (fetcher.formData?.get("orderId") as string | null) ?? null;
  const submittingIntent = (fetcher.formData?.get("intent") as string | null) ?? null;
  const isSubmitting = fetcher.state !== "idle";

  return (
    <>
      {orders.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3">
          <AlertTriangle className="size-4 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900">
              過去日のやり残し注文が {orders.length} 件あります
            </p>
            <p className="text-xs text-amber-700">完了またはキャンセル処理を行ってください</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="bg-white text-amber-900 border-amber-300 hover:bg-amber-100 shrink-0"
            onClick={() => setIsOpen(true)}
          >
            確認する
          </Button>
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>過去日のやり残し注文</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading && orders.length === 0 && (
              <p className="text-sm text-stone-400 text-center py-4">読み込み中...</p>
            )}
            {fetchError && <p className="text-xs text-red-500 text-center py-2">{fetchError}</p>}
            {!isLoading && orders.length === 0 && !fetchError && (
              <p className="text-sm text-stone-400 text-center py-6">やり残しはありません</p>
            )}

            {orders.map((order) => {
              const isThisOrderSubmitting = isSubmitting && submittingOrderId === order.id;
              const canClose = order.status === "ready";
              return (
                <div
                  key={order.id}
                  className="border border-stone-200 rounded-xl p-3 space-y-2 bg-white"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-2xl font-black tabular-nums text-stone-800">
                        #{order.orderNumber}
                      </span>
                      <span className="text-xs text-stone-500 shrink-0">{order.businessDate}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-stone-100 text-stone-600 shrink-0">
                      {statusLabel[order.status]}
                    </span>
                  </div>

                  <ul className="space-y-0.5">
                    {order.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex justify-between text-xs text-stone-600 tabular-nums"
                      >
                        <span className="truncate pr-2">{item.name}</span>
                        <span className="text-stone-500 shrink-0">×{item.quantity}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex gap-2">
                    {canClose && (
                      <fetcher.Form method="post" action="/cashier?index" className="flex-1">
                        <input type="hidden" name="intent" value="complete" />
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="eventId" value={order.businessDate} />
                        <Button type="submit" size="sm" disabled={isSubmitting} className="w-full">
                          {isThisOrderSubmitting && submittingIntent !== "cancel" ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "完了"
                          )}
                        </Button>
                      </fetcher.Form>
                    )}
                    <fetcher.Form method="post" action="/cashier?index" className="flex-1">
                      <input type="hidden" name="intent" value="cancel" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="eventId" value={order.businessDate} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={isSubmitting}
                        className="w-full"
                      >
                        {isThisOrderSubmitting && submittingIntent === "cancel" ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "キャンセル"
                        )}
                      </Button>
                    </fetcher.Form>
                  </div>
                </div>
              );
            })}

            {fetcher.data && fetcher.data.ok === false && fetcher.data.error && (
              <p className="text-xs text-red-500 text-center py-2">{fetcher.data.error}</p>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setIsOpen(false)}
          >
            閉じる
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
