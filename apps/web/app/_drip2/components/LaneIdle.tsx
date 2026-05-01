import { X } from "lucide-react";

export type LaneIdleState = {
  kind: "idle";
  menuItemId: string | null;
  count: number;
};

export type LanePendingState = {
  kind: "pending";
  menuItemId: string;
  count: number;
  durationSec: number;
};

export function LaneIdle({
  laneNumber,
  state,
  menus,
  onChangeState,
  onRemove,
}: {
  laneNumber: number;
  state: LaneIdleState;
  menus: Array<{ id: string; name: string }>;
  onChangeState: (next: LaneIdleState | LanePendingState) => void;
  onRemove: () => void;
}) {
  const canStart = state.menuItemId !== null && state.count >= 1;

  return (
    <div className="bg-white border-2 border-stone-200 rounded-3xl p-4 sm:p-6 flex flex-col gap-4 shadow-sm">
      <div className="flex items-center">
        <span className="text-sm font-bold text-stone-400">レーン {laneNumber}</span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto w-9 h-9 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-colors"
          title="このレーンを削除"
          aria-label="このレーンを削除"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-stone-500">メニューを選択</span>
        <div className="flex flex-wrap gap-2">
          {menus.map((m) => {
            const isActive = state.menuItemId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeState({ ...state, menuItemId: m.id })}
                className={`px-4 py-3 rounded-2xl border-2 font-bold transition-colors ${
                  isActive
                    ? "bg-amber-100 border-amber-500 text-amber-700"
                    : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50 active:bg-stone-100"
                }`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-stone-500">杯数</span>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => {
            const isActive = state.count === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChangeState({ ...state, count: n })}
                className={`w-14 h-14 text-2xl font-black rounded-2xl border-2 transition-colors ${
                  isActive
                    ? "bg-amber-100 border-amber-500 text-amber-700"
                    : "bg-white border-stone-200 text-stone-500 hover:bg-stone-50 active:bg-stone-100"
                }`}
              >
                {n}
              </button>
            );
          })}
          <span className="text-base font-bold text-stone-500 ml-1">杯</span>
        </div>
      </div>

      <button
        type="button"
        disabled={!canStart}
        onClick={() => {
          if (state.menuItemId === null) return;
          onChangeState({
            kind: "pending",
            menuItemId: state.menuItemId,
            count: state.count,
            durationSec: 0,
          });
        }}
        className="w-full py-4 text-xl font-black bg-amber-500 text-white rounded-2xl shadow-md disabled:opacity-50 active:scale-95 transition-transform"
      >
        ▶ 抽出開始
      </button>
    </div>
  );
}
