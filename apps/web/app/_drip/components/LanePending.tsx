import { Form } from "react-router";
import { formatDuration } from "../utils/formatDuration";
import type { LaneIdleState, LanePendingState } from "./LaneIdle";

export function LanePending({
  laneNumber,
  state,
  menuItemName,
  eventId,
  onChangeState,
  onStart,
  isStarting,
}: {
  laneNumber: number;
  state: LanePendingState;
  menuItemName: string;
  eventId: string;
  onChangeState: (next: LanePendingState | LaneIdleState) => void;
  /** Start ボタン押下時の楽観的削除トリガ。Form 自体は内部で submit するので、ここで Lane を消す */
  onStart: () => void;
  isStarting: boolean;
}) {
  const updateDuration = (delta: number) => {
    const next = Math.max(0, state.durationSec + delta);
    onChangeState({ ...state, durationSec: next });
  };
  const canStart = state.durationSec > 0;

  return (
    <div className="bg-white border-2 border-amber-300 rounded-3xl p-4 sm:p-6 flex flex-col gap-4 shadow-sm">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-bold text-stone-400">レーン {laneNumber}</span>
        <span className="text-lg font-black text-stone-800">{menuItemName}</span>
        <span className="text-base text-stone-500">{state.count} 杯</span>
      </div>

      <div className="flex flex-col items-center justify-center py-4 bg-stone-50 rounded-2xl">
        <span className="text-xs font-bold text-stone-400 mb-1">合計</span>
        <span className="text-5xl font-black text-stone-800 tabular-nums">
          {formatDuration(state.durationSec)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => updateDuration(10)}
          className="px-4 py-3 rounded-2xl bg-stone-100 text-stone-700 font-bold hover:bg-stone-200 active:bg-stone-300 transition-colors"
        >
          +10秒
        </button>
        <button
          type="button"
          onClick={() => updateDuration(60)}
          className="px-4 py-3 rounded-2xl bg-stone-100 text-stone-700 font-bold hover:bg-stone-200 active:bg-stone-300 transition-colors"
        >
          +1分
        </button>
        <button
          type="button"
          onClick={() => updateDuration(180)}
          className="px-4 py-3 rounded-2xl bg-stone-100 text-stone-700 font-bold hover:bg-stone-200 active:bg-stone-300 transition-colors"
        >
          +3分
        </button>
        <button
          type="button"
          onClick={() => onChangeState({ ...state, durationSec: 0 })}
          className="px-4 py-3 rounded-2xl bg-white border-2 border-stone-200 text-stone-500 font-bold hover:bg-stone-50 active:bg-stone-100 transition-colors"
        >
          リセット
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            onChangeState({ kind: "idle", menuItemId: state.menuItemId, count: state.count })
          }
          className="flex-1 py-4 text-base font-bold bg-white border-2 border-stone-200 text-stone-500 rounded-2xl hover:bg-stone-50 active:bg-stone-100 transition-colors"
        >
          キャンセル
        </button>
        <Form method="post" className="flex-[2]" onSubmit={onStart}>
          <input type="hidden" name="intent" value="brew-start" />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="menuItemId" value={state.menuItemId} />
          <input type="hidden" name="count" value={state.count} />
          <input type="hidden" name="targetDurationSec" value={state.durationSec} />
          <button
            type="submit"
            disabled={!canStart || isStarting}
            className="w-full py-4 text-xl font-black bg-amber-500 text-white rounded-2xl shadow-md disabled:opacity-50 active:scale-95 transition-transform"
          >
            {isStarting ? "..." : "▶ Start"}
          </button>
        </Form>
      </div>
    </div>
  );
}
