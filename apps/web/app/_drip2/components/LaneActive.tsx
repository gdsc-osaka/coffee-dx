import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useSubmit } from "react-router";
import { Check, CircleCheck, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TIMER_FEATURE_ENABLED } from "../constants";
import { parseJst } from "../utils/parseJst";
import { stopTimerEndSound } from "../utils/audioUnlock";
import { LaneTimer } from "./LaneTimer";

const COMPLETE_UNDO_WINDOW_MS = 5_000;

type CompletePhase = "idle" | "undoable" | "submitted";

/**
 * 抽出中レーン。完了タップ後は 5 秒間の取り消し猶予期間（undoable）を挟んでから
 * useFetcher で brew-complete を送信する。取消ボタンはタイマー状態と独立して idle 時に表示。
 * タイマーは内蔵 LaneTimer に委譲し、未設定 / 動作中 / 終了の 3 状態を独立管理。
 */
export function LaneActive({
  laneNumber,
  menuItemName,
  count,
  batchId,
  targetDurationSec,
  timerStartedAt,
  eventId,
  isCancelling,
  isSettingTimer,
}: {
  laneNumber: number;
  menuItemName: string;
  count: number;
  batchId: string;
  targetDurationSec: number | null;
  timerStartedAt: string | null;
  eventId: string;
  isCancelling: boolean;
  isSettingTimer: boolean;
}) {
  const submit = useSubmit();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [phase, setPhase] = useState<CompletePhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // タイマー動作中は 1 秒ごとに再評価して isFinished をリアクティブにする
  // （子の LaneTimer が tick しても親の data-finished には伝播しないため）。
  // フィーチャーフラグが false の間は常に false 扱い。
  const isTimerRunning =
    TIMER_FEATURE_ENABLED && targetDurationSec !== null && timerStartedAt !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isTimerRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isTimerRunning]);

  // 保留中は data-finished を常に false にする
  const isFinished =
    phase === "idle" &&
    isTimerRunning &&
    timerStartedAt !== null &&
    targetDurationSec !== null &&
    Math.floor((now - parseJst(timerStartedAt)) / 1000) >= targetDurationSec;

  // fetcher がエラー応答を返した場合は idle に戻し、エラーメッセージを表示する
  useEffect(() => {
    if (fetcher.data && !fetcher.data.ok && fetcher.data.error) {
      setErrorMessage(fetcher.data.error);
      setPhase("idle");
    }
  }, [fetcher.data]);

  // アンマウント時は保留中タイマーをクリア（送信は行わない）。
  // バッチの切り替わりは BrewLane 側の key={batchId} で再マウントされるのでここで扱う。
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const handleStartComplete = useCallback(() => {
    // 二重タップで保留タイマーが 2 本走ると「元に戻す」で片方しか止まらないため弾く
    if (undoTimerRef.current !== null) return;
    stopTimerEndSound(batchId);
    setErrorMessage(null);
    setCancelOpen(false);
    setPhase("undoable");

    undoTimerRef.current = window.setTimeout(() => {
      // 保留後の送信が他レーンの操作（画面遷移扱いの navigation submit）に中断されないよう useFetcher を使用する
      const fd = new FormData();
      fd.append("intent", "brew-complete");
      fd.append("eventId", eventId);
      fd.append("batchId", batchId);
      fetcher.submit(fd, { method: "post" });
      setPhase("submitted");
      undoTimerRef.current = null;
    }, COMPLETE_UNDO_WINDOW_MS);
  }, [batchId, eventId, fetcher]);

  const handleUndo = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPhase("idle");
  }, []);

  const handleCancelConfirmed = useCallback(() => {
    stopTimerEndSound(batchId);
    const fd = new FormData();
    fd.append("intent", "brew-cancel");
    fd.append("eventId", eventId);
    fd.append("batchId", batchId);
    submit(fd, { method: "post" });
    setCancelOpen(false);
  }, [eventId, batchId, submit]);

  const cardBorderClass =
    phase !== "idle"
      ? "bg-white border-emerald-300"
      : isFinished
        ? ""
        : "bg-white border-orange-200";

  return (
    <div
      data-finished={isFinished ? "true" : "false"}
      className={`rounded-3xl p-4 sm:p-6 flex flex-col gap-4 shadow-sm border-2 ${cardBorderClass}`}
    >
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-bold text-stone-400">レーン {laneNumber}</span>
        <span className="text-lg font-black text-stone-800">{menuItemName}</span>
        <span className="text-base text-stone-500">{count} 杯</span>
        {phase === "idle" ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-orange-600 font-bold">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" aria-hidden="true" />
            抽出中
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            完了
          </span>
        )}
      </div>

      {TIMER_FEATURE_ENABLED && (
        <div className={phase !== "idle" ? "hidden" : undefined}>
          <LaneTimer
            batchId={batchId}
            eventId={eventId}
            targetDurationSec={targetDurationSec}
            timerStartedAt={timerStartedAt}
            isPersisting={isSettingTimer}
            muted={phase !== "idle"}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {phase === "idle" ? (
          <>
            {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}
            <button
              type="button"
              onClick={handleStartComplete}
              disabled={isCancelling}
              className="w-full py-4 text-xl font-black rounded-2xl bg-emerald-100 text-emerald-800 hover:bg-emerald-200 active:bg-emerald-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Check className="w-6 h-6" aria-hidden="true" />
              完了
            </button>
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              disabled={isCancelling}
              className="py-3 text-sm font-bold bg-white border-2 border-stone-200 text-stone-500 hover:bg-stone-50 active:bg-stone-100 rounded-2xl disabled:opacity-50 transition-colors"
            >
              取消
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="flex items-center justify-center gap-2 text-emerald-700">
              <CircleCheck className="w-7 h-7" aria-hidden="true" />
              <span className="text-xl font-black">完了しました</span>
            </div>
            {phase === "undoable" && (
              <>
                <p className="text-sm text-stone-500">間違えた場合は「元に戻す」を押してください</p>
                <button
                  type="button"
                  onClick={handleUndo}
                  className="w-full py-4 text-lg font-black rounded-2xl bg-white border-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Undo2 className="w-5 h-5" aria-hidden="true" />
                  元に戻す
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>抽出を取消しますか？</DialogTitle>
            <DialogDescription>
              {menuItemName} {count} 杯のバッチを取消します。この操作は元に戻せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="px-5 py-3 rounded-2xl bg-white border-2 border-stone-200 text-stone-600 font-bold hover:bg-stone-50"
            >
              いいえ
            </button>
            <button
              type="button"
              onClick={handleCancelConfirmed}
              className="px-5 py-3 rounded-2xl bg-red-500 text-white font-bold hover:bg-red-600"
            >
              取消する
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
