import { useEffect, useState } from "react";
import { parseJst } from "../utils/parseJst";

/**
 * バッチ抽出開始時刻 (createdAt) からの経過秒を 1 秒ごとに更新する。
 * タブ非アクティブ時の throttle 対策として、差分計算ベースで欠落しないようにしている。
 */
export function useElapsedSeconds(createdAt: string): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - parseJst(createdAt)) / 1000));
}
