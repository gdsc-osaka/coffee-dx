import type { BatchAllocation } from "~/features/brew-queue/allocation";

/**
 * バッチ（または抽出の提案 1 枠）がどの注文の分かを「#12 ×2　#15 ×1　余り ×1」の形で表示する。
 * 抽出完了時に紐付くまでは予測（完了順や注文取消で変わることがある）。
 */
export function OrderAllocationList({ allocation }: { allocation: BatchAllocation | undefined }) {
  if (!allocation || (allocation.orders.length === 0 && allocation.surplus === 0)) return null;
  return (
    <ul aria-label="対応する注文番号" className="flex flex-wrap gap-x-3 gap-y-1">
      {allocation.orders.map((o) => (
        <li key={o.orderNumber} className="text-base font-bold text-stone-700 tabular-nums">
          #{o.orderNumber} <span className="text-stone-500">×{o.count}</span>
        </li>
      ))}
      {allocation.surplus > 0 && (
        <li className="text-base font-bold text-stone-400 tabular-nums">
          余り <span>×{allocation.surplus}</span>
        </li>
      )}
    </ul>
  );
}
