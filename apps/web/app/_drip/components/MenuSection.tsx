import { Form } from "react-router";
import type { MenuBrewSummary } from "../home";

export function MenuSection({
  menu,
  eventId,
  count,
  onCountChange,
  submittingBatchId,
  submittingIntent,
  submittingMenuId,
}: {
  menu: MenuBrewSummary;
  eventId: string;
  count: number;
  onCountChange: (n: number) => void;
  submittingBatchId: string | null;
  submittingIntent: string | null;
  submittingMenuId: string | null;
}) {
  const brewingBatches = menu.batches.filter((b) => b.status === "brewing");

  const isStartSubmitting =
    submittingIntent === "brew-start" && submittingMenuId === menu.menuItemId;

  return (
    <section className="w-full sm:w-[500px] flex flex-col gap-8 sm:shrink-0">
      {/* メニューヘッダー & ステータス (固定エリア) */}
      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-black text-stone-800">{menu.menuItemName}</h2>
          <div className="flex flex-wrap items-center gap-6">
            <span className="text-xl text-stone-500">
              注文 <span className="font-black text-stone-700 text-4xl ml-1">{menu.ordered}</span>
            </span>
            <span className="text-xl text-stone-500">
              抽出中{" "}
              <span className="font-black text-orange-600 text-4xl ml-1">{menu.brewing}</span>
            </span>
            <div className="flex items-center gap-2 text-xl text-stone-500">
              完成 <span className="font-black text-emerald-600 text-4xl ml-1">{menu.ready}</span>
              {menu.surplus > 0 && (
                <Form method="post" className="inline-flex ml-2">
                  <input type="hidden" name="intent" value="menu-surplus-decrease" />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="menuItemId" value={menu.menuItemId} />
                  <button
                    type="submit"
                    disabled={
                      submittingIntent === "menu-surplus-decrease" &&
                      submittingMenuId === menu.menuItemId
                    }
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 transition-colors leading-none pb-1 font-black text-3xl shadow-sm"
                    title="余剰を1件減らす"
                  >
                    -
                  </button>
                </Form>
              )}
            </div>
          </div>
        </div>

        {/* 新規バッチ開始コントロール (固定エリア) */}
        <Form
          method="post"
          className="flex flex-col gap-3 p-4 sm:p-6 bg-stone-100 rounded-3xl border-2 border-stone-200 sm:flex-row sm:items-center sm:gap-6"
        >
          <input type="hidden" name="intent" value="brew-start" />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="menuItemId" value={menu.menuItemId} />
          <input type="hidden" name="count" value={count} />

          <div className="flex items-center gap-3">
            {[1, 2, 3].map((num) => {
              const isActive = count === num;
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => onCountChange(num)}
                  className={`w-20 h-20 text-4xl font-black rounded-2xl transition-colors shadow-sm border-4 ${
                    isActive
                      ? "bg-amber-100 border-amber-500 text-amber-700"
                      : "bg-white border-stone-200 text-stone-500 hover:bg-stone-50 active:bg-stone-100"
                  }`}
                >
                  {num}
                </button>
              );
            })}
            <span className="text-xl font-bold text-stone-500 ml-2">杯</span>
          </div>

          <button
            type="submit"
            disabled={isStartSubmitting}
            className="w-full sm:flex-1 py-5 text-3xl font-black bg-amber-500 text-white rounded-2xl shadow-md disabled:opacity-50 active:scale-95 transition-transform"
          >
            {isStartSubmitting ? "..." : "開始"}
          </button>
        </Form>
      </div>

      {/* 抽出中バッチカード一覧 (下部に並ぶ) */}
      <div className="flex flex-col gap-4">
        {brewingBatches.map((batch) => {
          const isCompleting =
            submittingBatchId === batch.batchId && submittingIntent === "brew-complete";
          const isCancelling =
            submittingBatchId === batch.batchId && submittingIntent === "brew-cancel";

          return (
            <div
              key={batch.batchId}
              className="bg-white border-2 border-orange-200 rounded-3xl p-4 sm:p-6 flex items-center gap-3 sm:gap-6 shadow-sm"
            >
              <span className="w-4 h-4 rounded-full bg-orange-400 animate-pulse shrink-0" />
              <span className="text-xl sm:text-2xl font-bold text-stone-700 flex items-center">
                抽出中
                <span className="text-orange-600 font-black text-4xl sm:text-5xl mx-2 sm:mx-3">
                  {batch.count}
                </span>
                杯
              </span>
              <div className="ml-auto flex gap-2 sm:gap-3">
                <Form method="post">
                  <input type="hidden" name="intent" value="brew-complete" />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="batchId" value={batch.batchId} />
                  <button
                    type="submit"
                    disabled={isCompleting || isCancelling}
                    className="px-5 sm:px-8 py-4 sm:py-5 text-xl sm:text-2xl font-bold bg-emerald-500 text-white rounded-2xl disabled:opacity-50 active:scale-95 transition-transform shadow-sm"
                  >
                    {isCompleting ? "..." : "完了"}
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="brew-cancel" />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="batchId" value={batch.batchId} />
                  <button
                    type="submit"
                    disabled={isCompleting || isCancelling}
                    className="px-4 sm:px-6 py-4 sm:py-5 text-lg sm:text-xl font-bold bg-white border-2 border-stone-200 text-stone-400 rounded-2xl disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {isCancelling ? "..." : "取消し"}
                  </button>
                </Form>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
