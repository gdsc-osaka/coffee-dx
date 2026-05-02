import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { useSubmitMock } = vi.hoisted(() => ({
  useSubmitMock: vi.fn(),
}));
const submitFn = vi.fn();
useSubmitMock.mockReturnValue(submitFn);

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
  useSubmit: useSubmitMock,
}));

// テストではタイマー UI を有効にして検証する。本番では一時的に無効化中。
vi.mock("../constants", () => ({
  TIMER_FEATURE_ENABLED: true,
}));

import { LaneActive } from "./LaneActive";

beforeAll(() => {
  if (!("setPointerCapture" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  }
});

const setOffsetWidth = (el: HTMLElement, value: number) =>
  Object.defineProperty(el, "offsetWidth", {
    configurable: true,
    value,
  });

/** jsdom 26 で fireEvent.pointer* が clientX を伝搬しないため、MouseEvent を直接 dispatch */
function dispatchPointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerId?: number; clientX?: number; clientY?: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  if (init.pointerId !== undefined) {
    Object.defineProperty(event, "pointerId", {
      value: init.pointerId,
      configurable: true,
    });
  }
  el.dispatchEvent(event);
}

const baseProps = {
  laneNumber: 2,
  menuItemName: "アメリカーノ",
  count: 2,
  batchId: "batch-1",
  eventId: "2026-04-18",
  isCompleting: false,
  isCancelling: false,
  isSettingTimer: false,
};

describe("LaneActive", () => {
  beforeEach(() => {
    submitFn.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // timerStartedAt の +5 秒後を「現在時刻」にする
    vi.setSystemTime(new Date("2026-04-18T12:00:05+09:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("タイマー設定済み（targetDurationSec + timerStartedAt あり）で残り時間がカウントダウン表示", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    expect(screen.getByText("00:55")).toBeInTheDocument();
    expect(screen.getByText("残り")).toBeInTheDocument();
  });

  it("setInterval 経過で残り時間が減る", async () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    expect(screen.getByText("00:55")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("00:53")).toBeInTheDocument();
  });

  it("タイマー未設定 (timerStartedAt=null) のときはタイマー UI（▶ タイマー開始）が表示", () => {
    render(<LaneActive {...baseProps} targetDurationSec={null} timerStartedAt={null} />);
    expect(screen.getByRole("button", { name: "▶ タイマー開始" })).toBeInTheDocument();
  });

  it("残り時間が 0 以下のとき data-finished='true' になり、再設定 UI が出る", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={3} timerStartedAt="2026-04-18 12:00:00" />,
    );
    expect(screen.getByText(/タイマー終了/)).toBeInTheDocument();
    const lane = screen.getByText(/タイマー終了/).closest("[data-finished]");
    expect(lane).toHaveAttribute("data-finished", "true");
    expect(screen.getByRole("button", { name: "▶ タイマーを再設定" })).toBeInTheDocument();
  });

  it("タイマー未設定でも完了 / 取消 ボタンは表示される", () => {
    render(<LaneActive {...baseProps} targetDurationSec={null} timerStartedAt={null} />);
    expect(screen.getByRole("button", { name: /スワイプで完了/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消 \(1秒長押し\)/ })).toBeInTheDocument();
  });

  it("LaneTimer の +1分 → タイマー開始で useSubmit が brew-set-timer を 60s で送信", () => {
    render(<LaneActive {...baseProps} targetDurationSec={null} timerStartedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "+1分" }));
    fireEvent.click(screen.getByRole("button", { name: "▶ タイマー開始" }));
    expect(submitFn).toHaveBeenCalledTimes(1);
    const [fd] = submitFn.mock.calls[0];
    expect(fd.get("intent")).toBe("brew-set-timer");
    expect(fd.get("batchId")).toBe("batch-1");
    expect(fd.get("targetDurationSec")).toBe("60");
  });

  it("取消ボタンを長押しすると確認 Dialog が開く", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    expect(screen.queryByRole("button", { name: "取消する" })).not.toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: /取消/ });
    dispatchPointer(cancelBtn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("heading", { name: "抽出を取消しますか？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消する" })).toBeInTheDocument();
  });

  it("Dialog の「取消する」を押すと useSubmit が brew-cancel で呼ばれる", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    const cancelBtn = screen.getByRole("button", { name: /取消/ });
    dispatchPointer(cancelBtn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    fireEvent.click(screen.getByRole("button", { name: "取消する" }));
    expect(submitFn).toHaveBeenCalledTimes(1);
    const [fd] = submitFn.mock.calls[0];
    expect(fd.get("intent")).toBe("brew-cancel");
    expect(fd.get("eventId")).toBe("2026-04-18");
    expect(fd.get("batchId")).toBe("batch-1");
  });

  it("Dialog の「いいえ」で閉じても submit はされない", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    const cancelBtn = screen.getByRole("button", { name: /取消/ });
    dispatchPointer(cancelBtn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    fireEvent.click(screen.getByRole("button", { name: "いいえ" }));
    expect(submitFn).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "取消する" })).not.toBeInTheDocument();
  });

  it("スワイプを 60% 以上動かして離すと useSubmit が brew-complete で呼ばれる", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    const swipe = screen.getByRole("button", { name: /スワイプで完了/ });
    setOffsetWidth(swipe, 200);

    dispatchPointer(swipe, "pointerdown", { pointerId: 1, clientX: 0 });
    dispatchPointer(swipe, "pointermove", { pointerId: 1, clientX: 150 });
    dispatchPointer(swipe, "pointerup", { pointerId: 1, clientX: 150 });

    expect(submitFn).toHaveBeenCalledTimes(1);
    const [fd] = submitFn.mock.calls[0];
    expect(fd.get("intent")).toBe("brew-complete");
    expect(fd.get("batchId")).toBe("batch-1");
  });

  it("disabled (isCompleting) のときスワイプしても submit されない", () => {
    render(
      <LaneActive
        {...baseProps}
        targetDurationSec={60}
        timerStartedAt="2026-04-18 12:00:00"
        isCompleting
      />,
    );
    const swipe = screen.getByRole("button", { name: /スワイプで完了/ });
    setOffsetWidth(swipe, 200);

    dispatchPointer(swipe, "pointerdown", { pointerId: 1, clientX: 0 });
    dispatchPointer(swipe, "pointermove", { pointerId: 1, clientX: 150 });
    dispatchPointer(swipe, "pointerup", { pointerId: 1, clientX: 150 });

    expect(submitFn).not.toHaveBeenCalled();
  });
});
