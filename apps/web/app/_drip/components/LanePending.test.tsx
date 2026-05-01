import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

import { LanePending } from "./LanePending";
import type { LanePendingState } from "./LaneIdle";

function setup(initialDuration = 0) {
  const onChangeState = vi.fn();
  const onStart = vi.fn();
  const state: LanePendingState = {
    kind: "pending",
    menuItemId: "menu-1",
    count: 2,
    durationSec: initialDuration,
  };
  const utils = render(
    <LanePending
      laneNumber={1}
      state={state}
      menuItemName="アメリカーノ"
      eventId="2026-04-18"
      onChangeState={onChangeState}
      onStart={onStart}
      isStarting={false}
    />,
  );
  return { onChangeState, onStart, ...utils };
}

describe("LanePending", () => {
  it("初期は durationSec=0 のとき Start ボタンが disabled", () => {
    setup(0);
    expect(screen.getByRole("button", { name: "▶ Start" })).toBeDisabled();
  });

  it("+10秒ボタンを押すと onChangeState が durationSec+10 で呼ばれる", () => {
    const { onChangeState } = setup(60);
    fireEvent.click(screen.getByRole("button", { name: "+10秒" }));
    expect(onChangeState).toHaveBeenCalledWith({
      kind: "pending",
      menuItemId: "menu-1",
      count: 2,
      durationSec: 70,
    });
  });

  it("+1分ボタンを押すと onChangeState が durationSec+60 で呼ばれる", () => {
    const { onChangeState } = setup(30);
    fireEvent.click(screen.getByRole("button", { name: "+1分" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 90 }));
  });

  it("+3分ボタンを押すと onChangeState が durationSec+180 で呼ばれる", () => {
    const { onChangeState } = setup(0);
    fireEvent.click(screen.getByRole("button", { name: "+3分" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 180 }));
  });

  it("リセットボタンを押すと durationSec=0 で onChangeState が呼ばれる", () => {
    const { onChangeState } = setup(180);
    fireEvent.click(screen.getByRole("button", { name: "リセット" }));
    expect(onChangeState).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 0 }));
  });

  it("合計時間が MM:SS で表示される", () => {
    setup(125); // 2:05
    expect(screen.getByText("02:05")).toBeInTheDocument();
  });

  it("キャンセルボタンを押すと idle 状態へ戻す onChangeState が呼ばれる", () => {
    const { onChangeState } = setup(60);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onChangeState).toHaveBeenCalledWith({
      kind: "idle",
      menuItemId: "menu-1",
      count: 2,
    });
  });

  it("durationSec > 0 のとき Start ボタンが enabled になる", () => {
    setup(60);
    expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled();
  });

  it("Start submit で onStart が呼ばれる（楽観的削除トリガ）", () => {
    const { onStart } = setup(60);
    fireEvent.submit(screen.getByRole("button", { name: "▶ Start" }).closest("form")!);
    expect(onStart).toHaveBeenCalled();
  });
});
