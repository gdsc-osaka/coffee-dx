import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

// テストではタイマー UI を有効にして検証する。本番では一時的に無効化中。
vi.mock("../constants", () => ({
  TIMER_FEATURE_ENABLED: true,
}));

import { LaneIdle, type LaneIdleState } from "./LaneIdle";

function setup(initial: Partial<LaneIdleState> = {}, options: { isStarting?: boolean } = {}) {
  const onChangeState = vi.fn();
  const onStart = vi.fn();
  const state: LaneIdleState = {
    kind: "idle",
    menuItemId: null,
    count: 1,
    durationSec: 0,
    ...initial,
  };
  const utils = render(
    <LaneIdle
      laneNumber={1}
      laneIndex={0}
      state={state}
      menus={[
        { id: "menu-1", name: "アメリカーノ" },
        { id: "menu-2", name: "ラテ" },
      ]}
      eventId="2026-04-18"
      isStarting={options.isStarting ?? false}
      onChangeState={onChangeState}
      onStart={onStart}
    />,
  );
  return { onChangeState, onStart, ...utils };
}

describe("LaneIdle", () => {
  it("メニュー未選択のとき抽出開始ボタンが disabled", () => {
    setup({ menuItemId: null, durationSec: 60 });
    expect(screen.getByRole("button", { name: "▶ 抽出開始" })).toBeDisabled();
  });

  it("durationSec=0 のとき抽出開始ボタンが disabled（タイマー必須）", () => {
    setup({ menuItemId: "menu-1", count: 1, durationSec: 0 });
    expect(screen.getByRole("button", { name: "▶ 抽出開始" })).toBeDisabled();
  });

  it("メニュー選択ボタンを押すと onChangeState で menuItemId が設定される", () => {
    const { onChangeState } = setup({ menuItemId: null });
    fireEvent.click(screen.getByRole("button", { name: "アメリカーノ" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ menuItemId: "menu-1" }));
  });

  it("杯数ボタンを押すと onChangeState で count が変わる", () => {
    const { onChangeState } = setup({ menuItemId: "menu-1" });
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }));
  });

  it("+1分 ボタンで durationSec が +60 される", () => {
    const { onChangeState } = setup({ menuItemId: "menu-1", durationSec: 30 });
    fireEvent.click(screen.getByRole("button", { name: "+1分" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 90 }));
  });

  it("リセットで durationSec が 0 になる", () => {
    const { onChangeState } = setup({ menuItemId: "menu-1", durationSec: 180 });
    fireEvent.click(screen.getByRole("button", { name: "リセット" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 0 }));
  });

  it("合計時間が MM:SS で表示される", () => {
    setup({ durationSec: 125 });
    expect(screen.getByText("02:05")).toBeInTheDocument();
  });

  it("メニュー / 杯数 / タイマー全部揃って submit すると onStart が呼ばれる", () => {
    const { onStart } = setup({ menuItemId: "menu-1", count: 2, durationSec: 60 });
    fireEvent.submit(screen.getByRole("button", { name: "▶ 抽出開始" }).closest("form")!);
    expect(onStart).toHaveBeenCalled();
  });

  it("isStarting のとき抽出開始ボタンが disabled", () => {
    setup({ menuItemId: "menu-1", count: 2, durationSec: 60 }, { isStarting: true });
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
  });

  it("× 削除ボタンは存在しない（固定 3 レーンのため）", () => {
    setup();
    expect(screen.queryByRole("button", { name: "このレーンを削除" })).not.toBeInTheDocument();
  });

  it("form に laneIndex / targetDurationSec の hidden input が含まれる", () => {
    const { container } = setup({ menuItemId: "menu-1", count: 2, durationSec: 90 });
    const laneInput = container.querySelector('input[name="laneIndex"]');
    const durationInput = container.querySelector('input[name="targetDurationSec"]');
    expect(laneInput?.getAttribute("value")).toBe("0");
    expect(durationInput?.getAttribute("value")).toBe("90");
  });
});
