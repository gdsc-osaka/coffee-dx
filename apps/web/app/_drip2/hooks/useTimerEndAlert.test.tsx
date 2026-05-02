import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playMock = vi.hoisted(() => vi.fn());
vi.mock("../utils/audioUnlock", () => ({
  playTimerEndSound: playMock,
}));

import { useTimerEndAlert } from "./useTimerEndAlert";

describe("useTimerEndAlert", () => {
  beforeEach(() => {
    playMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remaining が初めて 0 以下に到達したときに 1 度だけ鳴る", () => {
    const { rerender } = renderHook(
      ({ r }: { r: number | null }) => useTimerEndAlert(r, "batch-1"),
      {
        initialProps: { r: 5 },
      },
    );
    expect(playMock).not.toHaveBeenCalled();

    rerender({ r: 1 });
    expect(playMock).not.toHaveBeenCalled();

    rerender({ r: 0 });
    expect(playMock).toHaveBeenCalledTimes(1);

    // 0 以下のまま再レンダリングしても再発火しない
    rerender({ r: -1 });
    rerender({ r: -2 });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("タイマー再設定で remaining が再び正の値に戻ったあと 0 に到達すると再度鳴る", () => {
    const { rerender } = renderHook(
      ({ r }: { r: number | null }) => useTimerEndAlert(r, "batch-1"),
      {
        initialProps: { r: 1 },
      },
    );

    rerender({ r: 0 });
    expect(playMock).toHaveBeenCalledTimes(1);

    // 再設定で正の値に戻る
    rerender({ r: 60 });
    expect(playMock).toHaveBeenCalledTimes(1);

    // 再度 0 に到達
    rerender({ r: 0 });
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it("remaining が null のとき何もしない（ref もリセットされる）", () => {
    const { rerender } = renderHook(
      ({ r }: { r: number | null }) => useTimerEndAlert(r, "batch-1"),
      {
        initialProps: { r: 0 as number | null },
      },
    );
    expect(playMock).toHaveBeenCalledTimes(1);

    // タイマー解除
    rerender({ r: null });
    expect(playMock).toHaveBeenCalledTimes(1);

    // 新しいタイマー開始 → 0 到達で再度鳴る
    rerender({ r: 30 });
    rerender({ r: 0 });
    expect(playMock).toHaveBeenCalledTimes(2);
  });
});
