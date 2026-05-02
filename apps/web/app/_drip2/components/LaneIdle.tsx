import { Form } from "react-router";
import { TIMER_FEATURE_ENABLED } from "../constants";
import { formatDuration } from "../utils/formatDuration";

export type LaneIdleState = {
  kind: "idle";
  menuItemId: string | null;
  count: number;
  /** Start 押下時に送信するタイマー秒数。0 はタイマーなし */
  durationSec: number;
};

export function LaneIdle({
  laneNumber,
  laneIndex,
  state,
  menus,
  eventId,
  isStarting,
  onChangeState,
  onStart,
}: {
  laneNumber: number;
  /** DB に永続化するレーン位置 (0 始まり)。laneNumber は 1 始まりの表示用 */
  laneIndex: number;
  state: LaneIdleState;
  menus: Array<{ id: string; name: string }>;
  eventId: string;
  isStarting: boolean;
  onChangeState: (next: LaneIdleState) => void;
  onStart: () => void;
}) {
  // タイマー機能が無効の間は durationSec を必須にしない
  const canStart =
    state.menuItemId !== null &&
    state.count >= 1 &&
    (!TIMER_FEATURE_ENABLED || state.durationSec > 0);

  const updateDuration = (delta: number) => {
    onChangeState({
      ...state,
      durationSec: Math.max(0, state.durationSec + delta),
    });
  };

  return (
    <div className="bg-white border-2 border-stone-200 rounded-3xl p-4 sm:p-6 flex flex-col gap-4 shadow-sm">
      <span className="text-sm font-bold text-stone-400">レーン {laneNumber}</span>

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

      {TIMER_FEATURE_ENABLED && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-stone-500">タイマー</span>
          <div className="flex flex-col items-center justify-center py-3 bg-stone-50 rounded-2xl">
            <span className="text-4xl font-black tabular-nums text-stone-800">
              {formatDuration(state.durationSec)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => updateDuration(10)}
              className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-700 font-bold hover:bg-stone-100"
            >
              +10秒
            </button>
            <button
              type="button"
              onClick={() => updateDuration(60)}
              className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-700 font-bold hover:bg-stone-100"
            >
              +1分
            </button>
            <button
              type="button"
              onClick={() => updateDuration(180)}
              className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-700 font-bold hover:bg-stone-100"
            >
              +3分
            </button>
            <button
              type="button"
              onClick={() => onChangeState({ ...state, durationSec: 0 })}
              className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-500 font-bold hover:bg-stone-100"
            >
              リセット
            </button>
          </div>
        </div>
      )}

      <Form method="post" onSubmit={onStart}>
        <input type="hidden" name="intent" value="brew-start" />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="menuItemId" value={state.menuItemId ?? ""} />
        <input type="hidden" name="count" value={state.count} />
        <input type="hidden" name="laneIndex" value={laneIndex} />
        <input type="hidden" name="targetDurationSec" value={state.durationSec} />
        <button
          type="submit"
          disabled={!canStart || isStarting}
          className="w-full py-4 text-xl font-black bg-amber-500 text-white rounded-2xl shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {isStarting ? "..." : "▶ 抽出開始"}
        </button>
      </Form>
    </div>
  );
}
