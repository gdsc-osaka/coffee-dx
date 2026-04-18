import { Form } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { cn } from "~/lib/utils";

type OrderStatus = "pending" | "brewing" | "ready";

type OrderStatusCardProps = {
  status: OrderStatus;
  orderNumber: number;
  createdAt: string;
  itemCount: number;
  items?: Array<{ id: string; name?: string; quantity: number }>;
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

function parseJstDate(value: string): Date {
  return new Date(value.replace(" ", "T") + "+09:00");
}

function formatMinutesAgo(createdAt: string): string {
  const diffMinutes = Math.max(
    0,
    Math.floor((Date.now() - parseJstDate(createdAt).getTime()) / 60000),
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
            <ul className="flex-1 space-y-1.5 mb-3">
              {items.map((item) => (
                <li key={item.id} className="flex justify-between text-sm">
                  <span className="text-stone-700">{item.name ?? "商品"}</span>
                  <span className="text-stone-400 tabular-nums">×{item.quantity}</span>
                </li>
              ))}
            </ul>
          )}
          {!items || items.length === 0 ? <div className="flex-1" /> : null}

          {action && (
            <Form method="post">
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
