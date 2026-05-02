import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __awaitAlarmLoadForTest,
  __resetAudioForTest,
  ensureAudioUnlocked,
  isAudioUnlocked,
  playTimerEndSound,
  stopTimerEndSound,
} from "./audioUnlock";

class FakeOscillator {
  type = "sine";
  frequency = { value: 0 };
  connect = vi.fn().mockReturnThis();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn().mockReturnThis();
}
class FakeBufferSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn().mockReturnThis();
  start = vi.fn();
  stop = vi.fn();
}

const instances: FakeAudioContext[] = [];

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createBuffer = vi.fn(() => ({}) as AudioBuffer);
  createBufferSource = vi.fn(() => new FakeBufferSource());
  createOscillator = vi.fn(() => new FakeOscillator());
  createGain = vi.fn(() => new FakeGain());
  decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);

  constructor() {
    instances.push(this);
  }
}

const lastInstance = () => instances[instances.length - 1];

beforeEach(() => {
  __resetAudioForTest();
  instances.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audioUnlock", () => {
  it("ensureAudioUnlocked() が AudioContext を resume して running にする", async () => {
    const ok = await ensureAudioUnlocked();
    expect(ok).toBe(true);
    expect(lastInstance()?.resume).toHaveBeenCalled();
    expect(lastInstance()?.state).toBe("running");
    expect(isAudioUnlocked()).toBe(true);
  });

  it("ensureAudioUnlocked() を 2 度呼んでも AudioContext は 1 度しか作られない", async () => {
    await ensureAudioUnlocked();
    const firstInstance = lastInstance();
    await ensureAudioUnlocked();
    expect(instances.length).toBe(1);
    expect(lastInstance()).toBe(firstInstance);
  });

  it("alarm.mp3 がロードされていれば BufferSource を作って再生する", async () => {
    await ensureAudioUnlocked();
    await __awaitAlarmLoadForTest();
    playTimerEndSound("batch-1");
    expect(lastInstance()?.createBufferSource).toHaveBeenCalled();
    // Oscillator (fallback) は使われない
    expect(lastInstance()?.createOscillator).not.toHaveBeenCalled();
  });

  it("alarm.mp3 のロードに失敗した場合は Oscillator を 3 回作って fallback する", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    );
    __resetAudioForTest();
    await ensureAudioUnlocked();
    await __awaitAlarmLoadForTest();
    playTimerEndSound("batch-1");
    expect(lastInstance()?.createOscillator).toHaveBeenCalledTimes(3);
  });

  it("stopTimerEndSound() は再生中のアラームソースを停止する", async () => {
    await ensureAudioUnlocked();
    await __awaitAlarmLoadForTest();
    playTimerEndSound("batch-1");
    const lastSource = lastInstance()?.createBufferSource.mock.results.at(-1)?.value as
      | FakeBufferSource
      | undefined;
    expect(lastSource).toBeDefined();
    stopTimerEndSound("batch-1");
    expect(lastSource?.stop).toHaveBeenCalled();
  });

  it("playTimerEndSound() を再度呼ぶと前のソースが停止されてから新しく再生される", async () => {
    await ensureAudioUnlocked();
    await __awaitAlarmLoadForTest();
    playTimerEndSound("batch-1");
    const firstSource = lastInstance()?.createBufferSource.mock.results.at(-1)?.value as
      | FakeBufferSource
      | undefined;

    playTimerEndSound("batch-1");
    expect(firstSource?.stop).toHaveBeenCalled();
    expect(lastInstance()?.createBufferSource).toHaveBeenCalledTimes(3); // 1 = unlock 用無音, 2 = 1 回目の alarm, 3 = 2 回目
  });

  it("異なる key のアラームは独立して鳴り、片方を停止しても他方は止まらない", async () => {
    await ensureAudioUnlocked();
    await __awaitAlarmLoadForTest();
    playTimerEndSound("batch-A");
    const sourceA = lastInstance()?.createBufferSource.mock.results.at(-1)?.value as
      | FakeBufferSource
      | undefined;
    playTimerEndSound("batch-B");
    const sourceB = lastInstance()?.createBufferSource.mock.results.at(-1)?.value as
      | FakeBufferSource
      | undefined;

    expect(sourceA).not.toBe(sourceB);
    // batch-A だけ止める
    stopTimerEndSound("batch-A");
    expect(sourceA?.stop).toHaveBeenCalled();
    expect(sourceB?.stop).not.toHaveBeenCalled();
  });

  it("stopTimerEndSound() は鳴っていなくても安全に呼べる", () => {
    expect(() => stopTimerEndSound("batch-1")).not.toThrow();
  });

  it("AudioContext が無い環境では ensureAudioUnlocked() は false を返し isAudioUnlocked() は false", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    __resetAudioForTest();
    const ok = await ensureAudioUnlocked();
    expect(ok).toBe(false);
    expect(isAudioUnlocked()).toBe(false);
  });

  it("playTimerEndSound() は unlock していない状態では何もしない", () => {
    expect(() => playTimerEndSound("batch-1")).not.toThrow();
  });
});
