import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSubmitMock, submitFn, fetcherSubmitFn, fetcherState, fetcherData } = vi.hoisted(() => {
  const submitFn = vi.fn();
  const fetcherSubmitFn = vi.fn();
  return {
    useSubmitMock: vi.fn(),
    submitFn,
    fetcherSubmitFn,
    fetcherState: { current: "idle" },
    fetcherData: { current: undefined as { ok: boolean; error?: string } | undefined },
  };
});

useSubmitMock.mockReturnValue(submitFn);

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
  useSubmit: useSubmitMock,
  useFetcher: () => ({
    submit: fetcherSubmitFn,
    state: fetcherState.current,
    data: fetcherData.current,
  }),
}));

// テストではタイマー UI を有効にして検証する。本番では一時的に無効化中。
vi.mock("../constants", () => ({
  TIMER_FEATURE_ENABLED: true,
}));

import { LaneActive } from "./LaneActive";

const baseProps = {
  laneNumber: 2,
  menuItemName: "アメリカーノ",
  count: 2,
  batchId: "batch-1",
  eventId: "2026-04-18",
  isCancelling: false,
  isSettingTimer: false,
};

describe("LaneActive", () => {
  beforeEach(() => {
    submitFn.mockClear();
    fetcherSubmitFn.mockClear();
    fetcherState.current = "idle";
    fetcherData.current = undefined;
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
    expect(screen.getByRole("button", { name: "完了" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
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

  it("取消ボタンをタップすると確認 Dialog が開く", async () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    expect(screen.queryByRole("button", { name: "取消する" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(
      await screen.findByRole("heading", { name: "抽出を取消しますか？" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消する" })).toBeInTheDocument();
  });

  it("Dialog の「取消する」を押すと useSubmit が brew-cancel で呼ばれる", async () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(await screen.findByRole("button", { name: "取消する" }));
    expect(submitFn).toHaveBeenCalledTimes(1);
    const [fd] = submitFn.mock.calls[0];
    expect(fd.get("intent")).toBe("brew-cancel");
    expect(fd.get("eventId")).toBe("2026-04-18");
    expect(fd.get("batchId")).toBe("batch-1");
  });

  it("Dialog の「いいえ」で閉じても submit はされない", async () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(await screen.findByRole("button", { name: "いいえ" }));
    expect(submitFn).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "取消する" })).not.toBeInTheDocument();
  });

  it("「完了」タップ直後は fetcherSubmitFn も submitFn も呼ばれず、「完了しました」と「元に戻す」が表示され、「取消」ボタンは表示されない", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    expect(fetcherSubmitFn).not.toHaveBeenCalled();
    expect(submitFn).not.toHaveBeenCalled();
    expect(screen.getByText("完了しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
  });

  it("5 秒経過で fetcherSubmitFn が 1 回だけ呼ばれ、FormData が intent=brew-complete / eventId / batchId を持つ。その後「元に戻す」は表示されない", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fetcherSubmitFn).toHaveBeenCalledTimes(1);
    const [fd, opts] = fetcherSubmitFn.mock.calls[0];
    expect(fd.get("intent")).toBe("brew-complete");
    expect(fd.get("eventId")).toBe("2026-04-18");
    expect(fd.get("batchId")).toBe("batch-1");
    expect(opts).toEqual({ method: "post" });
    expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
    expect(screen.getByText("完了しました")).toBeInTheDocument();
  });

  it("5 秒以内に「元に戻す」を押すと、その後 5 秒以上経過しても送信されず、「完了」ボタンが再表示される", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));

    expect(screen.getByRole("button", { name: "完了" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.queryByText("完了しました")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fetcherSubmitFn).not.toHaveBeenCalled();
  });

  it("5 秒以内にアンマウントすると送信されない", () => {
    const { unmount } = render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fetcherSubmitFn).not.toHaveBeenCalled();
  });

  it("fetcher.data が { ok: false, error: '...' } になったら「完了」ボタンとエラー文言が表示される", () => {
    const { rerender } = render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fetcherSubmitFn).toHaveBeenCalledTimes(1);

    // fetcher がエラー応答を返した状態をシミュレート
    fetcherData.current = { ok: false, error: "サーバーエラーが発生しました" };
    rerender(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );

    expect(screen.getByRole("button", { name: "完了" })).toBeInTheDocument();
    expect(screen.getByText("サーバーエラーが発生しました")).toBeInTheDocument();

    // 再度「完了」を押すとエラー表示が消える
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    expect(screen.queryByText("サーバーエラーが発生しました")).not.toBeInTheDocument();
    expect(screen.getByText("完了しました")).toBeInTheDocument();
  });

  it("タイマー終了状態（data-finished='true'）のレーンで「完了」を押すと、保留中は data-finished='false' になる", () => {
    const { container } = render(
      <LaneActive {...baseProps} targetDurationSec={3} timerStartedAt="2026-04-18 12:00:00" />,
    );
    const lane = container.querySelector("[data-finished]");
    expect(lane).toHaveAttribute("data-finished", "true");

    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    expect(lane).toHaveAttribute("data-finished", "false");

    // 元に戻すと再評価されて true に戻る
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(lane).toHaveAttribute("data-finished", "true");
  });

  it("isCancelling のとき「完了」ボタンが disabled", () => {
    render(
      <LaneActive
        {...baseProps}
        targetDurationSec={60}
        timerStartedAt="2026-04-18 12:00:00"
        isCancelling
      />,
    );
    expect(screen.getByRole("button", { name: "完了" })).toBeDisabled();
  });

  it("保留中もタイマー関連 UI はアンマウントされず非表示（hidden）で維持される", () => {
    render(
      <LaneActive {...baseProps} targetDurationSec={60} timerStartedAt="2026-04-18 12:00:00" />,
    );
    expect(screen.getByText("00:55")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    // DOM 上には存在するが hidden ラッパー内にある
    const timerEl = screen.getByText("00:55");
    expect(timerEl).toBeInTheDocument();
    expect(timerEl.closest(".hidden")).not.toBeNull();
  });
});
