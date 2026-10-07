import type { CartItem } from "./actions";

type RequestedCartItem = {
  menuItemId: string;
  unitPriceAtOrder?: number;
  quantity: number;
};

type MenuItemRecord = {
  id: string;
  name: string;
  price: number;
};

export type NormalizedCartItem = Omit<CartItem, "name" | "price"> & {
  name: string;
  price: number;
};

/**
 * 送信された全商品をサーバー側のメニュー情報で正規化する。
 * 1件でも存在しない商品が含まれている場合は、部分注文にせず null を返す。
 */
export function normalizeCartItems(
  requestedItems: RequestedCartItem[],
  menuItemRecords: MenuItemRecord[],
): NormalizedCartItem[] | null {
  const menuItemMap = new Map(menuItemRecords.map((item) => [item.id, item]));
  const requestedMenuItemIds = [...new Set(requestedItems.map((item) => item.menuItemId))];

  if (requestedMenuItemIds.some((id) => !menuItemMap.has(id))) {
    return null;
  }

  return requestedItems.map((item) => {
    const menuItem = menuItemMap.get(item.menuItemId)!;
    return {
      menuItemId: item.menuItemId,
      name: menuItem.name,
      price: menuItem.price,
      unitPriceAtOrder: item.unitPriceAtOrder,
      quantity: item.quantity,
    };
  });
}
