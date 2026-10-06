import { describe, expect, it } from "vitest";
import {
  addBasePriceItem,
  addPriceLine,
  getBasePriceQuantity,
  removeOneMenuItem,
  updatePriceLinePrice,
  updatePriceLineQuantity,
  type OrderCartLine,
} from "./cart";

const coffee = { id: "coffee", name: "コーヒーA", price: 300 };

describe("order cart", () => {
  it("通常追加は定価行へまとめる", () => {
    const cart = addBasePriceItem(addBasePriceItem([], coffee), coffee);

    expect(cart).toHaveLength(1);
    expect(cart[0]).toEqual(
      expect.objectContaining({
        menuItemId: "coffee",
        name: "コーヒーA",
        basePrice: 300,
        unitPriceAtOrder: 300,
        quantity: 2,
      }),
    );
    expect(cart[0].id).toMatch(/^cart-line-/);
  });

  it("変更価格行は定価行と独立して追加される", () => {
    const base = { ...addBasePriceItem([], coffee)[0], quantity: 3 };
    const cart = addPriceLine([base], coffee, 200, 1);

    expect(cart).toEqual([
      expect.objectContaining({ unitPriceAtOrder: 300, quantity: 3 }),
      expect.objectContaining({ unitPriceAtOrder: 200, quantity: 1 }),
    ]);
    expect(getBasePriceQuantity(cart, coffee.id, coffee.price)).toBe(3);
  });

  it("同じ変更価格はまとめ、別価格は別明細にする", () => {
    const base = { ...addBasePriceItem([], coffee)[0], quantity: 3 };
    const discounted = addPriceLine([base], coffee, 200, 1);
    const discountedId = discounted[1].id;
    const merged = addPriceLine(discounted, coffee, 200, 1);
    const split = addPriceLine(merged, coffee, 100, 1);

    expect(split.map(({ unitPriceAtOrder, quantity }) => ({ unitPriceAtOrder, quantity }))).toEqual(
      [
        { unitPriceAtOrder: 300, quantity: 3 },
        { unitPriceAtOrder: 200, quantity: 2 },
        { unitPriceAtOrder: 100, quantity: 1 },
      ],
    );
    expect(merged[1].id).toBe(discountedId);
  });

  it("商品カードのマイナスは定価行だけを減らす", () => {
    const cart: OrderCartLine[] = [
      {
        id: "adjusted-line",
        menuItemId: "coffee",
        name: "コーヒーA",
        basePrice: 300,
        unitPriceAtOrder: 200,
        quantity: 1,
      },
      {
        id: "base-line",
        menuItemId: "coffee",
        name: "コーヒーA",
        basePrice: 300,
        unitPriceAtOrder: 300,
        quantity: 1,
      },
    ];

    const withoutBase = removeOneMenuItem(cart, coffee.id, coffee.price);
    expect(withoutBase).toHaveLength(1);
    expect(withoutBase[0].unitPriceAtOrder).toBe(200);
    expect(removeOneMenuItem(withoutBase, coffee.id, coffee.price)).toEqual(withoutBase);
  });

  it("変更価格行の個数と価格を直接編集できる", () => {
    const cart = addPriceLine([], coffee, 200, 1);
    const lineId = cart[0].id;
    const quantityUpdated = updatePriceLineQuantity(cart, lineId, 2);
    const priceUpdated = updatePriceLinePrice(quantityUpdated, lineId, 100);

    expect(priceUpdated).toEqual([expect.objectContaining({ unitPriceAtOrder: 100, quantity: 2 })]);
    expect(updatePriceLineQuantity(priceUpdated, lineId, 0)).toEqual([]);
  });

  it("価格変更先に同じ商品・同じ価格の行があれば編集中の行IDを残して統合する", () => {
    const cart: OrderCartLine[] = [
      {
        id: "editing-line",
        menuItemId: "coffee",
        name: "コーヒーA",
        basePrice: 300,
        unitPriceAtOrder: 100,
        quantity: 1,
      },
      {
        id: "existing-line",
        menuItemId: "coffee",
        name: "コーヒーA",
        basePrice: 300,
        unitPriceAtOrder: 200,
        quantity: 2,
      },
    ];

    expect(updatePriceLinePrice(cart, "editing-line", 200)).toEqual([
      expect.objectContaining({
        id: "editing-line",
        unitPriceAtOrder: 200,
        quantity: 3,
      }),
    ]);
  });
});
