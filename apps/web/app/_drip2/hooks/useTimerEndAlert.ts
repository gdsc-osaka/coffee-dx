import { useEffect, useRef } from "react";
import { playTimerEndSound } from "../utils/audioUnlock";

/**
 * 残り秒数 (`remaining`) が 0 以下に初めて到達したタイミングで通知音を再生する。
 * 同じレーンで何度も鳴らないよう、ref で 1 度きりに制限する。
 *
 * `remaining` が `null`（タイマー未指定）の場合は何もしない。
 */
export function useTimerEndAlert(remaining: number | null): void {
  const triggered = useRef(false);
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0 && !triggered.current) {
      triggered.current = true;
      playTimerEndSound();
    }
  }, [remaining]);
}
