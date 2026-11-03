import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnservedOrders } from "./UnservedOrders";

describe("UnservedOrders", () => {
  it("注文番号・品目と、品目ごとの杯の状態を表示する", () => {
    render(
      <UnservedOrders
        orders={[
          {
            id: "o1",
            orderNumber: 12,
            createdAt: "2026-11-03 10:00:00",
            status: "brewing",
            items: [
              {
                id: "i1",
                name: "カフェラテ",
                quantity: 3,
                fulfillmentTypeAtOrder: "brew",
                readyCount: 1,
                brewingCount: 1,
                pendingCount: 1,
              },
              {
                id: "i2",
                name: "クッキー",
                quantity: 1,
                fulfillmentTypeAtOrder: "direct",
                readyCount: 1,
                brewingCount: 0,
                pendingCount: 0,
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("カフェラテ")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "完成1・抽出中1・未着手1" })).toBeInTheDocument();
    expect(screen.getByText("受渡済")).toBeInTheDocument();
  });

  it("注文がなければその旨を表示する", () => {
    render(<UnservedOrders orders={[]} />);
    expect(screen.getByText("未提供の注文はありません")).toBeInTheDocument();
  });
});
