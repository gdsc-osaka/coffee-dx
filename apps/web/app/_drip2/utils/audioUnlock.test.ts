import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAudioForTest,
  ensureAudioUnlocked,
  isAudioUnlocked,
  playTimerEndSound,
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
  connect = vi.fn().mockReturnThis();
  start = vi.fn();
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

  constructor() {
    instances.push(this);
  }
}

const lastInstance = () => instances[instances.length - 1];

beforeEach(() => {
  __resetAudioForTest();
  instances.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
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

  it("playTimerEndSound() は unlock 後に Oscillator を 3 回作って再生する", async () => {
    await ensureAudioUnlocked();
    playTimerEndSound();
    expect(lastInstance()?.createOscillator).toHaveBeenCalledTimes(3);
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
    expect(() => playTimerEndSound()).not.toThrow();
  });
});
