import { useState } from "react";
import { Form } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useElapsedSeconds } from "../hooks/useElapsedSeconds";
import { formatDuration } from "../utils/formatDuration";

export function LaneActive({
  laneNumber,
  menuItemName,
  count,
  batchId,
  createdAt,
  targetDurationSec,
  eventId,
  isCompleting,
  isCancelling,
}: {
  laneNumber: number;
  menuItemName: string;
  count: number;
  batchId: string;
  createdAt: string;
  targetDurationSec: number | null;
  eventId: string;
  isCompleting: boolean;
  isCancelling: boolean;
}) {
  const elapsed = useElapsedSeconds(createdAt);
  const remaining = targetDurationSec !== null ? targetDurationSec - elapsed : null;
  const isFinished = remaining !== null && remaining <= 0;
  const [cancelOpen, setCancelOpen] = useState(false);

  return (
    <div
      data-finished={isFinished ? "true" : "false"}
      className={`rounded-3xl p-4 sm:p-6 flex flex-col gap-4 shadow-sm border-2 transition-colors ${
        isFinished
          ? "bg-red-50 border-red-300"
          : "bg-white border-orange-200"
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

      <div className="flex flex-col items-center justify-center py-6 bg-stone-50 rounded-2xl">
        {remaining !== null ? (
          <>
            <span className="text-xs font-bold text-stone-400 mb-1">
              {isFinished ? "超過" : "残り"}
            </span>
            <span
              className={`text-6xl font-black tabular-nums ${
                isFinished ? "text-red-600" : "text-stone-800"
              }`}
            >
              {formatDuration(remaining)}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-bold text-stone-400 mb-1">経過</span>
            <span className="text-6xl font-black tabular-nums text-stone-800">
              {formatDuration(elapsed)}
            </span>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <Form method="post" className="flex-[2]">
          <input type="hidden" name="intent" value="brew-complete" />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="batchId" value={batchId} />
          <button
            type="submit"
            disabled={isCompleting || isCancelling}
            className="w-full py-4 text-xl font-black bg-emerald-500 text-white rounded-2xl shadow-md disabled:opacity-50 active:scale-95 transition-transform"
          >
            {isCompleting ? "..." : "完了"}
          </button>
        </Form>
        <button
          type="button"
          onClick={() => setCancelOpen(true)}
          disabled={isCompleting || isCancelling}
          className="flex-1 py-4 text-base font-bold bg-white border-2 border-stone-200 text-stone-500 rounded-2xl hover:bg-stone-50 active:bg-stone-100 disabled:opacity-50 transition-colors"
        >
          取消
        </button>
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
            <Form method="post" onSubmit={() => setCancelOpen(false)}>
              <input type="hidden" name="intent" value="brew-cancel" />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="batchId" value={batchId} />
              <button
                type="submit"
                className="px-5 py-3 rounded-2xl bg-red-500 text-white font-bold hover:bg-red-600"
              >
                取消する
              </button>
            </Form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
