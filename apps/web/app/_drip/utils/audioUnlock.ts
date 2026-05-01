/**
 * iOS Safari / iPadOS / Android Chrome の autoplay 制限への対処。
 * 「ユーザー操作起因のイベントハンドラ内」でしか初回 audio 再生は許可されないため、
 * 任意のタップ操作でこの関数を一度呼び出して AudioContext を unlock する。
 *
 * 一度 unlock すれば以降はスクリプトから自由に再生できる。
 */

type AudioCtxClass = typeof AudioContext;

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtxClass(): AudioCtxClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioCtxClass;
    webkitAudioContext?: AudioCtxClass;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export async function ensureAudioUnlocked(): Promise<boolean> {
  if (unlocked && audioCtx) return true;
  const Ctx = getCtxClass();
  if (!Ctx) return false;

  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return false;
    }
  }

  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch {
      // ignore
    }
  }

  // 短い無音バッファを再生して権限を確定する。
  try {
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
    unlocked = audioCtx.state === "running";
  } catch {
    return false;
  }

  return unlocked;
}

export function isAudioUnlocked(): boolean {
  return unlocked && audioCtx !== null && audioCtx.state === "running";
}

/**
 * タイマー終了通知音。880Hz × 0.4s のビープを 3 連発で目立たせる。
 * AudioContext が unlock されていない場合は no-op。
 */
export function playTimerEndSound(): void {
  if (!audioCtx) return;
  if (audioCtx.state !== "running") return;

  const startAt = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    const offset = i * 0.55;
    gain.gain.setValueAtTime(0, startAt + offset);
    gain.gain.linearRampToValueAtTime(0.3, startAt + offset + 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + offset + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(startAt + offset);
    osc.stop(startAt + offset + 0.4);
  }
}

/** テスト用に内部状態をリセット */
export function __resetAudioForTest(): void {
  audioCtx = null;
  unlocked = false;
}
