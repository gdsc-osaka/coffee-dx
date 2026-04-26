import { LXD02Printer, type PrinterStatus } from "lx-printer/lx-d02";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// HMR 越しに保持するためのグローバルキャッシュ。
// LXD02Printer は constructor 時にしか onStatusChange を登録できないため、
// mutable な callback ref を介して常に「最新の」PrinterClient へイベントを届ける。
const GLOBAL_PRINTER_KEY = "__COFFEE_DX_PRINTER__";

type GlobalPrinterCache = {
  printer: LXD02Printer;
  statusHandler: { current: ((s: PrinterStatus) => void) | null };
  lastPrinterStatus: PrinterStatus | null;
};

function getGlobalCache(): GlobalPrinterCache | null {
  if (typeof window === "undefined") return null;
  return (window as any)[GLOBAL_PRINTER_KEY] ?? null;
}

function setGlobalCache(cache: GlobalPrinterCache) {
  if (typeof window === "undefined") return;
  (window as any)[GLOBAL_PRINTER_KEY] = cache;
}

/**
 * プリンター制御を管理するクライアントクラス
 */
export class PrinterClient {
  private _cache: GlobalPrinterCache | null = null;
  private _status: ConnectionStatus = "disconnected";
  private _printerStatus: PrinterStatus | null = null;
  private _onStatusChange:
    | ((status: ConnectionStatus, printerStatus: PrinterStatus | null) => void)
    | null = null;

  constructor() {
    const cache = getGlobalCache();
    if (cache) {
      this._cache = cache;
      // HMR 後でも切断/接続イベントが新しい client に届くよう callback を差し替える
      cache.statusHandler.current = (s) => this.handlePrinterStatus(s);
      // 既知の最終状態から初期表示を復元
      if (cache.lastPrinterStatus) {
        this._printerStatus = cache.lastPrinterStatus;
        this._status = cache.lastPrinterStatus.isConnected ? "connected" : "disconnected";
      }
    }
  }

  private get _printer(): LXD02Printer | null {
    return this._cache?.printer ?? null;
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this._onStatusChange?.(this._status, this._printerStatus);
  }

  private handlePrinterStatus(s: PrinterStatus) {
    this._printerStatus = s;
    if (this._cache) this._cache.lastPrinterStatus = s;
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
   * プリンターに接続する
   */
  async connect(): Promise<void> {
    if (this._status === "connecting") return;

    this.setStatus("connecting");

    try {
      if (!this._cache) {
        const statusHandler: GlobalPrinterCache["statusHandler"] = {
          current: (s) => this.handlePrinterStatus(s),
        };
        const printer = new LXD02Printer({
          onStatusChange: (s) => statusHandler.current?.(s),
        });
        this._cache = { printer, statusHandler, lastPrinterStatus: null };
        setGlobalCache(this._cache);
      }
      await this._cache.printer.connect();
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
    if (!this._printer) {
      throw new Error("Printer not connected. Call connect() first in a user gesture.");
    }
    if (this._status !== "connected") {
      // 接続が切れている可能性があるため再接続を試みる
      try {
        await this._printer.connect();
        this.setStatus("connected");
      } catch {
        this.setStatus("error");
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
