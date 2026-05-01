import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LaneIdle, type LaneIdleState } from "./LaneIdle";

function setup(initial: Partial<LaneIdleState> = {}) {
  const onChangeState = vi.fn();
  const onRemove = vi.fn();
  const state: LaneIdleState = {
    kind: "idle",
    menuItemId: null,
    count: 1,
    ...initial,
  };
  const utils = render(
    <LaneIdle
      laneNumber={1}
      state={state}
      menus={[
        { id: "menu-1", name: "アメリカーノ" },
        { id: "menu-2", name: "ラテ" },
      ]}
      onChangeState={onChangeState}
      onRemove={onRemove}
    />,
  );
  return { onChangeState, onRemove, ...utils };
}

describe("LaneIdle", () => {
  it("メニュー未選択のとき抽出開始ボタンが disabled", () => {
    setup({ menuItemId: null });
    expect(screen.getByRole("button", { name: "▶ 抽出開始" })).toBeDisabled();
  });

  it("メニュー選択ボタンを押すと onChangeState で menuItemId が設定される", () => {
    const { onChangeState } = setup({ menuItemId: null });
    fireEvent.click(screen.getByRole("button", { name: "アメリカーノ" }));
    expect(onChangeState).toHaveBeenCalledWith({
      kind: "idle",
      menuItemId: "menu-1",
      count: 1,
    });
  });

  it("杯数ボタンを押すと onChangeState で count が変わる", () => {
    const { onChangeState } = setup({ menuItemId: "menu-1" });
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }));
  });

  it("メニュー選択済みで「抽出開始」を押すと pending 状態へ遷移", () => {
    const { onChangeState } = setup({ menuItemId: "menu-1", count: 2 });
    fireEvent.click(screen.getByRole("button", { name: "▶ 抽出開始" }));
    expect(onChangeState).toHaveBeenCalledWith({
      kind: "pending",
      menuItemId: "menu-1",
      count: 2,
      durationSec: 0,
    });
  });

  it("× 削除ボタンで onRemove が呼ばれる", () => {
    const { onRemove } = setup();
    fireEvent.click(screen.getByRole("button", { name: "このレーンを削除" }));
    expect(onRemove).toHaveBeenCalled();
  });
});
