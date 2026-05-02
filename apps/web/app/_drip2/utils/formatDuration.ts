/**
 * 秒数を MM:SS 形式で表示。負数のときは `-MM:SS` で表示する。
 */
export function formatDuration(totalSec: number): string {
  const sign = totalSec < 0 ? "-" : "";
  const abs = Math.abs(totalSec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
