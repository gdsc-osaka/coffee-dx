import { describe, expect, it } from "vitest";
import { normalizeCartItems } from "./normalize-cart-items";

const menus = [
  { id: "menu-1", name: "コーヒー", price: 300 },
  { id: "menu-2", name: "お菓子", price: 200 },
];

describe("normalizeCartItems", () => {
  it("存在しない商品が1件でも含まれていれば注文全体を拒否する", () => {
    const result = normalizeCartItems(
      [
        { menuItemId: "menu-1", quantity: 1 },
        { menuItemId: "missing", quantity: 1 },
      ],
      menus,
    );

    expect(result).toBeNull();
  });

  it("同じ商品IDの価格違い行を統合せずに残す", () => {
    const result = normalizeCartItems(
      [
        { menuItemId: "menu-1", unitPriceAtOrder: 300, quantity: 1 },
        { menuItemId: "menu-1", unitPriceAtOrder: 200, quantity: 1 },
      ],
      menus,
    );

    expect(result).toEqual([
      {
        menuItemId: "menu-1",
        name: "コーヒー",
        price: 300,
        unitPriceAtOrder: 300,
        quantity: 1,
      },
      {
        menuItemId: "menu-1",
        name: "コーヒー",
        price: 300,
        unitPriceAtOrder: 200,
        quantity: 1,
      },
    ]);
  });
});
