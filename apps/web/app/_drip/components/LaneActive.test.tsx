import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

import { LaneActive } from "./LaneActive";

const baseProps = {
  laneNumber: 2,
  menuItemName: "アメリカーノ",
  count: 2,
  batchId: "batch-1",
  createdAt: "2026-04-18 12:00:00",
  eventId: "2026-04-18",
  isCompleting: false,
  isCancelling: false,
};

describe("LaneActive", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // createdAt の +5 秒後を「現在時刻」にする
    vi.setSystemTime(new Date("2026-04-18T12:00:05+09:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("targetDurationSec が指定されているとき残り時間がカウントダウン表示される", () => {
    render(<LaneActive {...baseProps} targetDurationSec={60} />);
    // createdAt+5s の時点で残り 55 秒
    expect(screen.getByText("00:55")).toBeInTheDocument();
    expect(screen.getByText("残り")).toBeInTheDocument();
  });

  it("setInterval 経過で残り時間が減る", async () => {
    render(<LaneActive {...baseProps} targetDurationSec={60} />);
    expect(screen.getByText("00:55")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("00:53")).toBeInTheDocument();
  });

  it("targetDurationSec=null のとき経過時間（カウントアップ）が表示される", () => {
    render(<LaneActive {...baseProps} targetDurationSec={null} />);
    expect(screen.getByText("00:05")).toBeInTheDocument();
    expect(screen.getByText("経過")).toBeInTheDocument();
  });

  it("残り時間が 0 以下のとき data-finished='true' になりレーン色が変わる", () => {
    render(<LaneActive {...baseProps} targetDurationSec={3} />);
    // createdAt+5s で残り -2 秒（= 0 以下）
    const lane = screen.getByText("超過").closest('[data-finished]');
    expect(lane).toHaveAttribute("data-finished", "true");
    expect(screen.getByText("-00:02")).toBeInTheDocument();
  });

  it("取消ボタンを押すと確認 Dialog が開く", () => {
    render(<LaneActive {...baseProps} targetDurationSec={60} />);
    expect(screen.queryByRole("button", { name: "取消する" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "抽出を取消しますか？" })).toBeInTheDocument();
    expect(screen.getByText(/アメリカーノ 2 杯のバッチを取消します/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消する" })).toBeInTheDocument();
  });

  it("Dialog の「いいえ」を押すと閉じる", () => {
    render(<LaneActive {...baseProps} targetDurationSec={60} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "いいえ" }));
    // Dialog が閉じて取消する ボタンも消える
    expect(screen.queryByRole("button", { name: "取消する" })).not.toBeInTheDocument();
  });

  it("isCompleting のとき完了ボタンが disabled", () => {
    render(<LaneActive {...baseProps} targetDurationSec={60} isCompleting />);
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
  });
});
