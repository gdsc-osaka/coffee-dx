import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SwipeToConfirm } from "./SwipeToConfirm";

beforeAll(() => {
  // jsdom には setPointerCapture / hasPointerCapture / releasePointerCapture が無いのでスタブ
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

/**
 * jsdom 26 では PointerEvent が未実装で、fireEvent.pointerMove が clientX を
 * 伝搬できない。MouseEvent("pointermove", { clientX }) を直接 dispatch する。
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

describe("SwipeToConfirm", () => {
  let onConfirm: () => void;

  beforeEach(() => {
    onConfirm = vi.fn();
  });

  it("60% 以上スワイプして指を離すと onConfirm が呼ばれる", () => {
    render(<SwipeToConfirm onConfirm={onConfirm} threshold={0.6} />);
    const handle = screen.getByRole("button");
    setOffsetWidth(handle, 200);

    dispatchPointer(handle, "pointerdown", { pointerId: 1, clientX: 0 });
    dispatchPointer(handle, "pointermove", { pointerId: 1, clientX: 130 }); // 65%
    dispatchPointer(handle, "pointerup", { pointerId: 1, clientX: 130 });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("閾値未満で指を離すと onConfirm は呼ばれない", () => {
    render(<SwipeToConfirm onConfirm={onConfirm} threshold={0.6} />);
    const handle = screen.getByRole("button");
    setOffsetWidth(handle, 200);

    dispatchPointer(handle, "pointerdown", { pointerId: 1, clientX: 0 });
    dispatchPointer(handle, "pointermove", { pointerId: 1, clientX: 80 }); // 40%
    dispatchPointer(handle, "pointerup", { pointerId: 1, clientX: 80 });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disabled のとき onConfirm が呼ばれない", () => {
    render(<SwipeToConfirm onConfirm={onConfirm} disabled />);
    const handle = screen.getByRole("button");
    setOffsetWidth(handle, 200);

    dispatchPointer(handle, "pointerdown", { pointerId: 1, clientX: 0 });
    dispatchPointer(handle, "pointermove", { pointerId: 1, clientX: 200 });
    dispatchPointer(handle, "pointerup", { pointerId: 1, clientX: 200 });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("PointerCancel でも閾値超えなら onConfirm が呼ばれる（離した扱い）", () => {
    render(<SwipeToConfirm onConfirm={onConfirm} threshold={0.6} />);
    const handle = screen.getByRole("button");
    setOffsetWidth(handle, 200);

    dispatchPointer(handle, "pointerdown", { pointerId: 1, clientX: 0 });
    dispatchPointer(handle, "pointermove", { pointerId: 1, clientX: 180 });
    dispatchPointer(handle, "pointercancel", { pointerId: 1, clientX: 180 });

    // pointerCancel は handlePointerEnd を通るので、deltaX が 180 で 60% を超えていれば
    // onConfirm が呼ばれる仕様。ここでは「離す」ジェスチャと等価扱い
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
