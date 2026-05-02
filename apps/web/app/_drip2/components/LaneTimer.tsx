import { useEffect, useRef, useState } from "react";
import { useSubmit } from "react-router";
import { BellOff } from "lucide-react";
import { useTimerEndAlert } from "../hooks/useTimerEndAlert";
import { parseJst } from "../utils/parseJst";
import { stopTimerEndSound } from "../utils/audioUnlock";
import { formatDuration } from "../utils/formatDuration";

/**
 * LaneActive 内蔵タイマー UI。
 * - 未設定 (timerStartedAt=null OR targetDurationSec=null) → 加算ボタン + Start
 * - 動作中 (remaining > 0) → カウントダウン表示
 * - 終了 (remaining <= 0) → 設定 UI を再表示（残り時間は超過分をマイナスで表示）
 *
 * ボタン操作はすべて useSubmit で programmatic に brew-set-timer 送信。
 */
export function LaneTimer({
  batchId,
  eventId,
  targetDurationSec,
  timerStartedAt,
  isPersisting,
}: {
  batchId: string;
  eventId: string;
  targetDurationSec: number | null;
  timerStartedAt: string | null;
  /** brew-set-timer を submit 中かどうか（このレーンに対する送信中は disabled） */
  isPersisting: boolean;
}) {
  const submit = useSubmit();

  // unset 表示中にユーザーが組み立てている時間
  const [draftSec, setDraftSec] = useState(0);

  // unset / running の判定。タイマー終了 (remaining <= 0) のときは見た目 unset 扱い
  const isRunning = timerStartedAt !== null && targetDurationSec !== null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  const elapsedSec =
    isRunning && timerStartedAt !== null
      ? Math.max(0, Math.floor((now - parseJst(timerStartedAt)) / 1000))
      : 0;
  const remaining = isRunning && targetDurationSec !== null ? targetDurationSec - elapsedSec : null;
  const isFinished = remaining !== null && remaining <= 0;
  useTimerEndAlert(remaining, batchId);

  // 終了したらドラフトを初期値に戻して再設定 UI を出しやすくする
  const finishedHandledRef = useRef(false);
  useEffect(() => {
    if (isFinished && !finishedHandledRef.current) {
      finishedHandledRef.current = true;
      setDraftSec(0);
    }
    if (!isFinished) {
      finishedHandledRef.current = false;
    }
  }, [isFinished]);

  const handleStart = () => {
    if (draftSec <= 0) return;
    // 終了状態から再 Start する場合はこのレーンのアラームを止めてから新タイマー開始
    stopTimerEndSound(batchId);
    const fd = new FormData();
    fd.append("intent", "brew-set-timer");
    fd.append("eventId", eventId);
    fd.append("batchId", batchId);
    fd.append("targetDurationSec", String(draftSec));
    submit(fd, { method: "post" });
    setDraftSec(0);
  };

  const handleClear = () => {
    stopTimerEndSound(batchId);
    const fd = new FormData();
    fd.append("intent", "brew-set-timer");
    fd.append("eventId", eventId);
    fd.append("batchId", batchId);
    // targetDurationSec を送らないことで NULL（タイマー解除）にする
    submit(fd, { method: "post" });
  };

  // 動作中（残り時間あり）のみカウントダウン表示。それ以外は設定 UI
  if (isRunning && !isFinished) {
    return (
      <div className="flex flex-col items-center justify-center py-6 bg-stone-50 rounded-2xl gap-2">
        <span className="text-xs font-bold text-stone-400">残り</span>
        <span className="text-5xl font-black tabular-nums text-stone-800">
          {formatDuration(remaining ?? 0)}
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={isPersisting}
          className="text-xs text-stone-400 hover:text-stone-600 underline disabled:opacity-50"
        >
          タイマーを解除
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 py-4 px-3 bg-stone-50 rounded-2xl">
      {isFinished && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-bold text-red-600">タイマー終了 (超過)</span>
          <span className="text-3xl font-black tabular-nums text-red-600">
            {formatDuration(remaining ?? 0)}
          </span>
          <button
            type="button"
            onClick={() => stopTimerEndSound(batchId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border-2 border-stone-200 text-stone-600 text-xs font-bold hover:bg-stone-50"
          >
            <BellOff className="w-3.5 h-3.5" aria-hidden="true" />
            アラームを止める
          </button>
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-bold text-stone-400">タイマー</span>
        <span className="text-4xl font-black tabular-nums text-stone-800">
          {formatDuration(draftSec)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => setDraftSec((s) => s + 10)}
          className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-700 font-bold hover:bg-stone-100"
        >
          +10秒
        </button>
        <button
          type="button"
          onClick={() => setDraftSec((s) => s + 60)}
          className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-700 font-bold hover:bg-stone-100"
        >
          +1分
        </button>
        <button
          type="button"
          onClick={() => setDraftSec((s) => s + 180)}
          className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-700 font-bold hover:bg-stone-100"
        >
          +3分
        </button>
        <button
          type="button"
          onClick={() => setDraftSec(0)}
          className="px-3 py-2 rounded-xl bg-white border-2 border-stone-200 text-stone-500 font-bold hover:bg-stone-100"
        >
          リセット
        </button>
      </div>
      <button
        type="button"
        onClick={handleStart}
        disabled={draftSec <= 0 || isPersisting}
        className="w-full py-3 text-base font-black bg-amber-500 text-white rounded-2xl shadow-sm disabled:opacity-50"
      >
        {isPersisting ? "..." : isFinished ? "▶ タイマーを再設定" : "▶ タイマー開始"}
      </button>
    </div>
  );
}
