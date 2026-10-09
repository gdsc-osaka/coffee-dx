import { describe, expect, it } from "vitest";
import { safeStaffReturnTo } from "./auth-url";

describe("safeStaffReturnTo", () => {
  it("keeps staff paths and queries", () => {
    expect(safeStaffReturnTo("/order/mobile-checkout?tab=pending")).toBe(
      "/order/mobile-checkout?tab=pending",
    );
    expect(safeStaffReturnTo("/drip2?eventId=2026-10-09")).toBe("/drip2?eventId=2026-10-09");
  });

  it.each([
    "https://evil.example/order",
    "//evil.example/order",
    "/\\evil.example/order",
    "/staff/login",
    "/ordering",
    "/mobile/token",
    "/order#fragment",
  ])("rejects unsafe return path %s", (value) => {
    expect(safeStaffReturnTo(value)).toBe("/order");
  });
});
