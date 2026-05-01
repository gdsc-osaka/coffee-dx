import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LongPressButton } from "./LongPressButton";

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

/**
 * jsdom 26 では PointerEvent が未実装で、fireEvent.pointer* が clientX を
 * 伝搬できない。MouseEvent("pointer*", { clientX }) を直接 dispatch する。
 */
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

describe("LongPressButton", () => {
  let onLongPress: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    onLongPress = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1 秒押し続けると onLongPress が呼ばれる", () => {
    render(
      <LongPressButton onLongPress={onLongPress} duration={1000}>
        取消
      </LongPressButton>,
    );
    const btn = screen.getByRole("button", { name: "取消" });

    dispatchPointer(btn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("1 秒経たないうちに離すと onLongPress は呼ばれない", () => {
    render(
      <LongPressButton onLongPress={onLongPress} duration={1000}>
        取消
      </LongPressButton>,
    );
    const btn = screen.getByRole("button", { name: "取消" });

    dispatchPointer(btn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(btn, "pointerup", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("押している間に閾値以上動かすとキャンセルされる", () => {
    render(
      <LongPressButton onLongPress={onLongPress} duration={1000}>
        取消
      </LongPressButton>,
    );
    const btn = screen.getByRole("button", { name: "取消" });

    dispatchPointer(btn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(btn, "pointermove", { pointerId: 1, clientX: 30, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("disabled のときは onLongPress が呼ばれない", () => {
    render(
      <LongPressButton onLongPress={onLongPress} duration={1000} disabled>
        取消
      </LongPressButton>,
    );
    const btn = screen.getByRole("button", { name: "取消" });

    dispatchPointer(btn, "pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
