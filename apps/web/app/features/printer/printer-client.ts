import { LXD02Printer, type PrinterStatus } from "lx-printer/lx-d02";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// HMR対策としてグローバルにインスタンスを保持する
const GLOBAL_PRINTER_KEY = "__COFFEE_DX_PRINTER__";

/**
 * プリンター制御を管理するクライアントクラス
 */
export class PrinterClient {
  private _printer: LXD02Printer | null = null;
  private _status: ConnectionStatus = "disconnected";
  private _printerStatus: PrinterStatus | null = null;
  private _onStatusChange:
    | ((status: ConnectionStatus, printerStatus: PrinterStatus | null) => void)
    | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      const globalAny = window as any;
      if (globalAny[GLOBAL_PRINTER_KEY]) {
        this._printer = globalAny[GLOBAL_PRINTER_KEY];
        this._status = "connected"; // 以前のセッションで接続されていたと仮定
      }
    }
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this._onStatusChange?.(this._status, this._printerStatus);
  }

  onStatusUpdate(
    callback: (status: ConnectionStatus, printerStatus: PrinterStatus | null) => void,
  ) {
    this._onStatusChange = callback;
    // 初期値を通知
    callback(this._status, this._printerStatus);
  }

  /**
   * プリンターに接続する
   */
  async connect(): Promise<void> {
    if (this._status === "connecting") return;

    this.setStatus("connecting");

    try {
      if (!this._printer) {
        this._printer = new LXD02Printer({
          onStatusChange: (s) => {
            this._printerStatus = s;
            this._onStatusChange?.(this._status, this._printerStatus);
          },
        });
        if (typeof window !== "undefined") {
          (window as any)[GLOBAL_PRINTER_KEY] = this._printer;
        }
      }
      await this._printer.connect();
      this.setStatus("connected");
    } catch (e) {
      this.setStatus("error");
      throw e;
    }
  }

  /**
   * キャンバスまたは Raw Bitmap を印刷する
   */
  async print(data: HTMLCanvasElement | Uint8Array): Promise<void> {
    if (!this._printer || this._status !== "connected") {
      // 接続が切れている可能性があるため再接続を試みる
      if (this._printer) {
        try {
          await this._printer.connect();
          this.setStatus("connected");
        } catch (e) {
          this.setStatus("error");
          throw new Error("Printer not connected. Please connect first.");
        }
      } else {
        throw new Error("Printer not connected. Call connect() first in a user gesture.");
      }
    }
    await this._printer.print(data);
  }

  /**
   * 印刷濃度を設定する (1-7)
   */
  async setDensity(density: number): Promise<void> {
    if (!this._printer) throw new Error("Printer not connected");
    await this._printer.setDensity(density);
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get printerStatus(): PrinterStatus | null {
    return this._printerStatus;
  }
}

export const printerClient = new PrinterClient();
