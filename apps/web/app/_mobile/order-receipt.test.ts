import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MobileOrderReceipt, { ErrorBoundary, getMobileOrderDisplayState } from "./order-receipt";
import type { MobileOrderRequestResult } from "~/features/mobile-order/actions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getMobileOrderDisplayState", () => {
  it("会計待ちは会計待ちとして表示する", () => {
    expect(getMobileOrderDisplayState({ status: "awaiting_payment", orderStatus: null })).toBe(
      "payment",
    );
  });

  it("pending と brewing は抽出待ちにまとめる", () => {
    expect(getMobileOrderDisplayState({ status: "paid", orderStatus: "pending" })).toBe("brewing");
    expect(getMobileOrderDisplayState({ status: "paid", orderStatus: "brewing" })).toBe("brewing");
    expect(getMobileOrderDisplayState({ status: "paid", orderStatus: null })).toBe("brewing");
  });

  it("ready・completed・cancelled を客向け状態に変換する", () => {
    expect(getMobileOrderDisplayState({ status: "paid", orderStatus: "ready" })).toBe("ready");
    expect(getMobileOrderDisplayState({ status: "paid", orderStatus: "completed" })).toBe(
      "completed",
    );
    expect(getMobileOrderDisplayState({ status: "paid", orderStatus: "cancelled" })).toBe(
      "cancelled",
    );
    expect(getMobileOrderDisplayState({ status: "cancelled", orderStatus: null })).toBe(
      "cancelled",
    );
  });
});

it("状態取得に失敗しても注文控えを残し、次の取得で更新する", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("temporary error", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "paid", orderStatus: "ready" }));
  vi.stubGlobal("fetch", fetchMock);

  const order: MobileOrderRequestResult = {
    id: "request-1",
    publicToken: "a".repeat(32),
    businessDate: "2026-10-04",
    orderNumber: 128,
    status: "paid",
    orderStatus: "pending",
    createdAt: "2026-10-04 10:00:00",
    items: [{ menuItemId: "coffee-1", name: "ブレンドコーヒー", quantity: 2, price: 300 }],
  };
  render(
    createElement(MobileOrderReceipt, {
      loaderData: { order },
    } as Parameters<typeof MobileOrderReceipt>[0]),
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.getByText("再接続中")).toBeInTheDocument();
  expect(screen.getByText("抽出をお待ちください")).toBeInTheDocument();
  expect(screen.getByText("ブレンドコーヒー")).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.getByText("コーヒーができました")).toBeInTheDocument();
  expect(screen.getByText("自動更新中")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("初回取得に失敗した場合は再試行ボタンを表示する", () => {
  render(
    createElement(ErrorBoundary, {
      error: new Error("temporary failure"),
      params: { publicToken: "a".repeat(32) },
    }),
  );
  expect(screen.getByText("注文状況を読み込めませんでした")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "再試行する" })).toBeInTheDocument();
});
