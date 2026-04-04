import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("クラス名を結合する", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("Tailwindの競合クラスを解決する", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("falsy値を無視する", () => {
    expect(cn("foo", undefined, null, false, "bar")).toBe("foo bar");
  });
});
