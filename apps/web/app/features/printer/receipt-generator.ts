import { $Font } from "bdfparser";

export type ReceiptItem = {
  name: string;
  quantity: number;
};

export type ReceiptData = {
  orderNumber: number;
  items: ReceiptItem[];
  timestamp: Date;
};

/**
 * 文字列を AsyncIterableIterator<string> に変換する
 */
async function* stringToIterator(str: string): AsyncIterableIterator<string> {
  let start = 0;
  let count = 0;
  while (start < str.length) {
    let end = str.indexOf("\n", start);
    let line = "";
    if (end === -1) {
      line = str.slice(start);
      start = str.length;
    } else {
      line = str.slice(start, end).replace("\r", "");
      start = end + 1;
    }

    yield line;

    count++;
    // 1000行パースするごとにイベントループに処理を返し、UIのフリーズを防ぐ
    if (count % 1000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * レシート画像を生成するクラス
 */
export class ReceiptGenerator {
  private bdfFontInstance: any | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private backgroundSrc: string,
    private bdfFontSrc: string,
  ) {}

  /**
   * フォントなどを事前に読み込んでおく（UIフリーズ軽減のため）
   */
  async init(): Promise<void> {
    if (this.bdfFontInstance) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.isInitializing = true;
      try {
        await this.loadFontInstance();
      } finally {
        this.isInitializing = false;
      }
    })();
    return this.initPromise;
  }

  private async loadFontInstance(): Promise<any> {
    if (this.bdfFontInstance) return this.bdfFontInstance;
    const resp = await fetch(this.bdfFontSrc);
    if (!resp.ok) throw new Error(`Failed to load font: ${this.bdfFontSrc}`);
    const text = await resp.text();
    this.bdfFontInstance = await $Font(stringToIterator(text));
    return this.bdfFontInstance;
  }

  private async loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async generate(data: ReceiptData): Promise<Uint8Array> {
    const [bgImage, bdfFont] = await Promise.all([
      this.loadImage(this.backgroundSrc),
      this.loadFontInstance(),
    ]);

    // Google Sans Code がロードされているか確認
    await document.fonts.load('700 120px "Google Sans Code"');

    const canvas = document.createElement("canvas");
    canvas.width = 384; // LX-D02 の幅に固定
    canvas.height = bgImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");

    // 背景描画 (384px にリサイズして描画)
    ctx.drawImage(bgImage, 0, 0, 384, bgImage.height);

    // 受付番号描画 (Google Sans Code, Center, Y: 76px)
    ctx.fillStyle = "black";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = '700 120px "Google Sans Code"';
    ctx.fillText(`#${data.orderNumber}`, canvas.width / 2, 76);

    // ビットマップフォントはロード済み

    const pad = (n: number) => String(n).padStart(2, "0");
    const d = data.timestamp;
    const datetimeStr = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    // 日時描画 (右上揃え, Y: 0)
    const dtBitmap = bdfFont.draw(datetimeStr);
    const dtTrueWidth = this.getBitmapTrueWidth(dtBitmap);
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = dtBitmap.width();
    tempCanvas.height = dtBitmap.height();
    const tempCtx = tempCanvas.getContext("2d");
    if (tempCtx) {
      dtBitmap.draw2canvas(tempCtx as any);
      // 右端の空白を考慮して右寄せ
      ctx.drawImage(tempCanvas, canvas.width - dtTrueWidth, 0);
    }

    // 注文内容描画 (右揃え, Y: 22, 44, ...)
    data.items.slice(0, 3).forEach((item, index) => {
      const itemStr = `${item.name} x ${item.quantity}`;
      const itemBitmap = bdfFont.draw(itemStr);
      const itemTrueWidth = this.getBitmapTrueWidth(itemBitmap);
      const tCanvas = document.createElement("canvas");
      tCanvas.width = itemBitmap.width();
      tCanvas.height = itemBitmap.height();
      const tCtx = tCanvas.getContext("2d");
      if (tCtx) {
        itemBitmap.draw2canvas(tCtx as any);
        ctx.drawImage(tCanvas, canvas.width - itemTrueWidth, 22 + index * 22);
      }
    });

    return this.canvasToRaw(canvas);
  }

  /**
   * ビットマップの実際の描画幅（右端のピクセルまでの距離）を取得する
   */
  private getBitmapTrueWidth(bitmap: any): number {
    const data = bitmap.todata(2); // number[][]
    let maxWidth = 0;
    for (let y = 0; y < data.length; y++) {
      const row = data[y];
      for (let x = row.length - 1; x >= 0; x--) {
        if (row[x] > 0) {
          if (x + 1 > maxWidth) maxWidth = x + 1;
          break;
        }
      }
    }
    return maxWidth > 0 ? maxWidth : bitmap.width();
  }

  /**
   * Canvas を 1bpp の raw bitmap (384px幅) に変換する
   */
  private canvasToRaw(canvas: HTMLCanvasElement): Uint8Array {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not get canvas context");

    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // LX-D02 は 384px (48 bytes) 固定
    const packed = new Uint8Array(height * 48);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= 384) break;

        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // アルファ値が低い、または輝度が高い場合は白とする
        const brightness = a < 128 ? 255 : (r + g + b) / 3;

        if (brightness < 128) {
          const byteIdx = y * 48 + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          packed[byteIdx] |= 1 << bitIdx;
        }
      }
    }
    return packed;
  }
}

export const receiptGenerator = new ReceiptGenerator("/ticket-background.png", "/b16.bdf");
