import { AlertCircle, Battery, BatteryLow, Bluetooth, Settings } from "lucide-react";
import type { ConnectionStatus } from "~/features/printer/printer-client";
import type { PrinterStatus } from "lx-printer/lx-d02";

interface CashierHeaderProps {
  printerStatus: ConnectionStatus;
  printerStatusData: PrinterStatus | null;
  onOpenSettings: () => void;
}

export function CashierHeader({
  printerStatus,
  printerStatusData,
  onOpenSettings,
}: CashierHeaderProps) {
  return (
    <div className="shrink-0 flex flex-col rotate-180 bg-stone-950 p-2 gap-1 border-b border-stone-800">
      <div className="max-w-lg mx-auto w-full flex items-center justify-between px-2">
        <p className="text-stone-600 text-[10px] tracking-widest uppercase font-bold">
          Cashier View
        </p>
        <div className="flex items-center gap-2 text-[10px] text-stone-500">
          {printerStatusData && (
            <div className="flex items-center gap-1">
              {printerStatusData.isOutOfPaper ? (
                <AlertCircle className="size-3 text-red-500 animate-pulse" />
              ) : printerStatusData.isLowBattery ? (
                <BatteryLow className="size-3 text-amber-500" />
              ) : (
                <Battery className="size-3 text-emerald-500" />
              )}
              <span className={printerStatusData.isOutOfPaper ? "text-red-500" : ""}>
                {printerStatusData.isOutOfPaper ? "NO PAPER" : `${printerStatusData.battery}%`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Bluetooth
              className={
                printerStatus === "connected"
                  ? "size-3 text-emerald-500"
                  : printerStatus === "connecting"
                    ? "size-3 text-amber-500 animate-pulse"
                    : "size-3 text-stone-700"
              }
            />
            <span className={printerStatus === "connected" ? "text-emerald-500" : ""}>
              {printerStatus === "connected"
                ? "READY"
                : printerStatus === "connecting"
                  ? "CONNECT..."
                  : "OFF"}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1 hover:bg-stone-800 rounded transition-colors"
          >
            <Settings className="size-3 text-stone-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
