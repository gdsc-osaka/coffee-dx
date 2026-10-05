import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PriceAdjustmentDialog } from "./PriceAdjustmentDialog";

describe("PriceAdjustmentDialog", () => {
  it("定価と0個で開き、-100円と個数を適用する", () => {
    const onComplete = vi.fn();
    render(
      <PriceAdjustmentDialog
        item={{ id: "coffee", name: "コーヒーA", price: 300 }}
        onOpenChange={vi.fn()}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByLabelText("適用単価")).toHaveValue("300");
    expect(screen.getByText("個数")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完了する" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "−100円" }));
    fireEvent.click(screen.getByRole("button", { name: "変更する個数を1つ増やす" }));
    fireEvent.click(screen.getByRole("button", { name: "完了する" }));

    expect(onComplete).toHaveBeenCalledWith(200, 1);
  });

  it("-100円を繰り返しても0円未満にならない", () => {
    render(
      <PriceAdjustmentDialog
        item={{ id: "snack", name: "お菓子", price: 100 }}
        onOpenChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const minus100 = screen.getByRole("button", { name: "−100円" });
    fireEvent.click(minus100);
    fireEvent.click(minus100);

    expect(screen.getByLabelText("適用単価")).toHaveValue("0");
  });
});
