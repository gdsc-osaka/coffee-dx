import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import MobileOrderHome from "./home";

const storeToken = "store-token";
const publicToken = "a".repeat(32);
const storageKey = `mobile-order:pending:${storeToken}`;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderQrMenu() {
  const props = {
    loaderData: { storeToken, items: [], isAccepting: true, businessDate: "2026-10-04" },
  } as unknown as Parameters<typeof MobileOrderHome>[0];
  const router = createMemoryRouter(
    [
      {
        path: "/mobile/:storeToken",
        element: <MobileOrderHome {...props} />,
      },
      { path: "/mobile/orders/:publicToken", element: <p>注文控え</p> },
    ],
    { initialEntries: [`/mobile/${storeToken}`] },
  );
  render(<RouterProvider router={router} />);
}

describe("QR再読込時の保存済み注文", () => {
  it.each([
    ["会計前の取消", { status: "cancelled", orderStatus: null }],
    ["会計後の取消", { status: "paid", orderStatus: "cancelled" }],
    ["受取済み", { status: "paid", orderStatus: "completed" }],
  ])("%sなら保存済みトークンを消して注文画面に留まる", async (_label, status) => {
    window.localStorage.setItem(storageKey, JSON.stringify({ publicToken }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(status)));

    renderQrMenu();

    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull());
    expect(screen.getByText("商品を選んで注文してください")).toBeInTheDocument();
    expect(screen.queryByText("注文控え")).not.toBeInTheDocument();
  });

  it("対応中の注文は控えに戻し、トークンを保持する", async () => {
    const saved = JSON.stringify({ publicToken });
    window.localStorage.setItem(storageKey, saved);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status: "paid", orderStatus: "ready" })),
    );

    renderQrMenu();

    expect(await screen.findByText("注文控え")).toBeInTheDocument();
    expect(window.localStorage.getItem(storageKey)).toBe(saved);
  });
});
