import { Form } from "react-router";
import { AlertTriangle, Check, PackagePlus } from "lucide-react";
import type { ProductionIndicator } from "../home";

export function ProductionDashboard({
  indicators,
  eventId,
  submittingIntent,
  submittingMenuId,
}: {
  indicators: ProductionIndicator[];
  eventId: string;
  submittingIntent: string | null;
  submittingMenuId: string | null;
}) {
  if (indicators.length === 0) {
    return null;
  }

  return (
    <section aria-label="生産状況" className="px-4 sm:px-8 pt-6 sm:pt-8">
      <h2 className="text-lg font-bold text-stone-700 mb-3">生産状況</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
        {indicators.map((ind) => (
          <ProductionRow
            key={ind.menuItemId}
            indicator={ind}
            eventId={eventId}
            isDecrementing={
              submittingIntent === "menu-surplus-decrease" && submittingMenuId === ind.menuItemId
            }
          />
        ))}
      </ul>
    </section>
  );
}

function ProductionRow({
  indicator,
  eventId,
  isDecrementing,
}: {
  indicator: ProductionIndicator;
  eventId: string;
  isDecrementing: boolean;
}) {
  const status = indicator.shortage > 0 ? "shortage" : indicator.extra > 0 ? "extra" : "exact";

  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className="text-2xl font-bold text-stone-700 min-w-[10rem]">
        {indicator.menuItemName}
      </span>

      {status === "shortage" && (
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 border border-red-300 text-red-700 font-bold text-lg">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          あと {indicator.shortage} 杯 不足
        </span>
      )}
      {status === "extra" && (
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-bold text-lg">
          <PackagePlus className="w-5 h-5" aria-hidden="true" />+{indicator.extra} 杯 余裕
        </span>
      )}
      {status === "exact" && (
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-100 text-stone-500 font-medium text-lg">
          <Check className="w-5 h-5" aria-hidden="true" />
          不足なし
        </span>
      )}

      {indicator.surplus > 0 && (
        <Form method="post" className="inline-flex">
          <input type="hidden" name="intent" value="menu-surplus-decrease" />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="menuItemId" value={indicator.menuItemId} />
          <button
            type="submit"
            disabled={isDecrementing}
            aria-label="余剰を1件減らす"
            className="w-12 h-12 flex items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 transition-colors leading-none pb-1 font-black text-2xl shadow-sm"
            title="余剰を1件減らす"
          >
            -
          </button>
        </Form>
      )}
    </li>
  );
}
