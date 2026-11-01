import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrderAllocationList } from "./OrderAllocationList";

describe("OrderAllocationList", () => {
  it("注文番号ごとの杯数と余りを表示する", () => {
    render(
      <OrderAllocationList
        allocation={{
          orders: [
            { orderNumber: 12, count: 2 },
            { orderNumber: 15, count: 1 },
          ],
          surplus: 1,
        }}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["#12 ×2", "#15 ×1", "余り ×1"]);
  });

  it("余りが 0 杯なら余りは表示しない", () => {
    render(
      <OrderAllocationList allocation={{ orders: [{ orderNumber: 3, count: 1 }], surplus: 0 }} />,
    );
    expect(screen.queryByText(/余り/)).not.toBeInTheDocument();
  });

  it("割り当てがなければ何も表示しない", () => {
    const { container } = render(<OrderAllocationList allocation={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
