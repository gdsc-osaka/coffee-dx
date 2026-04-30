import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { printerClient } from "~/features/printer/printer-client";
import type { ConnectionStatus } from "~/features/printer/printer-client";
import type { PrinterStatus } from "lx-printer/lx-d02";

interface PrinterSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printerStatus: ConnectionStatus;
  printerStatusData: PrinterStatus | null;
  optimisticDensity: number | null;
  setOptimisticDensity: (density: number | null) => void;
  isAutoPrintEnabled: boolean;
  setIsAutoPrintEnabled: (enabled: boolean) => void;
}

export function PrinterSettingsDialog({
  open,
  onOpenChange,
  printerStatus,
  printerStatusData,
  optimisticDensity,
  setOptimisticDensity,
  isAutoPrintEnabled,
  setIsAutoPrintEnabled,
}: PrinterSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-stone-900 text-white border-stone-800">
        <DialogHeader>
          <DialogTitle className="text-white">プリンター設定</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">接続状況</p>
              <p className="text-xs text-stone-400">
                {printerStatus === "connected" ? "接続済み" : "未接続"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent text-white border-stone-600 hover:bg-stone-800 hover:text-white"
              onClick={() => printerClient.connect().catch(console.error)}
            >
              {printerStatus === "connected" ? "再接続" : "プリンターを接続"}
            </Button>
          </div>

          {printerStatus === "connected" && printerStatusData && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-stone-800 p-3 rounded-xl border border-stone-700">
                <p className="text-[10px] text-stone-500 uppercase">Battery</p>
                <p className="text-xl font-bold">
                  {printerStatusData.battery !== undefined ? `${printerStatusData.battery}%` : "--"}
                </p>
              </div>
              <div className="bg-stone-800 p-3 rounded-xl border border-stone-700">
                <p className="text-[10px] text-stone-500 uppercase">Paper Status</p>
                <p
                  className={`text-xl font-bold ${printerStatusData.isOutOfPaper ? "text-red-500" : "text-emerald-500"}`}
                >
                  {printerStatusData.isOutOfPaper ? "Empty" : "OK"}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-3 bg-stone-800 rounded-xl border border-stone-700">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">自動印刷 (Auto Print)</p>
              <p className="text-xs text-stone-400">注文確定時に自動でレシートを印刷します</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isAutoPrintEnabled}
              onClick={() => setIsAutoPrintEnabled(!isAutoPrintEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isAutoPrintEnabled ? "bg-emerald-500" : "bg-stone-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isAutoPrintEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">印刷濃度 (1-7)</p>
              <span className="text-emerald-500 font-bold">
                {optimisticDensity ?? printerStatusData?.density ?? 4}
              </span>
            </div>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    if (printerStatus !== "connected") return;
                    setOptimisticDensity(d);
                    printerClient.setDensity(d).catch((err) => {
                      console.error(err);
                      setOptimisticDensity(null);
                    });
                  }}
                  disabled={printerStatus !== "connected"}
                  className={`flex-1 h-10 rounded-lg border transition-all ${
                    (optimisticDensity ?? printerStatusData?.density ?? 4) === d
                      ? "bg-emerald-600 border-emerald-500 text-white font-bold"
                      : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"
                  } ${printerStatus !== "connected" ? "opacity-30 cursor-not-allowed" : ""}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-500">
              ※数値を下げると印刷速度が向上しますが、印字が薄くなります。
            </p>
          </div>

          <Button
            className="w-full bg-stone-100 text-stone-900 hover:bg-white h-12 rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
