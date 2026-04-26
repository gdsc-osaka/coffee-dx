import { History, Loader2, Printer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { printerClient } from "~/features/printer/printer-client";
import { receiptGenerator } from "~/features/printer/receipt-generator";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type HistoryItem = {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
};

type HistoryOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string; // ISO 文字列（loader が toISOString() で返す）
  items: HistoryItem[];
};

type Cursor = { createdAt: string; id: string } | null;

type LoaderResponse = {
  orders: HistoryOrder[];
  nextCursor: Cursor;
};

interface OrderHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusLabel: Record<OrderStatus, string> = {
  pending: "受付中",
  brewing: "ドリップ中",
  ready: "提供待ち",
  completed: "完了",
  cancelled: "キャンセル",
};

const statusColor: Record<OrderStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  brewing: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  completed: "bg-stone-700 text-stone-300 border-stone-600",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/30",
};

// 端末のローカル TZ に依存せず、注文日時を JST で表示する
const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatJstShort(iso: string): string {
  const parts = jstFormatter.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export function OrderHistoryDialog({ open, onOpenChange }: OrderHistoryDialogProps) {
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (cursor: Cursor) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cursor) {
        params.set("cursorCreatedAt", cursor.createdAt);
        params.set("cursorId", cursor.id);
      }
      const res = await fetch(`/cashier/orders-history?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LoaderResponse;
      return data;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ダイアログを開いた瞬間に最初のページを読み込む（閉じている間は何もしない）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOrders([]);
    setNextCursor(null);
    fetchPage(null)
      .then((data) => {
        if (cancelled) return;
        setOrders(data.orders);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError("履歴の取得に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchPage]);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    try {
      const data = await fetchPage(nextCursor);
      setOrders((prev) => [...prev, ...data.orders]);
      setNextCursor(data.nextCursor);
    } catch {
      setError("追加の履歴の取得に失敗しました");
    }
  };

  const handleReprint = async (order: HistoryOrder) => {
    setReprintingId(order.id);
    try {
      // プリンターが未接続なら接続を試みる（ユーザージェスチャー内なので OK）
      if (printerClient.status !== "connected") {
        await printerClient.connect();
      }
      const canvas = await receiptGenerator.generate({
        orderNumber: order.orderNumber,
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
        timestamp: new Date(order.createdAt),
      });
      await printerClient.print(canvas);
    } catch (e) {
      console.error("Reprint failed:", e);
      alert("再印刷に失敗しました。プリンターの状態を確認してください。");
    } finally {
      setReprintingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-stone-900 text-white border-stone-800 max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <History className="size-4" />
            注文履歴
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {orders.length === 0 && !isLoading && !error && (
            <p className="text-sm text-stone-400 text-center py-8">注文履歴はありません</p>
          )}

          {orders.map((order) => (
            <div
              key={order.id}
              className="bg-stone-800 border border-stone-700 rounded-xl p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-2xl font-black tabular-nums">#{order.orderNumber}</span>
                  <span className="text-xs text-stone-400 shrink-0">
                    {formatJstShort(order.createdAt)}
                  </span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${statusColor[order.status]}`}
                >
                  {statusLabel[order.status]}
                </span>
              </div>
              <ul className="space-y-0.5">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex justify-between text-xs text-stone-300 tabular-nums"
                  >
                    <span className="truncate pr-2">{item.name}</span>
                    <span className="text-stone-500 shrink-0">×{item.quantity}</span>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full bg-transparent text-white border-stone-600 hover:bg-stone-700 hover:text-white h-9"
                disabled={reprintingId === order.id}
                onClick={() => handleReprint(order)}
              >
                {reprintingId === order.id ? (
                  <Loader2 className="size-3 mr-1.5 animate-spin" />
                ) : (
                  <Printer className="size-3 mr-1.5" />
                )}
                受付番号票を再印刷
              </Button>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center justify-center py-4 text-stone-400 text-xs gap-2">
              <Loader2 className="size-3 animate-spin" />
              読み込み中...
            </div>
          )}

          {error && <p className="text-xs text-red-400 text-center py-2">{error}</p>}

          {nextCursor && !isLoading && (
            <Button
              variant="outline"
              size="sm"
              className="w-full bg-transparent text-stone-300 border-stone-700 hover:bg-stone-800 hover:text-white"
              onClick={handleLoadMore}
            >
              さらに読み込む
            </Button>
          )}
        </div>

        <Button
          className="w-full bg-stone-100 text-stone-900 hover:bg-white h-11 rounded-xl shrink-0"
          onClick={() => onOpenChange(false)}
        >
          閉じる
        </Button>
      </DialogContent>
    </Dialog>
  );
}
