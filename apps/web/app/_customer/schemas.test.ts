import { describe, expect, it } from "vitest";
import { cartItemSchema, cartJsonSchema } from "./schemas";

describe("cartItemSchema", () => {
  it("正常な入力を受け付ける", () => {
    const result = cartItemSchema.safeParse({ menuItemId: "abc", quantity: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ menuItemId: "abc", quantity: 2 });
    }
  });

  it("menuItemId が空文字の場合は失敗する", () => {
    const result = cartItemSchema.safeParse({ menuItemId: "", quantity: 1 });
    expect(result.success).toBe(false);
  });

  it("quantity が 0 の場合は失敗する", () => {
    const result = cartItemSchema.safeParse({ menuItemId: "abc", quantity: 0 });
    expect(result.success).toBe(false);
  });

  it("quantity が負数の場合は失敗する", () => {
    const result = cartItemSchema.safeParse({ menuItemId: "abc", quantity: -1 });
    expect(result.success).toBe(false);
  });

  it("quantity が小数の場合は失敗する", () => {
    const result = cartItemSchema.safeParse({ menuItemId: "abc", quantity: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("cartJsonSchema", () => {
  it("正常な JSON を受け付けてパース済み配列を返す", () => {
    const input = JSON.stringify([{ menuItemId: "abc", quantity: 2 }]);
    const result = cartJsonSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ menuItemId: "abc", quantity: 2 }]);
    }
  });

  it("複数アイテムを受け付ける", () => {
    const input = JSON.stringify([
      { menuItemId: "abc", quantity: 1 },
      { menuItemId: "def", quantity: 3 },
    ]);
    const result = cartJsonSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("不正な JSON 文字列の場合はエラーになる", () => {
    const result = cartJsonSchema.safeParse("not-json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("カートデータが不正です");
    }
  });

  it("空配列の場合はエラーになる", () => {
    const result = cartJsonSchema.safeParse("[]");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("カートが空です");
    }
  });

  it("quantity が不正なアイテムが含まれる場合はエラーになる", () => {
    const input = JSON.stringify([{ menuItemId: "abc", quantity: -1 }]);
    const result = cartJsonSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("null を渡した場合はエラーになる", () => {
    const result = cartJsonSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});
