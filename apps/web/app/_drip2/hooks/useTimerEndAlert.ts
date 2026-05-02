import { useEffect, useRef } from "react";
import { playTimerEndSound } from "../utils/audioUnlock";

/**
 * 残り秒数 (`remaining`) が 0 以下に初めて到達したタイミングで通知音を再生する。
 * `key` は再生・停止時のレーン識別子（batchId 想定）で、複数レーンが同時に終了
 * しても各レーンが独立にアラーム制御できるようにする。
 *
 * 同じバッチで何度も鳴らないよう ref で 1 度きりに制限するが、タイマー再設定
 * で `remaining` が再び正の値に戻ったら ref をリセットして次の終了でも鳴らす。
 *
 * `remaining` が `null`（タイマー未指定）の場合は何もしない（ref もリセット）。
 */
export function useTimerEndAlert(remaining: number | null, key: string): void {
  const triggered = useRef(false);
  useEffect(() => {
    if (remaining === null) {
      // タイマー解除 → 次に開始されたときに鳴るようリセット
      triggered.current = false;
      return;
    }
    if (remaining <= 0) {
      if (!triggered.current) {
        triggered.current = true;
        playTimerEndSound(key);
      }
    } else {
      // 再設定でリスタートされた場合に備えてリセット
      triggered.current = false;
    }
  }, [remaining, key]);
}
