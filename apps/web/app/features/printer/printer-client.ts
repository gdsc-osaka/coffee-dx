import { LXD02Printer, type PrinterStatus } from "lx-printer/lx-d02";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * プリンター制御を管理するクライアントクラス
 */
export class PrinterClient {
  private _printer: LXD02Printer | null = null;
  private _status: ConnectionStatus = "disconnected";
  private _printerStatus: PrinterStatus | null = null;
  private _connectPromise: Promise<void> | null = null;
  private _onStatusChange:
    | ((status: ConnectionStatus, printerStatus: PrinterStatus | null) => void)
    | null = null;

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this._onStatusChange?.(this._status, this._printerStatus);
  }

  private handlePrinterStatus(s: PrinterStatus) {
    this._printerStatus = s;
    // 接続中の手動 connect() フローを潰さないよう、connecting 中は status を上書きしない
    if (this._status === "connecting") {
      this._onStatusChange?.(this._status, this._printerStatus);
      return;
    }
    this.setStatus(s.isConnected ? "connected" : "disconnected");
  }

  onStatusUpdate(
    callback: (status: ConnectionStatus, printerStatus: PrinterStatus | null) => void,
  ) {
    this._onStatusChange = callback;
    // 初期値を通知
    callback(this._status, this._printerStatus);
  }

  /**
   * プリンターに接続する。並行呼び出しは同じ Promise を共有する。
   */
  connect(): Promise<void> {
    this._connectPromise ??= (async () => {
      this.setStatus("connecting");
      try {
        if (!this._printer) {
          this._printer = new LXD02Printer({
            onStatusChange: (s) => this.handlePrinterStatus(s),
          });
        }
        await this._printer.connect();
        this.setStatus("connected");
      } catch (e) {
        this.setStatus("error");
        throw e;
      } finally {
        this._connectPromise = null;
      }
    })();

    return this._connectPromise;
  }

  /**
   * キャンバスまたは Raw Bitmap を印刷する
   */
  async print(data: HTMLCanvasElement | Uint8Array): Promise<void> {
    if (!this._printer) {
      throw new Error("Printer not connected. Call connect() first in a user gesture.");
    }
    if (this._status !== "connected") {
      // 進行中の connect があれば乗っかる。なければ再接続を試みる。
      try {
        await this.connect();
      } catch {
        throw new Error("Printer not connected. Please connect first.");
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
