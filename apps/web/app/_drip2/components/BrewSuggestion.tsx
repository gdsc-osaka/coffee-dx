import type { QueueEntry } from "~/features/brew-queue/queue";

/** キューの最大エントリー数（= レーン数）。空き枠もカードとして表示する */
const SLOT_COUNT = 3;

/**
 * 「抽出の提案」。OrderDO が管理する次枠キューを、レーンと同じ幅のカードで並べる。
 * 各端末はサーバーから受け取ったキューを表示するだけで、計算はしない。
 */
export function BrewSuggestion({
  queue,
  menuNameOf,
}: {
  queue: QueueEntry[];
  menuNameOf: (menuItemId: string) => string;
}) {
  return (
    <section aria-label="抽出の提案" className="px-4 sm:px-8 pb-6 sm:pb-8 overflow-x-auto">
      <h2 className="text-lg font-bold text-stone-700 mb-3">抽出の提案</h2>
      <ul className="flex flex-row gap-4 sm:gap-6">
        {Array.from({ length: SLOT_COUNT }, (_, idx) => {
          const entry = queue[idx];
          return entry ? (
            <li
              key={entry.id}
              className="w-[22rem] sm:w-[26rem] shrink-0 bg-white border-2 border-stone-200 rounded-3xl p-5 sm:p-6 flex flex-col gap-3 shadow-sm"
            >
              <span className="text-xl font-black text-stone-800">
                {menuNameOf(entry.menuItemId)}
              </span>
              <span className="text-lg font-bold text-stone-600 tabular-nums">{entry.count}杯</span>
            </li>
          ) : (
            <li
              key={`empty-${idx}`}
              className="w-[22rem] sm:w-[26rem] shrink-0 border-2 border-dashed border-stone-200 rounded-3xl p-5 sm:p-6 flex items-center justify-center text-sm text-stone-400"
            >
              提案なし
            </li>
          );
        })}
      </ul>
    </section>
  );
}
