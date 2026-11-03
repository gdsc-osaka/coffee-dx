import { useEffect, useState } from "react";
import { parseJstString } from "~/lib/datetime";
import { cn } from "~/lib/utils";
import type { UnservedOrder } from "../utils/unservedOrders";

function minutesAgo(createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - parseJstString(createdAt).getTime()) / 60000));
}

/** 1 杯 = 1 マス。完成 / 抽出中 / 未着手 を色で区別する */
function CupDots({ ready, brewing, pending }: { ready: number; brewing: number; pending: number }) {
  return (
    <span
      role="img"
      aria-label={`完成${ready}・抽出中${brewing}・未着手${pending}`}
      className="flex shrink-0 gap-0.5"
    >
      {Array.from({ length: ready }, (_, i) => (
        <span key={`r${i}`} className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
      ))}
      {Array.from({ length: brewing }, (_, i) => (
        <span key={`b${i}`} className="h-2.5 w-2.5 rounded-sm bg-orange-400 animate-pulse" />
      ))}
      {Array.from({ length: pending }, (_, i) => (
        <span key={`p${i}`} className="h-2.5 w-2.5 rounded-sm border border-stone-300 bg-white" />
      ))}
    </span>
  );
}

/**
 * 「未提供の注文」。抽出中・未着手の杯が残っている注文を、古い順に小さいカードで横 1 列に並べる
 * （タブレットで縦幅を取らないよう、全件は横スクロールで見る）。見るだけの欄で操作は置かない。
 */
export function UnservedOrders({ orders }: { orders: UnservedOrder[] }) {
  // 経過分数を 1 分ごとに更新する
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section aria-label="未提供の注文" className="px-4 sm:px-8 pb-6 sm:pb-8">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-bold text-stone-700">未提供の注文</h2>
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
          {orders.length}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-stone-400" aria-hidden="true">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            完成
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-400" />
            抽出中
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-stone-300 bg-white" />
            未着手
          </span>
        </span>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-stone-400">未提供の注文はありません</p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-2">
          {orders.map((order) => (
            <li
              key={order.id}
              data-status={order.status}
              className={cn(
                "w-44 shrink-0 rounded-xl border border-l-4 border-stone-200 bg-white px-3 py-2 shadow-sm",
                order.status === "brewing" ? "border-l-orange-400" : "border-l-stone-300",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-stone-800 tabular-nums">
                  #{order.orderNumber}
                </span>
                <span className="text-xs text-stone-400">
                  {minutesAgo(order.createdAt, now)}分前
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-1.5 text-sm">
                    <span className="min-w-0 truncate text-stone-700">{item.name}</span>
                    <span className="shrink-0 text-stone-500 tabular-nums">×{item.quantity}</span>
                    <span className="ml-auto shrink-0">
                      {item.fulfillmentTypeAtOrder === "direct" ? (
                        <span className="rounded bg-sky-100 px-1 text-[10px] font-bold text-sky-700">
                          受渡済
                        </span>
                      ) : (
                        <CupDots
                          ready={item.readyCount}
                          brewing={item.brewingCount}
                          pending={item.pendingCount}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
