import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data?: { ok: boolean; orderId?: string; error?: string };
  formData?: FormData;
};

const { useFetcherMock } = vi.hoisted(() => ({ useFetcherMock: vi.fn() }));

vi.mock("react-router", () => ({
  useFetcher: useFetcherMock,
}));

import { LeftoverOrdersBanner, msUntilNextJstDay } from "./LeftoverOrdersBanner";

const leftoverOrder = {
  id: "o-past",
  orderNumber: 246,
  status: "pending",
  isFree: false,
  businessDate: "2026-10-06",
  createdAt: "2026-10-06T08:00:00.000Z",
  items: [{ id: "i-past", menuItemId: "m1", name: "ブレンド", quantity: 1 }],
};

let fetcherState: FetcherState;

function mockFetcher(state: FetcherState) {
  fetcherState = state;
  useFetcherMock.mockImplementation(() => ({
    ...fetcherState,
    Form: ({ children, ...props }: React.ComponentProps<"form">) => (
      <form {...props}>{children}</form>
    ),
  }));
}

beforeEach(() => {
  mockFetcher({ state: "idle" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LeftoverOrdersBanner", () => {
  it("一覧の取得に失敗したら、やり残しなしと誤解されないよう警告と再読み込みを出す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(Response.json({ orders: [leftoverOrder] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LeftoverOrdersBanner />);

    expect(
      await screen.findByText("過去日のやり残し注文を確認できませんでした"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));

    expect(await screen.findByText("過去日のやり残し注文が 1 件あります")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("完了/キャンセルが失敗しても一覧を取り直す（他端末で処理済みの注文を消すため）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ orders: [leftoverOrder] }))
      .mockResolvedValueOnce(Response.json({ orders: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<LeftoverOrdersBanner />);
    expect(await screen.findByText("過去日のやり残し注文が 1 件あります")).toBeInTheDocument();

    mockFetcher({
      state: "idle",
      data: { ok: false, error: "この注文はすでに完了または取り消されています。" },
    });
    rerender(<LeftoverOrdersBanner />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("過去日のやり残し注文が 1 件あります")).not.toBeInTheDocument(),
    );
  });

  it("画面が表示に戻ったら一覧を取り直す", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ orders: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LeftoverOrdersBanner />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("JST の日付が変わった直後に一覧を取り直す", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // JST 2026-10-07 23:59:00
    vi.setSystemTime(new Date("2026-10-07T14:59:00.000Z"));
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ orders: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LeftoverOrdersBanner />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("msUntilNextJstDay", () => {
  it("JST の翌日 0 時までのミリ秒を返す", () => {
    // JST 2026-10-07 23:59:59
    expect(msUntilNextJstDay(Date.parse("2026-10-07T14:59:59.000Z"))).toBe(1_000);
    // JST 2026-10-08 00:00:00 ちょうどなら丸 1 日後
    expect(msUntilNextJstDay(Date.parse("2026-10-07T15:00:00.000Z"))).toBe(24 * 60 * 60 * 1000);
  });
});
