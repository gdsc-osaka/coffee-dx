import { useCallback, useState } from "react";
import { useSubmit } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { parseJst } from "../utils/parseJst";
import { SwipeToConfirm } from "./SwipeToConfirm";
import { LongPressButton } from "./LongPressButton";
import { LaneTimer } from "./LaneTimer";

/**
 * 抽出中レーン。完了スワイプ・取消長押しはタイマー状態と独立に常時表示。
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
  isCompleting,
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
  isCompleting: boolean;
  isCancelling: boolean;
  isSettingTimer: boolean;
}) {
  const submit = useSubmit();
  const [cancelOpen, setCancelOpen] = useState(false);

  // タイマー終了状態（点滅 CSS のトリガー）。timer 未設定時は false。
  const isFinished =
    targetDurationSec !== null &&
    timerStartedAt !== null &&
    Math.floor((Date.now() - parseJst(timerStartedAt)) / 1000) >= targetDurationSec;

  const handleComplete = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "brew-complete");
    fd.append("eventId", eventId);
    fd.append("batchId", batchId);
    submit(fd, { method: "post" });
  }, [eventId, batchId, submit]);

  const handleCancelConfirmed = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "brew-cancel");
    fd.append("eventId", eventId);
    fd.append("batchId", batchId);
    submit(fd, { method: "post" });
    setCancelOpen(false);
  }, [eventId, batchId, submit]);

  return (
    <div
      data-finished={isFinished ? "true" : "false"}
      className={`rounded-3xl p-4 sm:p-6 flex flex-col gap-4 shadow-sm border-2 ${
        isFinished ? "" : "bg-white border-orange-200"
      }`}
    >
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-bold text-stone-400">レーン {laneNumber}</span>
        <span className="text-lg font-black text-stone-800">{menuItemName}</span>
        <span className="text-base text-stone-500">{count} 杯</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-orange-600 font-bold">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" aria-hidden="true" />
          抽出中
        </span>
      </div>

      <LaneTimer
        batchId={batchId}
        eventId={eventId}
        targetDurationSec={targetDurationSec}
        timerStartedAt={timerStartedAt}
        isPersisting={isSettingTimer}
      />

      <div className="flex flex-col gap-2">
        <SwipeToConfirm
          onConfirm={handleComplete}
          disabled={isCompleting || isCancelling}
          className="bg-emerald-100 text-emerald-800"
        />
        <LongPressButton
          onLongPress={() => setCancelOpen(true)}
          disabled={isCompleting || isCancelling}
          className="py-3 text-sm font-bold bg-white border-2 border-stone-200 text-stone-500 rounded-2xl disabled:opacity-50"
        >
          取消 (1秒長押し)
        </LongPressButton>
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
