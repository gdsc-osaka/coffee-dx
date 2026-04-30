import { useEffect, useState } from "react";
import { Form } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { parseJstString } from "~/lib/datetime";
import { cn } from "~/lib/utils";

type OrderStatus = "pending" | "brewing" | "ready";

type OrderStatusCardProps = {
  status: OrderStatus;
  orderNumber: number;
  createdAt: string;
  itemCount: number;
  items?: Array<{
    id: string;
    name?: string;
    quantity: number;
    readyCount?: number;
    brewingCount?: number;
    pendingCount?: number;
  }>;
  action?: {
    label: string;
    isSubmitting?: boolean;
    fields: Array<{ name: string; value: string }>;
  };
  className?: string;
};

const statusConfig = {
  pending: {
    borderClass: "border-l-amber-300",
    dotClass: "bg-amber-400",
    buttonClass: "bg-amber-600 hover:bg-amber-700 text-white border-0",
  },
  brewing: {
    borderClass: "border-l-orange-400",
    dotClass: "bg-orange-400 animate-pulse",
    buttonClass: "bg-orange-600 hover:bg-orange-700 text-white border-0",
  },
  ready: {
    borderClass: "border-l-emerald-400",
    dotClass: "bg-emerald-500 animate-pulse",
    buttonClass: "bg-emerald-600 hover:bg-emerald-700 text-white border-0",
  },
} satisfies Record<OrderStatus, object>;

function formatMinutesAgo(createdAt: string): string {
  const diffMinutes = Math.max(
    0,
    Math.floor((Date.now() - parseJstString(createdAt).getTime()) / 60000),
  );
  return `${diffMinutes}分前`;
}

export function OrderStatusCard({
  status,
  orderNumber,
  createdAt,
  itemCount,
  items,
  action,
  className,
}: OrderStatusCardProps) {
  const cfg = statusConfig[status];

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      data-status={status}
      className={cn("w-[17rem] shrink-0 snap-start sm:w-[19rem]", className)}
    >
      <Card
        className={cn(
          "flex flex-col h-full min-h-[14rem] overflow-hidden rounded-2xl py-0",
          "bg-white border border-stone-200 border-l-4",
          "shadow-sm",
          cfg.borderClass,
        )}
      >
        <CardHeader className="pb-2 pt-4 px-4 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black tracking-tight text-stone-800 leading-none">
                  #{orderNumber}
                </span>
                <span className="text-xs text-stone-400 shrink-0">
                  {formatMinutesAgo(createdAt)}
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-1">{itemCount}点</p>
            </div>
            <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", cfg.dotClass)} />
          </div>
          <div className="h-px mt-3 bg-stone-100" />
        </CardHeader>

        <CardContent className="flex flex-col flex-1 pt-0 px-4 pb-4">
          {items && items.length > 0 && (
            <ul className="flex-1 space-y-3 mb-3 mt-3">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-700 font-medium">{item.name ?? "商品"}</span>
                    <span className="text-stone-500 tabular-nums font-medium">
                      ×{item.quantity}
                    </span>
                  </div>
                  {/* Virtual Status Display */}
                  {(item.readyCount !== undefined ||
                    item.brewingCount !== undefined ||
                    item.pendingCount !== undefined) && (
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: item.readyCount || 0 }).map((_, i) => (
                        <span
                          key={`ready-${i}`}
                          className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold"
                        >
                          ■ 完成
                        </span>
                      ))}
                      {Array.from({ length: item.brewingCount || 0 }).map((_, i) => (
                        <span
                          key={`brewing-${i}`}
                          className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold"
                        >
                          □ 抽出中
                        </span>
                      ))}
                      {Array.from({ length: item.pendingCount || 0 }).map((_, i) => (
                        <span
                          key={`pending-${i}`}
                          className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded font-bold"
                        >
                          □ 未着手
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!items || items.length === 0 ? <div className="flex-1" /> : null}

          {action && (
            <Form method="post" className="mt-auto">
              {action.fields.map((field) => (
                <input key={field.name} type="hidden" name={field.name} value={field.value} />
              ))}
              <Button
                type="submit"
                className={cn("h-16 w-full text-base font-bold rounded-xl", cfg.buttonClass)}
                disabled={action.isSubmitting}
              >
                {action.isSubmitting ? "更新中..." : action.label}
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
