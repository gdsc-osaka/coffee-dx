import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

import { ProductionDashboard } from "./ProductionDashboard";
import type { ProductionIndicator } from "../home";

function build(overrides: Partial<ProductionIndicator>): ProductionIndicator {
  return {
    menuItemId: "menu-1",
    menuItemName: "アメリカーノ",
    shortage: 0,
    extra: 0,
    surplus: 0,
    ...overrides,
  };
}

const renderDashboard = (
  indicators: ProductionIndicator[],
  options: { submittingIntent?: string; submittingMenuId?: string } = {},
) =>
  render(
    <ProductionDashboard
      indicators={indicators}
      eventId="2026-04-18"
      submittingIntent={options.submittingIntent ?? null}
      submittingMenuId={options.submittingMenuId ?? null}
    />,
  );

describe("ProductionDashboard", () => {
  it("indicators が空のとき何もレンダリングしない", () => {
    const { container } = renderDashboard([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("shortage > 0 のとき 不足バッジが表示される", () => {
    renderDashboard([build({ shortage: 2 })]);
    expect(screen.getByText(/あと 2 杯 不足/)).toBeInTheDocument();
  });

  it("extra > 0 のとき 余裕バッジが表示される", () => {
    renderDashboard([build({ extra: 1 })]);
    expect(screen.getByText(/\+1 杯 余裕/)).toBeInTheDocument();
  });

  it("shortage と extra がいずれも 0 のとき 不足なしバッジが表示される", () => {
    renderDashboard([build({ shortage: 0, extra: 0 })]);
    expect(screen.getByText("不足なし")).toBeInTheDocument();
  });

  it("surplus > 0 のとき 余剰削除ボタンが出る", () => {
    renderDashboard([build({ shortage: 0, extra: 1, surplus: 1 })]);
    expect(screen.getByTitle("余剰を1件減らす")).toBeEnabled();
  });

  it("surplus が 0 のとき 余剰削除ボタンは出ない", () => {
    renderDashboard([build({ surplus: 0 })]);
    expect(screen.queryByTitle("余剰を1件減らす")).not.toBeInTheDocument();
  });

  it("当該メニューの削除を submit 中はボタンが disabled になる", () => {
    renderDashboard([build({ surplus: 1 })], {
      submittingIntent: "menu-surplus-decrease",
      submittingMenuId: "menu-1",
    });
    expect(screen.getByTitle("余剰を1件減らす")).toBeDisabled();
  });

  it("複数メニューが順番に並ぶ", () => {
    renderDashboard([
      build({ menuItemId: "m1", menuItemName: "アイスコーヒー", shortage: 1 }),
      build({ menuItemId: "m2", menuItemName: "ホットコーヒー", extra: 0, shortage: 0 }),
      build({ menuItemId: "m3", menuItemName: "カフェラテ", extra: 2 }),
    ]);
    expect(screen.getByText("アイスコーヒー")).toBeInTheDocument();
    expect(screen.getByText("ホットコーヒー")).toBeInTheDocument();
    expect(screen.getByText("カフェラテ")).toBeInTheDocument();
    expect(screen.getByText(/あと 1 杯 不足/)).toBeInTheDocument();
    expect(screen.getByText("不足なし")).toBeInTheDocument();
    expect(screen.getByText(/\+2 杯 余裕/)).toBeInTheDocument();
  });
});
