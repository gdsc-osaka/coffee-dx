/**
 * iOS Safari / iPadOS / Android Chrome の autoplay 制限への対処。
 * 「ユーザー操作起因のイベントハンドラ内」でしか初回 audio 再生は許可されないため、
 * 任意のタップ操作でこの関数を一度呼び出して AudioContext を unlock する。
 *
 * unlock 後に /sounds/alarm.mp3 をプリロードしておき、タイマー終了で
 * BufferSource として再生する。フェッチ失敗時は 880Hz のビープ 3 連発に fallback。
 */

type AudioCtxClass = typeof AudioContext;

const ALARM_URL = "/sounds/alarm.mp3";

let audioCtx: AudioContext | null = null;
let unlocked = false;
let alarmBuffer: AudioBuffer | null = null;
let alarmLoadPromise: Promise<void> | null = null;
/**
 * レーン (key = batchId) ごとに再生中のアラームソースを保持する。
 * 複数レーンが同時に鳴ったとき、特定レーンだけを停止できるようにする。
 */
const activeAlarmSources = new Map<string, AudioBufferSourceNode>();

function getCtxClass(): AudioCtxClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioCtxClass;
    webkitAudioContext?: AudioCtxClass;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

async function loadAlarmBuffer(ctx: AudioContext): Promise<void> {
  if (alarmBuffer) return;
  if (alarmLoadPromise) return alarmLoadPromise;
  alarmLoadPromise = (async () => {
    try {
      const res = await fetch(ALARM_URL);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      alarmBuffer = await ctx.decodeAudioData(arr);
    } catch {
      // ネットワーク or デコード失敗時はフォールバックのビープ音を使う
    }
  })();
  return alarmLoadPromise;
}

export async function ensureAudioUnlocked(): Promise<boolean> {
  // すでに running なら何もしない。state を毎回確認しないと iOS Safari 等で
  // 画面オフ・タブ非アクティブ後に "interrupted" / "suspended" になっても
  // 「unlock 済み」のまま放置されてしまう。
  if (audioCtx && unlocked && audioCtx.state === "running") return true;

  const Ctx = getCtxClass();
  if (!Ctx) return false;

  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return false;
    }
  }

  // suspended と interrupted (iOS) はどちらも resume() で復帰する
  if (audioCtx.state !== "running") {
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

  if (unlocked && audioCtx) {
    // alarm.mp3 のプリロードはバックグラウンドで進める（unlock の戻り値はこれを待たない）
    void loadAlarmBuffer(audioCtx);
  }

  return unlocked;
}

export function isAudioUnlocked(): boolean {
  return unlocked && audioCtx !== null && audioCtx.state === "running";
}

/**
 * タイマー終了通知音。/sounds/alarm.mp3 を再生する。
 * 第 1 引数 key（batchId 想定）は同レーンの重複再生防止と停止 API での識別に使う。
 * MP3 が未ロードのときは 880Hz × 0.4s のビープ 3 連発を fallback として鳴らす。
 * AudioContext が unlock されていない場合は no-op。
 */
export function playTimerEndSound(key: string): void {
  if (!audioCtx) return;
  if (audioCtx.state !== "running") return;

  // 同じ key のソースがあれば先に停止（重複再生防止）
  stopTimerEndSound(key);

  if (alarmBuffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = alarmBuffer;
    src.connect(audioCtx.destination);
    src.onended = () => {
      if (activeAlarmSources.get(key) === src) activeAlarmSources.delete(key);
    };
    src.start(0);
    activeAlarmSources.set(key, src);
    return;
  }

  // Fallback: 880Hz × 0.4s × 3 連発（短時間で自動終了するため停止トラッキングしない）
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

/**
 * 指定 key（batchId）のレーンで再生中のタイマー終了通知音を停止する。
 * 他レーンのアラームには影響しない。鳴っていない場合は no-op。
 */
export function stopTimerEndSound(key: string): void {
  const src = activeAlarmSources.get(key);
  if (!src) return;
  try {
    src.stop(0);
  } catch {
    // 既に停止済みの場合は InvalidStateError が出る場合があるので握り潰す
  }
  activeAlarmSources.delete(key);
}

/** テスト用に内部状態をリセット */
export function __resetAudioForTest(): void {
  audioCtx = null;
  unlocked = false;
  alarmBuffer = null;
  alarmLoadPromise = null;
  activeAlarmSources.clear();
}

/** テスト用: alarm.mp3 のロード Promise を await する */
export async function __awaitAlarmLoadForTest(): Promise<void> {
  if (alarmLoadPromise) await alarmLoadPromise;
}
