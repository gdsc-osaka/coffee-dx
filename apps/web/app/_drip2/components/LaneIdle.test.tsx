import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

import { LaneIdle, type LaneIdleState } from "./LaneIdle";

function setup(initial: Partial<LaneIdleState> = {}, options: { isStarting?: boolean } = {}) {
  const onChangeState = vi.fn();
  const onStart = vi.fn();
  const state: LaneIdleState = {
    kind: "idle",
    menuItemId: null,
    count: 1,
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

  it("メニュー選択済みで「抽出開始」を submit すると onStart が呼ばれる", () => {
    const { onStart } = setup({ menuItemId: "menu-1", count: 2 });
    fireEvent.submit(screen.getByRole("button", { name: "▶ 抽出開始" }).closest("form")!);
    expect(onStart).toHaveBeenCalled();
  });

  it("isStarting のとき抽出開始ボタンが disabled", () => {
    setup({ menuItemId: "menu-1", count: 2 }, { isStarting: true });
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
  });

  it("× 削除ボタンは存在しない（固定 3 レーンのため）", () => {
    setup();
    expect(screen.queryByRole("button", { name: "このレーンを削除" })).not.toBeInTheDocument();
  });

  it("form に laneIndex の hidden input が含まれる", () => {
    const { container } = setup({ menuItemId: "menu-1", count: 2 });
    const laneInput = container.querySelector('input[name="laneIndex"]');
    expect(laneInput).not.toBeNull();
    expect(laneInput?.getAttribute("value")).toBe("0");
  });
});
